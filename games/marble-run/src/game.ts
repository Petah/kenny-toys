import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Sounds } from '@shared/audio';
import { kenney } from '@shared/kenney';
import { load, save } from '@shared/storage';
import type { Triangles } from '../../../shared/glb.ts';
import { MUSIC, preview } from './assets.ts';
import { MARBLE_RADIUS, RunPhysics, STEP } from './physics.ts';
import { ITEMS } from './pieces.ts';
import { aimSun, buildRun, buildWorld, marbleMaterials, type Models } from './scene3d.ts';
import { START, buildRun as layoutRun, randomRun, tryItem, type Head, type Item, type Placed, type Shape } from './track.ts';

const SAVE_KEY = 'marble-run:track';
/** A run to start with, so the first visit has something to watch straight away. */
const SAMPLE = ['straight', 'drop', 'left', 'steep', 'helix-right', 'u-left', 'bump', 'wave', 'drop', 'jog-left', 'helix-left', 'gentle', 'funnel', 'finish'];
const BURST = 10;
const MAX_MARBLES = 60;

interface Marble {
  id: number;
  mesh: THREE.Mesh;
  /** Seconds it's been nearly still, and seconds since it landed on the grass. */
  still: number;
  grounded: number;
  finished: boolean;
}

interface Puff {
  mesh: THREE.Mesh;
  life: number;
}

export class MarbleRunGame {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private timer = new THREE.Timer();
  private physics = new RunPhysics();

  private items: Item[] = [];
  private placed: Placed[] = [];
  private head: Head | null = START;
  private runGroup?: THREE.Group;
  private arrow: THREE.Mesh;
  private marbles: Marble[] = [];
  private puffs: Puff[] = [];
  private materials = marbleMaterials();
  private marbleGeo = new THREE.SphereGeometry(MARBLE_RADIUS, 20, 14);
  private queued = 0;
  private nextDrop = 0;
  private finished = 0;
  private accumulator = 0;
  private lastClack = 0;
  private toastTimer = 0;
  private frameTarget = new THREE.Vector3();

