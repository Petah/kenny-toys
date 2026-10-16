import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { makeIcons } from '@shared/model-icons';
import { load, save } from '@shared/storage';
import { MUSIC } from './assets.ts';
import {
  Defense, MAX_LEVEL, TOWERS, UFOS, UFO_Y, WAVES, stats, upgradeCost,
  type Dir, type Event, type Shot, type Tower, type TowerKind, type Ufo,
} from './defense.ts';

type State = 'title' | 'play' | 'over';

const TILE_TOP = 0.2;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface UfoView {
  obj: THREE.Group;
  bar: THREE.Mesh;
  barBack: THREE.Mesh;
  flash: THREE.MeshBasicMaterial;
}

interface TowerView {
  obj: THREE.Group;
  weapon: THREE.Object3D;
  barrel?: THREE.Object3D;
  level: number;
  kick: number;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

/** Which way each tile model's path runs before it's turned (N, E, S, W = 0..3). */
const PATH_MODELS: { model: string; dirs: Dir[] }[] = [
  { model: 'tile-straight', dirs: [0, 2] },
  { model: 'tile-corner-round', dirs: [1, 2] },
  { model: 'tile-end', dirs: [2] },
];

export class DefenseGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.5, 300);
  private renderer: THREE.WebGLRenderer;
  private last = 0;

  private state: State = 'title';
  private d = new Defense();
  private board = new THREE.Group();
  private ufos = new Map<number, UfoView>();
  private towers = new Map<number, TowerView>();
  private shots = new Map<number, THREE.Object3D>();
  private puffs: Puff[] = [];
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);
  private hover: THREE.Object3D;
  private hoverMat: THREE.MeshBasicMaterial;
  private range: THREE.Mesh;
  private castle = new THREE.Group();
  private spawnRing!: THREE.Object3D;

  private speed = 1;
  private selected?: { col: number; row: number; tower?: Tower };
  private ray = new THREE.Raycaster();
  private best = load<number>('ufo-defense:best', 0);
  private icons: Record<string, string>;
  private shake = 0;
  private camBase = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private beams: { obj: THREE.Object3D; life: number }[] = [];

  constructor(
    stage: HTMLElement,
    private models: Record<string, THREE.Object3D>,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.buildWorld();
    this.scene.add(this.board);
    this.hoverMat = new THREE.MeshBasicMaterial({ color: 0x7ee05a, transparent: true, opacity: 0.6, depthWrite: false });
    this.hover = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), this.hoverMat);
    this.hover.rotation.x = -Math.PI / 2;
    this.hover.visible = false;
    this.scene.add(this.hover);
    this.range = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    this.range.add(fill);
    this.range.rotation.x = -Math.PI / 2;
    this.range.visible = false;
    this.scene.add(this.range);
    this.icons = makeIcons(Object.fromEntries((Object.keys(TOWERS) as TowerKind[]).map((k) => [k, this.towerModel(k, 1).obj])), 128);
    this.buildMenu();
    this.bindInput();
    new ResizeObserver(() => this.frameCamera()).observe(stage);
    this.buildBoard();
    this.frameCamera();
    this.showTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---- World -------------------------------------------------------------------------------

  private buildWorld() {
    this.scene.background = new THREE.Color(0x8fcfe8);
    this.scene.fog = new THREE.Fog(0x8fcfe8, 40, 90);
    this.scene.add(new THREE.HemisphereLight(0xf2f8ff, 0x557a44, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    sun.position.set(-8, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -14;
    sc.right = sc.top = 14;
    sc.far = 60;
    sun.shadow.bias = -0.0005;
    sun.target.position.set(6, 0, 4);
    sun.position.set(-2, 16, 14);
    this.scene.add(sun, sun.target);
  }

  private put(name: string, x: number, z: number, yaw = 0, y = 0, parent: THREE.Object3D = this.board) {
    const m = this.models[name].clone();
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    parent.add(m);
    return m;
  }

  /** Tiles for the map, path pieces turned to join up, scenery and a ring of woods around it. */
  private buildBoard() {
    this.board.clear();
    const lv = this.d.level;
    for (const p of lv.path) {
      const isEnd = p.dirs.length === 1;
      let placed = false;
      for (const def of PATH_MODELS) {
        if (def.dirs.length !== p.dirs.length) continue;
        for (let k = 0; k < 4 && !placed; k++) {
          // Turning a model by k quarter turns moves each of its openings round by -k.
          const turned = def.dirs.map((d) => ((d - k + 4) % 4) as Dir);
          if (turned.every((d) => p.dirs.includes(d))) {
            const model = isEnd && p.col === lv.spawn.col && p.row === lv.spawn.row ? 'tile-spawn-end' : def.model;
            this.put(model, p.col, p.row, (k * Math.PI) / 2);
            placed = true;
          }
        }
        if (placed) break;
      }
      if (!placed) this.put('tile-dirt', p.col, p.row);
    }
    for (const c of lv.free) this.put('tile', c.col, c.row);
    let seed = 5;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sceneryTiles = ['tile-tree', 'tile-tree-double', 'tile-rock', 'tile-crystal'];
    for (const c of lv.scenery) this.put(sceneryTiles[Math.floor(r() * sceneryTiles.length)], c.col, c.row, Math.floor(r() * 4) * (Math.PI / 2));
    // Woods and hills round the edge, so the map sits in a landscape.
    for (let row = -3; row < lv.rows + 3; row++) {
      for (let col = -3; col < lv.cols + 3; col++) {
        if (col >= 0 && row >= 0 && col < lv.cols && row < lv.rows) continue;
        const roll = r();
        const name = roll < 0.45 ? 'tile-tree-quad' : roll < 0.7 ? 'tile-tree-double' : roll < 0.82 ? 'tile-hill' : roll < 0.9 ? 'tile-rock' : 'tile';
        this.put(name, col, row, Math.floor(r() * 4) * (Math.PI / 2));
      }
    }
    // The castle at the end of the road, and a portal where the UFOs arrive.
    this.castle.clear();
    const b = lv.base;
    let y = TILE_TOP;
    for (const part of ['tower-square-bottom-a', 'tower-square-middle-a', 'tower-square-middle-a', 'tower-square-roof-a']) {
      const m = this.put(part, 0, 0, 0, y, this.castle);
      y += part.endsWith('roof-a') ? 0 : 0.5;
      void m;
    }
    this.castle.position.set(b.col, 0, b.row);
    this.castle.scale.setScalar(0.9);
    this.board.add(this.castle);
    this.spawnRing = this.put('spawn-round', lv.spawn.col, lv.spawn.row, 0, TILE_TOP);
    this.board.traverse((o) => {
      if (o instanceof THREE.Mesh) o.receiveShadow = true;
    });
  }

  /** Frames the map, turning it a quarter on tall screens. */
  private frameCamera() {
    const w = this.renderer.domElement.clientWidth || 1;
    const h = this.renderer.domElement.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const lv = this.d.level;
    const cx = (lv.cols - 1) / 2;
    const cz = (lv.rows - 1) / 2;
    const target = new THREE.Vector3(cx, 0, cz);
    const corners: THREE.Vector3[] = [];
    for (const sx of [-0.5, lv.cols - 0.5]) for (const sz of [-0.5, lv.rows - 0.5]) for (const yy of [0, 1.5]) corners.push(new THREE.Vector3(sx, yy, sz));
    const top = 1 - (2 * (w < 600 ? 112 : 70)) / h;
    const bottom = -1 + (2 * (w < 600 ? 90 : 20)) / h;
    const side = 1 - (2 * 10) / w;
    const elev = THREE.MathUtils.degToRad(58);
    let best = { dist: Infinity, pos: new THREE.Vector3(), target };
    for (const yaw of [0, -Math.PI / 2]) {
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
      const fits = (dist: number) => {
        this.camera.position.copy(target).addScaledVector(dir, dist);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
        let minY = 9;
        let maxY = -9;
        let maxX = 0;
        for (const c of corners) {
          const p = c.clone().project(this.camera);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
          maxX = Math.max(maxX, Math.abs(p.x));
        }
        return { ok: maxX <= side && maxY - minY <= top - bottom, mid: (maxY + minY) / 2 };
      };
      let lo = 3;
      let hi = 200;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid).ok) hi = mid;
        else lo = mid;
      }
      if (hi < best.dist - 0.3) {
        const { mid } = fits(hi);
        const up = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const per = (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * hi) / Math.sin(elev);
        const t2 = target.clone().addScaledVector(up, (mid - (top + bottom) / 2) * per);
        best = { dist: hi, pos: t2.clone().addScaledVector(dir, hi), target: t2 };
      }
    }
    this.camBase.pos.copy(best.pos);
    this.camBase.target.copy(best.target);
    this.camera.position.copy(best.pos);
    this.camera.lookAt(best.target);
  }

  // ---- Models ------------------------------------------------------------------------------

  /** A tower: a round or square base, a storey per level above the first, a top and its weapon. */
  private towerModel(kind: TowerKind, level: number): TowerView {
    const obj = new THREE.Group();
    const shape = kind === 'turret' || kind === 'cannon' ? 'round' : 'square';
    const storey = shape === 'round' ? 0.6 : 0.5;
    let y = 0;
    this.put(`tower-${shape}-bottom-a`, 0, 0, 0, y, obj);
    y += storey;
    for (let i = 1; i < level; i++) {
      this.put(`tower-${shape}-middle-a`, 0, 0, 0, y, obj);
      y += storey;
    }
    this.put(`tower-${shape}-top-a`, 0, 0, 0, y, obj);
    y += 0.42;
    const weapon = this.put(TOWERS[kind].weapon, 0, 0, 0, y, obj);
    const barrel = weapon.getObjectByName('barrel') ?? weapon.getObjectByName('arrow') ?? weapon.getObjectByName('catapult') ?? undefined;
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    return { obj, weapon, barrel, level, kick: 0 };
  }

  private syncTower(t: Tower) {
    let v = this.towers.get(t.id);
    if (v && v.level === t.level) return v;
    if (v) this.scene.remove(v.obj);
    v = this.towerModel(t.kind, t.level);
    v.obj.position.set(t.col, TILE_TOP, t.row);
    v.obj.scale.setScalar(0.92);
    this.scene.add(v.obj);
    this.towers.set(t.id, v);
    // Pop up into place.
    v.obj.scale.y = 0.2;
    return v;
  }

  private ufoView(u: Ufo): UfoView {
    let v = this.ufos.get(u.id);
    if (v) return v;
    const obj = new THREE.Group();
    const body = this.models[UFOS[u.kind].model].clone();
    body.scale.setScalar(UFOS[u.kind].size);
    body.position.y = -0.2 * UFOS[u.kind].size;
    obj.add(body);
    // A white flash layered over the body when it's hit.
    const flash = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.45 * UFOS[u.kind].size, 16, 10), flash);
    glow.scale.y = 0.45;
    obj.add(glow);
    const barBack = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.08), new THREE.MeshBasicMaterial({ color: 0x23232c, depthTest: false }));
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.05), new THREE.MeshBasicMaterial({ color: 0x7ee05a, depthTest: false }));
    barBack.renderOrder = 5;
    bar.renderOrder = 6;
    obj.add(barBack, bar);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== bar && o !== barBack && o !== glow) o.castShadow = true;
    });
    this.scene.add(obj);
    v = { obj, bar, barBack, flash };
    this.ufos.set(u.id, v);
    return v;
  }

  // ---- Effects -----------------------------------------------------------------------------

  private puff(at: THREE.Vector3, colour: number, size: number, up = 1.2) {
    const mesh = new THREE.Mesh(this.puffGeo, new THREE.MeshStandardMaterial({ color: colour, roughness: 1, emissive: colour, emissiveIntensity: 0.25 }));
    mesh.position.copy(at);
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 1.6, up + Math.random(), (Math.random() - 0.5) * 1.6);
    this.puffs.push({ mesh, vel, life: 0, max: 0.6 + Math.random() * 0.3, size });
  }

  private explode(x: number, z: number, big: boolean) {
    const at = new THREE.Vector3(x, UFO_Y, z);
    for (let i = 0; i < (big ? 16 : 7); i++) this.puff(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)), i % 3 ? 0xffa640 : 0xfff2a0, big ? 0.35 : 0.2);
    for (let i = 0; i < 4; i++) this.puff(at, 0x6d6a72, big ? 0.3 : 0.16, 0.4);
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

  // ---- Input -------------------------------------------------------------------------------

  private tileAt(cx: number, cy: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP), hit)) return undefined;
    const col = Math.round(hit.x);
    const row = Math.round(hit.z);
    if (col < 0 || row < 0 || col >= this.d.level.cols || row >= this.d.level.rows) return undefined;
    return { col, row };
  }

  private bindInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this.state !== 'play') return;
      const t = this.tileAt(e.clientX, e.clientY);
      this.showHover(t);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (this.state !== 'play') return;
      const t = this.tileAt(e.clientX, e.clientY);
      this.select(t);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(undefined);
      if (e.key === ' ' && this.state === 'play') {
        e.preventDefault();
        this.sendWave();
      }
      if ((e.key === 'Enter' || e.key === ' ') && this.state !== 'play') this.start();
    });
    $('wave-btn').addEventListener('click', () => this.sendWave());
    $('speed-btn').addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
      $('speed-btn').textContent = `${this.speed}×`;
      this.sounds.play('click');
    });
    $('title-play').addEventListener('click', () => this.start());
    $('over-go').addEventListener('click', () => this.start());
    $('upgrade').addEventListener('click', () => this.upgradeSelected());
    $('sell').addEventListener('click', () => this.sellSelected());
  }

  private showHover(t?: { col: number; row: number }) {
    if (!t) {
      this.hover.visible = false;
      return;
    }
    const tower = this.d.towers.find((x) => x.col === t.col && x.row === t.row);
    const ok = this.d.canBuild(t.col, t.row) || !!tower;
    this.hover.visible = true;
    this.hover.position.set(t.col, TILE_TOP + 0.02, t.row);
    this.hoverMat.color.setHex(ok ? 0x7ee05a : 0xff6a5a);
    this.hoverMat.opacity = ok ? 0.45 : 0.3;
  }

  private buildMenu() {
    const box = $('build-options');
    for (const kind of Object.keys(TOWERS) as TowerKind[]) {
      const t = TOWERS[kind];
      const b = document.createElement('button');
      b.dataset.kind = kind;
      b.innerHTML = `<img src="${this.icons[kind]}" alt=""><b>${t.name}</b><span class="cost">${t.cost}</span><small>${t.note}</small>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.buildSelected(kind);
      });
      b.addEventListener('pointerenter', () => this.showRange(kind, 1));
      box.append(b);
    }
  }

  private showRange(kind?: TowerKind, level = 1) {
    const s = this.selected;
    if (!kind || !s) {
      this.range.visible = false;
      return;
    }
    const r = stats(kind, level).range;
    this.range.visible = true;
    this.range.position.set(s.col, TILE_TOP + 0.04, s.row);
    this.range.scale.setScalar(r);
  }

  private select(t?: { col: number; row: number }) {
    $('build').classList.remove('show');
    $('tower').classList.remove('show');
    this.range.visible = false;
    if (!t) {
      this.selected = undefined;
      return;
    }
    const tower = this.d.towers.find((x) => x.col === t.col && x.row === t.row);
    if (tower) {
      this.selected = { ...t, tower };
      this.showRange(tower.kind, tower.level);
      this.drawTowerPanel();
      this.place($('tower'), t);
      $('tower').classList.add('show');
      this.sounds.play('click');
    } else if (this.d.canBuild(t.col, t.row)) {
      this.selected = t;
      this.drawBuildPanel();
      this.place($('build'), t);
      $('build').classList.add('show');
      this.showRange('turret', 1);
      this.sounds.play('click');
    } else {
      this.selected = undefined;
    }
  }

  /** Puts a panel beside the tile on screen, kept on screen. */
  private place(el: HTMLElement, t: { col: number; row: number }) {
    const p = new THREE.Vector3(t.col, TILE_TOP, t.row).project(this.camera);
    const x = ((p.x + 1) / 2) * window.innerWidth;
    const y = ((1 - p.y) / 2) * window.innerHeight;
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    const w = r.width || 300;
    const h = r.height || 160;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
    const top = y - h - 30 > 70 ? y - h - 30 : Math.min(window.innerHeight - h - 8, y + 30);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  private drawBuildPanel() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#build-options button')) {
      b.disabled = this.d.coins < TOWERS[b.dataset.kind as TowerKind].cost;
    }
  }

  private drawTowerPanel() {
    const t = this.selected?.tower;
    if (!t) return;
    $('tower-name').textContent = `${TOWERS[t.kind].name}, level ${t.level}`;
    const up = $<HTMLButtonElement>('upgrade');
    if (t.level >= MAX_LEVEL) {
      up.textContent = 'Max level';
      up.disabled = true;
    } else {
      const cost = upgradeCost(t.kind, t.level);
      up.innerHTML = `Upgrade <span class="cost">${cost}</span>`;
      up.disabled = this.d.coins < cost;
    }
    $('sell').innerHTML = `Sell <span class="cost">${Math.floor(t.spent * 0.7)}</span>`;
  }

  private buildSelected(kind: TowerKind) {
    const s = this.selected;
    if (!s) return;
    const t = this.d.build(kind, s.col, s.row);
    if (!t) {
      this.sounds.play('nope', { volume: 0.4 });
      return;
    }
    this.sounds.play('build', { volume: 0.6 });
    this.syncTower(t);
    for (let i = 0; i < 6; i++) this.puff(new THREE.Vector3(s.col, TILE_TOP, s.row), 0xc9b59a, 0.18, 0.6);
    this.select(undefined);
    this.drawHud();
  }

  private upgradeSelected() {
    const t = this.selected?.tower;
    if (!t || !this.d.upgrade(t)) {
      this.sounds.play('nope', { volume: 0.4 });
      return;
    }
    this.sounds.play('upgrade', { volume: 0.5 });
    this.syncTower(t);
    this.showRange(t.kind, t.level);
    this.drawTowerPanel();
    this.drawHud();
  }

  private sellSelected() {
    const t = this.selected?.tower;
    if (!t) return;
    const refund = this.d.sell(t);
    const v = this.towers.get(t.id);
    if (v) this.scene.remove(v.obj);
    this.towers.delete(t.id);
    this.sounds.play('sell', { volume: 0.5 });
    this.pop(`+${refund}`, new THREE.Vector3(t.col, 1, t.row), 'coin');
    this.select(undefined);
    this.drawHud();
  }

  private sendWave() {
    if (this.state !== 'play' || this.d.wave >= WAVES) return;
    const early = this.d.running;
    const before = this.d.coins;
    for (const e of this.d.sendWave()) this.handle(e);
    if (early && this.d.coins > before) this.pop(`early bonus +${this.d.coins - before}`, new THREE.Vector3(this.d.level.spawn.col, 1.5, this.d.level.spawn.row), 'coin');
    this.drawHud();
  }

  // ---- HUD and flow ------------------------------------------------------------------------

  private drawHud() {
    $('coins').textContent = String(this.d.coins);
    $('lives').textContent = String(this.d.lives);
    $('wave').textContent = `${Math.max(1, this.d.wave)}/${WAVES}`;
    const btn = $<HTMLButtonElement>('wave-btn');
    btn.disabled = this.d.wave >= WAVES;
    btn.textContent = this.d.wave === 0 ? 'Send first wave' : this.d.running ? 'Next wave early' : 'Next wave';
    btn.classList.toggle('ready', !this.d.running && this.d.wave < WAVES);
    if ($('build').classList.contains('show')) this.drawBuildPanel();
    if ($('tower').classList.contains('show')) this.drawTowerPanel();
  }

  private showTitle() {
    this.state = 'title';
    document.body.classList.add('on-title');
    $('title').classList.add('show');
    $('title-best').textContent = this.best ? `Best: ${this.best}` : '';
  }

  private start() {
    this.sounds.play('click');
    void this.sounds.music(MUSIC, 0.14);
    for (const v of this.towers.values()) this.scene.remove(v.obj);
    for (const v of this.ufos.values()) this.scene.remove(v.obj);
    for (const v of this.shots.values()) this.scene.remove(v);
    this.towers.clear();
    this.ufos.clear();
    this.shots.clear();
    this.d = new Defense();
    this.state = 'play';
    this.speed = 1;
    $('speed-btn').textContent = '1×';
    document.body.classList.remove('on-title');
    $('title').classList.remove('show');
    $('over').classList.remove('show');
    this.drawHud();
    this.hint('Tap a grass tile to build a tower, then send the first wave');
  }

  private hint(text: string) {
    const h = $('hint');
    h.textContent = text;
    h.classList.toggle('show', !!text);
  }

  private end(won: boolean) {
    this.state = 'over';
    this.select(undefined);
    const score = this.d.score;
    const record = score > this.best;
    if (record) {
      this.best = score;
      save('ufo-defense:best', score);
    }
    $('over-title').textContent = won ? 'Castle saved!' : 'Castle taken!';
    $('over-wave').textContent = `${this.d.wave}`;
    $('over-lives').textContent = `${this.d.lives}`;
    $('over-score').textContent = `${score}`;
    $('over-note').textContent = record ? 'New best!' : `Best: ${this.best}`;
    setTimeout(() => $('over').classList.add('show'), 900);
    this.sounds.play(won ? 'won' : 'lost', { volume: 0.6, detune: 0 });
    if (record) setTimeout(() => this.sounds.play('best', { volume: 0.6, detune: 0 }), 1600);
  }

  private handle(e: Event) {
    switch (e.type) {
      case 'wave':
        this.sounds.play(e.wave === WAVES ? 'final' : 'go', { volume: 0.5, detune: 0 });
        this.banner(e.wave === WAVES ? 'Final wave!' : `Wave ${e.wave}`, e.wave % 5 === 0 ? 'Mothership incoming' : '');
        this.hint('');
        break;
      case 'fire': {
        this.sounds.play(e.tower.kind, { volume: e.tower.kind === 'turret' ? 0.12 : 0.3 });
        const v = this.towers.get(e.tower.id);
        if (v) v.kick = 1;
        const ammo = this.models[TOWERS[e.shot.kind].ammo].clone();
        ammo.scale.setScalar(e.shot.kind === 'turret' ? 0.7 : 0.9);
        this.scene.add(ammo);
        this.shots.set(e.shot.id, ammo);
        this.drawShot(e.shot, ammo);
        break;
      }
      case 'hit': {
        const obj = this.shots.get(e.shot.id);
        if (obj) this.scene.remove(obj);
        this.shots.delete(e.shot.id);
        if (e.splash) {
          this.explode(e.x, e.z, e.shot.splash > 1);
          this.sounds.play('boom', { volume: 0.3 });
          if (e.shot.splash > 1) this.shake = 0.25;
        } else if (e.shot.kind !== 'turret') this.sounds.play('hit', { volume: 0.2 });
        break;
      }
      case 'kill': {
        const v = this.ufos.get(e.ufo.id);
        if (v) this.scene.remove(v.obj);
        this.ufos.delete(e.ufo.id);
        this.explode(e.x, e.z, e.ufo.kind === 'mother');
        this.sounds.play(e.ufo.kind === 'mother' ? 'bigBoom' : 'boom', { volume: 0.35 });
        this.sounds.play('coin', { volume: 0.2 });
        this.pop(`+${e.reward}`, new THREE.Vector3(e.x, UFO_Y + 0.5, e.z), 'coin');
        if (e.ufo.kind === 'mother') this.shake = 0.5;
        break;
      }
      case 'leak': {
        const v = this.ufos.get(e.ufo.id);
        if (v) {
          // A beam down onto the castle as it gets through.
          const beam = this.models['enemy-ufo-beam'].clone();
          beam.position.copy(v.obj.position).setY(TILE_TOP);
          beam.scale.set(0.8, UFO_Y, 0.8);
          this.scene.add(beam);
          this.beams.push({ obj: beam, life: 0.6 });
          this.scene.remove(v.obj);
        }
        this.ufos.delete(e.ufo.id);
        this.shake = 0.35;
        this.sounds.play('leak', { volume: 0.5 });
        this.pop(`-${UFOS[e.ufo.kind].leak}`, new THREE.Vector3(this.d.level.base.col, 2.2, this.d.level.base.row), 'bad');
        break;
      }
      case 'cleared':
        this.sounds.play('cleared', { volume: 0.5 });
        this.banner(`Wave ${e.wave} cleared`, `+${e.bonus} coins`);
        break;
      case 'over':
        this.end(false);
        break;
      case 'won':
        this.end(true);
        break;
    }
    this.drawHud();
  }

  private banner(text: string, sub = '') {
    const b = $('banner');
    b.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    b.classList.add('show');
    clearTimeout(Number(b.dataset.timer));
    b.dataset.timer = String(setTimeout(() => b.classList.remove('show'), 1600));
  }

  private drawShot(s: Shot, obj: THREE.Object3D) {
    const k = Math.min(1, s.t / s.time);
    const x = s.from.x + (s.to.x - s.from.x) * k;
    const z = s.from.z + (s.to.z - s.from.z) * k;
    const endY = s.splash ? TILE_TOP + 0.3 : UFO_Y;
    const y = s.from.y + (endY - s.from.y) * k + Math.sin(k * Math.PI) * s.arc;
    const prev = obj.position.clone();
    obj.position.set(x, y, z);
    if (prev.lengthSq() > 0) obj.lookAt(prev.multiplyScalar(-1).add(obj.position.clone().multiplyScalar(2)));
  }

  // ---- Frame -------------------------------------------------------------------------------

  private frame(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.step(dt * (this.state === 'play' ? this.speed : 1));
    this.render(dt);
  }

  /** Advances the game by `dt` seconds of play (automated checks call it directly). */
  step(dt: number) {
    if (this.state !== 'play') return;
    // Small steps so fast-forward stays accurate.
    const n = Math.ceil(dt / (1 / 60));
    for (let i = 0; i < n; i++) for (const e of this.d.step(dt / n)) this.handle(e);
  }

  private render(dt: number) {
    const now = performance.now() / 1000;
    for (const u of this.d.ufos) {
      const v = this.ufoView(u);
      const p = this.d.ufoPos(u);
      v.obj.position.set(p.x, UFO_Y + Math.sin(now * 3 + u.id) * 0.05, p.z);
      v.obj.children[0].rotation.y += dt * 1.5;
      v.flash.opacity = Math.max(0, 0.7 - u.hitAt * 6);
      const frac = Math.max(0, u.hp / u.maxHp);
      v.bar.scale.x = Math.max(0.01, frac);
      v.bar.position.x = -0.28 * (1 - frac);
      (v.bar.material as THREE.MeshBasicMaterial).color.setHex(frac > 0.5 ? 0x7ee05a : frac > 0.25 ? 0xffc93a : 0xff5a4e);
      const barY = 0.55 * UFOS[u.kind].size + 0.15;
      v.bar.position.y = v.barBack.position.y = barY;
      v.bar.quaternion.copy(this.camera.quaternion);
      v.barBack.quaternion.copy(this.camera.quaternion);
      v.bar.visible = v.barBack.visible = frac < 1;
    }
    for (const t of this.d.towers) {
      const v = this.syncTower(t);
      v.obj.scale.y += (0.92 - v.obj.scale.y) * Math.min(1, dt * 10);
      // Turn the weapon smoothly towards its target.
      let d = t.yaw - v.weapon.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.weapon.rotation.y += d * Math.min(1, dt * 12);
      v.kick = Math.max(0, v.kick - dt * 6);
      if (v.barrel) v.barrel.position.z = -v.kick * 0.08;
    }
    for (const s of this.d.shots) {
      const obj = this.shots.get(s.id);
      if (obj) this.drawShot(s, obj);
    }
    for (const b of [...this.beams]) {
      b.life -= dt;
      b.obj.scale.x = b.obj.scale.z = 0.8 * Math.max(0.05, b.life / 0.6);
      if (b.life <= 0) {
        this.scene.remove(b.obj);
        this.beams.splice(this.beams.indexOf(b), 1);
      }
    }
    for (const p of [...this.puffs]) {
      p.life += dt;
      const k = p.life / p.max;
      p.vel.multiplyScalar(1 - dt * 2);
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8 * 0.9));
      if (k >= 1) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(this.puffs.indexOf(p), 1);
      }
    }
    this.spawnRing.rotation.y += dt;
    // Camera shake.
    this.shake = Math.max(0, this.shake - dt);
    const j = this.shake * 0.15;
    this.camera.position.copy(this.camBase.pos).add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j));
    this.camera.lookAt(this.camBase.target);
    this.renderer.render(this.scene, this.camera);
  }
}
