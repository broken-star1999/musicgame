import { audioContext } from './audio-context';

/** Each game owns its source and clock. Pausing never suspends the shared
 * context, so a late browser/global resume cannot advance a paused song. */
export class Transport {
  private readonly context = audioContext();
  private readonly gain: GainNode;
  private source?: AudioBufferSourceNode;
  private position: number;
  private anchor: number;
  private playing = false;
  private stopped = false;

  constructor(private readonly buffer: AudioBuffer, volume: number, lead = 2.5) {
    this.gain = this.context.createGain(); this.gain.gain.value = volume;
    this.gain.connect(this.context.destination);
    this.position = -lead; this.anchor = this.context.currentTime;
    try { this.startSource(); }
    catch (error) { this.stopped = true; this.gain.disconnect(); throw error; }
  }

  time(): number { return this.position + (this.playing ? this.context.currentTime - this.anchor : 0); }

  private releaseSource(): void {
    const source = this.source; this.source = undefined;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* Already ended or never started. */ }
    source.disconnect(); source.buffer = null;
  }

  private startSource(): void {
    const now = this.context.currentTime;
    // After natural audio end, the clock still advances through the chart's
    // final judgment/settlement margin; no out-of-range source is necessary.
    if (this.position < this.buffer.duration) {
      const source = this.context.createBufferSource(); this.source = source;
      try {
        source.buffer = this.buffer; source.connect(this.gain);
        source.onended = () => {
          if (this.source !== source) return;
          this.source = undefined; source.onended = null;
          source.disconnect(); source.buffer = null;
        };
        source.start(now + Math.max(0, -this.position), Math.max(0, this.position));
      } catch (error) { this.releaseSource(); throw error; }
    }
    this.anchor = now; this.playing = true;
  }

  pause(): Promise<void> {
    if (!this.stopped && this.playing) {
      this.position = this.time(); this.playing = false;
      this.releaseSource();
    }
    return Promise.resolve();
  }

  /** Invoke resume immediately in the button's user gesture. Unlocking alone
   * never recreates the song source or changes this game's frozen offset. */
  unlock(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    try { return this.context.resume(); } catch (error) { return Promise.reject(error); }
  }

  resume(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.context.state !== 'running') return Promise.reject(new Error('音频仍被系统暂停，请再次点击继续恢复声音。'));
    if (!this.playing) {
      try { this.startSource(); } catch { return Promise.reject(new Error('音乐恢复失败，请重新开始或返回选歌。')); }
    }
    return Promise.resolve();
  }

  stop(): void {
    if (this.stopped) return;
    this.position = this.time(); this.playing = false; this.stopped = true;
    this.releaseSource(); this.gain.disconnect();
  }
}
