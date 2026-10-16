import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Sounds } from '@shared/audio';
import { load, save } from '@shared/storage';
import { MUSIC } from './assets.ts';
import { METRES, MOVES, Ride, STATION_LENGTH, START, apply, buildTrack, fits, poses, sampleAt, type MoveName, type Track } from './coaster.ts';

type State = 'build' | 'ride' | 'report';

/** The track model's rails are this far above its origin. */
const RAIL = 0.3;
const CAR_GAP = 1.4;
const CARS = 4;
const MAX_MOVES = 30;

/** Palette order, with a label and a little line drawing for each move. */
const PALETTE: { move: MoveName; label: string; icon: string }[] = [
  { move: 'lift', label: 'Lift hill', icon: '<path d="M6 38 L42 10" /><circle cx="15" cy="31" r="2.4" /><circle cx="24" cy="24" r="2.4" /><circle cx="33" cy="17" r="2.4" />' },
  { move: 'drop', label: 'Big drop', icon: '<path d="M6 8 C 22 8, 22 40, 42 40" />' },
  { move: 'straight', label: 'Straight', icon: '<path d="M6 24 L42 24" />' },
  { move: 'left', label: 'Left', icon: '<path d="M30 42 L30 30 C 30 18, 22 12, 8 12" />' },
  { move: 'right', label: 'Right', icon: '<path d="M18 42 L18 30 C 18 18, 26 12, 40 12" />' },
  { move: 'wideLeft', label: 'Wide left', icon: '<path d="M38 42 C 38 20, 26 8, 6 8" />' },
  { move: 'wideRight', label: 'Wide right', icon: '<path d="M10 42 C 10 20, 22 8, 42 8" />' },
  { move: 'up', label: 'Climb', icon: '<path d="M6 36 C 20 36, 26 14, 42 14" />' },
  { move: 'down', label: 'Dip down', icon: '<path d="M6 14 C 20 14, 26 36, 42 36" />' },
  { move: 'hill', label: 'Camelback', icon: '<path d="M4 38 C 18 38, 16 8, 24 8 C 32 8, 30 38, 44 38" />' },
  { move: 'loop', label: 'Loop', icon: '<path d="M4 40 L22 40 C 38 40, 38 10, 24 10 C 10 10, 12 36, 26 38 L44 38" />' },
];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const vec = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

/** A suggested coaster for a first go and the "Surprise me" button's starting point. */
const STARTER: MoveName[] = ['lift', 'drop', 'loop', 'wideRight', 'hill', 'wideRight', 'straight'];

