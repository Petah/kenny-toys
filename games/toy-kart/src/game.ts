import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { kenney } from '@shared/kenney';
import { load, save } from '@shared/storage';
import { drive, lineYaw, nearest, turnAhead, type Driver } from './ai.ts';
import { KIT, MUSIC, VEHICLE_NAMES, VEHICLES, type Vehicle } from './assets.ts';
import { RacePhysics, STEP, TOP_SPEED, rotate, yawOf, type Car } from './physics.ts';
import { aimSun, buildCircuit, buildWorld, makeCar, type CircuitView, type Models } from './scene3d.ts';
import { CIRCUITS, LINE_STEP, WIDTH, build, type Built } from './track.ts';
import type { Triangles } from '../../../shared/glb.ts';

export const LAPS = 3;
const POINTS = [9, 6, 3, 1];
const PLACE = ['1st', '2nd', '3rd', '4th'];
/** Coins raise top speed a little each, up to this many. */
const MAX_COINS = 10;
const COIN_POWER = 0.015;
const BOOST_POWER = 1.45;
const BOOST_TIME = 1.3;
const SPIN_TIME = 0.9;
/** How close a car has to come to pick something up or hit a banana. */
const REACH = 0.5;

type Item = 'boost' | 'banana';
type State = 'title' | 'countdown' | 'racing' | 'finished' | 'results';

interface CarView {
  root: THREE.Group;
  body: THREE.Object3D;
  wheels: THREE.Object3D[];
  front: THREE.Object3D[];
}

interface Racer {
  name: string;
  vehicle: Vehicle;
  player: boolean;
  car: Car;
  view: CarView;
  driver: Driver;
  index: number;
  progress: number;
  laps: number;
  lapStart: number;
  bestLap: number;
  finishedAt?: number;
  item: Item | null;
  boostLeft: number;
  coins: number;
  /** Computer cars wait this long before using an item. */
  itemIn: number;
  points: number;
  /** Physics pose last step and this step, for drawing in between. */
  prev: { p: THREE.Vector3; q: THREE.Quaternion };
  next: { p: THREE.Vector3; q: THREE.Quaternion };
  wheelSpin: number;
  /** Seconds spent barely moving. */
  stuck: number;
}

interface Pickup {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  /** Seconds until it's back after being taken. */
  away: number;
}

interface Banana {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  by: Racer;
  age: number;
}

