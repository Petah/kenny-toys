import * as THREE from 'three';
import type { Sounds } from '@shared/audio';
import { load, save } from '@shared/storage';
import { MUSIC } from './assets.ts';
import { parseCourse, type Course } from './course.ts';
import type { Triangles } from '../../../shared/glb.ts';
import { HOLES } from './holes.ts';
import { Hud, relative, scoreName } from './hud.ts';
import { BALL_RADIUS, CoursePhysics, STEP, type BallEvent } from './physics.ts';
import { WATER_Y, aimSun, buildCourse, buildWorld, type CourseView, type Models } from './scene3d.ts';

type State = 'title' | 'intro' | 'aim' | 'rolling' | 'out' | 'sunk';

/** A hole is picked up after this many strokes. */
const MAX_STROKES = 8;
/** Drag this fraction of the screen's short side for a full-power putt. */
const FULL_DRAG = 0.32;
/** Start an aim this close to the ball (screen pixels); drags anywhere else turn the camera. */
const GRAB_RADIUS = 90;
const BEST_KEY = 'minigolf:best';
/** The putter is drawn smaller than life and leant out to the side, so it doesn't hide the aim. */
const CLUB_SCALE = 0.45;
const CLUB_LEAN = 0.5;

interface Best {
  total: number;
  holes: number[];
}

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  ttl: number;
  grow?: number;
}

