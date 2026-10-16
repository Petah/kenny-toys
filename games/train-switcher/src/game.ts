import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { makeIcons } from '@shared/model-icons';
import { load, save } from '@shared/storage';
import { MUSIC } from './assets.ts';
import { stageFor, type Stage } from './layouts.ts';
import { Route, TILE, centre, neighbour, opposite, parseLayout, sample, segmentFor, type Cell, type Dir, type Layout } from './rail.ts';
import { CARGO, COUPLING, ENGINES, ENGINE_LENGTH, WAGON_LENGTH, trainLength } from './trains.ts';

type State = 'title' | 'intro' | 'run' | 'clear' | 'over';

interface Car {
  obj: THREE.Object3D;
  /** Distance from the front of the train to the middle of this car. */
  offset: number;
  length: number;
}

interface Train {
  cargo: number;
  route: Route;
  /** How far along its route the front of the train is. */
  head: number;
  length: number;
  cars: Car[];
  /** A coloured disc riding above the engine, so the cargo reads at a glance. */
  marker: THREE.Object3D;
  steam: boolean;
  puffIn: number;
  /** Has it reached a shed door (and been scored). */
  arrived: boolean;
}

interface SwitchView {
  cell: Cell;
  /** The rails of each way out, lit for the set one. */
  branches: THREE.Object3D[];
  arrow: THREE.Group;
  arrowMat: THREE.MeshBasicMaterial;
  disc: THREE.Mesh;
  discMat: THREE.MeshBasicMaterial;
  yaw: number;
  pop: number;
  locked: boolean;
}

interface ShedView {
  cell: Cell;
  cargo: number;
  group: THREE.Group;
  bounce: number;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  spin?: THREE.Vector3;
}

