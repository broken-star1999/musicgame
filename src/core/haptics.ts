import type { Hit } from './judgment';

type Vibrator = { vibrate?: (pattern: number | number[]) => boolean };

export class HitFeedback {
  private last = -Infinity;
  constructor(private enabled: boolean, private device: Vibrator = typeof navigator === 'undefined' ? {} : navigator, private now = () => performance.now()) {}

  hit(hit: Hit) {
    if (!this.enabled || hit.grade === 'miss' || !this.device.vibrate) return;
    const time = this.now();
    if (time - this.last < 35) return; // Chords should feel like one short pulse.
    try {
      this.device.vibrate.call(this.device, hit.type === 'tap' ? 10 : hit.type === 'hold' ? 12 : 16);
      this.last = time;
    } catch { /* Unsupported or blocked vibration must never interrupt play. */ }
  }

  stop() {
    if (!this.enabled || !Number.isFinite(this.last) || !this.device.vibrate) return;
    try { this.device.vibrate.call(this.device, 0); } catch { /* Optional hardware. */ }
  }
}