interface Puff {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

/** The kit's preview renders, used as HUD icons. */
const ICONS = `${KIT.replace('/Models', '')}/Previews`;
const ITEM_ICON: Record<Item, string> = { boost: 'smoke', banana: 'item-banana' };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class KartGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.05, 200);
  private renderer: THREE.WebGLRenderer;
  private sun: THREE.DirectionalLight;
  private timer = new THREE.Timer();

  private state: State = 'title';
  private raceNo = 0;
  private built!: Built;
  private physics?: RacePhysics;
  private view?: CircuitView;
  private racers: Racer[] = [];
  private boxes: Pickup[] = [];
  private coins: Pickup[] = [];
  private bananas: Banana[] = [];
  private puffs: Puff[] = [];
  private paints = new Map<string, THREE.Material>();

  private acc = 0;
  private time = 0;
  private countdown = 0;
  private finishWait = 0;
  private vehicle: Vehicle;
  private standings: { name: string; vehicle: Vehicle; player: boolean; points: number }[] = [];

  private keys = new Set<string>();
  private touch = { left: false, right: false, brake: false, used: false };
  private steer = 0;
  private engine?: { set: (rate: number, vol: number) => void; stop: () => void };
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = 0;
  private bestCup = load<number>('toy-kart:best', 0);
  /** Lets the computer drive the player's car too, for automated checks. */
  autopilot = false;

  constructor(
    stage: HTMLElement,
    private models: Models,
    private triangles: (model: string) => Triangles,
    private sounds: Sounds,
    textures: Record<string, THREE.Texture>,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    ({ sun: this.sun } = buildWorld(this.scene));
    this.vehicle = load<Vehicle>('toy-kart:vehicle', 'racer');
    if (!VEHICLES.includes(this.vehicle)) this.vehicle = 'racer';
    this.makePaints(textures);
    $<HTMLImageElement>('coin-icon').src = kenney(`${ICONS}/item-coin-gold.png`);
    this.bindInput();
    this.loadRace(0);
    this.showTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /**
   * The track's material in each paint. Variation A turns the kit's orange track yellow, and
   * variation B turns it white, which takes a tint for blue or green.
   */
  private makePaints(textures: Record<string, THREE.Texture>) {
    let base: THREE.MeshStandardMaterial | undefined;
    this.models['track-wide-straight'].traverse((o) => {
      if (o instanceof THREE.Mesh) base = o.material as THREE.MeshStandardMaterial;
    });
    if (!base) return;
    for (const tex of Object.values(textures)) {
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
    }
    const paint = (name: string, tex: THREE.Texture, tint = 0xffffff) => {
      const m = base!.clone();
      m.map = tex;
      m.color.setHex(tint);
      this.paints.set(name, m);
    };
    paint('yellow', textures['variation-a']);
    paint('blue', textures['variation-b'], 0x6fb4ff);
    paint('green', textures['variation-b'], 0x7fd98a);
  }

  // ---- Races -------------------------------------------------------------------------------

  /** Builds a circuit and lines the cars up on its grid. */
  private loadRace(index: number) {
    this.raceNo = index;
    this.clearRace();
    const circuit = CIRCUITS[index % CIRCUITS.length];
    this.built = build(circuit);
    this.physics = new RacePhysics(this.built, this.triangles);
    this.view = buildCircuit(this.built, this.models, this.paints.get(circuit.paint), index);
    this.scene.add(this.view.group);
    aimSun(this.sun, this.view);

    // The player and three computer cars, each a different model. In the cup's first race the
    // player starts at the back; after that the grid is reversed standings.
    if (!this.standings.length || index === 0) {
      const others = VEHICLES.filter((v) => v !== this.vehicle).sort(() => Math.random() - 0.5).slice(0, 3);
      this.standings = [
        ...others.map((v) => ({ name: VEHICLE_NAMES[v], vehicle: v, player: false, points: 0 })),
        { name: 'You', vehicle: this.vehicle, player: true, points: 0 },
      ];
    }
    const order = index === 0 ? this.standings : [...this.standings].sort((a, b) => b.points - a.points);
    const n = this.built.line.length;
    order.forEach((s, slot) => {
      const back = 1.6 + slot * 1.1;
      const at = (n - Math.round(back / LINE_STEP)) % n;
      const p = this.built.line[at];
      const yaw = lineYaw(this.built, at);
      const side = slot % 2 ? 0.5 : -0.5;
      const x = p.x - Math.cos(yaw) * side;
      const z = p.z + Math.sin(yaw) * side;
      const car = this.physics!.addCar(x, p.y, z, yaw);
      const view = makeCar(this.models, s.vehicle);
      this.scene.add(view.root);
      const pos = new THREE.Vector3(x, p.y, z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const skill = Math.min(0.98, 0.86 + index * 0.035 + slot * 0.012);
      this.racers.push({
        name: s.name, vehicle: s.vehicle, player: s.player, car, view,
        driver: { lane: [-0.45, 0.45, -0.15, 0.15][slot], skill },
        index: at, progress: at - n, laps: 0, lapStart: 0, bestLap: Infinity, item: null, boostLeft: 0, coins: 0,
        itemIn: 0, points: s.points, prev: { p: pos.clone(), q: q.clone() }, next: { p: pos.clone(), q: q.clone() }, wheelSpin: 0, stuck: 0,
      });
    });
    this.placePickups();
    this.time = 0;
    this.acc = 0;
    this.syncCamera(true);
    this.drawMinimapTrack();
  }

  private clearRace() {
    for (const r of this.racers) this.scene.remove(r.view.root);
    this.racers = [];
    for (const p of [...this.boxes, ...this.coins]) this.scene.remove(p.mesh);
    for (const b of this.bananas) this.scene.remove(b.mesh);
    for (const p of this.puffs) this.scene.remove(p.mesh);
    this.boxes = [];
    this.coins = [];
    this.bananas = [];
    this.puffs = [];
    if (this.view) this.scene.remove(this.view.group);
    this.physics?.free();
    this.physics = undefined;
  }

  /** A row of item boxes across the track a third and two thirds of the way round, and runs of coins between. */
  private placePickups() {
    const n = this.built.line.length;
    const at = (frac: number, lane: number) => {
      const i = Math.round(frac * n) % n;
      const p = this.built.line[i];
      const yaw = lineYaw(this.built, i);
      return new THREE.Vector3(p.x - Math.cos(yaw) * lane, p.y, p.z + Math.sin(yaw) * lane);
    };
    for (const frac of [0.3, 0.72]) {
      for (const lane of [-0.6, 0, 0.6]) {
        const pos = at(frac, lane);
        const mesh = this.models['item-box'].clone();
        mesh.scale.setScalar(0.9);
        mesh.position.copy(pos);
        this.scene.add(mesh);
        this.boxes.push({ mesh, pos, away: 0 });
      }
    }
    for (const [frac, lane, sway] of [[0.12, -0.4, 0.5], [0.5, 0.4, -0.6], [0.8, 0, 0.6]] as const) {
      for (let k = 0; k < 5; k++) {
        const pos = at(frac + k * 0.012, lane + Math.sin(k / 1.5) * sway);
        const coin = new THREE.Group();
        const m = this.models['item-coin-gold'].clone();
        // The coin model hangs off its corner; centre it on the group so it spins in place.
        m.position.set(0.13, 0, -0.05);
        coin.add(m);
        coin.position.copy(pos).add(new THREE.Vector3(0, 0.12, 0));
        coin.scale.setScalar(1.1);
        this.scene.add(coin);
        this.coins.push({ mesh: coin, pos, away: 0 });
      }
    }
  }

  private startCup() {
    this.sounds.play('click');
    this.standings = [];
    this.loadRace(0);
    this.startCountdown();
    void this.sounds.music(MUSIC, 0.16);
  }

  private startCountdown() {
    this.state = 'countdown';
    this.countdown = 3.6;
    this.hideCards();
    document.body.classList.remove('on-title');
    this.updateHud();
    this.engine ??= this.sounds.loop('engine', 0);
  }

  private finishRace() {
    this.state = 'results';
    const order = this.order();
    order.forEach((r, i) => {
      r.points += POINTS[i];
      const s = this.standings.find((x) => x.vehicle === r.vehicle)!;
      s.points = r.points;
    });
    const last = this.raceNo === CIRCUITS.length - 1;
    const player = order.findIndex((r) => r.player);
    const rows = order
      .map((r, i) => `<tr class="${r.player ? 'me' : ''}"><td>${PLACE[i]}</td><td>${r.name}</td><td>${r.finishedAt !== undefined ? fmt(r.finishedAt) : '-'}</td><td>+${POINTS[i]}</td></tr>`)
      .join('');
    const best = order.find((r) => r.player)!.bestLap;
    const key = `toy-kart:lap:${this.built.circuit.name}`;
    const record = load<number>(key, Infinity);
    const isRecord = best < record;
    if (isRecord) save(key, best);
    $('results-title').textContent = `${PLACE[player]} place`;
    $('results-table').innerHTML = `<tr><th></th><th>Racer</th><th>Time</th><th>Points</th></tr>${rows}`;
    $('results-note').textContent = isRecord ? `New best lap: ${fmt(best)}` : Number.isFinite(record) ? `Best lap ${fmt(best)} (record ${fmt(record)})` : `Best lap ${fmt(best)}`;
    const go = $<HTMLButtonElement>('results-go');
    go.textContent = last ? 'Final standings' : 'Next race';
    go.onclick = () => {
      this.sounds.play('click');
      if (last) this.showStandings();
      else {
        this.loadRace(this.raceNo + 1);
        this.startCountdown();
      }
    };
    $('results').classList.add('show');
    go.focus();
  }

  private showStandings() {
    const order = [...this.standings].sort((a, b) => b.points - a.points);
    const place = order.findIndex((s) => s.player);
    const rows = order.map((s, i) => `<tr class="${s.player ? 'me' : ''}"><td>${PLACE[i]}</td><td>${s.name}</td><td>${s.points}</td></tr>`).join('');
    this.sounds.play(place === 0 ? 'podium' : place < 3 ? 'placed' : 'meh', { detune: 0 });
    if (place === 0) setTimeout(() => this.sounds.play('congrats', { detune: 0 }), 900);
    const trophy = ['Gold cup!', 'Silver cup!', 'Bronze cup!', 'No cup this time'][place];
    // The best cup is kept as 4 for gold down to 1 for fourth.
    const earlier = this.bestCup;
    if (4 - place > this.bestCup) {
      this.bestCup = 4 - place;
      save('toy-kart:best', this.bestCup);
    }
    $('results-title').textContent = trophy;
    $('results-table').innerHTML = `<tr><th></th><th>Racer</th><th>Points</th></tr>${rows}`;
    $('results-note').textContent = earlier > 4 - place ? `Your best: ${PLACE[4 - earlier]} overall` : earlier && earlier < 4 - place ? 'Your best cup yet!' : '';
    const go = $<HTMLButtonElement>('results-go');
    go.textContent = 'Race again';
    go.onclick = () => {
      this.hideCards();
      this.startCup();
    };
    $('results').classList.add('show');
    go.focus();
  }

  /** Racers in race order: finishers by time, then by distance round. */
  private order() {
    return [...this.racers].sort((a, b) => {
      if (a.finishedAt !== undefined || b.finishedAt !== undefined) return (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity);
      return b.progress - a.progress;
    });
  }

  // ---- Frame loop --------------------------------------------------------------------------

  private frame(now: number) {
    this.timer.update(now);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.physics && this.state !== 'title' && this.state !== 'results') {
      if (this.state === 'countdown') this.tickCountdown(dt);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        this.acc -= STEP;
        steps++;
        this.fixedStep();
      }
      if (steps === 8) this.acc = 0;
    } else {
      this.acc = 0;
    }
    this.animate(dt);
    this.drawCars();
    if (this.state === 'title') this.titleCamera(dt);
    else this.syncCamera(false, dt);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  }

  private tickCountdown(dt: number) {
    const before = Math.ceil(this.countdown - 0.6);
    this.countdown -= dt;
    const now = Math.ceil(this.countdown - 0.6);
    if (now !== before && now >= 0) {
      if (now > 0) {
        this.sounds.play(['one', 'two', 'three'][now - 1], { detune: 0 });
        this.banner(String(now), '', 0.8);
      } else {
        this.sounds.play('go', { detune: 0 });
        this.banner('GO!', '', 0.9);
        this.state = 'racing';
        this.time = 0;
        for (const r of this.racers) r.itemIn = 0;
      }
    }
  }

  /** One physics step: everyone's controls, the world, then laps, pickups and falls. */
  private fixedStep() {
    const physics = this.physics!;
    const racing = this.state === 'racing' || this.state === 'finished';
    if (racing) this.time += STEP;
    const playerSpeedBefore = this.player ? vlen(this.player.car.body.linvel()) : 0;
    for (const r of this.racers) {
      const p = r.car.body.translation();
      r.boostLeft = Math.max(0, r.boostLeft - STEP);
      r.car.power = (1 + r.coins * COIN_POWER) * (r.boostLeft > 0 ? BOOST_POWER : 1);
      if (!racing) r.car.controls = { throttle: 0, steer: 0 };
      else if (r.player && r.finishedAt === undefined && !this.autopilot) r.car.controls = this.playerControls();
      else {
        // Computer cars, and the player's after the flag, drive themselves. A little catch-up keeps the pack close.
        const lead = this.player ? (r.progress - this.player.progress) * LINE_STEP : 0;
        const band = r.player ? 0.9 : Math.max(-0.06, Math.min(0.05, -lead / 60));
        r.car.controls = drive(this.built, { ...r.driver, skill: r.driver.skill + band }, r.index, p.x, p.z, yawOf(r.car.body), r.car.speed, TOP_SPEED * r.car.power);
        if (!r.player) this.computerItems(r);
      }
      r.prev.p.copy(r.next.p);
      r.prev.q.copy(r.next.q);
    }
    physics.step();
    for (const r of this.racers) {
      const p = r.car.body.translation();
      const q = r.car.body.rotation();
      r.next.p.set(p.x, p.y, p.z);
      r.next.q.set(q.x, q.y, q.z, q.w);
      this.track(r);
      if (racing) {
        this.pickups(r);
        this.fallen(r);
      }
    }
    // A sudden loss of speed is a knock against a wall or another car.
    const me = this.player;
    if (me) {
      const lost = playerSpeedBefore - vlen(me.car.body.linvel());
      if (lost > 1.4) {
        const hitCar = this.racers.some((o) => o !== me && o.next.p.distanceTo(me.next.p) < 0.85);
        this.sounds.play(hitCar ? 'bump' : 'wall', { volume: Math.min(0.7, lost / 6) });
        this.shake = Math.min(0.25, lost / 25);
      }
    }
  }

  private get player() {
    return this.racers.find((r) => r.player);
  }

  /** Progress round the circuit, laps and the finish. */
  private track(r: Racer) {
    const n = this.built.line.length;
    const p = r.next.p;
    const near = nearest(this.built, p.x, p.y, p.z, r.index);
    let step = near.index - r.index;
    if (step < -n / 2) step += n;
    if (step > n / 2) step -= n;
    r.progress += step;
    r.index = near.index;
    if (this.state !== 'racing' && this.state !== 'finished') return;
    if (r.progress >= (r.laps + 1) * n && r.finishedAt === undefined) {
      const lap = this.time - r.lapStart;
      r.bestLap = Math.min(r.bestLap, lap);
      r.lapStart = this.time;
      r.laps++;
      if (r.laps >= LAPS) {
        r.finishedAt = this.time;
        if (r.player) this.playerFinished();
      } else if (r.player) {
        this.sounds.play('lap', { detune: 0 });
        if (r.laps === LAPS - 1) {
          this.sounds.play('finalLap', { detune: 0 });
          this.banner('FINAL LAP', fmt(lap));
        } else this.banner(`LAP ${r.laps + 1}`, fmt(lap));
      }
    }
  }

  private playerFinished() {
    this.state = 'finished';
    const place = this.order().findIndex((r) => r.player);
    this.sounds.play(place === 0 ? 'win' : 'lap', { detune: 0 });
    this.sounds.play(place === 0 ? 'podium' : place < 3 ? 'placed' : 'meh', { detune: 0, volume: 0.5 });
    this.banner(place === 0 ? 'YOU WIN!' : `${PLACE[place]}!`, fmt(this.time), 3);
    this.finishWait = 3.5;
  }

  /** Item boxes, coins and bananas. */
  private pickups(r: Racer) {
    const p = r.next.p;
    for (const b of this.boxes) {
      if (b.away > 0 || b.pos.distanceTo(p) > REACH) continue;
      b.away = 3;
      this.burst(b.pos, 0xb06cff, 8);
      if (!r.item) {
        // Cars at the back are likelier to get a boost.
        const place = this.order().indexOf(r);
        r.item = Math.random() < 0.45 + place * 0.12 ? 'boost' : 'banana';
        r.itemIn = 0.6 + Math.random() * 2;
        if (r.player) {
          this.sounds.play('box', { detune: 0, volume: 0.5 });
          this.flashItem();
        }
      }
    }
    for (const c of this.coins) {
      if (c.away > 0 || c.pos.distanceTo(p) > REACH) continue;
      c.away = 8;
      if (r.coins < MAX_COINS) r.coins++;
      if (r.player) this.sounds.play('coin', { volume: 0.35, detune: 0, rate: 1 + r.coins * 0.03 });
    }
    for (const b of this.bananas) {
      if (b.age < 0.4 && b.by === r) continue;
      if (b.pos.distanceTo(p) > REACH * 0.9) continue;
      b.age = -1;
      r.car.spin = SPIN_TIME;
      const v = r.car.body.linvel();
      r.car.body.setLinvel({ x: v.x * 0.45, y: v.y, z: v.z * 0.45 }, true);
      r.coins = Math.max(0, r.coins - 2);
      if (r.player || r.next.p.distanceTo(this.player!.next.p) < 6) this.sounds.play('spin', { volume: r.player ? 0.6 : 0.3 });
      if (r.player) {
        this.shake = 0.15;
        this.banner('Banana!', '', 0.9);
      }
    }
    this.bananas = this.bananas.filter((b) => {
      if (b.age >= 0) return true;
      this.scene.remove(b.mesh);
      this.burst(b.pos, 0xffd84a, 6);
      return false;
    });
  }

  /**
   * A car that's left the track (on the floor, flying too long or far off the line), or has sat
   * stuck against a wall, goes back on the line.
   */
  private fallen(r: Racer) {
    const near = nearest(this.built, r.next.p.x, r.next.p.y, r.next.p.z, r.index);
    r.stuck = Math.abs(r.car.speed) < 0.4 && r.finishedAt === undefined ? r.stuck + STEP : 0;
    if (!r.car.onFloor && r.car.airTime < 1.6 && near.off < WIDTH * 1.3 && r.stuck < 2.5) return;
    r.stuck = 0;
    const i = r.index;
    const q = this.built.line[i];
    const yaw = lineYaw(this.built, i);
    this.physics!.reset(r.car, q.x, q.y, q.z, yaw);
    r.next.p.set(q.x, q.y, q.z);
    r.next.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    r.prev.p.copy(r.next.p);
    r.prev.q.copy(r.next.q);
    if (r.player) {
      this.sounds.play('fall', { volume: 0.5, detune: 0 });
      this.banner('Oops!', 'back on the track', 1);
      this.syncCamera(true);
    }
  }

  private useItem(r: Racer) {
    if (!r.item || this.state !== 'racing' || r.car.spin > 0) return;
    const item = r.item;
    r.item = null;
    if (item === 'boost') {
      r.boostLeft = BOOST_TIME;
      const f = rotate(r.car.body.rotation(), 0, 0, 1);
      const v = r.car.body.linvel();
      r.car.body.setLinvel({ x: v.x + f.x * 2.5, y: v.y, z: v.z + f.z * 2.5 }, true);
      if (r.player) {
        this.sounds.play('boost', { volume: 0.5 });
        this.shake = 0.08;
      }
    } else {
      const f = rotate(r.car.body.rotation(), 0, 0, 1);
      const pos = r.next.p.clone().add(new THREE.Vector3(-f.x, 0, -f.z).multiplyScalar(0.75));
      const near = this.built.line[nearest(this.built, pos.x, pos.y, pos.z, r.index).index];
      pos.y = near.y;
      const mesh = this.models['item-banana'].clone();
      mesh.scale.setScalar(1.5);
      mesh.position.copy(pos);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(mesh);
      this.bananas.push({ mesh, pos, by: r, age: 0 });
      if (r.player || r.next.p.distanceTo(this.player!.next.p) < 6) this.sounds.play('drop', { volume: 0.4 });
    }
  }

  private computerItems(r: Racer) {
    if (!r.item) return;
    r.itemIn -= STEP;
    if (r.itemIn > 0) return;
    // Boosts wait for a straight; bananas go down when someone's close behind.
    if (r.item === 'boost' && turnAhead(this.built, r.index, 5) > 0.4) return;
    if (r.item === 'banana' && !this.racers.some((o) => o !== r && r.progress - o.progress > 0 && (r.progress - o.progress) * LINE_STEP < 6) && r.itemIn > -4) return;
    this.useItem(r);
  }

  // ---- Input -------------------------------------------------------------------------------

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      if (e.repeat) return;
      if ((e.key === ' ' || e.key === 'Shift' || e.key.toLowerCase() === 'x') && this.player) this.useItem(this.player);
      if (this.state === 'title') {
        if (e.key === 'ArrowLeft') this.pickVehicle(-1);
        if (e.key === 'ArrowRight') this.pickVehicle(1);
        if (e.key === 'Enter') this.startCup();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    const hold = (id: string, key: 'left' | 'right' | 'brake') => {
      const el = $(id);
      const on = (e: PointerEvent) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.touch[key] = true;
        this.touch.used = true;
        el.classList.add('down');
      };
      const off = () => {
        this.touch[key] = false;
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    hold('t-left', 'left');
    hold('t-right', 'right');
    hold('t-brake', 'brake');
    $('t-item').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touch.used = true;
      if (this.player) this.useItem(this.player);
    });
    $('title-play').onclick = () => this.startCup();
    $('car-prev').onclick = () => this.pickVehicle(-1);
    $('car-next').onclick = () => this.pickVehicle(1);
  }

  private playerControls() {
    const k = this.keys;
    const left = k.has('arrowleft') || k.has('a') || this.touch.left;
    const right = k.has('arrowright') || k.has('d') || this.touch.right;
    const gas = k.has('arrowup') || k.has('w');
    const brake = k.has('arrowdown') || k.has('s') || this.touch.brake;
    // Keys steer in over a moment, so a tap nudges and a hold turns fully.
    const want = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = want === 0 || Math.sign(want) !== Math.sign(this.steer) ? 9 : 4.5;
    this.steer += Math.max(-rate * STEP, Math.min(rate * STEP, want - this.steer));
    // Touch players drive with the throttle held for them.
    const throttle = brake ? -1 : gas || this.touch.used ? 1 : 0;
    return { throttle, steer: this.steer };
  }

  private pickVehicle(dir: number) {
    const i = VEHICLES.indexOf(this.vehicle);
    this.vehicle = VEHICLES[(i + dir + VEHICLES.length) % VEHICLES.length];
    save('toy-kart:vehicle', this.vehicle);
    this.sounds.play('click');
    // Swap the player's car on the grid to show it.
    const me = this.player;
    if (me) {
      this.scene.remove(me.view.root);
      me.view = makeCar(this.models, this.vehicle);
      me.vehicle = this.vehicle;
      this.scene.add(me.view.root);
      this.tweenPop(me.view.root);
    }
    // Any computer car using that model swaps to the one just left.
    const clash = this.racers.find((r) => !r.player && r.vehicle === this.vehicle);
    if (clash) {
      clash.vehicle = VEHICLES[i];
      clash.name = VEHICLE_NAMES[VEHICLES[i]];
      this.scene.remove(clash.view.root);
      clash.view = makeCar(this.models, clash.vehicle);
      this.scene.add(clash.view.root);
    }
    $('car-name').textContent = VEHICLE_NAMES[this.vehicle];
  }

  private tweenPop(o: THREE.Object3D) {
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / 300);
      o.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.25);
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  // ---- Drawing -----------------------------------------------------------------------------

  private drawCars() {
    const alpha = this.acc / STEP;
    for (const r of this.racers) {
      const root = r.view.root;
      root.position.lerpVectors(r.prev.p, r.next.p, alpha);
      root.quaternion.slerpQuaternions(r.prev.q, r.next.q, alpha);
      // The physics body floats; draw the car down on its wheels.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
      root.position.addScaledVector(up, -0.215);
      r.wheelSpin += (r.car.speed / 0.12) * (1 / 60);
      for (const w of r.view.wheels) w.rotation.x = -r.wheelSpin;
      const steer = r.car.controls.steer * 0.45;
      for (const w of r.view.front) w.rotation.y = -steer;
      // Lean a touch on the springs when turning hard.
      r.view.body.rotation.z = Math.max(-0.12, Math.min(0.12, r.car.slide * 0.04));
    }
  }

  /** Pickups bob and spin, smoke drifts, the engine hums with the player's speed. */
  private animate(dt: number) {
    const t = performance.now() / 1000;
    for (const b of this.boxes) {
      b.away = Math.max(0, b.away - dt);
      const s = b.away > 0 ? 0 : Math.min(1, b.mesh.scale.x / 0.9 + dt * 3) * 0.9;
      b.mesh.scale.setScalar(Math.max(0.001, s));
      b.mesh.visible = s > 0.01;
      b.mesh.rotation.y = t * 1.6;
      b.mesh.position.y = b.pos.y + 0.12 + Math.sin(t * 3 + b.pos.x) * 0.05;
    }
    for (const c of this.coins) {
      c.away = Math.max(0, c.away - dt);
      c.mesh.visible = c.away <= 0;
      c.mesh.rotation.y = t * 3 + c.pos.x;
    }
    for (const b of this.bananas) b.age += dt;
    // Smoke: boosting cars puff it out behind.
    for (const r of this.racers) {
      if (r.boostLeft > 0 && Math.random() < dt * 30) {
        const f = rotate(r.car.body.rotation(), 0, 0, 1);
        this.puff(r.next.p.clone().add(new THREE.Vector3(-f.x * 0.45, 0.15, -f.z * 0.45)), new THREE.Vector3(-f.x, 0.6, -f.z), 0.5, 0.7);
      } else if (Math.abs(r.car.slide) > 2.2 && r.car.grounded && Math.random() < dt * 20) {
        this.puff(r.next.p.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, 0.4, 0), 0.4, 0.4);
      }
    }
    this.puffs = this.puffs.filter((p) => {
      p.life += dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.mesh.scale.setScalar(p.size * (0.4 + k) * (1 - k * k));
      if (k < 1) return true;
      this.scene.remove(p.mesh);
      return false;
    });
    const me = this.player;
    if (this.engine) {
      const going = this.state === 'countdown' || this.state === 'racing' || this.state === 'finished';
      const speed = me ? Math.abs(me.car.speed) : 0;
      this.engine.set(0.55 + (speed / TOP_SPEED) * 0.9 + (me && me.boostLeft > 0 ? 0.2 : 0), going ? 0.06 + (speed / TOP_SPEED) * 0.1 : 0);
    }
    if (this.state === 'finished') {
      this.finishWait -= dt;
      // Wait for the others (or a few seconds) before the results.
      if (this.finishWait <= 0 || this.racers.every((r) => r.finishedAt !== undefined)) {
        for (const r of this.racers) r.finishedAt ??= this.time + (this.built.line.length * LAPS - r.progress) * LINE_STEP / TOP_SPEED;
        this.finishRace();
      }
    }
  }

  private puff(pos: THREE.Vector3, vel: THREE.Vector3, size: number, max: number) {
    const mesh = this.models.smoke.clone();
    mesh.position.copy(pos);
    mesh.rotation.y = Math.random() * 6;
    this.scene.add(mesh);
    this.puffs.push({ mesh, vel, life: 0, max, size });
  }

  private burst(pos: THREE.Vector3, _colour: number, count: number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.puff(pos.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3(Math.cos(a) * 1.5, 1 + Math.random(), Math.sin(a) * 1.5), 0.35, 0.45);
    }
  }

  /** The chase camera: behind and above the player, easing after them. */
  private syncCamera(snap: boolean, dt = 0) {
    const me = this.player;
    if (!me) return;
    const portrait = this.camera.aspect < 1;
    const dist = portrait ? 3.6 : 2.9;
    const height = portrait ? 1.8 : 1.35;
    const root = me.view.root;
    const yaw = Math.atan2(...(() => {
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
      return [f.x, f.z] as [number, number];
    })());
    // While spinning out the camera keeps facing along the track rather than whirling round.
    const look = me.car.spin > 0 ? lineYaw(this.built, me.index) : yaw;
    const want = new THREE.Vector3(root.position.x - Math.sin(look) * dist, root.position.y + height, root.position.z - Math.cos(look) * dist);
    const target = new THREE.Vector3(root.position.x + Math.sin(look) * 1.6, root.position.y + 0.35, root.position.z + Math.cos(look) * 1.6);
    if (snap) {
      this.camPos.copy(want);
      this.camLook.copy(target);
    } else {
      this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
      this.camLook.lerp(target, 1 - Math.exp(-dt * 10));
    }
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0));
      this.shake = Math.max(0, this.shake - dt * 0.8);
    }
    this.camera.fov = portrait ? 72 : 62 + (me.boostLeft > 0 ? 8 : 0);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.camLook);
  }

  /** On the title the camera circles slowly round the player's car on the grid. */
  private titleCamera(dt: number) {
    const me = this.player;
    if (!me) return;
    const a = (this.titleAngle += dt * 0.35);
    const p = me.view.root.position;
    const portrait = this.camera.aspect < 1;
    const r = portrait ? 3 : 2.2;
    this.camera.position.set(p.x + Math.sin(a) * r, p.y + (portrait ? 2.2 : 1.6), p.z + Math.cos(a) * r);
    this.camera.fov = portrait ? 60 : 50;
    this.camera.updateProjectionMatrix();
    // Aim below the car so it sits in the top half, clear of the title.
    this.camera.lookAt(p.x, p.y - (portrait ? 1.3 : 0.5), p.z);
  }

  private titleAngle = 0;

  // ---- HUD ---------------------------------------------------------------------------------

  private updateHud() {
    const me = this.player;
    if (!me || this.state === 'title') return;
    const place = this.order().indexOf(me);
    $('pos').innerHTML = `${place + 1}<small>${PLACE[place].slice(-2)}</small>`;
    $('lap').textContent = `LAP ${Math.min(LAPS, me.laps + 1)}/${LAPS}`;
    $('time').textContent = fmt(this.state === 'countdown' ? 0 : me.finishedAt ?? this.time);
    $('coins').textContent = `${me.coins}`;
    const slot = $('item');
    const icon = me.item ? `url("${kenney(`${ICONS}/${ITEM_ICON[me.item]}.png`)}")` : 'none';
    if (slot.style.backgroundImage !== icon) {
      slot.style.backgroundImage = icon;
      $('t-item').style.backgroundImage = icon;
    }
    this.drawMinimap();
  }

  private flashItem() {
    const el = $('item');
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  private mapScale = { x0: 0, z0: 0, k: 1 };

  private drawMinimapTrack() {
    const c = $<HTMLCanvasElement>('minimap');
    const g = c.getContext('2d')!;
    const xs = this.built.line.map((p) => p.x);
    const zs = this.built.line.map((p) => p.z);
    const pad = 10;
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...zs) - Math.min(...zs);
    const k = Math.min((c.width - pad * 2) / w, (c.height - pad * 2) / h);
    this.mapScale = { x0: Math.min(...xs) - (c.width / k - w) / 2, z0: Math.min(...zs) - (c.height / k - h) / 2, k };
    this.mapTrack = document.createElement('canvas');
    this.mapTrack.width = c.width;
    this.mapTrack.height = c.height;
    const t = this.mapTrack.getContext('2d')!;
    t.lineJoin = t.lineCap = 'round';
    for (const [width, colour] of [[10, 'rgba(40,30,20,0.55)'], [5, '#ffffff']] as const) {
      t.strokeStyle = colour;
      t.lineWidth = width;
      t.beginPath();
      this.built.line.forEach((p, i) => {
        const [x, y] = this.mapPoint(p.x, p.z);
        if (i) t.lineTo(x, y);
        else t.moveTo(x, y);
      });
      t.closePath();
      t.stroke();
    }
    g.clearRect(0, 0, c.width, c.height);
  }

  private mapTrack?: HTMLCanvasElement;

  private mapPoint(x: number, z: number): [number, number] {
    const { x0, z0, k } = this.mapScale;
    // Mirror x so the map reads the same way round as the view from above.
    const c = $<HTMLCanvasElement>('minimap');
    return [c.width - (x - x0) * k, c.height - (z - z0) * k];
  }

  private drawMinimap() {
    const c = $<HTMLCanvasElement>('minimap');
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    if (this.mapTrack) g.drawImage(this.mapTrack, 0, 0);
    const colours = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'];
    // The player last, on top.
    const sorted = [...this.racers].sort((a, b) => Number(a.player) - Number(b.player));
    for (const r of sorted) {
      const [x, y] = this.mapPoint(r.next.p.x, r.next.p.z);
      g.fillStyle = r.player ? '#ff4d8d' : colours[this.racers.indexOf(r) % colours.length];
      g.strokeStyle = '#2b2118';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r.player ? 7 : 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  private bannerTimer = 0;

  private banner(text: string, small = '', seconds = 1.6) {
    const el = $('banner');
    el.innerHTML = '';
    el.append(text);
    if (small) {
      const s = document.createElement('small');
      s.textContent = small;
      el.append(s);
    }
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  private showTitle() {
    this.state = 'title';
    document.body.classList.add('on-title');
    $('car-name').textContent = VEHICLE_NAMES[this.vehicle];
    $('title-best').textContent = this.bestCup > 1 ? `best cup: ${['bronze', 'silver', 'gold'][this.bestCup - 2]}` : 'three races, three laps each';
    $('title').classList.add('show');
  }

  private hideCards() {
    $('title').classList.remove('show');
    $('results').classList.remove('show');
  }
}

function vlen(v: { x: number; y: number; z: number }) {
  return Math.hypot(v.x, v.y, v.z);
}

/** 83.456 → "1:23.45". */
function fmt(t: number) {
  if (!Number.isFinite(t)) return '-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
