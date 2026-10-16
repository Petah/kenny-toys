import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { load, save } from '@shared/storage';
import { MUSIC } from './assets.ts';
import { makeIcons } from '@shared/model-icons';
import { PETS, type PetKind } from './pets.ts';
import { DROP_GAP, PEDESTAL_HALF, PEDESTAL_HEIGHT, STEP, Stack, extent, type Pet, type PetShape } from './stack.ts';

export interface PetModel {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  shape: PetShape;
}

type State = 'title' | 'aim' | 'drop' | 'over';
type Clip = 'idle' | 'walk' | 'run' | 'dance' | 'gesture-positive' | 'gesture-negative' | 'static';

/** A pet's model with its own animations, in the air or on the tower. */
interface PetView {
  kind: PetKind;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  clip?: Clip;
  pet?: Pet;
  /** Physics pose last step and this step, for drawing in between. */
  prev: { p: THREE.Vector3; q: THREE.Quaternion };
  next: { p: THREE.Vector3; q: THREE.Quaternion };
  /** Has it cheered for landing yet. */
  cheered: boolean;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

/** 1 world unit is 10cm: a pet stands about 15cm tall. */
const CM = 10;
const HEARTS = 3;
/** How far the hanging pet can go either side. */
const REACH = PEDESTAL_HALF + 1.6;
const MOVE_SPEED = 5;
/** Seconds to drop each pet: generous at first, then quicker. */
const aimTime = (placed: number) => Math.max(6, 11 - placed * 0.25);
/** Longest wait for a drop to settle before the next pet comes anyway. */
const MAX_WAIT = 5;
/** Seconds a fallen pet tumbles before it vanishes in a puff. */
const FALLEN_LINGER = 1.4;
/** The first pets are flat-headed ones, to get going. */
const EASY: PetKind[] = ['beaver', 'panda', 'polar', 'koala', 'elephant', 'pig', 'dog', 'hog'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const Z = new THREE.Vector3(0, 0, 1);

export class StackGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private renderer: THREE.WebGLRenderer;
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  private timer = new THREE.Timer();

  private state: State = 'title';
  private stack!: Stack;
  private views: PetView[] = [];
  private puffs: Puff[] = [];
  private bag: PetKind[] = [];
  private nextKind: PetKind = 'beaver';

  /** The pet waiting to be dropped. */
  private held?: PetView;
  private aimX = 0;
  private angle = 0;
  /** The angle drawn, which swings round to `angle`. */
  private shownAngle = 0;
  private holdY = 2;
  private aimLeft = 0;
  private wait = 0;
  private turn = 0;
  /** The turn a heart was last lost on, so one bad drop costs only one heart. */
  private heartTurn = -1;
  private hearts = HEARTS;
  private placed = 0;
  private runBest = 0;
  private best = load<number>('pet-stack:best', 0);
  private cheeredBest = false;
  private overIn = 0;
  private acc = 0;
  private lastKnock = 0;
  private lastTick = 0;
  private danceFor = 0;

  private keys = new Set<string>();
  private drag?: { id: number; startX: number; aimX: number; moved: boolean; touch: boolean };
  private wheelAt = 0;
  private camY = 0;
  private camDist = 14;
  private shake = 0;
  private bestLine: THREE.Group;
  private titlePet?: PetView;
  private ray = new THREE.Raycaster();
  private clouds: THREE.Group[] = [];
  private icons: Record<string, string>;

  constructor(
    stage: HTMLElement,
    private models: Record<string, PetModel>,
    private scenery: Record<string, THREE.Object3D>,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.buildWorld();
    this.bestLine = this.makeBestLine();
    this.scene.add(this.bestLine);
    this.stack = new Stack(this.shapes());
    this.icons = makeIcons({ ...Object.fromEntries(Object.entries(models).map(([k, m]) => [k, m.scene])), heart: scenery.heart });
    this.drawHearts();
    this.bindInput();
    this.showTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private shapes() {
    return Object.fromEntries(Object.entries(this.models).map(([k, m]) => [k, m.shape]));
  }

  // ---- The world ---------------------------------------------------------------------------

  /** Sky, meadow, the grass pedestal and a ring of trees, flowers and fences round it. */
  private buildWorld() {
    const sky = document.createElement('canvas');
    sky.width = 4;
    sky.height = 256;
    const g = sky.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#5fb6ec');
    grad.addColorStop(0.65, '#bfe6f7');
    grad.addColorStop(1, '#eef8e8');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(0xd6efd8, 30, 80);

    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x5d8a3c, 1.6));
    this.sun.position.set(-6, 14, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -9;
    cam.right = cam.top = 9;
    cam.near = 1;
    cam.far = 60;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshStandardMaterial({ color: 0x7cc456, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -PEDESTAL_HEIGHT;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const pedestal = this.scenery['block-grass-large-tall'].clone();
    pedestal.scale.setScalar(PEDESTAL_HEIGHT / 2);
    pedestal.position.y = -PEDESTAL_HEIGHT;
    this.scene.add(pedestal);

    // Scenery dotted round the back and sides, never in front of the tower.
    let seed = 99;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const place = (name: string, x: number, z: number, scale: number) => {
      const m = this.scenery[name].clone();
      m.position.set(x, -PEDESTAL_HEIGHT, z);
      m.rotation.y = rand() * Math.PI * 2;
      m.scale.setScalar(scale);
      this.scene.add(m);
    };
    // Woods at the back of the meadow, thinning towards the front at the sides.
    for (let i = 0; i < 90; i++) {
      const x = (rand() - 0.5) * 70;
      const z = -10 - rand() * 30 + (Math.abs(x) > 14 ? rand() * 12 : 0);
      place(rand() < 0.5 ? 'tree' : 'tree-pine', x, z, 2.4 + rand() * 2.4);
    }
    for (let i = 0; i < 90; i++) {
      const x = (rand() - 0.5) * 36;
      // Only low things up front, and nothing between the camera and the pedestal.
      const z = 1.5 - rand() * 12;
      if (Math.abs(x) < PEDESTAL_HALF + 1 && z > -2.5) continue;
      const front = z > -2;
      const kinds = front ? ['flowers', 'grass', 'grass', 'mushrooms'] : ['flowers', 'flowers-tall', 'grass', 'rocks', 'mushrooms', 'plant', 'hedge'];
      place(kinds[Math.floor(rand() * kinds.length)], x, z, (front ? 1 : 1.3) + rand() * 0.8);
    }
    // A fence behind the pedestal.
    for (let i = -6; i <= 6; i++) {
      const f = this.scenery['fence-straight'].clone();
      f.position.set(i * 1.5, -PEDESTAL_HEIGHT, -3.6);
      f.scale.setScalar(1.5);
      this.scene.add(f);
    }
    // Clouds: lumpy white blobs drifting high up.
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 });
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), cloudMat);
        b.position.set((k - 2) * 1.1 + rand() * 0.4, Math.sin(k * 1.3) * 0.3, rand() * 0.6);
        b.scale.setScalar(0.9 + (2 - Math.abs(k - 2)) * 0.35);
        c.add(b);
      }
      c.position.set((rand() - 0.5) * 60, 8 + rand() * 30, -20 - rand() * 15);
      c.scale.setScalar(1 + rand() * 1.2);
      c.userData.drift = 0.2 + rand() * 0.3;
      this.clouds.push(c);
      this.scene.add(c);
    }
  }

  /** A dashed line across the pedestal at the best height so far, with a flag on the end. */
  private makeBestLine() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85 });
    for (let x = -REACH; x < REACH; x += 0.5) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.05), mat);
      dash.position.set(x + 0.14, 0, 0.75);
      group.add(dash);
    }
    const flag = this.scenery.flag.clone();
    flag.position.set(REACH + 0.1, -0.05, 0.75);
    flag.scale.setScalar(1.2);
    group.add(flag);
    group.visible = false;
    return group;
  }

  // ---- Pets --------------------------------------------------------------------------------

  private makeView(kind: PetKind): PetView {
    const model = this.models[kind];
    const root = new THREE.Group();
    const body = model.scene.clone();
    root.add(body);
    const mixer = new THREE.AnimationMixer(body);
    const actions = new Map(model.clips.map((c) => [c.name, mixer.clipAction(c)]));
    const view: PetView = {
      kind, root, mixer, actions, cheered: false,
      prev: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
      next: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
    };
    this.scene.add(root);
    return view;
  }

  /** Plays a clip, looping or once (then back to idle), fading from whatever was playing. */
  private play(view: PetView, clip: Clip, once = false) {
    const next = view.actions.get(clip);
    if (!next || (view.clip === clip && !once)) return;
    const prev = view.clip ? view.actions.get(view.clip) : undefined;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = 0.9 + Math.random() * 0.2;
    next.play();
    if (prev && prev !== next) next.crossFadeFrom(prev, 0.2, false);
    view.clip = clip;
    if (once) {
      const back = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== next) return;
        view.mixer.removeEventListener('finished', back);
        if (view.clip === clip && view.pet?.state !== 'fallen') this.play(view, 'idle');
      };
      view.mixer.addEventListener('finished', back);
    }
  }

  private removeView(view: PetView) {
    this.scene.remove(view.root);
    view.mixer.stopAllAction();
    this.views.splice(this.views.indexOf(view), 1);
  }

  /** The next pet from a shuffled bag of all of them, flat-headed ones first. */
  private draw(): PetKind {
    if (!this.bag.length) {
      this.bag = [...PETS].sort(() => Math.random() - 0.5);
      if (this.turn === 0) {
        const easy = [...EASY].sort(() => Math.random() - 0.5).slice(0, 3);
        this.bag = [...this.bag.filter((k) => !easy.includes(k)), ...easy];
      }
    }
    return this.bag.pop()!;
  }

  // ---- Flow --------------------------------------------------------------------------------

  private showTitle() {
    this.state = 'title';
    document.body.classList.add('on-title');
    $('title').classList.add('show');
    $('over').classList.remove('show');
    $('title-best').textContent = this.best ? `Best tower: ${this.best}cm` : '';
    // A pet dancing on the pedestal while you decide.
    const kind = EASY[Math.floor(Math.random() * EASY.length)];
    this.titlePet = this.makeView(kind);
    this.titlePet.root.position.set(0, 0, 0);
    this.play(this.titlePet, 'dance');
    this.camY = 1;
    this.camDist = 12;
  }

  private start() {
    this.sounds.play('click');
    void this.sounds.music(MUSIC, 0.18);
    if (this.titlePet) {
      this.scene.remove(this.titlePet.root);
      this.titlePet = undefined;
    }
    for (const v of [...this.views]) this.removeView(v);
    for (const p of this.puffs) this.scene.remove(p.mesh);
    this.puffs = [];
    this.stack.world.free();
    this.stack = new Stack(this.shapes());
    this.hearts = HEARTS;
    this.placed = 0;
    this.turn = 0;
    this.heartTurn = -1;
    this.runBest = 0;
    this.cheeredBest = false;
    this.bag = [];
    this.nextKind = this.draw();
    this.aimX = 0;
    this.drawHearts();
    this.updateHeight();
    $('title').classList.remove('show');
    $('over').classList.remove('show');
    document.body.classList.remove('on-title');
    this.hint(matchMedia('(pointer: coarse)').matches ? 'Drag to aim, let go to drop' : 'Click to drop · right-click to turn');
    this.sounds.play('go');
    this.nextPet();
  }

  /** Hangs the next pet over the tower. */
  private nextPet() {
    this.state = 'aim';
    const kind = this.nextKind;
    this.nextKind = this.draw();
    $<HTMLImageElement>('next-icon').src = this.icons[this.nextKind];
    this.held = this.makeView(kind);
    this.play(this.held, 'walk');
    // After the first few, pets come any way up, so each one wants turning to sit right.
    this.angle = this.turn < 3 ? 0 : (Math.floor(Math.random() * 4) * Math.PI) / 2;
    this.shownAngle = this.angle;
    this.holdY = this.wantedHoldY();
    this.aimLeft = aimTime(this.placed);
    this.lastTick = Math.ceil(this.aimLeft);
  }

  /** Where the held pet hangs: its lowest point DROP_GAP over everything on the tower. */
  private wantedHoldY() {
    let top = 0;
    for (const p of this.stack.pets) if (p.state !== 'fallen') top = Math.max(top, this.stack.top(p));
    if (!this.held) return top + DROP_GAP;
    return top + DROP_GAP - extent(this.models[this.held.kind].shape, this.angle).minY;
  }

  private turnHeld(dir: 1 | -1) {
    if (this.state !== 'aim') return;
    this.angle += (dir * Math.PI) / 2;
    this.sounds.play('turn', { volume: 0.4 });
  }

  private dropHeld() {
    if (this.state !== 'aim' || !this.held) return;
    const view = this.held;
    // Let go from where it's drawn, but never inside something, even if the hanging height is
    // still catching up.
    const y = Math.max(view.root.position.y, this.wantedHoldY());
    this.held = undefined;
    view.pet = this.stack.drop(view.kind, this.aimX, y, this.angle);
    this.syncView(view, true);
    this.views.push(view);
    this.play(view, 'run');
    this.sounds.play('drop', { volume: 0.35 });
    this.state = 'drop';
    this.wait = 0;
    this.hint('');
  }

  private loseHeart() {
    if (this.heartTurn === this.turn || this.hearts <= 0) return;
    this.heartTurn = this.turn;
    this.hearts--;
    this.drawHearts();
    this.shake = 0.5;
    this.sounds.play('oops', { volume: 0.5 });
    if (this.hearts > 0) this.banner(this.hearts === 1 ? 'Careful!' : 'Oops!', this.hearts === 1 ? 'One heart left' : '');
    else this.overIn = 1.6;
  }

  private gameOver() {
    this.state = 'over';
    if (this.held) {
      this.scene.remove(this.held.root);
      this.held = undefined;
    }
    const height = Math.round(this.runBest * CM);
    const record = height > this.best;
    if (record) {
      this.best = height;
      save('pet-stack:best', height);
    }
    const stacked = this.stack.pets.filter((p) => p.state === 'landed').length;
    $('over-title').textContent = record && height > 0 ? 'New best!' : 'Tower down!';
    $('over-height').textContent = String(height);
    $('over-pets').textContent = String(Math.max(stacked, 0));
    $('over-note').textContent = record ? 'Your tallest tower yet' : `Best: ${this.best}cm`;
    $('over').classList.add('show');
    $('ring').style.display = 'none';
    this.sounds.play('over', { volume: 0.7 });
    this.sounds.play('sad', { volume: 0.5 });
    for (const v of this.views) if (v.pet?.state === 'landed') this.play(v, 'gesture-negative', true);
  }

  // ---- Each frame --------------------------------------------------------------------------

  private frame(t: number) {
    this.timer.update(t);
    const dt = Math.min(this.timer.getDelta(), 0.05);

    if (this.state === 'aim' || this.state === 'drop' || this.state === 'over') {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        for (const v of this.views) {
          v.prev.p.copy(v.next.p);
          v.prev.q.copy(v.next.q);
        }
        this.stack.step();
        for (const v of this.views) this.syncView(v, false);
        this.afterStep();
      }
      const alpha = this.acc / STEP;
      for (const v of this.views) {
        v.root.position.lerpVectors(v.prev.p, v.next.p, alpha);
        v.root.quaternion.slerpQuaternions(v.prev.q, v.next.q, alpha);
      }
    }

    if (this.state === 'aim') this.updateAim(dt);
    if (this.state === 'drop') {
      this.wait += dt;
      const dropped = this.views.at(-1)?.pet;
      const landedOrGone = !dropped || dropped.state !== 'falling';
      if ((landedOrGone && this.stack.settled()) || this.wait > MAX_WAIT) this.afterDrop();
    }
    if (this.overIn > 0) {
      this.overIn -= dt;
      if (this.overIn <= 0) this.gameOver();
    }
    if (this.danceFor > 0) {
      this.danceFor -= dt;
      if (this.danceFor <= 0) for (const v of this.views) if (v.pet?.state === 'landed' && v.clip === 'dance') this.play(v, 'idle');
    }

    for (const v of this.views) v.mixer.update(dt);
    if (this.held) this.held.mixer.update(dt);
    if (this.titlePet) {
      this.titlePet.mixer.update(dt);
      this.titlePet.root.rotation.y = Math.sin(t / 1400) * 0.5;
    }
    this.updatePuffs(dt);
    for (const c of this.clouds) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 40) c.position.x = -40;
    }
    this.updateCamera(dt);
    this.updateOverlays();
    this.renderer.render(this.scene, this.camera);
  }

  /** Copies a pet's physics pose into what gets drawn. */
  private syncView(v: PetView, snap: boolean) {
    if (!v.pet) return;
    const t = v.pet.body.translation();
    const r = v.pet.body.rotation();
    v.next.p.set(t.x, t.y, t.z);
    v.next.q.set(r.x, r.y, r.z, r.w);
    if (snap) {
      v.prev.p.copy(v.next.p);
      v.prev.q.copy(v.next.q);
    }
  }

  /** Sounds, cheers and falls, after each physics step. */
  private afterStep() {
    const now = performance.now();
    for (const v of [...this.views]) {
      const p = v.pet!;
      if (p.thump > 1.5 && now - this.lastKnock > 70) {
        this.lastKnock = now;
        const hard = Math.min(1, p.thump / 5);
        this.sounds.play(p.state === 'fallen' ? 'land' : 'knock', { volume: 0.15 + hard * 0.4 });
        if (hard > 0.5) this.puff(v.next.p.clone().add(new THREE.Vector3(0, 0.1, 0)), 4, 0.25);
      }
      if (p.state === 'landed' && !v.cheered && p.still > 0.3) {
        v.cheered = true;
        this.play(v, 'gesture-positive', true);
        this.sounds.play('settle', { volume: 0.35 });
      }
      if (p.state === 'fallen' && p.fallenFor === 0) {
        // Just went over the edge.
        p.fallenFor = 1e-6;
        this.play(v, 'gesture-negative');
        this.sounds.play('fall', { volume: 0.4 });
        if (this.state !== 'over') this.loseHeart();
      }
      if (p.state === 'fallen' && p.fallenFor > FALLEN_LINGER) {
        this.puff(v.next.p.clone().add(new THREE.Vector3(0, 0.6, 0)), 12, 0.5);
        this.sounds.play('poof', { volume: 0.4 });
        this.stack.remove(p);
        this.removeView(v);
      }
    }
  }

  private afterDrop() {
    if (this.hearts <= 0) {
      this.state = 'over';
      return;
    }
    const dropped = this.views.at(-1)?.pet;
    if (dropped && dropped.state === 'landed') this.placed++;
    this.turn++;
    this.updateHeight();
    this.nextPet();
  }

  /** Height so far, best of the run, and the cheers for each metre and a new record. */
  private updateHeight() {
    const h = this.stack.height();
    const cm = Math.round(h * CM);
    $('height').innerHTML = `${cm}<small>cm</small>`;
    const before = this.runBest;
    this.runBest = Math.max(this.runBest, h);
    const best = Math.max(this.best, Math.round(this.runBest * CM));
    $('best').textContent = best ? `BEST ${best}cm` : '';
    const metre = Math.floor((this.runBest * CM) / 100);
    if (metre > Math.floor((before * CM) / 100)) {
      // Each new metre wins back a heart.
      const heal = this.hearts < HEARTS;
      if (heal) {
        this.hearts++;
        this.drawHearts();
      }
      this.banner(`${metre}m!`, heal ? 'Heart back!' : metre === 1 ? 'A metre of pets' : 'Keep stacking');
      this.sounds.play('metre', { volume: 0.5 });
      this.dance();
    }
    if (!this.cheeredBest && this.best > 0 && cm > this.best) {
      this.cheeredBest = true;
      this.banner('New best!', `${cm}cm`);
      this.sounds.play('best', { volume: 0.7 });
      this.dance();
    }
  }

  private dance() {
    for (const v of this.views) if (v.pet?.state === 'landed') this.play(v, 'dance');
    this.danceFor = 2.6;
  }

  private updateAim(dt: number) {
    const held = this.held!;
    const dir = (this.keys.has('ArrowRight') || this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('ArrowLeft') || this.keys.has('KeyA') ? 1 : 0);
    if (dir) this.aimX += dir * MOVE_SPEED * dt;
    this.aimX = THREE.MathUtils.clamp(this.aimX, -REACH, REACH);
    this.holdY = THREE.MathUtils.damp(this.holdY, this.wantedHoldY(), 6, dt);
    this.holdY = Math.max(this.holdY, this.wantedHoldY() - 0.05);
    this.shownAngle = THREE.MathUtils.damp(this.shownAngle, this.angle, 18, dt);
    const sway = Math.sin(performance.now() / 260) * 0.03;
    held.root.position.set(this.aimX, this.holdY + 0.12 + sway, 0);
    held.root.quaternion.setFromAxisAngle(Z, this.shownAngle);

    this.aimLeft -= dt;
    const secs = Math.ceil(this.aimLeft);
    if (secs < this.lastTick && secs <= 3 && secs > 0) this.sounds.play('tick', { volume: 0.35 });
    this.lastTick = secs;
    if (this.aimLeft <= 0) this.dropHeld();
  }

  private updateCamera(dt: number) {
    const top = this.state === 'title' ? 3.2 : this.holdY + 2.8;
    const low = Math.max(-PEDESTAL_HEIGHT - 0.4, top - 11);
    const span = top - low + 1.2;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const wide = (REACH + 2.5) * 2;
    const dist = Math.max(span / 2 / tan, wide / 2 / (tan * this.camera.aspect));
    // On narrow screens the width sets the distance and leaves room to spare up and down; the
    // spare goes above the tower, so the pedestal sits low and the HUD has sky to sit in.
    const mid = Math.max((top + low) / 2, low - 0.6 + dist * tan * 0.8);
    this.camY = THREE.MathUtils.damp(this.camY, mid, 3, dt);
    this.camDist = THREE.MathUtils.damp(this.camDist, dist, 3, dt);
    this.shake = Math.max(0, this.shake - dt);
    // A smooth wobble rather than a fresh random offset each frame, which jitters at 120Hz.
    const s = this.shake * 0.12;
    const now = performance.now() / 1000;
    this.camera.position.set(Math.sin(now * 37) * s, this.camY + this.camDist * 0.16 + Math.sin(now * 29 + 1) * s, this.camDist);
    this.camera.lookAt(0, this.camY, 0);
    // The sun's shadow follows the top of the tower.
    this.sun.position.set(-6, this.camY + 14, 9);
    this.sun.target.position.set(0, this.camY - 2, 0);
  }

  /** The timer ring over the held pet and the best line's label. */
  private updateOverlays() {
    const ring = $('ring');
    if (this.state === 'aim' && this.held) {
      const p = this.screen(new THREE.Vector3(this.aimX, this.holdY + extent(this.models[this.held.kind].shape, this.angle).maxY + 0.7, 0));
      ring.style.display = 'block';
      ring.style.left = `${p.x}px`;
      ring.style.top = `${p.y}px`;
      const frac = Math.max(0, this.aimLeft / aimTime(this.placed));
      const c = 2 * Math.PI * 18;
      const front = ring.querySelector<SVGCircleElement>('.front')!;
      front.style.strokeDasharray = `${c}`;
      front.style.strokeDashoffset = `${c * (1 - frac)}`;
      ring.classList.toggle('hurry', this.aimLeft < 3);
    } else ring.style.display = 'none';

    const label = $('bestline');
    const bestY = this.best / CM;
    const show = this.state !== 'title' && this.best > 0;
    this.bestLine.visible = show;
    if (show) {
      this.bestLine.position.y = bestY;
      const p = this.screen(new THREE.Vector3(REACH + 0.6, bestY + 0.5, 0.75));
      label.style.display = p.y > 0 && p.y < innerHeight ? 'block' : 'none';
      label.style.left = `${p.x}px`;
      label.style.top = `${p.y}px`;
    } else label.style.display = 'none';
  }

  private screen(v: THREE.Vector3) {
    const p = v.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  // ---- Puffs, HUD --------------------------------------------------------------------------

  private puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, emissive: 0xffffff, emissiveIntensity: 0.3 });
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);

  private puff(at: THREE.Vector3, n: number, size: number) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.puffGeo, this.puffMat.clone());
      mesh.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(a), Math.random() * 0.8 + 0.2, Math.sin(a) * 0.4).multiplyScalar(1 + Math.random() * 1.5);
      this.scene.add(mesh);
      const max = 0.5 + Math.random() * 0.4;
      this.puffs.push({ mesh, vel, life: max, max, size: size * (0.6 + Math.random() * 0.8) });
    }
  }

  private updatePuffs(dt: number) {
    for (const p of [...this.puffs]) {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(this.puffs.indexOf(p), 1);
        continue;
      }
      const k = 1 - p.life / p.max;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 3);
      p.mesh.scale.setScalar(p.size * (0.4 + k));
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - k * k;
    }
  }

  private drawHearts() {
    const box = $('hearts');
    box.replaceChildren(
      ...Array.from({ length: HEARTS }, (_, i) => {
        const img = document.createElement('img');
        img.src = this.icons.heart;
        img.alt = '';
        if (i >= this.hearts) img.className = 'lost';
        return img;
      }),
    );
  }

  private bannerTimer = 0;
  private banner(text: string, sub = '') {
    const b = $('banner');
    b.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), 1400);
  }

  private hint(text: string) {
    const h = $('hint');
    if (text) h.textContent = text;
    h.style.opacity = text ? '1' : '0';
  }

  // ---- Input -------------------------------------------------------------------------------

  /** World x under a point on screen, on the plane the pets move in. */
  private worldX(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    return this.ray.ray.intersectPlane(plane, hit) ? hit.x : this.aimX;
  }

  private bindInput() {
    const stage = this.renderer.domElement;
    stage.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.turnHeld(1);
    });
    stage.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      const touch = e.pointerType !== 'mouse';
      this.drag = { id: e.pointerId, startX: this.worldX(e.clientX, e.clientY), aimX: this.aimX, moved: false, touch };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      const x = this.worldX(e.clientX, e.clientY);
      if (this.drag?.id === e.pointerId && this.drag.touch) {
        // Fingers drag the pet from wherever they land, so they needn't cover it.
        if (Math.abs(x - this.drag.startX) > 0.08) this.drag.moved = true;
        this.aimX = THREE.MathUtils.clamp(this.drag.aimX + (x - this.drag.startX), -REACH, REACH);
      } else if (e.pointerType === 'mouse') {
        this.aimX = THREE.MathUtils.clamp(x, -REACH, REACH);
      }
    });
    stage.addEventListener('pointerup', (e) => {
      if (this.drag?.id !== e.pointerId) return;
      this.drag = undefined;
      this.dropHeld();
    });
    stage.addEventListener('pointercancel', () => (this.drag = undefined));
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (performance.now() - this.wheelAt < 180) return;
        this.wheelAt = performance.now();
        this.turnHeld(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (e.repeat && !['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) return;
      this.keys.add(e.code);
      const onCard = this.state === 'title' || $('over').classList.contains('show');
      if (onCard && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        this.start();
        return;
      }
      if (['ArrowUp', 'KeyW', 'KeyX', 'KeyR'].includes(e.code)) this.turnHeld(1);
      if (e.code === 'KeyZ' || e.code === 'KeyQ') this.turnHeld(-1);
      if (['Space', 'ArrowDown', 'KeyS', 'Enter'].includes(e.code)) {
        e.preventDefault();
        this.dropHeld();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    for (const [id, dir] of [['t-left', -1], ['t-right', 1]] as const) {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('down');
        this.turnHeld(dir);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => b.classList.remove('down'));
    }
    $('title-play').addEventListener('click', () => this.start());
    $('over-go').addEventListener('click', () => this.start());
  }
}
