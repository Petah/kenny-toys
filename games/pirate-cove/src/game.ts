import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { load, save } from '@shared/storage';
import { MUSIC } from './assets.ts';
import { SHIPS, Sea, WORLD, type Event, type Island, type Ship, type ShipKind, type Side } from './sea.ts';

type State = 'title' | 'play' | 'over';

const MODEL: Record<ShipKind, string> = { pirate: 'ship-pirate-small', small: 'ship-small', medium: 'ship-medium', large: 'ship-large' };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** The sea's swell: the same waves move the water and rock the ships. */
function wave(x: number, z: number, t: number) {
  return Math.sin(x * 0.11 + t * 1.1) * 0.35 + Math.sin(z * 0.09 - t * 0.8) * 0.3 + Math.sin((x + z) * 0.05 + t * 0.6) * 0.25;
}

interface ShipView {
  obj: THREE.Group;
  hull: THREE.Object3D;
  roll: number;
  smokeIn: number;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  fall?: boolean;
  /** Foam lies flat on the water. */
  flat?: boolean;
}

export class CoveGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.5, 900);
  private renderer: THREE.WebGLRenderer;
  private last = 0;
  private clock = 0;

  private state: State = 'title';
  private sea = new Sea();
  private water: THREE.Mesh;
  private ships = new Map<number, ShipView>();
  private balls = new Map<number, THREE.Object3D>();
  private loot = new Map<number, THREE.Object3D>();
  private islandGroup = new THREE.Group();
  private forts = new Map<Island, THREE.Object3D>();
  private puffs: Puff[] = [];
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);
  private mats = {
    smoke: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 1 }),
    foam: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.2 }),
    fire: new THREE.MeshBasicMaterial({ color: 0xffb040 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 1 }),
  };

  private keys = new Set<string>();
  private steerTouch?: { id: number; x: number };
  private camYaw = 0;
  private best = load<number>('pirate-cove:best', 0);
  private hurried = false;
  private lastTick = -1;
  private radar: CanvasRenderingContext2D;

  constructor(
    stage: HTMLElement,
    private models: Record<string, THREE.Object3D>,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.scene.background = new THREE.Color(0x9fd8f2);
    this.scene.fog = new THREE.Fog(0x9fd8f2, 120, 300);
    this.scene.add(new THREE.HemisphereLight(0xf2fbff, 0x2f6f8a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.3);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.far = 260;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    // A low-poly sea that follows the ship and swells.
    const geo = new THREE.PlaneGeometry(420, 420, 84, 84);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2f9fc9, roughness: 0.35, metalness: 0.05, flatShading: true }));
    this.water.receiveShadow = true;
    this.scene.add(this.water);
    this.scene.add(this.islandGroup);
    this.radar = $<HTMLCanvasElement>('radar').getContext('2d')!;
    this.bindInput();
    this.buildIslands();
    this.showTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private sun: THREE.DirectionalLight;

  // ---- World -------------------------------------------------------------------------------

  private put(name: string, x: number, z: number, scale: number, yaw = 0, y = 0, parent: THREE.Object3D = this.islandGroup) {
    const m = this.models[name].clone();
    m.position.set(x, y, z);
    m.scale.setScalar(scale);
    m.rotation.y = yaw;
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    parent.add(m);
    return m;
  }

  /** Sandy islands with palms and rocks, a fort on some. */
  private buildIslands() {
    this.islandGroup.clear();
    this.forts.clear();
    let seed = 41;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const i of this.sea.islands) {
      // The sand patch is 7.7 × 6 across; stretch it to the island's size.
      const patch = this.put(r() < 0.5 ? 'patch-sand-foliage' : 'patch-sand', i.x, i.z, 1, r() * 6.3, -0.4);
      patch.scale.set((i.r * 2.3) / 7.7, 2.2, (i.r * 2.3) / 6);
      this.put('patch-grass-foliage', i.x + (r() - 0.5) * i.r * 0.4, i.z + (r() - 0.5) * i.r * 0.4, i.r / 4, r() * 6.3, 0.1);
      const palms = 2 + Math.floor(i.r / 4);
      for (let k = 0; k < palms; k++) {
        const a = r() * Math.PI * 2;
        const d = i.r * (0.3 + r() * 0.5);
        this.put(['palm-straight', 'palm-bend', 'palm-detailed-straight'][k % 3], i.x + Math.cos(a) * d, i.z + Math.sin(a) * d, 1.4 + r() * 0.6, r() * 6.3, 0.2);
      }
      const a = r() * Math.PI * 2;
      this.put(['rocks-sand-a', 'rocks-sand-b', 'rocks-a', 'rocks-b', 'rocks-c'][Math.floor(r() * 5)], i.x + Math.cos(a) * i.r * 0.85, i.z + Math.sin(a) * i.r * 0.85, 1 + r() * 0.8, r() * 6.3, -0.5);
      if (i.fort) {
        const t = this.put('tower-complete-small', i.x, i.z, 1.1, r() * 6.3, 0.1);
        this.put('flag-pirate', 0, 0, 1, 0, 7.4, t).visible = false;
        this.forts.set(i, t);
      }
    }
    // A wreck or two for scenery.
    this.put('ship-wreck', WORLD * 0.7, -WORLD * 0.5, 1.2, 1, -1.5);
  }

  // ---- Views -------------------------------------------------------------------------------

  private shipView(s: Ship): ShipView {
    let v = this.ships.get(s.id);
    if (v) return v;
    const obj = new THREE.Group();
    const hull = this.put(MODEL[s.kind], 0, 0, 1, 0, 0, obj);
    this.scene.add(obj);
    v = { obj, hull, roll: 0, smokeIn: 0 };
    this.ships.set(s.id, v);
    return v;
  }

  private puff(at: THREE.Vector3, mat: THREE.Material, size: number, vel: THREE.Vector3, life = 1, grow = 1.5, fall = false) {
    const mesh = new THREE.Mesh(this.puffGeo, mat);
    mesh.position.copy(at);
    mesh.scale.setScalar(size * 0.3);
    this.scene.add(mesh);
    this.puffs.push({ mesh, vel, life: 0, max: life * (0.8 + Math.random() * 0.4), size, grow, fall });
  }

  private splash(x: number, z: number, big = 1) {
    const y = wave(x, z, this.clock);
    for (let i = 0; i < 7 * big; i++) {
      this.puff(new THREE.Vector3(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5)), this.mats.foam, 0.5 * big, new THREE.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 4, (Math.random() - 0.5) * 3), 0.8, 1, true);
    }
  }

  private pop(text: string, at: THREE.Vector3, cls = '') {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    document.body.append(el);
    const p = at.clone().project(this.camera);
    if (p.z > 1) {
      el.remove();
      return;
    }
    el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    setTimeout(() => el.remove(), 1100);
  }

  // ---- Input -------------------------------------------------------------------------------

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
      if (this.state !== 'play') {
        if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) this.start();
        return;
      }
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'j') this.fire('left');
      if (k === 'e' || k === 'l') this.fire('right');
      if (k === ' ') {
        this.fire('left');
        this.fire('right');
      }
      if (k === 'w' || k === 'arrowup') this.setSail(Math.min(1, this.sea.player.sail + 0.34));
      if (k === 's' || k === 'arrowdown') this.setSail(Math.max(0.15, this.sea.player.sail - 0.34));
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.state !== 'play') return;
      if (e.pointerType === 'mouse') {
        // Click the water: fire the side that faces it.
        const p = this.waterPoint(e.clientX, e.clientY);
        if (p) this.fire(this.sea.sideFacing(this.sea.player, p.x, p.z));
        return;
      }
      // Touch: drag anywhere to steer.
      this.steerTouch = { id: e.pointerId, x: e.clientX };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.steerTouch?.id === e.pointerId) {
        const dx = e.clientX - this.steerTouch.x;
        this.sea.player.turn = Math.max(-1, Math.min(1, dx / 60));
      }
    });
    const end = (e: PointerEvent) => {
      if (this.steerTouch?.id === e.pointerId) {
        this.steerTouch = undefined;
        this.sea.player.turn = 0;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    $('fire-left').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.fire('left');
    });
    $('fire-right').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.fire('right');
    });
    $('sail').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const s = this.sea.player.sail;
      this.setSail(s > 0.9 ? 0.35 : s > 0.5 ? 1 : 0.68);
    });
    $('title-play').addEventListener('click', () => this.start());
    $('over-go').addEventListener('click', () => this.start());
  }

  private waterPoint(cx: number, cy: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : undefined;
  }

  private setSail(v: number) {
    this.sea.player.sail = v;
    this.sounds.play('creak', { volume: 0.3 });
    this.drawHud();
  }

  private fire(side: Side) {
    const p = this.sea.player;
    if (this.state !== 'play' || p.sinking !== undefined) return;
    const balls = this.sea.fire(p, side);
    if (balls.length) this.onFire(p, side, balls);
  }

  // ---- Events ------------------------------------------------------------------------------

  private onFire(s: Ship, side: Side, balls: { x: number; y: number; z: number }[]) {
    const dir = Sea.sideDir(s, side);
    const near = s === this.sea.player || Math.hypot(s.x - this.sea.player.x, s.z - this.sea.player.z) < 80;
    if (near) this.sounds.play('cannon', { volume: s === this.sea.player ? 0.6 : 0.35 });
    for (const b of balls) {
      // Smoke billows out of each gun port.
      for (let k = 0; k < 3; k++) this.puff(new THREE.Vector3(b.x, b.y, b.z), this.mats.smoke, 0.9, new THREE.Vector3(dir.x * (3 + k), 0.6 + Math.random(), dir.z * (3 + k)), 1.4, 2.4);
      this.puff(new THREE.Vector3(b.x, b.y, b.z), this.mats.fire, 0.5, new THREE.Vector3(dir.x * 6, 0, dir.z * 6), 0.15, 1.5);
    }
    const v = this.ships.get(s.id);
    if (v) v.roll += side === 'left' ? -0.12 : 0.12;
  }

  private handle(e: Event) {
    const p = this.sea.player;
    switch (e.type) {
      case 'fire':
        this.onFire(e.ship, e.side, e.balls);
        break;
      case 'fortFire':
        this.sounds.play('cannon', { volume: 0.3, rate: 0.85 });
        this.puff(new THREE.Vector3(e.ball.x, e.ball.y, e.ball.z), this.mats.smoke, 1.2, new THREE.Vector3(0, 1.5, 0), 1.5, 2.5);
        break;
      case 'hit': {
        const at = new THREE.Vector3(e.ball.x, e.ball.y, e.ball.z);
        this.sounds.play('hit', { volume: e.ship === p ? 0.6 : 0.4 });
        for (let k = 0; k < 5; k++) {
          const chip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.6), this.mats.wood);
          chip.position.copy(at);
          this.scene.add(chip);
          this.puffs.push({ mesh: chip, vel: new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 5, (Math.random() - 0.5) * 8), life: 0, max: 1.2, size: 1, grow: 0, fall: true });
        }
        this.puff(at, this.mats.dark, 0.8, new THREE.Vector3(0, 2, 0), 1, 2);
        if (e.ship === p) {
          this.shake = 0.35;
          this.flashHull();
        }
        break;
      }
      case 'fortHit':
        this.sounds.play('boom', { volume: 0.4 });
        this.puff(new THREE.Vector3(e.ball.x, e.ball.y, e.ball.z), this.mats.dark, 1, new THREE.Vector3(0, 2, 0), 1, 2);
        break;
      case 'splash':
        if (Math.hypot(e.ball.x - p.x, e.ball.z - p.z) < 70) this.sounds.play('splash', { volume: 0.18 });
        this.splash(e.ball.x, e.ball.z);
        break;
      case 'sink': {
        this.sounds.play('boom', { volume: 0.6 });
        const at = new THREE.Vector3(e.ship.x, 3, e.ship.z);
        for (let k = 0; k < 10; k++) this.puff(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)), k % 3 ? this.mats.dark : this.mats.fire, 1.4, new THREE.Vector3(0, 2 + Math.random() * 2, 0), 2, 2);
        if (e.ship !== p) this.pop(`Sunk! +${SHIPS[e.ship.kind].gold}`, at.setY(8), 'gold');
        else this.sounds.play('sad', { volume: 0.5, detune: 0 });
        break;
      }
      case 'fortDown': {
        const t = this.forts.get(e.island);
        this.sounds.play('boom', { volume: 0.7, rate: 0.7 });
        if (t) {
          t.scale.y *= 0.35;
          for (let k = 0; k < 12; k++) this.puff(new THREE.Vector3(e.island.x + (Math.random() - 0.5) * 4, 3, e.island.z + (Math.random() - 0.5) * 4), this.mats.dark, 1.6, new THREE.Vector3(0, 3, 0), 2.2, 2);
          // Your flag goes up over the ruins.
          const flag = t.children.find((c) => c.visible === false);
          if (flag) flag.visible = true;
        }
        this.pop('Fort taken! +75', new THREE.Vector3(e.island.x, 10, e.island.z), 'gold');
        break;
      }
      case 'loot': {
        const obj = this.loot.get(e.loot.id);
        if (obj) this.scene.remove(obj);
        this.loot.delete(e.loot.id);
        this.sounds.play('coins', { volume: 0.5 });
        this.pop(e.loot.kind === 'repair' ? `Repairs +${e.loot.value}` : `+${e.loot.value}`, new THREE.Vector3(e.loot.x, 4, e.loot.z), e.loot.kind === 'repair' ? 'fix' : 'gold');
        break;
      }
      case 'bump':
        this.sounds.play('scrape', { volume: 0.5 });
        if (e.ship === p) {
          this.shake = 0.3;
          this.flashHull();
        }
        break;
      case 'over':
        this.end();
        break;
      default:
        break;
    }
  }

  private shake = 0;

  private flashHull() {
    const bar = $('hull');
    bar.classList.remove('hurt');
    void bar.offsetWidth;
    bar.classList.add('hurt');
  }

  // ---- HUD and flow ------------------------------------------------------------------------

  private drawHud() {
    const s = this.sea;
    $('gold').textContent = String(s.gold);
    const secs = Math.ceil(s.time);
    $('clock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    $('clock').classList.toggle('hurry', s.time <= 15);
    const hp = Math.max(0, s.player.hp) / SHIPS.pirate.hp;
    $('hull-fill').style.width = `${hp * 100}%`;
    $('hull-fill').style.background = hp > 0.5 ? '#7ee05a' : hp > 0.25 ? '#ffc93a' : '#ff5a4e';
    for (const side of ['left', 'right'] as Side[]) {
      const left = s.player.reload[side] / SHIPS.pirate.reload;
      $(`fire-${side}`).style.setProperty('--reload', `${left * 100}%`);
      $(`fire-${side}`).classList.toggle('ready', left <= 0);
    }
    $('sail').textContent = s.player.sail > 0.9 ? 'Full sail' : s.player.sail > 0.5 ? 'Half sail' : 'Slow';
  }

  /** A little chart of what's about: navy ships red, loot gold, islands sand. */
  private drawRadar() {
    const g = this.radar;
    const size = g.canvas.width;
    const p = this.sea.player;
    const range = 110;
    const k = size / 2 / range;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(20, 60, 90, 0.55)';
    g.fill();
    g.clip();
    // The chart turns with the ship, so ahead is always up.
    g.translate(size / 2, size / 2);
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const at = (x: number, z: number) => {
      const dx = x - p.x;
      const dz = z - p.z;
      return [(-dx * fz + dz * fx) * k, -(dx * fx + dz * fz) * k] as const;
    };
    g.fillStyle = '#e8d29a';
    for (const i of this.sea.islands) {
      const [x, y] = at(i.x, i.z);
      g.beginPath();
      g.arc(x, y, i.r * k, 0, Math.PI * 2);
      g.fill();
      if (i.fort && !i.fort.dead) {
        g.fillStyle = '#ff7a5a';
        g.fillRect(x - 3, y - 3, 6, 6);
        g.fillStyle = '#e8d29a';
      }
    }
    g.fillStyle = '#ffd23f';
    for (const l of this.sea.loot) {
      const [x, y] = at(l.x, l.z);
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ff5a4e';
    for (const s of this.sea.ships) {
      if (s === p || s.sinking !== undefined) continue;
      const [x, y] = at(s.x, s.z);
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(size / 2, size / 2 - 7);
    g.lineTo(size / 2 + 5, size / 2 + 5);
    g.lineTo(size / 2 - 5, size / 2 + 5);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.stroke();
  }

  private showTitle() {
    this.state = 'title';
    document.body.classList.add('on-title');
    $('title').classList.add('show');
    $('title-best').textContent = this.best ? `Best haul: ${this.best} gold` : '';
  }

  private start() {
    this.sounds.play('click');
    void this.sounds.music(MUSIC, 0.16);
    for (const v of this.ships.values()) this.scene.remove(v.obj);
    for (const v of this.balls.values()) this.scene.remove(v);
    for (const v of this.loot.values()) this.scene.remove(v);
    this.ships.clear();
    this.balls.clear();
    this.loot.clear();
    this.sea = new Sea();
    this.buildIslands();
    this.state = 'play';
    this.hurried = false;
    this.camYaw = this.sea.player.heading;
    document.body.classList.remove('on-title');
    $('title').classList.remove('show');
    $('over').classList.remove('show');
    this.sounds.play('go', { volume: 0.6, detune: 0 });
  }

  private end() {
    this.state = 'over';
    const s = this.sea;
    const sunk = s.player.sinking !== undefined;
    const record = s.gold > this.best;
    if (record) {
      this.best = s.gold;
      save('pirate-cove:best', s.gold);
    }
    $('over-title').textContent = sunk ? 'Sunk!' : record && s.gold > 0 ? 'Record haul!' : 'Time to sail home';
    $('over-gold').textContent = String(s.gold);
    $('over-sunk').textContent = String(s.sunk);
    $('over-note').textContent = sunk ? 'Davy Jones keeps half... no, you keep it all. This time.' : record ? '' : `Best haul: ${this.best}`;
    setTimeout(() => $('over').classList.add('show'), 800);
    if (!sunk) this.sounds.play(record ? 'best' : 'timeOver', { volume: 0.6, detune: 0 });
    else this.sounds.play('sunk', { volume: 0.6, detune: 0 });
    if (!sunk) this.sounds.play('done', { volume: 0.4, detune: 0 });
  }

  // ---- Frame -------------------------------------------------------------------------------

  private frame(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.step(dt);
    this.render(dt);
  }

  /** Advances the game by `dt` seconds (automated checks call it directly). */
  step(dt: number) {
    this.clock += dt;
    if (this.state !== 'play') return;
    const p = this.sea.player;
    if (!this.steerTouch) {
      const left = this.keys.has('a') || this.keys.has('arrowleft');
      const right = this.keys.has('d') || this.keys.has('arrowright');
      p.turn = (left ? 1 : 0) - (right ? 1 : 0);
    }
    for (const e of this.sea.step(dt)) this.handle(e);
    if (this.sea.time <= 15 && !this.hurried) {
      this.hurried = true;
      this.sounds.play('hurry', { volume: 0.6, detune: 0 });
    }
    const secs = Math.ceil(this.sea.time);
    if (this.sea.time <= 5 && secs !== this.lastTick && this.sea.time > 0) this.sounds.play('tick', { volume: 0.4, detune: 0 });
    this.lastTick = secs;
    this.drawHud();
  }

  private render(dt: number) {
    const t = this.clock;
    const p = this.sea.player;
    // The sea follows the ship (snapped to its grid so the waves don't slide).
    const cell = 420 / 84;
    const wx = Math.round(p.x / cell) * cell;
    const wz = Math.round(p.z / cell) * cell;
    this.water.position.set(wx, 0, wz);
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, wave(pos.getX(i) + wx, pos.getZ(i) + wz, t) - 0.3);
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();

    for (const s of this.sea.ships) {
      const v = this.shipView(s);
      const y = wave(s.x, s.z, t);
      v.roll += (-s.turn * Math.min(1, s.speed / 8) * 0.12 - v.roll) * Math.min(1, dt * 2);
      const sink = s.sinking ?? 0;
      v.obj.position.set(s.x, y - 0.2 - sink * sink * 0.6, s.z);
      v.obj.rotation.set(Math.sin(t * 1.3 + s.id) * 0.04 + sink * 0.15, s.heading, v.roll + Math.sin(t * 0.9 + s.id) * 0.05 + sink * 0.1, 'YXZ');
      // Smoke from a battered hull, and a wake behind when under way.
      v.smokeIn -= dt;
      if (v.smokeIn <= 0) {
        v.smokeIn = 0.25;
        if (s.hp < SHIPS[s.kind].hp * 0.5 && s.sinking === undefined) this.puff(new THREE.Vector3(s.x, 4, s.z), this.mats.dark, 0.7, new THREE.Vector3(0, 3, 0), 1.6, 2);
        if (s.speed > 3 && s.sinking === undefined) {
          const back = SHIPS[s.kind].length * 0.5;
          const foam = new THREE.Vector3(s.x - Math.sin(s.heading) * back + (Math.random() - 0.5) * 2, y - 0.1, s.z - Math.cos(s.heading) * back + (Math.random() - 0.5) * 2);
          this.puff(foam, this.mats.foam, 0.35, new THREE.Vector3(0, 0, 0), 1.4, 1.6);
          this.puffs[this.puffs.length - 1].flat = true;
        }
      }
    }
    for (const [id, v] of this.ships) {
      if (!this.sea.ships.some((s) => s.id === id)) {
        this.scene.remove(v.obj);
        this.ships.delete(id);
      }
    }
    // Cannonballs.
    const live = new Set<number>();
    for (const b of this.sea.balls) {
      live.add(b.id);
      let obj = this.balls.get(b.id);
      if (!obj) {
        obj = this.models['cannon-ball'].clone();
        obj.scale.setScalar(0.9);
        this.scene.add(obj);
        this.balls.set(b.id, obj);
      }
      obj.position.set(b.x, b.y, b.z);
    }
    for (const [id, obj] of this.balls) {
      if (!live.has(id)) {
        this.scene.remove(obj);
        this.balls.delete(id);
      }
    }
    // Loot bobbing on the swell.
    const lootLive = new Set<number>();
    for (const l of this.sea.loot) {
      lootLive.add(l.id);
      let obj = this.loot.get(l.id);
      if (!obj) {
        obj = this.models[l.kind === 'repair' ? 'crate' : 'barrel'].clone();
        obj.scale.setScalar(1.3);
        this.scene.add(obj);
        this.loot.set(l.id, obj);
      }
      obj.position.set(l.x, wave(l.x, l.z, t) - 0.5, l.z);
      obj.rotation.set(Math.sin(t * 2 + l.id) * 0.2, t * 0.5 + l.id, 0);
      obj.visible = l.life > 3 || Math.sin(t * 20) > 0;
    }
    for (const [id, obj] of this.loot) {
      if (!lootLive.has(id)) {
        this.scene.remove(obj);
        this.loot.delete(id);
      }
    }
    for (const pf of [...this.puffs]) {
      pf.life += dt;
      const k = pf.life / pf.max;
      if (pf.fall) pf.vel.y -= 16 * dt;
      else pf.vel.multiplyScalar(1 - dt * 1.5);
      pf.mesh.position.addScaledVector(pf.vel, dt);
      if (pf.grow) pf.mesh.scale.setScalar(pf.size * (k < 0.15 ? k / 0.15 : 1 + (k - 0.15) * pf.grow) * (k > 0.7 ? (1 - k) / 0.3 : 1));
      if (pf.flat) pf.mesh.scale.y *= 0.25;
      else pf.mesh.rotation.x += dt * 8;
      if (k >= 1 || (pf.fall && pf.mesh.position.y < -1)) {
        this.scene.remove(pf.mesh);
        this.puffs.splice(this.puffs.indexOf(pf), 1);
      }
    }
    // Chase camera: behind and above, swinging round after the ship.
    let d = p.heading - this.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camYaw += d * Math.min(1, dt * (this.state === 'title' ? 0.3 : 1.8));
    if (this.state === 'title') this.camYaw += dt * 0.15;
    const tall = this.camera.aspect < 0.9;
    const back = tall ? 34 : 30;
    const up = tall ? 26 : 19;
    const cam = new THREE.Vector3(p.x - Math.sin(this.camYaw) * back, up, p.z - Math.cos(this.camYaw) * back);
    this.shake = Math.max(0, this.shake - dt);
    cam.x += (Math.random() - 0.5) * this.shake * 1.5;
    cam.y += (Math.random() - 0.5) * this.shake * 1.5;
    this.camera.position.lerp(cam, Math.min(1, dt * 5));
    this.camera.lookAt(p.x + Math.sin(this.camYaw) * 10, 2, p.z + Math.cos(this.camYaw) * 10);
    this.sun.position.set(p.x + 40, 80, p.z + 30);
    this.sun.target.position.set(p.x, 0, p.z);
    if (this.state === 'play') this.drawRadar();
    this.renderer.render(this.scene, this.camera);
  }
}