export class MinigolfGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 60);
  private renderer: THREE.WebGLRenderer;
  private sun: THREE.DirectionalLight;
  private hud = new Hud();
  private timer = new THREE.Timer();

  private holeIndex = 0;
  private scores: (number | undefined)[] = [];
  private strokes = 0;
  private state: State = 'title';
  course!: Course;
  physics!: CoursePhysics;
  private view?: CourseView;
  private lastRest = new THREE.Vector3();
  private accumulator = 0;
  private lastKnock = 0;

  private ball: THREE.Object3D;
  private marker: THREE.Mesh;
  private club: THREE.Object3D;
  private aimDots: THREE.Mesh[] = [];
  private particles: Particle[] = [];

  // Camera: orbiting `target` at `yaw` (0 looks north), `pitch` above the horizon, `dist` away.
  private target = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0.55;
  private dist = 1.6;
  private introT = 0;
  private introFrom = new THREE.Vector3();

  // Aiming.
  private aim: { dir: THREE.Vector3; power: number } | null = null;
  private drag: { mode: 'aim' | 'orbit'; x: number; y: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private keys = new Set<string>();
  private charge: { t: number } | null = null;
  private kbAimYaw: number | null = null;

  constructor(
    stage: HTMLElement,
    private models: Models,
    private triangles: (model: string, skip?: string[]) => Triangles,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.sun = buildWorld(this.scene).sun;

    this.ball = models['ball-red'].clone();
    this.club = models['club-red'].clone();
    this.club.scale.setScalar(CLUB_SCALE);
    this.club.rotation.order = 'YXZ';
    this.club.visible = false;
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.045, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.marker.rotation.x = Math.PI;
    const dotGeo = new THREE.SphereGeometry(0.013, 10, 8);
    for (let i = 0; i < 14; i++) {
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      dot.visible = false;
      this.aimDots.push(dot);
    }
    this.scene.add(this.ball, this.club, this.marker, ...this.aimDots);

    this.bindInput();
    this.loadHole(0);
    this.state = 'title';
    document.body.classList.add('on-title');
    const best = load<Best | null>(BEST_KEY, null);
    if (best) document.getElementById('title-best')!.textContent = `best round ${best.total} (${relative(best.total - totalPar())})`;
    document.getElementById('title-play')!.onclick = () => this.startRound();
    document.getElementById('btn-card')!.onclick = () => this.openCard();
    document.getElementById('btn-replay')!.onclick = () => this.restartHole();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- Round flow ------------------------------------------------------------------------------

  startRound() {
    document.getElementById('title')!.classList.remove('show');
    document.body.classList.remove('on-title');
    this.sounds.play('click');
    void this.sounds.music(MUSIC, 0.18);
    this.scores = [];
    this.loadHole(0);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    this.hud.hint(
      touch
        ? 'Drag back from the ball and let go to putt. Drag elsewhere to look around.'
        : 'Drag back from the ball and let go to putt, or aim with ← → and hold space. Drag elsewhere to look around.',
      9,
    );
  }

  private loadHole(index: number) {
    this.holeIndex = index;
    this.strokes = 0;
    if (this.view) this.scene.remove(this.view.group);
    this.physics?.free();
    this.course = parseCourse(HOLES[index].rows);
    this.physics = new CoursePhysics(this.course, this.triangles);
    this.view = buildCourse(this.course, this.models);
    this.scene.add(this.view.group);
    aimSun(this.sun, this.view);
    const tee = this.physics.tee;
    this.lastRest.set(tee.x, tee.y, tee.z);
    this.syncBall();
    // Face the way the tee points, then sweep in from an overview of the whole hole.
    this.yaw = (this.course.tee.turns * Math.PI) / 2;
    // A portrait screen sees less to the sides, so start further back and higher there.
    const portrait = this.camera.aspect < 1;
    this.pitch = portrait ? 0.75 : 0.62;
    this.dist = portrait ? 3.1 : 2.1;
    this.target.copy(this.ball.position);
    const { centre, radius } = this.view;
    this.introFrom.set(centre.x, centre.y + radius * 1.5 + 1, centre.z + radius * 0.9 + 0.8);
    this.introT = 0;
    this.state = 'intro';
    this.aim = null;
    this.charge = null;
    this.kbAimYaw = null;
    this.updateHud();
    this.hud.banner(`Hole ${index + 1}`, `${HOLES[index].name} · par ${HOLES[index].par}`, 1.6);
  }

  private restartHole() {
    if (this.state === 'title') return;
    this.sounds.play('click');
    this.loadHole(this.holeIndex);
  }

  private updateHud() {
    const diff = this.scores.reduce<number>((a, s, i) => a + (s === undefined ? 0 : s - HOLES[i].par), 0);
    this.hud.setHole(this.holeIndex, this.strokes, diff);
  }

  private finishHole(strokes: number, pickedUp = false) {
    this.scores[this.holeIndex] = strokes;
    const par = HOLES[this.holeIndex].par;
    const best = load<Best | null>(BEST_KEY, null);
    const name = pickedUp ? 'Picked up' : scoreName(strokes, par);
    const diff = strokes - par;
    this.hud.banner(name, `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}`, 2.4);
    if (strokes === 1) {
      this.sounds.play('great', { volume: 0.55, detune: 0 });
      window.setTimeout(() => this.sounds.play('holeInOne', { volume: 0.8, detune: 0 }), 500);
    } else this.sounds.play(diff < 0 ? 'great' : diff === 0 ? 'good' : 'meh', { volume: 0.5, detune: 0 });
    this.updateHud();

    const last = this.holeIndex === HOLES.length - 1;
    window.setTimeout(() => {
      if (!last) {
        this.loadHole(this.holeIndex + 1);
        return;
      }
      const total = this.scores.reduce<number>((a, s) => a + (s ?? 0), 0);
      const isBest = !best || total < best.total;
      if (isBest) {
        save<Best>(BEST_KEY, { total, holes: this.scores as number[] });
        this.sounds.play('record', { volume: 0.8, detune: 0 });
      }
      this.hud.showCard(this.scores, {
        title: 'Round complete',
        note: isBest ? `New best round: ${total} (${relative(total - totalPar())})` : `Best round ${best!.total} (${relative(best!.total - totalPar())})`,
        button: 'Play again',
        onGo: () => this.startRound(),
      });
    }, 2600);
  }

  private openCard() {
    if (this.state === 'title' || this.hud.cardOpen) return;
    this.sounds.play('click');
    const best = load<Best | null>(BEST_KEY, null);
    this.hud.showCard(this.scores, { title: 'Scorecard', note: best ? `Best round ${best.total} (${relative(best.total - totalPar())})` : '', button: 'Close', onGo: () => {} });
  }

  // ---- Putting ---------------------------------------------------------------------------------

  /** Putts in a world direction. Public so automated checks can play shots. */
  putt(dir: THREE.Vector3, power: number) {
    if (this.state !== 'aim' || power < 0.03) return;
    this.physics.putt(dir.x, dir.z, power);
    this.strokes++;
    this.state = 'rolling';
    this.sounds.play('putt', { volume: 0.25 + power * 0.5 });
    this.swingClub(dir, power);
    this.aim = null;
    this.hud.hideHint();
    this.updateHud();
  }

  private onBall(e: BallEvent) {
    if (e.kind === 'wall') {
      const now = performance.now();
      if (now - this.lastKnock > 70) {
        this.lastKnock = now;
        this.sounds.play('knock', { volume: Math.min(0.7, 0.15 + e.speed * 0.2) });
      }
    } else if (e.kind === 'stopped') {
      this.lastRest.copy(this.ball.position);
      if (this.strokes >= MAX_STROKES) {
        this.state = 'sunk';
        this.finishHole(MAX_STROKES, true);
      } else {
        this.state = 'aim';
      }
    } else if (e.kind === 'out') {
      this.state = 'out';
      this.splash(this.ball.position);
      this.strokes++;
      this.updateHud();
      this.hud.banner('Splash!', '+1 stroke', 1.2);
      window.setTimeout(() => {
        this.physics.place(this.lastRest.x, this.lastRest.y, this.lastRest.z);
        this.syncBall();
        this.state = this.strokes >= MAX_STROKES ? 'sunk' : 'aim';
        if (this.state === 'sunk') this.finishHole(MAX_STROKES, true);
      }, 1100);
    } else if (e.kind === 'sunk') {
      this.state = 'sunk';
      this.sounds.play('cup', { volume: 0.6 });
      this.confetti(new THREE.Vector3(this.physics.cup.x, this.physics.cup.y + 0.02, this.physics.cup.z));
      this.finishHole(this.strokes);
    }
  }

  // ---- Input -----------------------------------------------------------------------------------

  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        this.drag = null;
        this.aim = null;
        this.pinch = this.pinchDistance();
        return;
      }
      const ball = this.ballOnScreen();
      const near = Math.hypot(e.clientX - ball.x, e.clientY - ball.y) < GRAB_RADIUS;
      this.drag = { mode: near && this.state === 'aim' ? 'aim' : 'orbit', x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId)!;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        if (this.pinch > 0) this.zoom(this.pinch / d);
        this.pinch = d;
        return;
      }
      if (!this.drag) return;
      if (this.drag.mode === 'orbit') {
        this.yaw -= (e.clientX - prev.x) * 0.008;
        this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - prev.y) * 0.006, 0.12, 1.4);
        this.kbAimYaw = null;
      } else {
        this.aimFromDrag(e.clientX, e.clientY);
      }
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      if (this.drag?.mode === 'aim' && this.aim) this.putt(this.aim.dir, this.aim.power);
      if (this.drag?.mode === 'aim') this.aim = null;
      this.drag = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => this.zoom(Math.exp(e.deltaY * 0.001)), { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.state === 'aim') this.charge = { t: 0 };
      }
      if (e.code === 'KeyR') this.restartHole();
      if (e.code === 'KeyC' || e.code === 'Tab') {
        e.preventDefault();
        if (this.hud.cardOpen) this.hud.hideCard();
        else this.openCard();
      }
      if (e.code === 'Enter' && document.getElementById('title')!.classList.contains('show')) this.startRound();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.charge && this.aim) {
        this.putt(this.aim.dir, this.aim.power);
        this.charge = null;
      }
    });
  }

  private pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  private zoom(factor: number) {
    this.dist = THREE.MathUtils.clamp(this.dist * factor, 0.35, 6);
  }

  private ballOnScreen() {
    const p = this.ball.position.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** Pulling back from the ball aims the other way; the further, the harder. */
  private aimFromDrag(x: number, y: number) {
    const ball = this.ballOnScreen();
    const dx = x - ball.x;
    const dy = y - ball.y;
    const r = this.renderer.domElement.getBoundingClientRect();
    const power = Math.min(1, Math.hypot(dx, dy) / (FULL_DRAG * Math.min(r.width, r.height)));
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const dir = right.multiplyScalar(-dx).add(forward.multiplyScalar(dy)).normalize();
    this.aim = power > 0.01 ? { dir, power } : null;
  }

  /** Arrow keys turn the aim (and the camera with it); holding space swings the power up and down. */
  private keyboardAim(dt: number) {
    const turn = (this.keys.has('ArrowRight') || this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('ArrowLeft') || this.keys.has('KeyA') ? 1 : 0);
    const tilt = (this.keys.has('ArrowUp') || this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('ArrowDown') || this.keys.has('KeyS') ? 1 : 0);
    if (tilt) this.pitch = THREE.MathUtils.clamp(this.pitch - tilt * dt * 0.9, 0.12, 1.4);
    if (this.state !== 'aim' || this.drag?.mode === 'aim') return;
    if (turn) {
      this.kbAimYaw = (this.kbAimYaw ?? this.yaw) + turn * dt * 1.4;
      this.yaw = this.kbAimYaw;
    }
    if (!turn && !this.charge && this.kbAimYaw === null) return;
    const yaw = this.kbAimYaw ?? this.yaw;
    let power = 0.35;
    if (this.charge) {
      this.charge.t += dt;
      const phase = (this.charge.t / 1.6) % 2;
      power = Math.max(0.03, phase < 1 ? phase : 2 - phase);
    }
    this.aim = { dir: new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)), power: this.charge ? power : 0 };
    if (!this.charge) this.aim.power = 0.0001;
  }

  // ---- Frame -----------------------------------------------------------------------------------

  private frame() {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    const t = this.timer.getElapsed();
    this.keyboardAim(dt);

    if (this.state === 'rolling') {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 60 && this.state === 'rolling') {
        for (const e of this.physics.step()) this.onBall(e);
        this.accumulator -= STEP;
        steps++;
      }
      this.syncBall();
    } else {
      this.accumulator = 0;
      if (this.state === 'out') {
        // Let it sink out of sight in the pond.
        this.ball.position.y = Math.max(WATER_Y - 0.1, this.ball.position.y - dt * 0.2);
      } else if (this.state === 'sunk') {
        this.ball.position.lerp(new THREE.Vector3(this.physics.cup.x, this.physics.cup.y - 0.005, this.physics.cup.z), 1 - Math.exp(-dt * 10));
      }
    }

    for (const blade of this.view?.blades ?? []) blade.rotation.z += dt * 1.3;
    if (this.view) this.view.flag.rotation.y = Math.sin(t * 1.3) * 0.15;
    this.drawAim(t);
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private syncBall() {
    const p = this.physics.position;
    this.ball.position.set(p.x, p.y, p.z);
    const q = this.physics.ball.rotation();
    this.ball.quaternion.set(q.x, q.y, q.z, q.w);
  }

  private updateCamera(dt: number) {
    if (this.state === 'title') {
      // A slow turn around the first hole behind the title.
      const { centre, radius } = this.view!;
      const a = this.timer.getElapsed() * 0.12;
      this.camera.position.set(centre.x + Math.sin(a) * (radius + 1.8), centre.y + radius * 0.9 + 0.8, centre.z + Math.cos(a) * (radius + 1.8));
      this.camera.lookAt(centre);
      return;
    }
    this.target.lerp(this.ball.position, 1 - Math.exp(-dt * 5));
    const want = new THREE.Vector3(
      this.target.x - Math.sin(this.yaw) * this.dist * Math.cos(this.pitch),
      this.target.y + this.dist * Math.sin(this.pitch),
      this.target.z + Math.cos(this.yaw) * this.dist * Math.cos(this.pitch),
    );
    if (this.state === 'intro') {
      this.introT = Math.min(1, this.introT + dt / 1.8);
      const e = this.introT < 0.35 ? 0 : THREE.MathUtils.smootherstep(this.introT, 0.35, 1);
      this.camera.position.lerpVectors(this.introFrom, want, e);
      const look = new THREE.Vector3().lerpVectors(this.view!.centre, this.target, e);
      this.camera.lookAt(look);
      if (this.introT >= 1) this.state = 'aim';
      return;
    }
    this.camera.position.copy(want);
    this.camera.lookAt(this.target);
  }

  private drawAim(t: number) {
    const aiming = this.state === 'aim' && this.aim !== null && this.aim.power > 0.01;
    this.marker.visible = this.state === 'aim' && !aiming;
    this.marker.position.copy(this.ball.position).add(new THREE.Vector3(0, 0.1 + Math.sin(t * 4) * 0.015, 0));
    this.aimDots.forEach((d) => (d.visible = false));
    if (!aiming) {
      if (this.state === 'aim') this.club.visible = false;
      return;
    }
    const { dir, power } = this.aim!;
    const len = 0.15 + power * 1.6;
    const color = new THREE.Color().setHSL(0.33 - power * 0.33, 0.9, 0.55);
    this.aimDots.forEach((d, i) => {
      const f = (i + 1) / this.aimDots.length;
      d.visible = true;
      d.position.copy(this.ball.position).addScaledVector(dir, f * len);
      d.position.y = this.ball.position.y - BALL_RADIUS + 0.012;
      (d.material as THREE.MeshBasicMaterial).color.copy(color);
      d.scale.setScalar(1 - f * 0.4);
    });
    this.placeClub(dir, 0.03 + power * 0.18);
  }

  /** The putter stands behind the ball, pulled back further for a harder putt. */
  private placeClub(dir: THREE.Vector3, back: number) {
    this.club.visible = true;
    // The model's grip is at its origin and its head 0.77 below, face pointing along +x.
    // Turn the face along the putt, then lean the shaft out to the golfer's side.
    this.club.rotation.set(-CLUB_LEAN, Math.atan2(-dir.z, dir.x), 0);
    const head = new THREE.Vector3(0, -0.77 * CLUB_SCALE, 0).applyEuler(this.club.rotation);
    const ground = this.ball.position.y - BALL_RADIUS + 0.004;
    this.club.position.set(
      this.ball.position.x - dir.x * (back + BALL_RADIUS) - head.x,
      ground - head.y,
      this.ball.position.z - dir.z * (back + BALL_RADIUS) - head.z,
    );
  }

  private swingClub(dir: THREE.Vector3, power: number) {
    const start = performance.now();
    const from = 0.03 + power * 0.18;
    const anim = () => {
      const k = Math.min(1, (performance.now() - start) / 90);
      this.placeClub(dir, from * (1 - k) - 0.02 * k);
      if (k < 1) requestAnimationFrame(anim);
      else window.setTimeout(() => (this.club.visible = false), 350);
    };
    anim();
  }

  // ---- Effects ---------------------------------------------------------------------------------

  private splash(at: THREE.Vector3) {
    this.sounds.play('splash', { volume: 0.6 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, WATER_Y + 0.002, at.z);
    this.addParticle(ring, new THREE.Vector3(), 0.8, 5);
    for (let i = 0; i < 10; i++) {
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true }));
      drop.position.set(at.x, WATER_Y, at.z);
      const a = (i / 10) * Math.PI * 2;
      this.addParticle(drop, new THREE.Vector3(Math.cos(a) * 0.35, 0.9 + Math.random() * 0.5, Math.sin(a) * 0.35), 0.7);
    }
  }

  private confetti(at: THREE.Vector3) {
    const colors = [0xff5a6e, 0xffd23f, 0x4fd1ff, 0x7be37b, 0xffffff];
    for (let i = 0; i < 26; i++) {
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.003, 0.009), new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
      bit.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      const s = 0.25 + Math.random() * 0.35;
      this.addParticle(bit, new THREE.Vector3(Math.cos(a) * s, 1 + Math.random() * 0.8, Math.sin(a) * s), 1.6);
    }
  }

  private addParticle(mesh: THREE.Mesh, vel: THREE.Vector3, ttl: number, grow?: number) {
    this.scene.add(mesh);
    this.particles.push({ mesh, vel, life: 0, ttl, grow });
  }

  private updateParticles(dt: number) {
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      const k = p.life / p.ttl;
      if (k >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        return false;
      }
      if (p.grow) p.mesh.scale.setScalar(1 + k * p.grow);
      else {
        p.vel.y -= 3 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += dt * 8;
        p.mesh.rotation.y += dt * 6;
      }
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
      return true;
    });
  }
}

const totalPar = () => HOLES.reduce((a, h) => a + h.par, 0);
