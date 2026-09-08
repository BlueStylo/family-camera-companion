const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
export class DemoPTZ {
  constructor() { this.reset(); }
  reset() { this.pan = 0; this.tilt = -18; this.fov = 70; this.stop(); }
  move(direction, now = 0) {
    if (!['left', 'right', 'up', 'down'].includes(direction)) throw new Error('Invalid PTZ direction');
    this.direction = direction;
    this.until = now + 1500;
  }
  stop() { this.direction = null; this.until = 0; }
  zoom(delta) {
    if (!Number.isFinite(delta)) throw new Error('Invalid zoom');
    this.fov = clamp(this.fov + delta, 25, 90);
  }
  tick(deltaMs, now) {
    if (now >= this.until) this.stop();
    if (!this.direction) return;
    const step = clamp(deltaMs, 0, 100) * .035;
    if (this.direction === 'left') this.pan -= step;
    if (this.direction === 'right') this.pan += step;
    if (this.direction === 'up') this.tilt += step;
    if (this.direction === 'down') this.tilt -= step;
    this.pan = clamp(this.pan, -150, 150);
    this.tilt = clamp(this.tilt, -75, 35);
  }
  get state() { return { pan: this.pan, tilt: this.tilt, fov: this.fov, moving: Boolean(this.direction) }; }
}
