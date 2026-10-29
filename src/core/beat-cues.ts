import { audioContext } from './audio-context';
import type { Chart } from '../types';

const LOOKAHEAD = 0.12, LENGTH = 0.022, MAX_ACTIVE = 16;
interface Cue { oscillator: OscillatorNode; gain: GainNode; end: number }

/** Optional autoplay listening aid. Every cue refers to an original note head,
 * independent of judgment offset, and owns only short native audio nodes. */
export class BeatCues {
  private readonly heads: number[];
  private readonly volume: number;
  private readonly context?: AudioContext;
  private readonly active = new Set<Cue>();
  private enabled = false;
  private disposed = false;
  private cursor?: number;
  private previous?: { song: number; context: number };

  constructor(chart: Chart, volume: number, context?: AudioContext) {
    this.heads = [...new Set(chart.notes.map(note => note.time).filter(time => Number.isFinite(time) && time >= 0))].sort((a, b) => a - b);
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    try { this.context = context ?? audioContext(); } catch { /* An unavailable optional aid cannot stop the game. */ }
  }

  private lowerBound(time: number): number {
    let low = 0, high = this.heads.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.heads[middle] < time) low = middle + 1; else high = middle; }
    return low;
  }

  private retire(cue: Cue, stop: boolean): void {
    if (!this.active.delete(cue)) return;
    try { cue.oscillator.onended = null; } catch { /* A failed optional node is still disconnected below. */ }
    if (stop) try { cue.oscillator.stop(); } catch { /* Already ended or unavailable. */ }
    try { cue.oscillator.disconnect(); } catch { /* Keep cleaning the gain if a node rejects cleanup. */ }
    try { cue.gain.disconnect(); } catch { /* Cleanup never interrupts music. */ }
  }

  private reset(): void {
    for (const cue of this.active) this.retire(cue, true);
    this.cursor = undefined; this.previous = undefined;
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.enabled) return;
    this.enabled = enabled; this.reset();
  }

  get isEnabled(): boolean { return this.enabled && !this.disposed && !!this.context; }

  pause(): void { if (!this.disposed) this.reset(); }

  private schedule(at: number): boolean {
    const context = this.context!;
    let oscillator: OscillatorNode | undefined, gain: GainNode | undefined, cue: Cue | undefined;
    try {
      oscillator = context.createOscillator(); gain = context.createGain();
      cue = { oscillator, gain, end: at + LENGTH }; this.active.add(cue);
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(1600, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(this.volume * 0.055, at + 0.002);
      gain.gain.linearRampToValueAtTime(0, at + LENGTH);
      oscillator.connect(gain); gain.connect(context.destination);
      const owned = cue; oscillator.onended = () => this.retire(owned, false);
      oscillator.start(at); oscillator.stop(at + LENGTH);
      return true;
    } catch {
      if (cue) this.retire(cue, true);
      else {
        try { oscillator?.stop(); } catch { /* A partially created oscillator may not have started. */ }
        try { oscillator?.disconnect(); } catch { /* Continue optional cleanup. */ }
        try { gain?.disconnect(); } catch { /* Continue optional cleanup. */ }
      }
      this.enabled = false; this.reset(); return false;
    }
  }

  update(songTime: number, contextTime?: number): void {
    if (this.disposed || !this.enabled || !this.context || this.volume === 0 || !Number.isFinite(songTime)) return;
    try {
      const now = contextTime ?? this.context.currentTime;
      if (!Number.isFinite(now) || now < 0) return;
      if (this.context.state !== 'running') { this.reset(); return; }
      // onended may arrive after a busy frame. Retire completed nodes before
      // scheduling, without waiting for its queued event to reach the page.
      for (const cue of this.active) if (cue.end <= this.context.currentTime) this.retire(cue, false);
      const previous = this.previous;
      if (previous && (songTime < previous.song || Math.abs((now - previous.context) - (songTime - previous.song)) > 0.03)) this.reset();
      this.previous = { song: songTime, context: now };
      this.cursor = Math.max(this.cursor ?? 0, this.lowerBound(songTime));
      while (this.cursor < this.heads.length && this.heads[this.cursor] <= songTime + LOOKAHEAD) {
        const head = this.heads[this.cursor++], at = now + head - songTime;
        // Skip elapsed heads and don't accumulate a burst after a stalled frame.
        if (at < this.context.currentTime - 0.005) continue;
        if (this.active.size >= MAX_ACTIVE) { this.cursor = this.lowerBound(songTime + LOOKAHEAD + 1e-9); break; }
        if (!this.schedule(Math.max(at, this.context.currentTime))) return;
      }
    } catch { this.enabled = false; this.reset(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false; this.reset();
  }
}