export class CoasterGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private last = 0;

  private state: State = 'build';
  private moves: MoveName[] = load<MoveName[]>('coaster-builder:moves', STARTER).filter((m) => m in MOVES);
  private track!: Track;
  private trackGroup = new THREE.Group();
  private returnGroup = new THREE.Group();
  private preview = new THREE.Group();
  private endMarker: THREE.Mesh;
  private train: THREE.Object3D[] = [];
  private ride?: Ride;
  private view: 'front' | 'chase' = 'front';
  private camUp = new THREE.Vector3(0, 1, 0);
  private frameTarget = new THREE.Vector3();
  private frameDist = 40;
  private best = load<number>('coaster-builder:best', 0);
  private rumble?: { set: (rate: number, vol: number) => void; stop: () => void };
  private clankAt = 0;
  private wasAir = false;
  /** Trees and stalls, hidden where the track runs through them. */
  private decor: THREE.Object3D[] = [];
  private puffs: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  constructor(
    stage: HTMLElement,
    private models: Record<string, THREE.Object3D>,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 160;
    this.buildWorld();
    this.scene.add(this.trackGroup, this.returnGroup, this.preview);
    this.endMarker = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 20), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    this.scene.add(this.endMarker);
    for (let i = 0; i < CARS; i++) {
      const car = new THREE.Group();
      car.add(this.models[i === 0 ? 'coaster-train-front' : 'coaster-train'].clone());
      this.train.push(car);
      this.scene.add(car);
    }
    this.buildPalette();
    this.bindUi();
    this.rebuild(true);
    this.camera.position.copy(this.frameTarget).add(new THREE.Vector3(-0.5, 0.95, 1).normalize().multiplyScalar(this.frameDist));
    this.controls.target.copy(this.frameTarget);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---- The park ----------------------------------------------------------------------------

  private buildWorld() {
    this.scene.background = new THREE.Color(0x9fd6f2);
    this.scene.fog = new THREE.Fog(0x9fd6f2, 150, 420);
    this.scene.add(new THREE.HemisphereLight(0xeef8ff, 0x6a9a4a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    sun.position.set(-40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -90;
    sc.right = sc.top = 90;
    sc.near = 1;
    sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: 0x86c45a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const put = (name: string, x: number, z: number, s: number, yaw = 0) => {
      const m = this.models[name].clone();
      m.position.set(x, 0, z);
      m.scale.setScalar(s);
      m.rotation.y = yaw;
      this.scene.add(m);
      return m;
    };
    const decor = (name: string, x: number, z: number, s: number, yaw = 0) => {
      const m = put(name, x, z, s, yaw);
      this.decor.push(m);
      return m;
    };
    // The station: a platform beside the track, gates, a way in and out.
    for (let z = 1; z < STATION_LENGTH; z += 3) {
      const st = put('station', 2.2, z, 2, Math.PI / 2);
      st.position.y = START.p.y - 0.6 - 0.02;
      const fence = put(z < 4 ? 'station-gate' : 'station-fence', 3.4, z, 2, Math.PI / 2);
      fence.position.y = START.p.y - 0.62;
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, START.p.y - 0.6, STATION_LENGTH + 2), new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 1 }));
    deck.position.set(2.6, (START.p.y - 0.6) / 2, STATION_LENGTH / 2);
    deck.castShadow = deck.receiveShadow = true;
    this.scene.add(deck);
    put('ride-entrance', 6.5, 3, 2.4, -Math.PI / 2);
    put('ride-exit', 6.5, 10, 2.4, -Math.PI / 2);
    put('park-entrance', 18, -14, 3, Math.PI);

    // Trees, stalls and benches dotted round the park, away from the middle.
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) {
      const a = r() * Math.PI * 2;
      const d = 55 + r() * 90;
      decor(r() < 0.5 ? 'tree' : 'tree-large', Math.cos(a) * d, Math.sin(a) * d, 3 + r() * 2.5, r() * 6.3);
    }
    const stalls = ['stall-drinks', 'stall-food', 'stall-information', 'stall-toilets'];
    for (let i = 0; i < 8; i++) {
      const a = -0.6 + i * 0.32;
      decor(stalls[i % 4], 12 + Math.cos(a) * 14, -4 + Math.sin(a) * 26, 2.6, -a - Math.PI / 2);
    }
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const d = 20 + r() * 60;
      decor(['flowers', 'grass', 'bench', 'trash'][Math.floor(r() * 4)], Math.cos(a) * d, Math.sin(a) * d, 2.4, r() * 6.3);
    }
  }

  // ---- Track -------------------------------------------------------------------------------

  /** Instances of a model's meshes, one per matrix. */
  private instanced(name: string, mats: THREE.Matrix4[], material?: THREE.Material) {
    const g = new THREE.Group();
    if (!mats.length) return g;
    const model = this.models[name];
    model.updateMatrixWorld(true);
    const tmp = new THREE.Matrix4();
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const im = new THREE.InstancedMesh(o.geometry, material ?? o.material, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, o.matrixWorld)));
      im.castShadow = !material;
      im.receiveShadow = true;
      im.frustumCulled = false;
      g.add(im);
    });
    return g;
  }

  private clearGroup(g: THREE.Group) {
    g.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    g.clear();
  }

  /** Track pieces a unit apart along part of the track, and supports down to the grass. */
  private lay(track: Track, from: number, to: number, into: THREE.Group, ghost?: THREE.Material) {
    const pieces: THREE.Matrix4[] = [];
    const posts: THREE.Matrix4[] = [];
    const feet: THREE.Matrix4[] = [];
    for (let s = from + 0.5; s < to; s += 1) {
      const pt = sampleAt(track, s);
      const t = vec(pt.t);
      const u = vec(pt.u);
      const side = new THREE.Vector3().crossVectors(u, t).normalize();
      const m = new THREE.Matrix4().makeBasis(side, u, t);
      m.setPosition(vec(pt.p).addScaledVector(u, -RAIL));
      pieces.push(m);
      // A post every few units where the track is upright and off the ground.
      const h = pt.p.y - RAIL;
      if (!ghost && Math.round(s) % 3 === 0 && u.y > 0.7 && h > 1.2 && !pt.station) {
        const post = new THREE.Matrix4().compose(new THREE.Vector3(pt.p.x, 0, pt.p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(t.x, t.z)), new THREE.Vector3(1.6, h - 0.15, 1.6));
        posts.push(post);
        feet.push(new THREE.Matrix4().compose(new THREE.Vector3(pt.p.x, 0, pt.p.z), new THREE.Quaternion(), new THREE.Vector3(1.6, 0.35, 1.6)));
      }
    }
    into.add(this.instanced('coaster-steel-track', pieces, ghost));
    into.add(this.instanced('support-small', posts));
    into.add(this.instanced('support-small-bottom', feet));
  }

  /** Re-lays the track after a change: the built part solid, the run back to the station as a ghost. */
  private rebuild(frame = false) {
    this.track = buildTrack(this.moves, true);
    const open = buildTrack(this.moves, false);
    this.clearGroup(this.trackGroup);
    this.clearGroup(this.returnGroup);
    this.lay(this.track, 0, open.length, this.trackGroup);
    const ghost = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.lay(this.track, open.length, this.track.length, this.returnGroup, ghost);
    // Where the next piece goes.
    const end = poses(this.moves).at(-1)!;
    this.endMarker.position.set(end.p.x, end.p.y + 1.6, end.p.z);
    this.endMarker.rotation.set(Math.PI, 0, 0);
    this.updatePalette();
    this.placeTrain(0);
    // Clear the scenery out of the coaster's way.
    for (const d of this.decor) {
      d.visible = !this.track.points.some((p, i) => i % 4 === 0 && Math.hypot(p.p.x - d.position.x, p.p.z - d.position.z) < 4.5 * Math.max(1, d.scale.x / 3));
    }
    // Frame everything that's been built.
    const box = new THREE.Box3();
    for (const p of this.track.points) box.expandByPoint(vec(p.p));
    box.expandByPoint(new THREE.Vector3(0, 0, 0));
    const size = box.getSize(new THREE.Vector3());
    box.getCenter(this.frameTarget);
    // Far enough back that the whole coaster fits the narrower way of the screen.
    const radius = size.length() / 2;
    const half = THREE.MathUtils.degToRad(25);
    const narrow = Math.min(half, Math.atan(Math.tan(half) * this.camera.aspect));
    this.frameDist = Math.max(30, (radius / Math.tan(narrow)) * 1.1);
    // The palette covers the bottom of the screen, so look a little nearer than the middle.
    const toCam = this.camera.position.clone().sub(this.controls.target).setY(0);
    if (toCam.lengthSq() > 1) this.frameTarget.addScaledVector(toCam.normalize(), radius * 0.22);
    if (frame) {
      this.controls.target.copy(this.frameTarget);
    }
    save('coaster-builder:moves', this.moves);
    $('count').textContent = this.moves.length ? `${this.moves.length} pieces · ${Math.round(open.length * METRES)}m of track` : 'add pieces to the end of the track';
  }

  /** Shows the shape a move would add, from the end of the track. */
  private showPreview(move?: MoveName) {
    this.clearGroup(this.preview);
    this.preview.clear();
    if (!move || this.state !== 'build') return;
    const end = poses(this.moves).at(-1)!;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) pts.push(vec(apply(end, MOVES[move].at(i / 60))));
    const ok = fits(end, move);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.28, 8), new THREE.MeshBasicMaterial({ color: ok ? 0xffd23f : 0xff5a4e, transparent: true, opacity: 0.75 }));
    this.preview.add(tube);
  }

  // ---- Train -------------------------------------------------------------------------------

  /** Puts the cars on the track with the front car at `s`. */
  private placeTrain(s: number) {
    this.train.forEach((car, i) => {
      const pt = sampleAt(this.track, Math.max(0, s - i * CAR_GAP));
      const t = vec(pt.t);
      const u = vec(pt.u);
      const side = new THREE.Vector3().crossVectors(u, t).normalize();
      car.matrixAutoUpdate = true;
      car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, u, t));
      car.position.copy(vec(pt.p));
      car.visible = true;
    });
  }

  // ---- Palette and buttons -----------------------------------------------------------------

  private buildPalette() {
    const box = $('palette');
    for (const item of PALETTE) {
      const b = document.createElement('button');
      b.dataset.move = item.move;
      b.innerHTML = `<svg viewBox="0 0 48 48">${item.icon}</svg><span>${item.label}</span>`;
      b.addEventListener('click', () => this.add(item.move, b));
      b.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && this.showPreview(item.move));
      b.addEventListener('pointerleave', () => this.showPreview());
      box.append(b);
    }
  }

  private updatePalette() {
    const end = poses(this.moves).at(-1)!;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#palette button')) {
      b.classList.toggle('off', !fits(end, b.dataset.move as MoveName) || this.moves.length >= MAX_MOVES);
    }
    ($('undo') as HTMLButtonElement).disabled = !this.moves.length;
  }

  private add(move: MoveName, button: HTMLElement) {
    if (this.state !== 'build') return;
    const end = poses(this.moves).at(-1)!;
    if (!fits(end, move) || this.moves.length >= MAX_MOVES) {
      button.classList.remove('nope');
      void button.offsetWidth;
      button.classList.add('nope');
      this.sounds.play('nope', { volume: 0.4 });
      this.toast(this.moves.length >= MAX_MOVES ? 'That’s a long coaster! Time to ride it.' : 'Too low for that, try climbing first');
      return;
    }
    this.moves.push(move);
    this.sounds.play('place', { volume: 0.5 });
    this.rebuild();
    this.showPreview(matchMedia('(pointer: fine)').matches ? move : undefined);
  }

  private bindUi() {
    $('undo').addEventListener('click', () => {
      if (this.state !== 'build' || !this.moves.length) return;
      this.moves.pop();
      this.sounds.play('undo', { volume: 0.5 });
      this.rebuild();
    });
    $('clear').addEventListener('click', () => {
      if (this.state !== 'build') return;
      this.moves = [];
      this.sounds.play('undo', { volume: 0.5 });
      this.rebuild();
    });
    $('surprise').addEventListener('click', () => {
      if (this.state !== 'build') return;
      this.moves = this.randomCoaster();
      this.sounds.play('ok', { volume: 0.5 });
      this.rebuild();
    });
    $('ride').addEventListener('click', () => this.startRide());
    $('view').addEventListener('click', () => {
      this.view = this.view === 'front' ? 'chase' : 'front';
      $('view').textContent = this.view === 'front' ? 'Chase view' : 'Front seat';
      this.sounds.play('click');
    });
    $('stop').addEventListener('click', () => this.endRide(true));
    $('again').addEventListener('click', () => this.startRide());
    $('build').addEventListener('click', () => this.toBuild());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state !== 'build') this.toBuild();
      if (e.key === 'v' && this.state === 'ride') $('view').click();
    });
  }

  /** A lift, a big drop, then a random run of thrills that never dips into the grass. */
  private randomCoaster(): MoveName[] {
    const out: MoveName[] = ['lift', 'drop'];
    const pick: MoveName[] = ['loop', 'hill', 'right', 'left', 'wideRight', 'wideLeft', 'down', 'up', 'straight', 'hill', 'loop'];
    const want = 6 + Math.floor(Math.random() * 4);
    let tries = 0;
    while (out.length < want && tries++ < 200) {
      const m = pick[Math.floor(Math.random() * pick.length)];
      if (m === out[out.length - 1] && m !== 'hill') continue;
      if (fits(poses(out).at(-1)!, m)) out.push(m);
    }
    return out;
  }

  private toast(text: string) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(Number(t.dataset.timer));
    t.dataset.timer = String(setTimeout(() => t.classList.remove('show'), 1800));
  }

  // ---- Ride --------------------------------------------------------------------------------

  private startRide() {
    if (!this.moves.length) {
      this.toast('Add some track first!');
      this.sounds.play('nope', { volume: 0.4 });
      return;
    }
    void this.sounds.music(MUSIC, 0.12);
    this.state = 'ride';
    this.showPreview();
    this.ride = new Ride(this.track);
    this.returnGroup.visible = true;
    this.clearGroup(this.returnGroup);
    // Ride the whole circuit solid.
    const open = buildTrack(this.moves, false);
    this.lay(this.track, open.length, this.track.length, this.returnGroup);
    document.body.classList.add('riding');
    document.body.classList.remove('reporting');
    this.controls.enabled = false;
    this.endMarker.visible = false;
    this.sounds.play('bell', { volume: 0.35, detune: 0 });
    this.sounds.play('go', { volume: 0.5, detune: 0 });
    this.rumble?.stop();
    this.rumble = this.sounds.loop('rumble', 0);
    this.camUp.set(0, 1, 0);
    this.wasAir = false;
  }

  private endRide(stopped = false) {
    const ride = this.ride;
    this.rumble?.stop();
    this.rumble = undefined;
    if (!ride || stopped) {
      this.toBuild();
      return;
    }
    this.state = 'report';
    this.camera.up.set(0, 1, 0);
    document.body.classList.remove('riding');
    document.body.classList.add('reporting');
    const { stars, word, score } = ride.rating();
    const st = ride.stats;
    const record = ride.ended === 'home' && score > this.best + 0.01;
    if (record) {
      this.best = score;
      save('coaster-builder:best', score);
    }
    $('report-title').textContent = ride.ended === 'stalled' ? 'Stalled!' : ride.ended === 'flew' ? 'Off the rails!' : `${word}!`;
    $('report-stars').innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
    $('report-note').textContent =
      ride.ended === 'stalled' ? 'The train ran out of puff on a climb. Try a lift hill or a bigger drop before it.' : record ? 'Your best coaster yet!' : '';
    $('r-speed').textContent = `${Math.round(st.topSpeed * METRES * 3.6)}`;
    $('r-drop').textContent = `${Math.round(st.biggestDrop * METRES)}`;
    $('r-g').textContent = `${st.maxG.toFixed(1)}`;
    $('r-air').textContent = `${st.airtime.toFixed(1)}`;
    $('r-loops').textContent = `${st.loops}`;
    $('r-length').textContent = `${Math.round(st.length * METRES)}`;
    this.sounds.play(ride.ended !== 'home' ? 'sad' : stars >= 4 ? 'great' : 'done', { volume: 0.5, detune: 0 });
    if (record && stars >= 3) setTimeout(() => this.sounds.play('best', { volume: 0.6, detune: 0 }), 900);
  }

  private toBuild() {
    this.state = 'build';
    this.ride = undefined;
    this.rumble?.stop();
    this.rumble = undefined;
    document.body.classList.remove('riding', 'reporting');
    this.controls.enabled = true;
    this.endMarker.visible = true;
    this.camera.up.set(0, 1, 0);
    this.rebuild();
    // Back up to a view of the whole coaster.
    const dir = this.camera.position.clone().sub(this.frameTarget);
    dir.y = Math.max(dir.y, dir.length() * 0.55);
    this.camera.position.copy(this.frameTarget).add(dir.normalize().multiplyScalar(this.frameDist));
    this.controls.target.copy(this.frameTarget);
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
    const ride = this.ride;
    if (this.state !== 'ride' || !ride) return;
    // Small steps keep the physics steady at speed.
    const n = Math.ceil(dt / (1 / 240));
    for (let i = 0; i < n; i++) ride.step(dt / n);
    if (ride.flight) {
      this.train.forEach((car, i) => {
        car.position.copy(vec(ride.flight!.p)).addScaledVector(vec(ride.flight!.t), -i * CAR_GAP);
      });
    } else {
      this.placeTrain(ride.s);
    }
    // Sound: a rumble that rises with speed, clanks on the chain, a whoosh on the way down.
    const pt = sampleAt(this.track, ride.s);
    this.rumble?.set(0.5 + Math.min(1.5, Math.abs(ride.speed) / 14), Math.min(0.35, Math.abs(ride.speed) / 40));
    if (pt.chain && performance.now() > this.clankAt) {
      this.clankAt = performance.now() + 140;
      this.sounds.play('clank', { volume: 0.25 });
    }
    const air = ride.g < 0.3;
    if (air && !this.wasAir) this.sounds.play('whoosh', { volume: 0.4 });
    this.wasAir = air;
    $('speed').textContent = String(Math.round(Math.abs(ride.speed) * METRES * 3.6));
    $('gforce').textContent = `${ride.g.toFixed(1)}g`;
    $('gforce').className = ride.g > 3.5 ? 'hot' : ride.g < 0.3 ? 'float' : '';
    if (ride.ended && (!ride.flight || ride.flight.p.y <= 0)) {
      if (ride.ended === 'flew') this.crash(vec(ride.flight!.p));
      this.endRide();
    }
  }

  private crash(at: THREE.Vector3) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: i % 3 ? 0x9a9aa6 : 0xffa040, roughness: 1 }));
      mesh.position.copy(at);
      this.scene.add(mesh);
      this.puffs.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8), life: 0 });
    }
    this.sounds.play('nope', { volume: 0.5 });
  }

  private render(dt: number) {
    const ride = this.ride;
    if (this.state === 'ride' && ride) {
      const s = ride.s;
      const pt = sampleAt(this.track, s);
      const p = ride.flight ? vec(ride.flight.p) : vec(pt.p);
      const t = ride.flight ? vec(ride.flight.t) : vec(pt.t);
      const u = ride.flight ? new THREE.Vector3(0, 1, 0) : vec(pt.u);
      if (this.view === 'front') {
        this.camUp.lerp(u, Math.min(1, dt * 10)).normalize();
        const ahead = ride.flight ? p.clone().add(t) : vec(sampleAt(this.track, s + 5).p).addScaledVector(vec(sampleAt(this.track, s + 5).u), 0.8);
        this.camera.position.copy(p).addScaledVector(u, 1.25).addScaledVector(t, 0.3);
        this.camera.up.copy(this.camUp);
        this.camera.lookAt(ahead);
        this.camera.fov = 70;
      } else {
        this.camUp.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 3));
        const want = p.clone().addScaledVector(t, -9).add(new THREE.Vector3(0, 4.5, 0));
        this.camera.position.lerp(want, Math.min(1, dt * 4));
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(p.clone().addScaledVector(t, 3));
        this.camera.fov = 55;
      }
      this.camera.updateProjectionMatrix();
    } else {
      if (this.camera.fov !== 50) {
        this.camera.fov = 50;
        this.camera.updateProjectionMatrix();
      }
      this.controls.target.lerp(this.frameTarget, 1 - Math.exp(-dt * 2));
      this.controls.update();
      this.endMarker.position.y += Math.sin(performance.now() / 250) * 0.01;
    }
    for (const p of [...this.puffs]) {
      p.life += dt;
      p.vel.y -= 12 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(Math.max(0.01, 1.2 - p.life));
      if (p.life > 1.2) {
        this.scene.remove(p.mesh);
        this.puffs.splice(this.puffs.indexOf(p), 1);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
