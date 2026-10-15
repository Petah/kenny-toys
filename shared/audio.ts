import { kenney } from './kenney';
import type { SfxGroups } from './phaser';

/**
 * Sound for games that don't run Phaser (the three.js ones): named groups of interchangeable
 * files, each play picking one at random with a little pitch wobble, plus a looping track.
 * Browsers start audio suspended, so it resumes on the first tap or key press.
 */
export class Sounds {
  private ctx = new AudioContext();
  private buffers = new Map<string, AudioBuffer[]>();
  private musicSource?: AudioBufferSourceNode;

  constructor() {
    const resume = () => void this.ctx.resume();
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  private async decode(file: string) {
    const data = await (await fetch(kenney(file))).arrayBuffer();
    return this.ctx.decodeAudioData(data);
  }

  async load(groups: SfxGroups) {
    await Promise.all(
      Object.entries(groups).map(async ([name, files]) => this.buffers.set(name, await Promise.all(files.map((f) => this.decode(f))))),
    );
  }

  play(name: string, { volume = 0.6, detune = 150, rate = 1 } = {}) {
    const variants = this.buffers.get(name);
    if (!variants?.length || this.ctx.state !== 'running') return;
    const source = this.ctx.createBufferSource();
    source.buffer = variants[Math.floor(Math.random() * variants.length)];
    source.detune.value = (Math.random() * 2 - 1) * detune;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  /**
   * Loops one sound from a group until stopped, with its pitch and volume set while it plays
   * (an engine's hum). Before audio is allowed to start it waits silently and starts on its own.
   */
  loop(name: string, volume = 0.3) {
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.ctx.destination);
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(name)?.[0] ?? null;
    source.loop = true;
    source.connect(gain);
    source.start();
    return {
      set: (rate: number, vol: number) => {
        const t = this.ctx.currentTime;
        source.playbackRate.setTargetAtTime(rate, t, 0.05);
        gain.gain.setTargetAtTime(vol, t, 0.05);
      },
      stop: () => {
        source.stop();
        gain.disconnect();
      },
    };
  }

  /** Loops a track quietly in the background; calling it again does nothing while it plays. */
  async music(file: string, volume = 0.2) {
    if (this.musicSource) return;
    const buffer = await this.decode(file);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
    this.musicSource = source;
  }
}