const HEARTS = 3;
/** Rails sit 0.9 below a piece's origin; this lifts their tops to y = 0, where the wheels run. */
const RAIL_Y = 0.9;
/** Seconds the next train's colour shows on the tunnel lamp before it comes out. */
const SIGNAL_AHEAD = 2.5;
const STEP: Record<Dir, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class SwitcherGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
  private renderer: THREE.WebGLRenderer;
  private sun = new THREE.DirectionalLight(0xfff2dc, 2.3);
  private last = 0;

  private state: State = 'title';
  private stageNo = 0;
  private stage!: Stage & { lap: number };
  private layout!: Layout;
  private yard = new THREE.Group();
  private switches: SwitchView[] = [];
  private sheds: ShedView[] = [];
  /** Which cargo each shed takes, by shed letter. */
  private shedCargo: number[] = [];
  private trains: Train[] = [];
  private puffs: Puff[] = [];
  private lamp!: THREE.MeshStandardMaterial;

  /** Trains still to come out this stage, as cargo indexes. */
  private queue: number[] = [];
  private sent = 0;
  private spawnIn = 0;
  private results: boolean[] = [];
  private hearts = HEARTS;
  private score = 0;
  private best = load<number>('train-switcher:best', 0);
  private stageMistakes = 0;
  private wait = 0;
  /** Sets switches for the trains coming (the title screen's demo, and automated checks). */
  autopilot = false;
  /** For each shed, the way each switch must be set to get there. */
  private routes: Map<Cell, number>[] = [];

  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hover?: SwitchView;
  private shake = 0;
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);
  private puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.15 });
  private dimRail: THREE.Material;
  private ballast = new THREE.MeshStandardMaterial({ color: 0xbfae94, roughness: 1 });
  private icons: Record<string, string>;
  private camAim = { target: new THREE.Vector3(), pos: new THREE.Vector3() };

  constructor(
    stage: HTMLElement,
    private models: Record<string, THREE.Object3D>,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.dimRail = this.makeDimRail();
    this.buildWorld();
    this.scene.add(this.yard);
    this.icons = makeIcons(Object.fromEntries(CARGO.map((c) => [c.name, models[c.wagon]])), 128);
    this.bindInput();
    new ResizeObserver(() => this.frameCamera(true)).observe(stage);
    this.showTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** The kit's rail material, darkened, for the way a switch isn't set. */
  private makeDimRail() {
    let mat: THREE.Material | undefined;
    this.models['railroad-straight'].traverse((o) => {
      if (o instanceof THREE.Mesh && !mat) mat = (o.material as THREE.Material).clone();
    });
    const dim = mat as THREE.MeshStandardMaterial;
    dim.color = new THREE.Color(0.45, 0.47, 0.5);
    return dim;
  }

  // ---- The world ---------------------------------------------------------------------------

  private buildWorld() {
    this.scene.background = new THREE.Color(0x9ad7ef);
    this.scene.fog = new THREE.Fog(0x9ad7ef, 120, 260);
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x5d8a3c, 1.5));
    this.sun.position.set(-20, 40, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x86c45a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
  }

  private place(name: string, x: number, z: number, scale: number, yaw = 0, parent: THREE.Object3D = this.yard) {
    const m = this.models[name].clone();
    m.position.set(x, -0.1, z);
    m.scale.setScalar(scale);
    m.rotation.y = yaw;
    parent.add(m);
    return m;
  }

  /** Lays out a stage's yard: rails, switches, sheds, the tunnel in its hill and scenery round it. */
  private buildYard(stage: Stage) {
    this.yard.clear();
    this.switches = [];
    this.sheds = [];
    this.layout = parseLayout(stage.map);
    const layout = this.layout;

    // Which cargo goes to which shed: the first stage's colours are the boldest.
    const kinds = CARGO.map((_, i) => i).slice(0, layout.stations.length).sort(() => Math.random() - 0.5);
    this.shedCargo = kinds;

    for (const cell of layout.cells) {
      const { x, z } = centre(cell.col, cell.row);
      if (cell.kind === 'switch') {
        this.switches.push(this.makeSwitch(cell));
      } else if (cell.kind === 'station') {
        this.rail(segmentFor(cell.col, cell.row, cell.entry, opposite(cell.entry)));
        const shed = this.makeShed(this.shedCargo[cell.station]);
        const [sx, sz] = STEP[cell.entry];
        shed.position.set(x, 0, z);
        shed.rotation.y = Math.atan2(-sx, -sz);
        this.yard.add(shed);
        this.sheds.push({ cell, cargo: this.shedCargo[cell.station], group: shed, bounce: 0 });
      } else {
        this.rail(segmentFor(cell.col, cell.row, cell.entry, cell.exits[0]));
      }
    }
    this.buildTunnel(layout.tunnel);
    this.scatter(layout);
    this.routes = layout.stations.map((s) => this.pathTo(s));
    this.fitShadow();
  }

  /** One rail piece along a segment. */
  private rail(seg: ReturnType<typeof segmentFor>, parent: THREE.Object3D = this.yard) {
    const m = this.models[seg.turn ? 'railroad-corner-small' : 'railroad-straight'].clone();
    m.position.set(seg.x, RAIL_Y, seg.z);
    m.rotation.y = yawOf(seg.dx, seg.dz);
    // The kit's corner turns right; mirror it for a left.
    if (seg.turn === -1) m.scale.x = -1;
    parent.add(m);
    parent.add(this.bed(seg));
    return m;
  }

  /** A strip of gravel under a rail piece, so the line reads from up high. */
  private bed(seg: ReturnType<typeof segmentFor>) {
    const n = seg.turn ? 12 : 1;
    const pos: number[] = [];
    const idx: number[] = [];
    const half = 0.95;
    for (let i = 0; i <= n; i++) {
      const p = sample(seg, (seg.length * i) / n);
      pos.push(p.x - p.hz * half, 0, p.z + p.hx * half, p.x + p.hz * half, 0, p.z - p.hx * half);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    // Wind every triangle to face up.
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const ux = pos[b * 3] - pos[a * 3];
      const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3];
      const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      if (uz * vx - ux * vz < 0) [idx[t + 1], idx[t + 2]] = [c, b];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.ballast);
    m.position.y = -0.07;
    m.receiveShadow = true;
    return m;
  }

  private makeSwitch(cell: Cell): SwitchView {
    const { x, z } = centre(cell.col, cell.row);
    const branches = cell.exits.map((exit) => {
      const g = new THREE.Group();
      this.rail(segmentFor(cell.col, cell.row, cell.entry, exit), g);
      this.yard.add(g);
      return g;
    });
    // A round button with an arrow on it, pointing the way the switch is set.
    const discMat = new THREE.MeshBasicMaterial({ color: 0x23324a, transparent: true, opacity: 0.55, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 40), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.12, z);
    disc.renderOrder = 2;
    this.yard.add(disc);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const arrow = new THREE.Group();
    const shape = new THREE.Shape();
    // Drawn pointing down the page, so laid flat it points along +z and faces up.
    const pts: [number, number][] = [[-0.28, 0.75], [0.28, 0.75], [0.28, -0.15], [0.68, -0.15], [0, -0.95], [-0.68, -0.15], [-0.28, -0.15]];
    shape.moveTo(...pts[0]);
    for (const p of pts.slice(1)) shape.lineTo(...p);
    shape.closePath();
    const head = new THREE.Mesh(new THREE.ShapeGeometry(shape), arrowMat);
    head.rotation.x = -Math.PI / 2;
    head.renderOrder = 3;
    arrow.add(head);
    arrow.position.set(x, 0.16, z);
    this.yard.add(arrow);
    // Its number for the keyboard, where there is one.
    if (matchMedia('(pointer: fine)').matches) {
      const label = this.numberSprite(cell.index + 1);
      label.position.set(x + 1.25, 1, z + 1.25);
      this.yard.add(label);
    }
    const view: SwitchView = { cell, branches, arrow, arrowMat, disc, discMat, yaw: 0, pop: 0, locked: false };
    this.showSwitch(view, true);
    return view;
  }

  private numberSprite(n: number) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffe27a';
    g.beginPath();
    g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#2b3d5a';
    g.stroke();
    g.fillStyle = '#2b3d5a';
    g.font = '38px "Kenney Bold", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 32, 35);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.setScalar(1.3);
    sprite.renderOrder = 4;
    return sprite;
  }

  private showSwitch(view: SwitchView, snap = false) {
    const { cell } = view;
    view.branches.forEach((b, i) => {
      b.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.material === this.ballast) return;
        o.userData.lit ??= o.material;
        o.material = i === cell.set ? o.userData.lit : this.dimRail;
      });
      // The set way sits a hair higher so it's drawn over the other where the rails cross.
      b.position.y = i === cell.set ? 0.01 : 0;
    });
    const [ex, ez] = STEP[cell.exits[cell.set]];
    const target = yawOf(ex, ez);
    if (snap) view.yaw = target;
    view.arrow.userData.target = target;
  }

  /** An engine shed: cream walls, a roof in its cargo's colour and a big round sign over the door. */
  private makeShed(cargo: number) {
    const colour = CARGO[cargo].colour;
    const g = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: 0xf4e6c8, roughness: 0.9 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 1 });
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const H = 2.3;
    // Door faces -z (the way trains come in).
    box(0.3, H, 3.7, wall, -1.6, H / 2, 0.1);
    box(0.3, H, 3.7, wall, 1.6, H / 2, 0.1);
    box(3.5, H, 0.3, wall, 0, H / 2, 1.8);
    box(0.62, H, 0.3, wall, -1.29, H / 2, -1.6);
    box(0.62, H, 0.3, wall, 1.29, H / 2, -1.6);
    box(3.5, 0.5, 0.3, wall, 0, H - 0.25, -1.6);
    // Inside is in shadow.
    box(3, 0.05, 3.3, dark, 0, 0.02, 0.1).receiveShadow = false;
    const back = box(2.9, H - 0.1, 0.05, dark, 0, H / 2, 1.62);
    back.castShadow = false;
    box(0.36, 0.2, 0.36, trim, -1.6, 0.1, -1.6);
    box(0.36, 0.2, 0.36, trim, 1.6, 0.1, -1.6);
    // A gable roof running front to back.
    const pitch = 0.5;
    const half = 2.05;
    for (const side of [-1, 1]) {
      const r = box(half / Math.cos(pitch), 0.18, 4.2, roof, (side * half) / 2, H + Math.tan(pitch) * (half / 2), 0.1);
      r.rotation.z = -side * pitch;
    }
    const gable = new THREE.Shape();
    gable.moveTo(-1.75, 0);
    gable.lineTo(1.75, 0);
    gable.lineTo(0, Math.tan(pitch) * 1.75);
    gable.closePath();
    for (const z of [-1.6, 1.8]) {
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false }), wall);
      m.position.set(0, H, z - 0.15);
      m.castShadow = true;
      g.add(m);
    }
    // The sign: a white-rimmed disc of the cargo's colour, leaning back to face the camera.
    const sign = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.14, 32), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 }));
    rim.rotation.x = face.rotation.x = Math.PI / 2;
    sign.add(rim, face);
    sign.position.set(0, H + 0.45, -1.85);
    sign.rotation.x = -0.5;
    g.add(sign);
    g.userData.sign = sign;
    return g;
  }

  /** The tunnel mouth in a rocky hill, with a lamp showing the colour of the next train. */
  private buildTunnel(t: Cell) {
    const back = (n: number) => ({ col: t.col + STEP[t.entry][0] * n, row: t.row + STEP[t.entry][1] * n });
    const [fx, fz] = STEP[opposite(t.entry)];
    const yaw = yawOf(fx, fz);
    const mouth = back(1);
    const m = centre(mouth.col, mouth.row);
    const [sx, sz] = [fz, -fx];
    // A grassy hill of rock blocks, rising away from the yard.
    for (let d = 1; d <= 3; d++) {
      for (let s = -2; s <= 2; s++) {
        const p = back(d);
        const b = this.place('cliff_block_rock', (p.col + sx * s) * TILE, (p.row + sz * s) * TILE, TILE, yaw);
        const h = TILE * (0.85 + (d - 1) * 0.3 - Math.abs(s) * 0.08);
        b.scale.y = h;
        // A few trees up on top.
        if ((d + s) % 2 === 0 || d === 3) {
          const tree = this.place(d === 3 ? 'tree_pineRoundA' : 'tree_cone', (p.col + sx * s) * TILE + fz * 0.8, (p.row + sz * s) * TILE + fx * 0.8, 1.8 + ((d * 7 + s * 3) % 4) * 0.2, d + s);
          tree.position.y = h * 0.95 - 0.1;
        }
      }
    }
    // A stone portal on the hill's face, dark inside; trains come out of the darkness.
    const face = { x: m.x + fx * (TILE / 2), z: m.z + fz * (TILE / 2) };
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.9 });
    const key = new THREE.MeshStandardMaterial({ color: 0x7d776f, roughness: 0.9 });
    const put = (mesh: THREE.Mesh, along: number, up: number, out: number) => {
      mesh.position.set(face.x + sx * along + fx * out, up, face.z + sz * along + fz * out);
      mesh.rotation.y = yaw;
      mesh.castShadow = mesh.receiveShadow = true;
      this.yard.add(mesh);
    };
    put(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshBasicMaterial({ color: 0x15131a })), 0, 1.2, 0.03);
    for (const side of [-1, 1]) put(new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.7, 0.5), stone), side * 1.35, 1.25, 0.2);
    put(new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.6, 0.55), stone), 0, 2.75, 0.2);
    put(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.62), key), 0, 2.75, 0.22);
    // The signal lamp on a post beside the mouth.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 10), new THREE.MeshStandardMaterial({ color: 0x3a3a46 }));
    const side = 2.2;
    const px = m.x + fx * (TILE / 2 + 0.6) + sx * side;
    const pz = m.z + fz * (TILE / 2 + 0.6) + sz * side;
    post.position.set(px, 1.1, pz);
    post.castShadow = true;
    this.yard.add(post);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.4), new THREE.MeshStandardMaterial({ color: 0x23232c }));
    housing.position.set(px, 2.45, pz);
    housing.rotation.y = yaw;
    housing.castShadow = true;
    this.yard.add(housing);
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0x000000, roughness: 0.4 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 12), this.lamp);
    bulb.position.set(px + fx * 0.2, 2.45, pz + fz * 0.2);
    bulb.scale.set(1, 1, 0.6);
    this.yard.add(bulb);
    this.yard.userData.lampBulb = bulb;
  }

  /** Trees, rocks and flowers on the empty ground round the track. */
  private scatter(layout: Layout) {
    let seed = 7 + this.stageNo * 31;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const busy = new Set<string>();
    for (const c of layout.cells) busy.add(`${c.col},${c.row}`);
    const t = layout.tunnel;
    for (let d = 1; d <= 3; d++) for (let s = -2; s <= 2; s++) {
      const [bx, bz] = STEP[t.entry];
      busy.add(`${t.col + bx * d + bz * s},${t.row + bz * d - bx * s}`);
    }
    const trees = ['tree_default', 'tree_oak', 'tree_cone', 'tree_fat', 'tree_pineRoundA', 'tree_pineRoundC'];
    const small = ['rock_smallA', 'rock_smallC', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'grass', 'grass_large', 'plant_bush'];
    const pick = (list: string[]) => list[Math.floor(rand() * list.length)];
    const pad = 7;
    for (let r = -pad; r < layout.rows + pad; r++) {
      for (let c = -pad; c < layout.cols + pad; c++) {
        if (busy.has(`${c},${r}`)) continue;
        const inside = c >= 0 && r >= 0 && c < layout.cols && r < layout.rows;
        // Next to the track only small things, so nothing hides a train.
        const nearTrack = [0, 1, 2, 3].some((d) => busy.has(`${neighbour(c, r, d as Dir).col},${neighbour(c, r, d as Dir).row}`));
        const { x, z } = centre(c, r);
        const n = inside ? 2 : 3;
        for (let k = 0; k < n; k++) {
          const ox = (rand() - 0.5) * TILE * 0.8;
          const oz = (rand() - 0.5) * TILE * 0.8;
          const roll = rand();
          if (!nearTrack && roll < (inside ? 0.18 : 0.32)) this.place(pick(trees), x + ox, z + oz, 1.8 + rand() * 0.9, rand() * 6.3);
          else if (roll < 0.5) this.place(pick(small), x + ox, z + oz, 1.6 + rand() * 0.8, rand() * 6.3);
        }
        if (!inside && rand() < 0.05) this.place(rand() < 0.5 ? 'rock_largeA' : 'rock_largeC', x, z, 2.5, rand() * 6.3);
      }
    }
  }

  /** For one shed, the way each switch on the line to it has to be set. */
  private pathTo(station: Cell) {
    const need = new Map<Cell, number>();
    const parent = new Map<Cell, Cell>();
    for (const c of this.layout.cells) {
      for (const d of c.exits) {
        if (c.kind === 'tunnel') continue;
        const n = neighbour(c.col, c.row, d);
        const child = this.layout.at(n.col, n.row);
        if (child) parent.set(child, c);
      }
    }
    // The tunnel's own exit.
    const t = this.layout.tunnel;
    const first = neighbour(t.col, t.row, t.exits[0]);
    parent.set(this.layout.at(first.col, first.row)!, t);
    let at: Cell = station;
    while (parent.has(at)) {
      const p = parent.get(at)!;
      if (p.kind === 'switch') {
        const exit = p.exits.findIndex((d) => {
          const n = neighbour(p.col, p.row, d);
          return n.col === at.col && n.row === at.row;
        });
        need.set(p, exit);
      }
      at = p;
    }
    return need;
  }

  private fitShadow() {
    const w = this.layout.cols * TILE;
    const h = this.layout.rows * TILE;
    const cx = (this.layout.cols - 1) * TILE / 2;
    const cz = (this.layout.rows - 1) * TILE / 2;
    const r = Math.hypot(w, h) / 2 + TILE * 3;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = 200;
    cam.updateProjectionMatrix();
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - 30, 60, cz + 26);
  }

  // ---- Camera ------------------------------------------------------------------------------

  /** Frames the whole yard, turning it a quarter if that fits a tall screen better. */
  private frameCamera(snap = false) {
    if (!this.layout) return;
    const w = this.renderer.domElement.clientWidth || 1;
    const h = this.renderer.domElement.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // The yard's tiles, plus the tunnel's portal on the hill behind it.
    const t = this.layout.tunnel;
    const [bx, bz] = STEP[t.entry];
    const minX = Math.min(0, t.col + bx * 0.6) * TILE - TILE / 2;
    const maxX = Math.max(this.layout.cols - 1, t.col + bx * 0.6) * TILE + TILE / 2;
    const minZ = Math.min(0, t.row + bz * 0.6) * TILE - TILE / 2;
    const maxZ = Math.max(this.layout.rows - 1, t.row + bz * 0.6) * TILE + TILE / 2;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const target = new THREE.Vector3(cx, 0, cz);
    const halfW = (maxX - minX) / 2 + 0.6;
    const halfH = (maxZ - minZ) / 2 + 0.6;
    const corners: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 3]) corners.push(new THREE.Vector3(cx + sx * halfW, y, cz + sz * halfH));
    // Room for the HUD: a band along the top, and a little at the bottom.
    const top = 1 - (2 * (w < 560 ? 116 : 96)) / h;
    const bottom = -1 + (2 * 30) / h;
    const side = 1 - (2 * 14) / w;
    const elev = THREE.MathUtils.degToRad(57);
    let bestDist = Infinity;
    let best = { pos: new THREE.Vector3(), target };
    for (const yaw of [0, Math.PI / 2]) {
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
      const fits = (dist: number) => {
        this.camera.position.copy(target).addScaledVector(dir, dist);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
        let minY = Infinity;
        let maxY = -Infinity;
        let maxX = 0;
        for (const c of corners) {
          const p = c.clone().project(this.camera);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
          maxX = Math.max(maxX, Math.abs(p.x));
        }
        // The yard can sit off-centre vertically, so only its spread has to fit.
        return { ok: maxX <= side && maxY - minY <= top - bottom, mid: (maxY + minY) / 2 };
      };
      let lo = 5;
      let hi = 400;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid).ok) hi = mid;
        else lo = mid;
      }
      if (hi < bestDist - 0.5) {
        bestDist = hi;
        // Slide the view so the yard sits in the space between the HUD bands.
        const { mid } = fits(hi);
        const want = (top + bottom) / 2;
        const shift = new THREE.Vector3();
        // Approximate: move the target along the screen's up direction on the ground.
        const up = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const worldPerNdc = (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * hi) / Math.sin(elev);
        shift.copy(up).multiplyScalar((mid - want) * worldPerNdc);
        const t2 = target.clone().add(shift);
        best = { pos: t2.clone().addScaledVector(dir, hi), target: t2 };
      }
    }
    this.camAim.pos.copy(best.pos);
    this.camAim.target.copy(best.target);
    if (snap) {
      this.camera.position.copy(best.pos);
      this.camera.lookAt(best.target);
    }
  }

  // ---- Trains ------------------------------------------------------------------------------

  private makeTrain(cargo: number, wagons: number): Train {
    const route = new Route(this.layout, 3);
    const cars: Car[] = [];
    const engine = ENGINES[Math.floor(Math.random() * ENGINES.length)];
    const add = (name: string, offset: number, length: number) => {
      const holder = new THREE.Group();
      holder.add(this.models[name].clone());
      this.scene.add(holder);
      cars.push({ obj: holder, offset, length });
    };
    add(engine, ENGINE_LENGTH / 2, ENGINE_LENGTH);
    let at = ENGINE_LENGTH + COUPLING;
    for (let i = 0; i < wagons; i++) {
      add(CARGO[cargo].wagon, at + WAGON_LENGTH / 2, WAGON_LENGTH);
      at += WAGON_LENGTH + COUPLING;
    }
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.12, 28), new THREE.MeshBasicMaterial({ color: CARGO[cargo].colour }));
    marker.add(ring, dot);
    this.scene.add(marker);
    const train: Train = {
      cargo, route, head: route.mouth - 0.6, length: trainLength(wagons), cars, marker,
      steam: engine.startsWith('train-locomotive'), puffIn: 0, arrived: false,
    };
    this.poseTrain(train);
    return train;
  }

  private removeTrain(train: Train) {
    for (const c of train.cars) this.scene.remove(c.obj);
    this.scene.remove(train.marker);
    this.trains.splice(this.trains.indexOf(train), 1);
  }

  /** Puts each car on the track: its wheels at each end follow the rails, so it swings round bends. */
  private poseTrain(train: Train) {
    const { route } = train;
    for (const car of train.cars) {
      const mid = train.head - car.offset;
      const reach = car.length * 0.32;
      const f = route.at(mid + reach);
      const r = route.at(Math.max(0, mid - reach));
      car.obj.position.set((f.x + r.x) / 2, 0, (f.z + r.z) / 2);
      car.obj.rotation.y = yawOf(f.x - r.x, f.z - r.z);
      // Out of sight inside the hill until its nose reaches the mouth, and gone once in its shed.
      const front = mid + car.length / 2;
      car.obj.visible = front > route.mouth - 0.7 && mid < route.door + car.length / 2 + 0.3;
    }
    const lead = train.cars[0];
    train.marker.position.copy(lead.obj.position).setY(2.75 + Math.sin(performance.now() / 300) * 0.08);
    train.marker.visible = lead.obj.visible;
  }

  /** The next train: any shed's colour, but never the same three times running. */
  private nextCargo() {
    const sheds = this.shedCargo;
    const recent = this.queue.slice(-2);
    let pick: number;
    do pick = sheds[Math.floor(Math.random() * sheds.length)];
    while (recent.length === 2 && recent[0] === pick && recent[1] === pick);
    return pick;
  }

  private spawn() {
    const cargo = this.queue.shift();
    if (cargo === undefined) return;
    const wagons = 1 + Math.floor(Math.random() * this.stage.wagons);
    this.trains.push(this.makeTrain(cargo, wagons));
    this.sent++;
  }

  private updateTrains(dt: number) {
    const speed = this.stage.speed;
    for (const train of [...this.trains]) {
      train.head += speed * dt;
      train.route.extendTo(train.head + 0.01);
      this.poseTrain(train);
      if (!train.arrived && train.head >= train.route.door) {
        train.arrived = true;
        this.arrive(train);
      }
      // Smoke from the chimney while it's out in the open.
      const lead = train.cars[0];
      train.puffIn -= dt;
      if (lead.obj.visible && train.puffIn <= 0 && !train.arrived) {
        train.puffIn = train.steam ? 0.28 : 0.5;
        const fwd = new THREE.Vector3(Math.sin(lead.obj.rotation.y), 0, Math.cos(lead.obj.rotation.y));
        const at = lead.obj.position.clone().addScaledVector(fwd, train.steam ? 0.75 : -0.2).setY(train.steam ? 1.9 : 1.75);
        this.puff(at, train.steam ? 0.32 : 0.18, train.steam ? 0xffffff : 0x9a9aa6, fwd.multiplyScalar(-speed * 0.3));
      }
      if (train.head - train.length > train.route.door + 0.5) this.removeTrain(train);
    }
    // Switches are locked while a train is over them.
    for (const s of this.switches) s.locked = false;
    for (const t of this.trains) {
      for (const cell of t.route.cellsBetween(t.head - t.length, t.head)) {
        const s = this.switches.find((v) => v.cell === cell);
        if (s) s.locked = true;
      }
    }
  }

  private arrive(train: Train) {
    const shed = this.sheds.find((s) => s.cell.station === train.route.station)!;
    const right = shed.cargo === train.cargo;
    shed.bounce = 1;
    const top = shed.group.position.clone().setY(3.4);
    if (this.state === 'title') return;
    this.results.push(right);
    if (right) {
      this.score++;
      this.sounds.play('right', { volume: 0.5 });
      this.sounds.play('bell', { volume: 0.25, detune: 300 });
      for (let i = 0; i < 14; i++) this.confetti(top, CARGO[train.cargo].colour);
      this.pop(`+1`, top, CARGO[train.cargo].css);
    } else {
      this.stageMistakes++;
      this.hearts--;
      this.shake = 0.45;
      this.sounds.play('wrong', { volume: 0.55 });
      for (let i = 0; i < 6; i++) this.puff(top.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, -0.5, (Math.random() - 0.5) * 2)), 0.5, 0x6d6a72);
      this.pop('✗', top, '#ff5a4e');
      this.drawHearts();
      if (this.hearts <= 0) {
        this.wait = 1.6;
        this.state = 'over';
        this.sounds.play('sad', { volume: 0.5 });
      }
    }
    this.drawHud();
  }

  // ---- Effects -----------------------------------------------------------------------------

  private puff(at: THREE.Vector3, size: number, colour: number, drift = new THREE.Vector3()) {
    const mat = colour === 0xffffff ? this.puffMat : new THREE.MeshStandardMaterial({ color: colour, roughness: 1 });
    const mesh = new THREE.Mesh(this.puffGeo, mat);
    mesh.position.copy(at);
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.1 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4).add(drift);
    this.puffs.push({ mesh, vel, life: 0, max: 0.9 + Math.random() * 0.4, size });
  }

  private confetti(at: THREE.Vector3, colour: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.32), new THREE.MeshBasicMaterial({ color: Math.random() < 0.35 ? 0xffffff : colour }));
    mesh.position.copy(at);
    this.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 3;
    const vel = new THREE.Vector3(Math.cos(a) * s, 5 + Math.random() * 4, Math.sin(a) * s);
    const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    this.puffs.push({ mesh, vel, life: 0, max: 1.3, size: 1, spin });
  }

  private updatePuffs(dt: number) {
    for (const p of [...this.puffs]) {
      p.life += dt;
      const k = p.life / p.max;
      if (p.spin) {
        p.vel.y -= 14 * dt;
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.scale.setScalar(k > 0.75 ? (1 - k) * 4 : 1);
      } else {
        p.vel.multiplyScalar(1 - dt * 1.2);
        // Grow quickly, then shrink away.
        p.mesh.scale.setScalar(p.size * (k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75 * 0.9) * (1 + k));
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.life >= p.max) {
        this.scene.remove(p.mesh);
        if (p.mesh.material !== this.puffMat) (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(this.puffs.indexOf(p), 1);
      }
    }
  }

  /** A word that floats up from a point in the world. */
  private pop(text: string, at: THREE.Vector3, colour: string) {
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = text;
    el.style.color = colour;
    document.body.append(el);
    const p = at.clone().project(this.camera);
    el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    setTimeout(() => el.remove(), 1100);
  }

  // ---- Input -------------------------------------------------------------------------------

  private bindInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      const s = this.switchAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 1.5 : 1.15);
      if (s) this.flip(s);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.hover = this.switchAt(e.clientX, e.clientY, 1.15);
      canvas.style.cursor = this.hover ? 'pointer' : '';
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const s = this.switches.find((v) => v.cell.index === n - 1);
        if (s) this.flip(s);
      }
      if ((e.key === 'Enter' || e.key === ' ') && (this.state === 'title' || $('over').classList.contains('show'))) {
        e.preventDefault();
        this.start();
      }
    });
    $('title-play').addEventListener('click', () => this.start());
    $('over-go').addEventListener('click', () => this.start());
  }

  /** The switch under a screen point, or the nearest within `reach` tiles of it (for fingers). */
  private switchAt(cx: number, cy: number, reach: number) {
    if (this.state === 'title' || this.state === 'over') return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return undefined;
    let best: SwitchView | undefined;
    let bestD = reach * TILE * 0.5;
    for (const s of this.switches) {
      const c = centre(s.cell.col, s.cell.row);
      const d = Math.hypot(c.x - hit.x, c.z - hit.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private flip(view: SwitchView) {
    if (view.locked) {
      this.sounds.play('locked', { volume: 0.3 });
      view.pop = -1;
      return;
    }
    view.cell.set = 1 - view.cell.set;
    this.showSwitch(view);
    view.pop = 1;
    this.sounds.play('flip', { volume: 0.5, detune: 100 });
  }

  /** Sets each switch for the closest train still to reach it that needs it. */
  private drive() {
    for (const s of this.switches) {
      if (s.locked) continue;
      let want = -1;
      let gap = Infinity;
      for (const t of this.trains) {
        const need = this.routes[this.layout.stations.findIndex((c) => this.shedCargo[c.station] === t.cargo)]?.get(s.cell);
        if (need === undefined) continue;
        // How far the train is from the switch along its way there.
        const passed = t.route.segs.some((seg) => seg.cell === s.cell);
        if (passed) continue;
        const d = -t.head;
        if (d < gap) {
          gap = d;
          want = need;
        }
      }
      if (want >= 0 && s.cell.set !== want) {
        s.cell.set = want;
        this.showSwitch(s);
        s.pop = 1;
        if (this.state !== 'title') this.sounds.play('flip', { volume: 0.3 });
      }
    }
  }

  // ---- HUD ---------------------------------------------------------------------------------

  private drawHearts() {
    const box = $('hearts');
    box.innerHTML = '';
    for (let i = 0; i < HEARTS; i++) {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 24 22');
      s.innerHTML = '<path d="M12 21 C5 15 1 11 1 6.5 A5.5 5.5 0 0 1 12 4 A5.5 5.5 0 0 1 23 6.5 C23 11 19 15 12 21Z"/>';
      if (i >= this.hearts) s.classList.add('lost');
      box.append(s);
    }
  }

  private drawHud() {
    $('score').textContent = String(this.score);
    $('stage-name').innerHTML = `STAGE ${this.stageNo + 1}${this.stage.lap ? ` <small>LAP ${this.stage.lap + 1}</small>` : ''}`;
    const pips = $('pips');
    pips.innerHTML = '';
    for (let i = 0; i < this.stage.trains; i++) {
      const p = document.createElement('i');
      if (i < this.results.length) p.className = this.results[i] ? 'ok' : 'bad';
      pips.append(p);
    }
  }

  private showNext() {
    const next = this.queue[0];
    const icon = $<HTMLImageElement>('next-icon');
    if (next === undefined || this.state === 'title') {
      $('next').classList.remove('show');
    } else {
      icon.src = this.icons[CARGO[next].name];
      icon.style.borderColor = CARGO[next].css;
      $('next').classList.add('show');
    }
  }

  private banner(text: string, sub = '', time = 1.8) {
    const b = $('banner');
    b.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    b.classList.add('show');
    clearTimeout(Number(b.dataset.timer));
    b.dataset.timer = String(setTimeout(() => b.classList.remove('show'), time * 1000));
  }

  private hint(text: string) {
    $('hint').textContent = text;
    $('hint').style.opacity = text ? '1' : '0';
  }

  // ---- Flow --------------------------------------------------------------------------------

  private clearTrains() {
    for (const t of [...this.trains]) this.removeTrain(t);
  }

  private showTitle() {
    this.state = 'title';
    this.autopilot = true;
    document.body.classList.add('on-title');
    $('title').classList.add('show');
    $('over').classList.remove('show');
    $('title-best').textContent = this.best ? `Best: ${this.best} trains` : '';
    this.stageNo = 1;
    this.stage = { ...stageFor(1), every: 3.2 };
    this.buildYard(this.stage);
    this.frameCamera(true);
    this.queue = [];
    this.spawnIn = 0.3;
  }

  private start() {
    this.sounds.play('click');
    void this.sounds.music(MUSIC, 0.16);
    $('title').classList.remove('show');
    $('over').classList.remove('show');
    document.body.classList.remove('on-title');
    this.autopilot = false;
    this.score = 0;
    this.hearts = HEARTS;
    this.drawHearts();
    this.beginStage(0);
    this.hint(matchMedia('(pointer: coarse)').matches ? 'Tap a switch to flip it' : 'Click a switch to flip it, or press its number');
  }

  private beginStage(n: number) {
    this.clearTrains();
    this.stageNo = n;
    this.stage = stageFor(n);
    this.buildYard(this.stage);
    this.frameCamera(true);
    this.results = [];
    this.stageMistakes = 0;
    this.sent = 0;
    this.queue = [];
    for (let i = 0; i < this.stage.trains; i++) this.queue.push(this.nextCargo());
    this.spawnIn = 2.6;
    this.state = 'intro';
    this.wait = 2.6;
    this.drawHud();
    this.showNext();
    this.banner(`Stage ${n + 1}`, this.stage.lap ? `${this.stage.name} · faster!` : this.stage.name, 2.2);
    this.sounds.play(n === 0 ? 'go' : 'levelUp', { volume: 0.6, detune: 0 });
  }

  private endStage() {
    this.state = 'clear';
    this.wait = 3;
    const perfect = this.stageMistakes === 0;
    if (perfect && this.hearts < HEARTS) {
      this.hearts++;
      this.drawHearts();
    }
    this.sounds.play(perfect ? 'perfect' : 'clear', { volume: 0.5 });
    this.banner(perfect ? 'Perfect!' : 'Stage clear!', perfect && this.hearts === HEARTS ? 'All trains home' : perfect ? '+1 heart' : `${this.results.filter(Boolean).length} of ${this.results.length} home`, 2.6);
    this.hint('');
  }

  private gameOver() {
    this.clearTrains();
    const record = this.score > this.best;
    if (record) {
      this.best = this.score;
      save('train-switcher:best', this.score);
    }
    $('over-title').textContent = record && this.score > 0 ? 'New best!' : 'Yard closed!';
    $('over-score').textContent = String(this.score);
    $('over-stage').textContent = String(this.stageNo + 1);
    $('over-note').textContent = record ? '' : this.best ? `Best: ${this.best} trains` : '';
    $('over').classList.add('show');
    $('next').classList.remove('show');
    this.hint('');
    this.sounds.play(record && this.score > 0 ? 'best' : 'over', { volume: 0.6, detune: 0 });
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
    if (this.autopilot) this.drive();
    const moving = this.state === 'run' || this.state === 'intro' || this.state === 'title' || this.state === 'clear' || (this.state === 'over' && this.wait > 0);
    if (moving) this.updateTrains(dt);
    this.updatePuffs(dt);

    if (this.state === 'title') {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        this.queue.push(this.nextCargo());
        this.spawn();
        this.spawnIn = this.stage.every;
      }
    }
    if (this.state === 'intro') {
      this.wait -= dt;
      if (this.wait <= 0) this.state = 'run';
    }
    if (this.state === 'run' || this.state === 'intro') {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0 && this.queue.length) {
        this.spawn();
        this.spawnIn = this.stage.every;
        this.showNext();
        if (this.sent === 3) this.hint('');
      }
      if (this.state === 'run' && !this.queue.length && !this.trains.length) this.endStage();
    }
    if (this.state === 'clear') {
      this.wait -= dt;
      if (this.wait <= 0) this.beginStage(this.stageNo + 1);
    }
    if (this.state === 'over' && this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.gameOver();
    }
    this.updateLamp();
  }

  /** The tunnel lamp lights in the next train's colour shortly before it comes out. */
  private updateLamp() {
    const next = this.state === 'title' ? undefined : this.queue[0];
    const on = next !== undefined && this.spawnIn < SIGNAL_AHEAD && this.state !== 'over';
    const colour = on ? CARGO[next].colour : 0x555555;
    this.lamp.color.setHex(colour);
    this.lamp.emissive.setHex(on ? colour : 0x000000);
    this.lamp.emissiveIntensity = on ? 0.6 + 0.4 * Math.sin(performance.now() / 120) : 0;
  }

  private render(dt: number) {
    for (const s of this.switches) {
      const target = s.arrow.userData.target as number;
      let d = target - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yaw += d * Math.min(1, dt * 16);
      s.arrow.rotation.y = s.yaw;
      s.pop = Math.abs(s.pop) < 0.01 ? 0 : s.pop * Math.pow(0.002, dt);
      const shakeX = s.pop < 0 ? Math.sin(performance.now() / 25) * 0.15 * -s.pop : 0;
      const c = centre(s.cell.col, s.cell.row);
      s.arrow.position.x = c.x + shakeX;
      s.arrow.scale.setScalar(1 + Math.max(0, s.pop) * 0.35);
      s.arrowMat.color.setHex(s.locked ? 0xb8b8c4 : 0xffffff);
      s.discMat.opacity = this.hover === s ? 0.8 : 0.55;
      s.discMat.color.setHex(s.pop < 0 ? 0x8a2a2a : 0x23324a);
    }
    for (const shed of this.sheds) {
      shed.bounce = Math.max(0, shed.bounce - dt * 2.2);
      const b = Math.sin(shed.bounce * Math.PI * 2) * shed.bounce * 0.12;
      shed.group.scale.set(1 - b * 0.5, 1 + b, 1 - b * 0.5);
    }
    // Ease the camera to its framing, plus any shake.
    this.camera.position.lerp(this.camAim.pos, Math.min(1, dt * 4));
    const look = this.camAim.target.clone();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const k = this.shake * 0.6;
      look.x += (Math.random() - 0.5) * k;
      look.z += (Math.random() - 0.5) * k;
    }
    this.camera.lookAt(look);
    this.renderer.render(this.scene, this.camera);
  }
}
