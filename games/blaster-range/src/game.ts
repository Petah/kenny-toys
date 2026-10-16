import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { makeIcons } from '@shared/model-icons';
import { load, save } from '@shared/storage';
import { MUSIC } from './assets.ts';

type State = 'title' | 'play' | 'over';
type TargetKind = 'flip' | 'slide' | 'crate' | 'zip';

const ROUND = 60;
const GRAVITY = 4;
const EYE = 1.7;
const WALL_Z = -17;
const SIDE_X = 6.5;

/** The blasters to pick from: darts per clip, seconds between shots and to reload, dart speed. */
const BLASTERS = [
  { model: 'blaster-h', name: 'Zapper', clip: 6, every: 0.2, reload: 0.9, speed: 28, note: 'quick to reload' },
  { model: 'blaster-a', name: 'Popper', clip: 10, every: 0.13, reload: 1.5, speed: 30, note: 'big clip, fast fire' },
  { model: 'blaster-f', name: 'Longshot', clip: 5, every: 0.32, reload: 1.2, speed: 46, note: 'fast darts, scores ×1.2' },
] as const;

interface Target {
  kind: TargetKind;
  /** Moves and turns the disc. */
  holder: THREE.Group;
  disc: THREE.Object3D;
  radius: number;
  /** 0 hidden … 1 fully up. */
  up: number;
  life: number;
  max: number;
  hit: boolean;
  speed: number;
  dir: number;
  crate?: Crate;
  small: boolean;
}

interface Crate {
  group: THREE.Object3D;
  lid: THREE.Object3D;
  busy: boolean;
  x: number;
  z: number;
}

interface Dart {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  stuck: number;
  /** Stuck in a moving target, it rides along. */
  on?: Target;
  local?: THREE.Vector3;
}

interface Bit {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class RangeGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  private renderer: THREE.WebGLRenderer;
  private last = 0;

  private state: State = 'title';
  private blaster: (typeof BLASTERS)[number] = BLASTERS[0];
  private gun = new THREE.Group();
  private gunModel?: THREE.Object3D;
  private magazine?: THREE.Object3D;
  private magHome = new THREE.Vector3();
  private targets: Target[] = [];
  private darts: Dart[] = [];
  private bits: Bit[] = [];
  private crates: Crate[] = [];

  private time = ROUND;
  private score = 0;
  private hits = 0;
  private shots = 0;
  private combo = 0;
  private best = load<number>('blaster-range:best', 0);
  private ammo = 6;
  private cooldown = 0;
  private reloading = 0;
  private spawnIn = 0;
  private recoil = 0;
  private hurried = false;
  private lastTick = -1;
  private aim = new THREE.Vector2();
  private trigger = false;
  private ray = new THREE.Raycaster();
  private icons: Record<string, string>;

  constructor(
    stage: HTMLElement,
    private models: Record<string, THREE.Object3D>,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.camera.position.set(0, EYE, 0.5);
    this.camera.lookAt(0, 1.2, -10);
    this.scene.add(this.camera);
    this.camera.add(this.gun);
    this.buildRange();
    this.icons = makeIcons(Object.fromEntries(BLASTERS.map((b) => [b.model, this.models[b.model]])), 160);
    this.buildPicker();
    this.bindInput();
    this.showTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---- The range ---------------------------------------------------------------------------

  private canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
    tex.anisotropy = 8;
    return tex;
  }

