import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { makeIcons } from '@shared/model-icons';
import { load, save } from '@shared/storage';
import { MUSIC, PROPS } from './assets.ts';
import { HALF_W, Kitchen, LAYER, type Event, type Falling, type Kind } from './kitchen.ts';

type State = 'title' | 'play' | 'over';

/** Food Kit models are tiny; this makes a bun 3.6 across. */
const S = 10;
const PLATE_TOP = 0.45;
/** Some layers tuck into the one below (cheese drapes over the patty). */
const SINK: Partial<Record<Kind, number>> = { cheese: 0.18 };
const KEY_SPEED = 13;
const FOV = 32;
/** The view always shows from just under the counter top… */
const VIEW_BOTTOM = -2.6;
/** …to at least this high. */
const VIEW_MIN_TOP = 14.5;

interface Layer {
  kind: Kind;
  obj: THREE.Object3D;
  /** Where it sits along the plate, from how far off-centre it was caught. */
  dx: number;
  wobble: number;
  squash: number;
  /** Popping in from nothing. */
  grow: number;
}

interface Flying {
  objs: THREE.Object3D[];
  /** Seconds it hangs where it was, lifted a little, before it goes. */
  hold: number;
  vel: THREE.Vector3;
  spin: number;
  life: number;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** A seeded-enough random for a shift. */
const rand = () => Math.random();

export class BurgerGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 300);
  private renderer: THREE.WebGLRenderer;
  private last = 0;

  private state: State = 'title';
  private kitchen?: Kitchen;
  private plate = new THREE.Group();
  private layers: Layer[] = [];
  private falling = new Map<number, THREE.Object3D>();
  private flying: Flying[] = [];
  private puffs: Puff[] = [];
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);

  private plateX = 0;
  private targetX = 0;
  private plateV = 0;
  private keys = new Set<string>();
  private drag?: { id: number; startX: number; plateX: number };
  private halfW = HALF_W;
  private viewTop = VIEW_MIN_TOP;
  private best = load<number>('burger-stack:best', 0);
  private icons: Record<string, string>;
  private hurried = false;
  private overIn = 0;
  private lastTickSecond = -1;

  constructor(
    stage: HTMLElement,
    private models: Record<string, THREE.Object3D>,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.buildWorld();
    this.scene.add(this.plate);
    const kinds = Object.keys(LAYER) as Kind[];
    this.icons = makeIcons(Object.fromEntries(kinds.map((k) => [k, this.iconModel(k)])), 128);
    this.bindInput();
    new ResizeObserver(() => this.frameCamera()).observe(stage);
    this.frameCamera();
    this.showTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---- Pieces ------------------------------------------------------------------------------

  /** One layer's model, its bottom at y = 0 and centred, at game scale. */
  private piece(kind: Kind): THREE.Object3D {
    const holder = new THREE.Group();
    const take = (source: THREE.Object3D, scale: number) => {
      const m = source.clone();
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      const inner = new THREE.Group();
      inner.add(m);
      inner.scale.setScalar(scale);
      const box = new THREE.Box3().setFromObject(inner);
      inner.position.y = -box.min.y;
      inner.position.x = -(box.min.x + box.max.x) / 2;
      inner.position.z = -(box.min.z + box.max.z) / 2;
      return inner;
    };
    const part = (name: string) => {
      const node = this.models.burger.getObjectByName(name) ?? this.models['burger-cheese-double'].getObjectByName(name);
      if (!node) throw new Error(`no ${name} in the burger`);
      return node;
    };
    switch (kind) {
      case 'bun-bottom':
      case 'bun-top':
      case 'patty':
      case 'cheese':
      case 'salad':
      case 'tomato':
        holder.add(take(part(kind), S));
        break;
      case 'bacon':
        // Two rashers side by side, cut to a bun's width.
        for (const side of [-1, 1]) {
          const r = take(this.models.bacon, 7);
          r.position.x += side * 0.5;
          r.rotation.y = side * 0.12;
          holder.add(r);
        }
        break;
      case 'egg':
        holder.add(take(this.models['egg-cooked'], 8.5));
        break;
      case 'bones':
        holder.add(take(this.models['fish-bones'], 5.5));
        break;
      case 'can':
        holder.add(take(this.models['soda-can-crushed'], 9));
        break;
      case 'wrapper':
        holder.add(take(this.models['candy-bar-wrapper'], 9));
        break;
    }
    return holder;
  }

  private iconModel(kind: Kind) {
    const g = new THREE.Group();
    const p = this.piece(kind);
    // Seen from a little above, so thin layers read.
    p.rotation.x = 0.5;
    g.add(p);
    return g;
  }

  // ---- The world ---------------------------------------------------------------------------

  private buildWorld() {
    this.scene.background = new THREE.Color(0xf6e3c4);
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a6a50, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-6, 18, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -20;
    sc.right = sc.top = 20;
    sc.far = 60;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // A tiled diner wall.
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const g = tile.getContext('2d')!;
    g.fillStyle = '#f9efdc';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e8d6b8';
    g.fillRect(0, 0, 64, 64);
    g.fillRect(64, 64, 64, 64);
    g.strokeStyle = 'rgba(160,130,100,0.35)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 64, 64);
    g.strokeRect(64, 64, 64, 64);
    g.strokeRect(64, 0, 64, 64);
    g.strokeRect(0, 64, 64, 64);
    const tex = new THREE.CanvasTexture(tile);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(30, 20);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    wall.position.set(0, 20, -6);
    wall.receiveShadow = true;
    this.scene.add(wall);
    // A red stripe along the wall at counter height.
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(120, 1.2), new THREE.MeshStandardMaterial({ color: 0xd8473a, roughness: 0.8 }));
    stripe.position.set(0, 2.2, -5.95);
    this.scene.add(stripe);

    // The counter: a steel top over a red front.
    const top = new THREE.Mesh(new THREE.BoxGeometry(120, 0.5, 7), new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.3 }));
    top.position.set(0, -0.25, -1.5);
    top.receiveShadow = true;
    this.scene.add(top);
    const front = new THREE.Mesh(new THREE.BoxGeometry(120, 6, 0.4), new THREE.MeshStandardMaterial({ color: 0xd8473a, roughness: 0.8 }));
    front.position.set(0, -3.5, 2);
    this.scene.add(front);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(120, 0.25, 0.5), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, metalness: 0.4 }));
    trim.position.set(0, -0.62, 2.05);
    this.scene.add(trim);

    const plate = this.models.plate.clone();
    plate.scale.setScalar(5);
    this.plate.add(plate);
    this.plate.position.z = 0;

    // Kitchen things along the back of the counter, out at the sides.
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spots = [-30, -26, -22, -18.5, -15, -11.5, -9, 9, 11.5, 15, 18.5, 22, 26, 30];
    spots.forEach((x, i) => {
      const name = PROPS[i % PROPS.length];
      const m = this.models[name].clone();
      m.scale.setScalar(7);
      m.position.set(x + (r() - 0.5), 0, -3.2 + r() * 1.2);
      m.rotation.y = (r() - 0.5) * 1.2;
      this.scene.add(m);
    });
  }

  /** Fits the counter across the screen with room above for things to fall. */
  private frameCamera() {
    const w = this.renderer.domElement.clientWidth || 1;
    const h = this.renderer.domElement.clientHeight || 1;
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // A narrow screen gets a narrower counter.
    if (!this.kitchen || this.state !== 'play') this.halfW = aspect < 0.9 ? 4.3 : HALF_W;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const needW = this.halfW + 2.4;
    const needH = (VIEW_MIN_TOP - VIEW_BOTTOM) / 2;
    const dist = Math.max(needW / (tan * aspect), needH / tan);
    const halfH = dist * tan;
    this.viewTop = VIEW_BOTTOM + halfH * 2;
    const cy = VIEW_BOTTOM + halfH;
    // Looking a touch down onto the counter.
    this.camera.position.set(0, cy + dist * 0.12, dist);
    this.camera.lookAt(0, cy, 0);
    if (this.kitchen) this.kitchen.dropY = this.dropY();
  }

  /** Where things appear: just above the top of the view, measured from the plate. */
  private dropY() {
    return this.viewTop + 1.2 - PLATE_TOP;
  }

  // ---- Stack -------------------------------------------------------------------------------

  private clearStack() {
    for (const l of this.layers) this.plate.remove(l.obj);
    this.layers = [];
  }

  private stackHeight(upTo = this.layers.length) {
    let h = 0;
    for (let i = 0; i < upTo; i++) h += LAYER[this.layers[i].kind].h;
    return h;
  }

  private addLayer(kind: Kind, obj = this.piece(kind), dx = 0) {
    const y = PLATE_TOP + this.stackHeight() - (SINK[kind] ?? 0);
    obj.position.set(dx, y, 0);
    obj.rotation.set(0, (Math.random() - 0.5) * 0.4, 0);
    this.plate.add(obj);
    const layer: Layer = { kind, obj, dx, wobble: 0, squash: 1, grow: 1 };
    this.layers.push(layer);
    return layer;
  }

  /** A fresh bottom bun pops onto the plate. */
  private freshBun() {
    const l = this.addLayer('bun-bottom');
    l.grow = 0;
    this.sounds.play('pop', { volume: 0.3 });
  }

  /** Sends the whole stack flying off the plate: right to the pass when served, left into the bin when not. */
  private sendOff(served: boolean) {
    const objs = this.layers.map((l) => {
      const world = new THREE.Vector3();
      l.obj.getWorldPosition(world);
      this.plate.remove(l.obj);
      l.obj.position.copy(world);
      this.scene.add(l.obj);
      return l.obj;
    });
    this.layers = [];
    this.flying.push({
      objs,
      vel: served ? new THREE.Vector3(26, 3, 0) : new THREE.Vector3(-14, 9, 1),
      spin: served ? 0 : 5,
      life: 0,
      hold: 0.32,
    });
    this.sounds.play('whoosh', { volume: 0.4 });
  }

  // ---- Effects -----------------------------------------------------------------------------

  private puff(at: THREE.Vector3, colour: number, size = 0.5) {
    const mesh = new THREE.Mesh(this.puffGeo, new THREE.MeshStandardMaterial({ color: colour, roughness: 1, transparent: true, opacity: 0.85 }));
    mesh.position.copy(at);
    this.scene.add(mesh);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5));
    this.puffs.push({ mesh, vel, life: 0, max: 0.8 + Math.random() * 0.4, size });
  }

  private pop(text: string, at: THREE.Vector3, cls = '') {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    document.body.append(el);
    const p = at.clone().project(this.camera);
    el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    setTimeout(() => el.remove(), 1100);
  }

  // ---- Input -------------------------------------------------------------------------------

  private bindInput() {
    const canvas = this.renderer.domElement;
    const worldX = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit);
      return hit.x;
    };
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.targetX = worldX(e.clientX, e.clientY);
      else if (this.drag && e.pointerId === this.drag.id) {
        // Fingers drag the plate along, so they don't cover it.
        this.targetX = this.drag.plateX + (worldX(e.clientX, e.clientY) - this.drag.startX) * 1.3;
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.drag = { id: e.pointerId, startX: worldX(e.clientX, e.clientY), plateX: this.plateX };
    });
    const up = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = undefined;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key);
      if (e.key.startsWith('Arrow')) e.preventDefault();
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && (this.state === 'title' || $('over').classList.contains('show'))) {
        e.preventDefault();
        this.start();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    $('title-play').addEventListener('click', () => this.start());
    $('over-go').addEventListener('click', () => this.start());
  }

  // ---- HUD ---------------------------------------------------------------------------------

  private drawTicket(fresh = false) {
    const k = this.kitchen;
    const box = $('ticket-items');
    box.innerHTML = '';
    if (!k) return;
    k.ticket.forEach((kind, i) => {
      const row = document.createElement('div');
      row.className = i < k.stack.length ? 'done' : i === k.stack.length ? 'next' : '';
      row.innerHTML = `<img src="${this.icons[kind]}" alt=""><span>${LAYER[kind].name}</span>`;
      box.append(row);
    });
    $('ticket-no').textContent = `#${k.served + 1}`;
    if (fresh) {
      const t = $('ticket');
      t.classList.remove('fresh');
      void t.offsetWidth;
      t.classList.add('fresh');
    }
  }

  private drawHud() {
    const k = this.kitchen;
    if (!k) return;
    const secs = Math.ceil(k.time);
    $('clock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    $('clock').classList.toggle('hurry', k.time <= 10);
    $('cash').textContent = `$${k.cash}`;
    $('served').textContent = `${k.served} served`;
  }

  // ---- Flow --------------------------------------------------------------------------------

  private showTitle() {
    this.state = 'title';
    document.body.classList.add('on-title');
    $('title').classList.add('show');
    $('over').classList.remove('show');
    $('title-best').textContent = this.best ? `Best shift: $${this.best}` : '';
    // A finished burger on the plate while you decide.
    this.clearStack();
    for (const kind of ['bun-bottom', 'salad', 'patty', 'cheese', 'tomato', 'bacon', 'bun-top'] as Kind[]) this.addLayer(kind);
  }

  private start() {
    this.sounds.play('click');
    void this.sounds.music(MUSIC, 0.16);
    for (const obj of this.falling.values()) this.scene.remove(obj);
    this.falling.clear();
    this.frameCamera();
    this.kitchen = new Kitchen(rand, { halfW: this.halfW, dropY: this.dropY() });
    this.state = 'play';
    this.hurried = false;
    this.plateX = this.targetX = 0;
    this.clearStack();
    this.freshBun();
    $('title').classList.remove('show');
    $('over').classList.remove('show');
    document.body.classList.remove('on-title');
    this.drawTicket(true);
    this.drawHud();
    this.sounds.play('go', { volume: 0.6, detune: 0 });
  }

  private handle(events: Event[]) {
    const k = this.kitchen!;
    for (const e of events) {
      if (e.type === 'catch') this.onCatch(e.item, e.right, e.offset);
      else if (e.type === 'miss') this.dropFalling(e.item.id);
      else if (e.type === 'served') this.onServed(e.ticket);
      else if (e.type === 'ruined') this.onRuined();
    }
    if (events.some((e) => e.type === 'catch')) this.drawTicket(events.some((e) => e.type === 'served' || e.type === 'ruined'));
    void k;
  }

  private dropFalling(id: number) {
    const obj = this.falling.get(id);
    if (obj) this.scene.remove(obj);
    this.falling.delete(id);
  }

  private onCatch(item: Falling, right: boolean, offset: number) {
    const obj = this.falling.get(item.id) ?? this.piece(item.kind);
    this.falling.delete(item.id);
    this.scene.remove(obj);
    const layer = this.addLayer(item.kind, obj, Math.max(-0.6, Math.min(0.6, offset * 0.4)));
    layer.squash = 1;
    const at = new THREE.Vector3(this.plateX, PLATE_TOP + this.stackHeight() + 0.6, 0);
    if (right) {
      this.sounds.play('plop', { volume: 0.5, rate: 0.9 + this.layers.length * 0.06, detune: 50 });
      this.pop('+$1', at);
    } else {
      this.sounds.play('plop', { volume: 0.5 });
      this.sounds.play('yuck', { volume: 0.5 });
      for (let i = 0; i < 6; i++) this.puff(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, -0.5, 0)), 0x9fc24a, 0.45);
      this.pop(LAYER[item.kind].junk ? 'Yuck!' : 'Wrong!', at, 'bad');
    }
  }

  private onServed(ticket: Kind[]) {
    const k = this.kitchen!;
    const at = new THREE.Vector3(this.plateX, PLATE_TOP + this.stackHeight() + 1, 0);
    this.sounds.play('bell', { volume: 0.45, detune: 0 });
    this.sounds.play('cash', { volume: 0.5 });
    const pay = ticket.length * 2 + Math.min(5, k.streak - 1) * 2;
    this.pop(`Order up! +$${pay}`, at, 'big');
    setTimeout(() => this.pop('+5s', new THREE.Vector3(0, this.viewTop - 2.5, 0), 'time'), 300);
    this.sendOff(true);
    this.freshBun();
  }

  private onRuined() {
    // It all goes in the bin, after a moment to see what went wrong.
    this.sendOff(false);
    this.sounds.play('bin', { volume: 0.5 });
    this.freshBun();
  }

  private endShift() {
    this.state = 'over';
    const k = this.kitchen!;
    for (const obj of this.falling.values()) this.scene.remove(obj);
    this.falling.clear();
    const record = k.cash > this.best;
    if (record) {
      this.best = k.cash;
      save('burger-stack:best', k.cash);
    }
    $('over-title').textContent = record && k.cash > 0 ? 'New best!' : 'Shift over!';
    $('over-served').textContent = String(k.served);
    $('over-cash').textContent = `$${k.cash}`;
    $('over-note').textContent = record ? '' : `Best shift: $${this.best}`;
    $('over').classList.add('show');
    this.sounds.play(record && k.cash > 0 ? 'best' : 'done', { volume: 0.55, detune: 0 });
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
    // Steer the plate.
    const keyDir = (this.keys.has('ArrowRight') || this.keys.has('d') ? 1 : 0) - (this.keys.has('ArrowLeft') || this.keys.has('a') ? 1 : 0);
    if (keyDir) this.targetX = this.plateX + keyDir * KEY_SPEED * dt;
    this.targetX = Math.max(-this.halfW, Math.min(this.halfW, this.targetX));
    const prev = this.plateX;
    if (this.state === 'play') this.plateX += (this.targetX - this.plateX) * Math.min(1, dt * 22);
    else this.plateX += (0 - this.plateX) * Math.min(1, dt * 4);
    this.plateV += ((this.plateX - prev) / Math.max(dt, 1e-4) - this.plateV) * Math.min(1, dt * 12);

    const k = this.kitchen;
    if (this.state === 'play' && k) {
      this.handle(k.step(dt, this.plateX));
      // Draw what's falling.
      for (const item of k.items) {
        let obj = this.falling.get(item.id);
        if (!obj) {
          obj = this.piece(item.kind);
          this.scene.add(obj);
          this.falling.set(item.id, obj);
        }
        obj.position.set(item.x, PLATE_TOP + item.y, 0);
        obj.rotation.z += item.spin * dt * 0.4;
        obj.rotation.x = 0.35 + Math.sin(item.y * 0.6 + item.id) * 0.25;
      }
      const secs = Math.ceil(k.time);
      if (k.time <= 10 && !this.hurried) {
        this.hurried = true;
        this.sounds.play('hurry', { volume: 0.6, detune: 0 });
      }
      if (k.time <= 5 && secs !== this.lastTickSecond && k.time > 0) this.sounds.play('tick', { volume: 0.4, detune: 0 });
      this.lastTickSecond = secs;
      if (k.time <= 0 && this.overIn <= 0) {
        this.overIn = 1.2;
        this.sounds.play('timeOver', { volume: 0.6, detune: 0 });
      }
      if (this.overIn > 0) {
        this.overIn -= dt;
        if (this.overIn <= 0) this.endShift();
      }
      this.drawHud();
    }
  }

  private render(dt: number) {
    this.plate.position.x = this.plateX;
    // Layers lean against the plate's motion, more the higher they are, and spring back.
    const lean = Math.max(-1, Math.min(1, -this.plateV / 30));
    let y = PLATE_TOP;
    this.layers.forEach((l, i) => {
      const want = lean * i * 0.09;
      l.wobble += (want - l.wobble) * Math.min(1, dt * (14 - Math.min(8, i)));
      l.squash = Math.max(0, l.squash - dt * 4);
      const sq = Math.sin(l.squash * Math.PI) * 0.35;
      l.grow = Math.min(1, l.grow + dt * 4);
      const grow = 1 - Math.pow(1 - l.grow, 3);
      l.obj.scale.set(grow * (1 + sq * 0.5), grow * (1 - sq), grow * (1 + sq * 0.5));
      l.obj.position.x = l.dx + l.wobble;
      l.obj.position.y = y - (SINK[l.kind] ?? 0);
      l.obj.rotation.z = -l.wobble * 0.12;
      y += LAYER[l.kind].h;
    });
    for (const f of [...this.flying]) {
      if (f.hold > 0) {
        f.hold -= dt;
        for (const o of f.objs) o.position.y += dt * 2.5;
        continue;
      }
      f.life += dt;
      f.vel.y -= 30 * dt;
      for (const [i, o] of f.objs.entries()) {
        o.position.addScaledVector(f.vel, dt * (1 + i * 0.03));
        o.rotation.z += f.spin * dt * (i % 2 ? 1 : -1);
      }
      if (f.life > 1.4) {
        for (const o of f.objs) this.scene.remove(o);
        this.flying.splice(this.flying.indexOf(f), 1);
      }
    }
    for (const p of [...this.puffs]) {
      p.life += dt;
      const t = p.life / p.max;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * (t < 0.2 ? t / 0.2 : 1 + t));
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.85 * (1 - t);
      if (t >= 1) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(this.puffs.indexOf(p), 1);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
