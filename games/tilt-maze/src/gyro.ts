/**
 * Phone tilt from DeviceOrientationEvent, as a screen-space vector.
 *
 * iOS only reports orientation after DeviceOrientationEvent.requestPermission(), which must be
 * called inside a real tap. Phaser handles input on its next frame, outside the tap, so the
 * request goes on a plain DOM listener instead.
 */

/** Degrees of tilt from the resting pose that count as fully tilted. */
const FULL_TILT = 22;

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

class Gyro {
  private beta = 0;
  private gamma = 0;
  private lastEvent = 0;
  private rest = { beta: 0, gamma: 0 };
  private calibrated = false;

  constructor() {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta === null || e.gamma === null) return;
      this.beta = e.beta;
      this.gamma = e.gamma;
      this.lastEvent = performance.now();
      if (!this.calibrated) this.calibrate();
    });
    const api = (window as unknown as { DeviceOrientationEvent: PermissionApi }).DeviceOrientationEvent;
    if (typeof api.requestPermission === 'function') {
      const ask = () => {
        api.requestPermission!().catch(() => undefined);
        window.removeEventListener('touchend', ask);
      };
      window.addEventListener('touchend', ask);
    }
  }

  /** True while the device is actually reporting orientation. */
  get active() {
    return performance.now() - this.lastEvent < 500;
  }

  /** Treat the way the phone is held right now as level. */
  calibrate() {
    this.rest = { beta: this.beta, gamma: this.gamma };
    this.calibrated = true;
  }

  /** Tilt as a screen-space vector, each axis -1..1, or null without a gyro. */
  read(): { x: number; y: number } | null {
    if (!this.active) return null;
    // Tipping the top edge up (beta) rolls the ball down the screen; the right edge down (gamma) rolls it right.
    const dx = this.gamma - this.rest.gamma;
    const dy = this.beta - this.rest.beta;
    // Turn the device's axes into the screen's, whichever way round the phone is held.
    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    const x = dx * Math.cos(-angle) - dy * Math.sin(-angle);
    const y = dx * Math.sin(-angle) + dy * Math.cos(-angle);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v / FULL_TILT));
    return { x: clamp(x), y: clamp(y) };
  }
}

export const gyro = new Gyro();