  constructor(
    stage: HTMLElement,
    private models: Models,
    private triangles: (model: string) => Triangles,
    private shapes: (model: string) => Shape,
    private sounds: Sounds,
    createRenderer: (parent: HTMLElement, camera: THREE.PerspectiveCamera) => THREE.WebGLRenderer,
  ) {
    this.renderer = createRenderer(stage, this.camera);
    this.sun = buildWorld(this.scene, models).sun;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 45;
    this.camera.position.set(9, 11, 14);

    // Where the next piece will snap on.
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x6b4a00 }));
    this.arrow.castShadow = true;
    this.scene.add(this.arrow);

    this.buildPalette();
    this.bindButtons();
    const saved = load<string[] | null>(SAVE_KEY, null);
    this.setRun((saved ?? SAMPLE).map((id) => ITEMS.find((i) => i.id === id)).filter((i): i is Item => !!i), true);
    if (!saved) this.toast('Press Drop marbles, or Clear and build your own run');
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- Building ------------------------------------------------------------------------------

  /** Lays out the run from its items, rebuilds what's drawn and the physics, and saves it. */
  private setRun(items: Item[], reframe = false) {
    const run = layoutRun(items, this.shapes);
    this.items = run.items;
    this.placed = run.placed;
    this.head = run.head;
    if (this.runGroup) this.scene.remove(this.runGroup);
    this.runGroup = buildRun(this.placed, this.models);
    this.scene.add(this.runGroup);
    this.physics.setTrack(this.placed, this.triangles, this.shapes);
    const box = new THREE.Box3().setFromObject(this.runGroup);
    aimSun(this.sun, box);
    save(SAVE_KEY, this.items.map((i) => i.id));
    this.updatePalette();
    this.frameRun(box, reframe);
  }

  /** Eases the camera's focus to the run; on a fresh run, backs off far enough to see it all. */
  private frameRun(box: THREE.Box3, reframe: boolean) {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    // Aim a little below the middle, so the run sits above the palette at the bottom.
    centre.y = Math.min(centre.y, 3) - size * 0.08;
    this.frameTarget.copy(centre);
    if (!reframe) return;
    const dir = new THREE.Vector3(0.55, 0.62, 0.8).normalize();
    // A portrait screen sees less to the sides, so back off further to fit the run across it.
    const narrow = Math.max(1, 1 / this.camera.aspect) ** 0.8;
    this.camera.position.copy(centre).addScaledVector(dir, Math.max(9, size * 1.1) * narrow);
    this.controls.target.copy(centre);
  }

  private add(item: Item, button?: HTMLElement) {
    const result = tryItem(item, this.head, this.placed, this.shapes, this.items.length + 1);
    if (!result.ok) {
      this.sounds.play('nope', { volume: 0.4 });
      this.toast(this.head ? result.reason : 'The run ends in the finish cup. Undo to keep building');
      button?.classList.remove('nope');
      void button?.offsetWidth;
      button?.classList.add('nope');
      return;
    }
    this.sounds.play('place', { volume: 0.5 });
    this.setRun([...this.items, item]);
  }

  private undo() {
    if (!this.items.length) return;
    this.sounds.play('undo', { volume: 0.4 });
    this.setRun(this.items.slice(0, -1));
  }

  private surprise() {
    this.sounds.play('place', { volume: 0.5 });
    this.clearMarbles();
    this.setRun(randomRun(ITEMS, this.shapes, Math.random), true);
    this.toast('A brand new run. Drop the marbles!');
  }

  private clear() {
    this.sounds.play('undo', { volume: 0.4 });
    this.clearMarbles();
    this.setRun([], true);
    this.toast('Pick pieces below to build a run');
  }

  // ---- UI --------------------------------------------------------------------------------------

  private buildPalette() {
    const palette = document.getElementById('palette')!;
    for (const item of ITEMS) {
      const b = document.createElement('button');
      b.dataset.id = item.id;
      const img = document.createElement('img');
      img.src = kenney(preview(item.parts[Math.floor(item.parts.length / 2)].model));
      img.alt = '';
      b.append(img, item.label);
      b.title = item.label;
      b.onclick = () => this.add(item, b);
      palette.append(b);
    }
  }

  /** Dims pieces that wouldn't fit on the end right now. */
  private updatePalette() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#palette button')) {
      const item = ITEMS.find((i) => i.id === b.dataset.id)!;
      b.style.opacity = tryItem(item, this.head, this.placed, this.shapes, this.items.length + 1).ok ? '1' : '0.45';
    }
  }

  private bindButtons() {
    document.getElementById('drop')!.onclick = () => this.drop();
    document.getElementById('undo')!.onclick = () => this.undo();
    document.getElementById('surprise')!.onclick = () => this.surprise();
    document.getElementById('clear')!.onclick = () => this.clear();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.drop();
      }
      if (e.code === 'Backspace' || e.code === 'KeyZ') this.undo();
    });
  }

  private toast(text: string) {
    const el = document.getElementById('toast')!;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  private updateCount() {
    document.getElementById('count')!.textContent = `${this.finished} marble${this.finished === 1 ? '' : 's'} finished`;
  }

  // ---- Marbles ---------------------------------------------------------------------------------

  /** Queues a burst of marbles from the top. Public so automated checks can run them. */
  drop() {
    void this.sounds.music(MUSIC, 0.16);
    this.sounds.play('drop', { volume: 0.4 });
    this.queued += BURST;
  }

  private spawnMarble() {
    // Marbles start at the closed back of the starting chute, rolling forward.
    const id = this.physics.addMarble(START.x + (Math.random() - 0.5) * 0.05, START.y + MARBLE_RADIUS + 0.03, START.z + 0.38, START.dx * 1.2, START.dz * 1.2);
    const mesh = new THREE.Mesh(this.marbleGeo, this.materials[id % this.materials.length]);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.marbles.push({ id, mesh, still: 0, grounded: 0, finished: false });
  }

  private removeMarble(m: Marble, puff: boolean) {
    this.physics.removeMarble(m.id);
    this.scene.remove(m.mesh);
    if (puff) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(MARBLE_RADIUS * 1.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
      p.position.copy(m.mesh.position);
      this.scene.add(p);
      this.puffs.push({ mesh: p, life: 0 });
      this.sounds.play('pop', { volume: 0.25 });
    }
  }

  private clearMarbles() {
    for (const m of this.marbles) this.removeMarble(m, false);
    this.marbles = [];
    this.queued = 0;
  }

  /** Tracks each marble: through the finish hole, settled on the grass, or stuck on the track. */
  private updateMarbles(dt: number) {
    const finish = this.items.at(-1)?.id === 'finish' ? this.placed.at(-1)! : null;
    this.marbles = this.marbles.filter((m) => {
      const body = this.physics.marble(m.id)!;
      const p = body.translation();
      const v = body.linvel();
      m.mesh.position.set(p.x, p.y, p.z);
      const q = body.rotation();
      m.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      // Through the hole in the finish piece: counted once, as it drops below the track.
      if (finish && !m.finished && p.y < finish.y + 0.1 && p.x > finish.box.minX && p.x < finish.box.maxX && p.z > finish.box.minZ && p.z < finish.box.maxZ) {
        m.finished = true;
        this.finished++;
        this.updateCount();
        this.sounds.play('finish', { volume: 0.35 });
      }
      const speed = Math.hypot(v.x, v.y, v.z);
      m.still = speed < 0.05 ? m.still + dt : 0;
      m.grounded = p.y < MARBLE_RADIUS + 0.05 ? m.grounded + dt : 0;
      if (m.grounded > 2.5 || m.still > 2 || p.y < -2) {
        this.removeMarble(m, true);
        return false;
      }
      return true;
    });
    while (this.marbles.length > MAX_MARBLES) this.removeMarble(this.marbles.shift()!, true);
  }

  // ---- Frame -----------------------------------------------------------------------------------

  private frame() {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    const t = this.timer.getElapsed();

    if (this.queued > 0 && t >= this.nextDrop) {
      this.spawnMarble();
      this.queued--;
      this.nextDrop = t + 0.32;
    }
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 40) {
      for (const e of this.physics.step()) {
        const now = performance.now();
        if (now - this.lastClack > 45) {
          this.lastClack = now;
          this.sounds.play('clack', { volume: Math.min(0.5, e.speed * 0.08) });
        }
      }
      this.accumulator -= STEP;
      steps++;
    }
    this.updateMarbles(dt);

    for (const p of this.puffs) {
      p.life += dt;
      p.mesh.scale.setScalar(1 + p.life * 4);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - p.life * 2.4);
    }
    this.puffs = this.puffs.filter((p) => {
      if (p.life < 0.35) return true;
      this.scene.remove(p.mesh);
      return false;
    });

    this.arrow.visible = !!this.head;
    if (this.head) {
      const h = this.head;
      this.arrow.position.set(h.x + h.dx * (0.45 + Math.sin(t * 5) * 0.08), h.y + 0.35, h.z + h.dz * (0.45 + Math.sin(t * 5) * 0.08));
      this.arrow.rotation.set(0, 0, 0);
      this.arrow.rotation.order = 'YXZ';
      this.arrow.rotation.y = Math.atan2(-h.dx, -h.dz);
      this.arrow.rotation.x = -Math.PI / 2;
    }

    this.controls.target.lerp(this.frameTarget, 1 - Math.exp(-dt * 2));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