  private buildRange() {
    this.scene.background = new THREE.Color(0x2a2f45);
    this.scene.fog = new THREE.Fog(0x2a2f45, 22, 40);
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3550, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -10;
    sc.right = 10;
    sc.top = 4;
    sc.bottom = -20;
    sc.far = 40;
    key.target.position.set(0, 0, -9);
    this.scene.add(key, key.target);
    // Spotlights down the lanes.
    for (const z of [-6, -12]) {
      const spot = new THREE.PointLight(0xffe2b0, 18, 14, 1.6);
      spot.position.set(0, 4.2, z);
      this.scene.add(spot);
    }

    const planks = this.canvasTexture(256, 256, (g) => {
      g.fillStyle = '#b07a4f';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#a26e45' : '#b8835a';
        g.fillRect(0, i * 32, 256, 30);
        g.fillStyle = 'rgba(60,30,10,0.35)';
        g.fillRect(((i * 97) % 256), i * 32, 3, 30);
      }
    }, [6, 10]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIDE_X * 2, 30), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -12;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const stripes = this.canvasTexture(256, 256, (g) => {
      g.fillStyle = '#3d4a78';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#34406a';
      for (let i = 0; i < 4; i++) g.fillRect(i * 64, 0, 32, 256);
    }, [4, 1]);
    const wallMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.95 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(SIDE_X * 2, 6), wallMat);
    back.position.set(0, 3, WALL_Z);
    back.receiveShadow = true;
    this.scene.add(back);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), wallMat);
      wall.position.set(side * SIDE_X, 3, -12);
      wall.rotation.y = -side * Math.PI / 2;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }
    // A big bullseye painted on the back wall.
    const ring = (r: number, colour: number, z: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }));
      m.position.set(0, 3, WALL_Z + z);
      this.scene.add(m);
    };
    ring(2.2, 0xe8eef8, 0.01);
    ring(1.6, 0xe8473a, 0.02);
    ring(1.0, 0xe8eef8, 0.03);
    ring(0.45, 0xe8473a, 0.04);
    // The counter in front of you.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(SIDE_X * 2, 1.0, 0.7), new THREE.MeshStandardMaterial({ color: 0xe8473a, roughness: 0.7 }));
    counter.position.set(0, 0.5, -0.45);
    counter.castShadow = counter.receiveShadow = true;
    this.scene.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(SIDE_X * 2, 0.08, 0.9), new THREE.MeshStandardMaterial({ color: 0xf2d38a, roughness: 0.6 }));
    top.position.set(0, 1.03, -0.45);
    this.scene.add(top);
    // Rails the sliding targets run on, and lane dividers.
    for (const z of [-7, -13]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(SIDE_X * 2, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0x8a90a8, roughness: 0.4, metalness: 0.5 }));
      rail.position.set(0, z === -7 ? 2.9 : 3.3, z);
      this.scene.add(rail);
    }
    // Crates along the lanes; some hide targets.
    const cratePlaces: [string, number, number, number][] = [
      ['crate-wide', -3.6, -5, 1.6], ['crate-medium', 2.8, -5.5, 1.6], ['crate-medium', -1, -9.5, 1.6], ['crate-wide', 3.5, -10.5, 1.6],
      ['crate-medium', -4.2, -12, 1.6], ['crate-small', 1.2, -14, 1.6],
    ];
    for (const [name, x, z, s] of cratePlaces) {
      const g = this.models[name].clone();
      g.position.set(x, 0, z);
      g.scale.setScalar(s);
      g.rotation.y = Math.PI / 2;
      this.scene.add(g);
      const lid = g.getObjectByName('lid');
      if (lid && name === 'crate-medium') this.crates.push({ group: g, lid, busy: false, x, z });
    }
  }

  // ---- Targets -----------------------------------------------------------------------------

  /** A target disc facing the shooter, in a holder that moves and turns it. */
  private makeTarget(kind: TargetKind, small: boolean): Target {
    const holder = new THREE.Group();
    const scale = small ? 2.4 : 2.2;
    const disc = this.models[small ? 'target-small' : 'target-large'].clone();
    disc.scale.setScalar(scale);
    // The model's face points along x; turn it to face back down the range.
    disc.rotation.y = Math.PI / 2;
    // The disc turns on its own pivot, so flip targets swing up while their post stays put.
    const pivot = new THREE.Group();
    pivot.add(disc);
    holder.add(pivot);
    const radius = (small ? 0.1 : 0.17) * scale;
    if (kind === 'flip' || kind === 'crate') {
      // A little post under it.
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x5a5f78 }));
      post.position.y = -radius - 0.45;
      holder.add(post);
    } else if (kind === 'slide') {
      // Hangs from the rail.
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x8a90a8 }));
      rod.position.y = radius + 0.6;
      holder.add(rod);
    }
    holder.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(holder);
    return { kind, holder, disc, radius, up: 0, life: 0, max: 2.5, hit: false, speed: 0, dir: 1, small };
  }

  private spawn() {
    const pace = 1 - this.time / ROUND;
    const r = Math.random();
    let t: Target;
    const freeCrates = this.crates.filter((c) => !c.busy);
    if (r < 0.22 && freeCrates.length) {
      const c = freeCrates[Math.floor(Math.random() * freeCrates.length)];
      c.busy = true;
      t = this.makeTarget('crate', true);
      t.crate = c;
      t.holder.position.set(c.x, 0.15, c.z);
      t.max = 1.8 - pace * 0.5;
    } else if (r < 0.52) {
      t = this.makeTarget('slide', false);
      const row = Math.random() < 0.5 ? -7 : -13;
      t.dir = Math.random() < 0.5 ? 1 : -1;
      t.speed = (1.6 + pace * 2.2 + Math.random()) * (row === -7 ? 1 : 0.8);
      t.holder.position.set(-t.dir * (SIDE_X - 0.6), row === -7 ? 2.9 - 0.6 - t.radius - 0.6 : 3.3 - 0.6 - t.radius - 0.6, row);
      t.max = 99;
    } else if (r < 0.62 && pace > 0.15) {
      t = this.makeTarget('zip', true);
      t.dir = Math.random() < 0.5 ? 1 : -1;
      t.speed = 5 + pace * 3;
      t.holder.position.set(-t.dir * (SIDE_X - 0.4), 3.6 + Math.random() * 0.8, -10 - Math.random() * 4);
      t.max = 99;
    } else {
      t = this.makeTarget('flip', Math.random() < 0.25);
      // Somewhere clear on the floor of the range.
      const x = (Math.random() * 2 - 1) * (SIDE_X - 1.2);
      const z = -4 - Math.random() * 11;
      t.holder.position.set(x, 0.95 + t.radius, z);
      t.max = 2.6 - pace * 1.1;
    }
    this.targets.push(t);
    this.sounds.play('up', { volume: 0.25 });
  }

  private removeTarget(t: Target) {
    this.scene.remove(t.holder);
    if (t.crate) t.crate.busy = false;
    this.targets.splice(this.targets.indexOf(t), 1);
    for (const d of this.darts) if (d.on === t) d.stuck = 0;
  }

  private updateTargets(dt: number) {
    for (const t of [...this.targets]) {
      t.life += dt;
      const showing = !t.hit && t.life < t.max;
      t.up += ((showing ? 1 : 0) - t.up) * Math.min(1, dt * 10);
      if (t.kind === 'flip') {
        // Flips up from lying flat, and back down.
        t.disc.parent!.rotation.x = -(1 - t.up) * Math.PI / 2;
      } else if (t.kind === 'crate' && t.crate) {
        // The lid swings open and the target rises out.
        t.crate.lid.rotation.z = -t.up * 1.6;
        t.holder.position.y = 0.15 + t.up * 0.95;
        t.holder.visible = t.up > 0.05;
      } else {
        t.holder.position.x += t.dir * t.speed * dt;
        if (t.kind === 'zip') t.holder.position.y += Math.sin(t.life * 6) * dt * 1.2;
        if (Math.abs(t.holder.position.x) > SIDE_X - 0.3 && t.life > 0.5) t.life = Math.max(t.life, 99);
      }
      const gone = (t.kind === 'slide' || t.kind === 'zip') ? Math.abs(t.holder.position.x) > SIDE_X - 0.3 && t.life > 0.5 : t.up < 0.02 && (t.hit || t.life > t.max);
      if (gone) this.removeTarget(t);
    }
  }

  // ---- Shooting ----------------------------------------------------------------------------

  /** Where the pointer's aim meets the range. */
  private aimPoint() {
    this.ray.setFromCamera(this.aim, this.camera);
    const objs = this.targets.filter((t) => t.up > 0.5 && !t.hit).map((t) => t.disc);
    const hits = this.ray.intersectObjects(objs, true);
    if (hits.length) return hits[0].point;
    // Otherwise the back wall's plane, or far along the ray.
    const p = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -WALL_Z), p)) return p;
    return this.ray.ray.at(30, p);
  }

  private muzzle() {
    const p = new THREE.Vector3(0, 0.02, -0.45);
    return this.gun.localToWorld(p);
  }

  private fire() {
    if (this.state !== 'play' || this.cooldown > 0 || this.reloading > 0) return;
    if (this.ammo <= 0) {
      this.sounds.play('empty', { volume: 0.4 });
      this.startReload();
      return;
    }
    this.ammo--;
    this.shots++;
    this.cooldown = this.blaster.every;
    this.recoil = 1;
    const from = this.muzzle();
    const to = this.aimPoint();
    // Lob it a touch so the dart's fall brings it onto the point aimed at.
    const dist = from.distanceTo(to);
    const speed = this.blaster.speed;
    const flight = dist / speed;
    const vel = to.clone().sub(from).normalize().multiplyScalar(speed);
    vel.y += 0.5 * GRAVITY * flight;
    const obj = this.models['bullet-foam-tip'].clone();
    obj.scale.setScalar(2.2);
    this.scene.add(obj);
    this.darts.push({ obj, pos: from, vel, stuck: 0 });
    this.sounds.play('fire', { volume: 0.35, rate: 1.6, detune: 200 });
    this.drawAmmo();
    if (this.ammo === 0) setTimeout(() => this.state === 'play' && this.ammo === 0 && this.startReload(), 250);
  }

  private startReload() {
    if (this.reloading > 0 || this.ammo === this.blaster.clip) return;
    this.reloading = this.blaster.reload;
    this.sounds.play('reload', { volume: 0.5 });
    $('reload').classList.add('show');
  }

  private updateDarts(dt: number) {
    for (const d of [...this.darts]) {
      if (d.stuck > 0) {
        d.stuck -= dt;
        if (d.on && d.local) d.obj.position.copy(d.on.disc.localToWorld(d.local.clone()));
        if (d.stuck <= 0) {
          this.scene.remove(d.obj);
          this.darts.splice(this.darts.indexOf(d), 1);
        }
        continue;
      }
      const prev = d.pos.clone();
      d.vel.y -= GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);
      // Point the dart along its flight (the model stands up along +y).
      d.obj.position.copy(d.pos);
      d.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.vel.clone().normalize().negate());
      if (this.hitTarget(d, prev)) continue;
      // Walls, floor, crates: stick and stay a while.
      const stuck = d.pos.z < WALL_Z + 0.05 || d.pos.y < 0.02 || Math.abs(d.pos.x) > SIDE_X - 0.05 || d.pos.y > 6;
      if (stuck) {
        d.pos.z = Math.max(d.pos.z, WALL_Z + 0.05);
        d.obj.position.copy(d.pos);
        d.stuck = 4;
        this.sounds.play('thunk', { volume: 0.2 });
        this.missed();
      }
    }
  }

  /** Does the dart's last step cross a target's face inside its rim? */
  private hitTarget(d: Dart, prev: THREE.Vector3) {
    for (const t of this.targets) {
      if (t.hit || t.up < 0.6) continue;
      const centre = new THREE.Vector3();
      t.disc.getWorldPosition(centre);
      const normal = new THREE.Vector3(-1, 0, 0).applyQuaternion(t.disc.getWorldQuaternion(new THREE.Quaternion()));
      const a = prev.clone().sub(centre).dot(normal);
      const b = d.pos.clone().sub(centre).dot(normal);
      if (Math.sign(a) === Math.sign(b) && Math.abs(b) > 0.02) continue;
      const k = a / (a - b || 1e-6);
      const at = prev.clone().lerp(d.pos, k);
      const off = at.distanceTo(centre) / t.radius;
      if (off > 1) continue;
      this.scoreHit(t, off, at);
      d.stuck = 1.2;
      d.on = t;
      d.local = t.disc.worldToLocal(at.clone());
      d.pos.copy(at);
      d.obj.position.copy(at);
      return true;
    }
    return false;
  }

  private scoreHit(t: Target, off: number, at: THREE.Vector3) {
    t.hit = true;
    // Darts still in the air at the buzzer don't count.
    if (this.state !== 'play') {
      t.disc.visible = false;
      return;
    }
    this.hits++;
    this.combo++;
    const ring = off < 0.3 ? 100 : off < 0.65 ? 50 : 25;
    const mult = Math.min(3, 1 + Math.floor(this.combo / 3) * 0.5);
    const kindBonus = t.kind === 'zip' ? 3 : t.small ? 2 : 1;
    const gunBonus = this.blaster.model === 'blaster-f' ? 1.2 : 1;
    const points = Math.round(ring * kindBonus * mult * gunBonus);
    this.score += points;
    this.sounds.play('hit', { volume: 0.5 });
    this.sounds.play('pop', { volume: 0.35, rate: 1 + Math.min(1, this.combo * 0.05) });
    if (ring === 100) this.sounds.play('bull', { volume: 0.35 });
    this.pop(ring === 100 ? `BULLSEYE +${points}` : `+${points}`, at, ring === 100 ? 'bull' : '');
    // The disc bursts into bits.
    for (let i = 0; i < 9; i++) {
      const obj = this.models[i % 3 ? 'target-fragment-small' : 'target-fragment-large'].clone();
      obj.scale.setScalar(2.2);
      obj.position.copy(at);
      this.scene.add(obj);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, 1 + Math.random() * 2);
      this.bits.push({ obj, vel, spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12), life: 0 });
    }
    t.disc.visible = false;
    this.drawHud();
  }

  private missed() {
    if (this.state !== 'play') return;
    if (this.combo >= 3) this.pop('combo lost', this.camera.position.clone().add(new THREE.Vector3(0, -0.3, -3)), 'lost');
    this.combo = 0;
    this.drawHud();
  }

  private pop(text: string, at: THREE.Vector3, cls = '') {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    document.body.append(el);
    const p = at.clone().project(this.camera);
    el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    setTimeout(() => el.remove(), 1000);
  }

  // ---- Input and HUD -----------------------------------------------------------------------

  private bindInput() {
    const canvas = this.renderer.domElement;
    const setAim = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.aim.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ch = $('crosshair');
      ch.style.left = `${e.clientX}px`;
      ch.style.top = `${e.clientY}px`;
    };
    canvas.addEventListener('pointermove', setAim);
    canvas.addEventListener('pointerdown', (e) => {
      setAim(e);
      if (e.button === 2) {
        this.startReload();
        return;
      }
      if (e.pointerType === 'touch') this.assist(e.clientX, e.clientY);
      this.trigger = true;
      this.fire();
    });
    window.addEventListener('pointerup', () => (this.trigger = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') this.startReload();
      if (e.key === ' ' && this.state === 'play') {
        e.preventDefault();
        this.fire();
      }
      if (e.key === 'Enter' && $('over').classList.contains('show')) this.start(this.blaster);
    });
    $('again').addEventListener('click', () => this.start(this.blaster));
    $('swap').addEventListener('click', () => this.showTitle());
  }

  /** Fingers are blunt: a tap near a target aims at its middle. */
  private assist(cx: number, cy: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best: THREE.Vector3 | undefined;
    let bestD = 48;
    for (const t of this.targets) {
      if (t.hit || t.up < 0.6) continue;
      const c = t.disc.getWorldPosition(new THREE.Vector3());
      const p = c.clone().project(this.camera);
      const d = Math.hypot(rect.left + ((p.x + 1) / 2) * rect.width - cx, rect.top + ((1 - p.y) / 2) * rect.height - cy);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) this.aim.set(best.x, best.y);
  }

  private buildPicker() {
    const box = $('picker');
    for (const b of BLASTERS) {
      const btn = document.createElement('button');
      btn.className = 'pick';
      btn.innerHTML = `<img src="${this.icons[b.model]}" alt=""><b>${b.name}</b><small>${b.clip} darts, ${b.note}</small>`;
      btn.addEventListener('click', () => this.start(b));
      box.append(btn);
    }
  }

  private drawAmmo() {
    const box = $('ammo');
    box.innerHTML = '';
    for (let i = 0; i < this.blaster.clip; i++) {
      const d = document.createElement('i');
      if (i >= this.ammo) d.className = 'used';
      box.append(d);
    }
  }

  private drawHud() {
    $('score').textContent = String(this.score);
    const secs = Math.ceil(this.time);
    $('clock').textContent = `0:${String(secs).padStart(2, '0')}`;
    $('clock').classList.toggle('hurry', this.time <= 10);
    const mult = Math.min(3, 1 + Math.floor(this.combo / 3) * 0.5);
    $('combo').textContent = this.combo >= 3 ? `×${mult} combo` : '';
  }

  private setGun(model: string) {
    if (this.gunModel) this.gun.remove(this.gunModel);
    const m = this.models[model].clone();
    m.scale.setScalar(0.62);
    // The models' barrels point along -z, which is ahead for the camera.
    this.gun.add(m);
    this.gunModel = m;
    this.magazine = m.getObjectByName('magazine') ?? undefined;
    if (this.magazine) this.magHome.copy(this.magazine.position);
    this.gun.position.set(0.32, -0.3, -0.62);
  }

  // ---- Flow --------------------------------------------------------------------------------

  private showTitle() {
    this.state = 'title';
    for (const t of [...this.targets]) this.removeTarget(t);
    document.body.classList.add('on-title');
    $('title').classList.add('show');
    $('over').classList.remove('show');
    $('title-best').textContent = this.best ? `Best: ${this.best}` : '';
    this.gun.visible = false;
  }

  private start(b: (typeof BLASTERS)[number]) {
    this.sounds.play('click');
    void this.sounds.music(MUSIC, 0.14);
    this.blaster = b;
    this.setGun(b.model);
    this.gun.visible = true;
    for (const t of [...this.targets]) this.removeTarget(t);
    for (const d of this.darts) this.scene.remove(d.obj);
    this.darts = [];
    this.time = ROUND;
    this.score = this.hits = this.shots = this.combo = 0;
    this.ammo = b.clip;
    this.reloading = 0;
    this.cooldown = 0.2;
    this.spawnIn = 0.6;
    this.hurried = false;
    this.state = 'play';
    $('title').classList.remove('show');
    $('over').classList.remove('show');
    document.body.classList.remove('on-title');
    this.drawAmmo();
    this.drawHud();
    this.sounds.play('go', { volume: 0.6, detune: 0 });
  }

  private endRound() {
    this.state = 'over';
    this.sounds.play('buzzer', { volume: 0.5, detune: 0 });
    const record = this.score > this.best;
    if (record) {
      this.best = this.score;
      save('blaster-range:best', this.score);
    }
    setTimeout(() => this.sounds.play(record && this.score > 0 ? 'best' : 'timeOver', { volume: 0.6, detune: 0 }), 500);
    $('over-title').textContent = record && this.score > 0 ? 'New best!' : 'Time!';
    $('over-score').textContent = String(this.score);
    $('over-hits').textContent = String(this.hits);
    $('over-acc').textContent = `${this.shots ? Math.round((this.hits / this.shots) * 100) : 0}%`;
    $('over-note').textContent = record ? '' : `Best: ${this.best}`;
    $('over').classList.add('show');
    $('reload').classList.remove('show');
  }

  // ---- Frame -------------------------------------------------------------------------------

  private frame(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.step(dt);
    this.render(dt);
  }

  /** Advances by `dt` seconds (automated checks call it directly). */
  step(dt: number) {
    if (this.state === 'play') {
      this.time = Math.max(0, this.time - dt);
      this.cooldown -= dt;
      if (this.reloading > 0) {
        this.reloading -= dt;
        if (this.reloading <= 0) {
          this.ammo = this.blaster.clip;
          this.drawAmmo();
          this.sounds.play('ready', { volume: 0.5 });
          $('reload').classList.remove('show');
        }
      }
      // Hold to keep firing with the fast blasters.
      if (this.trigger && this.blaster.model === 'blaster-a') this.fire();
      this.spawnIn -= dt;
      const pace = 1 - this.time / ROUND;
      const live = this.targets.filter((t) => !t.hit).length;
      if (this.spawnIn <= 0 && live < 3 + Math.floor(pace * 3)) {
        this.spawn();
        this.spawnIn = 0.9 - pace * 0.45 + Math.random() * 0.4;
      }
      if (this.time <= 10 && !this.hurried) {
        this.hurried = true;
        this.sounds.play('hurry', { volume: 0.6, detune: 0 });
      }
      const secs = Math.ceil(this.time);
      if (this.time <= 5 && secs !== this.lastTick) this.sounds.play('tick', { volume: 0.4, detune: 0 });
      this.lastTick = secs;
      this.drawHud();
      if (this.time <= 0) this.endRound();
    }
    this.updateTargets(dt);
    this.updateDarts(dt);
    for (const b of [...this.bits]) {
      b.life += dt;
      b.vel.y -= 12 * dt;
      b.obj.position.addScaledVector(b.vel, dt);
      if (b.obj.position.y < 0.02) {
        b.obj.position.y = 0.02;
        b.vel.multiplyScalar(0.4);
        b.vel.y = Math.abs(b.vel.y) * 0.3;
      }
      b.obj.rotation.x += b.spin.x * dt;
      b.obj.rotation.y += b.spin.y * dt;
      if (b.life > 2.5) {
        this.scene.remove(b.obj);
        this.bits.splice(this.bits.indexOf(b), 1);
      }
    }
  }

  private render(dt: number) {
    // The blaster turns towards where you're aiming, kicks when it fires, and dips to reload.
    this.recoil = Math.max(0, this.recoil - dt * 8);
    // Turned in a little, so the barrel points at the crosshair.
    const yaw = 0.1 - this.aim.x * 0.35;
    const pitch = this.aim.y * 0.25;
    this.gun.rotation.set(pitch + this.recoil * 0.25, yaw, 0);
    const dip = this.reloading > 0 ? Math.sin(Math.min(1, 1 - this.reloading / this.blaster.reload) * Math.PI) : 0;
    this.gun.position.set(0.3 + this.aim.x * 0.06, -0.28 + this.aim.y * 0.04 - dip * 0.15, -0.58 + this.recoil * 0.06);
    this.gun.rotation.z = dip * 0.5;
    if (this.magazine) this.magazine.position.y = this.magHome.y - dip * 0.35;
    // Tall screens get a wider view so the whole range still fits across.
    const aspect = this.camera.aspect;
    const fov = aspect >= 1.2 ? 60 : Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(36)) / aspect)));
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (aspect < 1) this.gun.position.x -= 0.14;
    // A gentle sway of the view towards the aim.
    this.camera.rotation.set(-0.08 + this.aim.y * 0.04, -this.aim.x * 0.05, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
