import { waitForAudio } from './audio-work';

interface RecoverableAudio { unlock(): Promise<void>; resume(): Promise<void> }
interface RecoveryCallbacks {
  countdown(value: number | null): void;
  ready(): void;
  error(message: string): void;
  interrupted(): void;
}

/** Each instance belongs to one game. Each attempt has its own generation and
 * abort signal, so late promises can never finish another attempt or session. */
export class GameRecovery {
  private generation = 0;
  private disposed = false;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  constructor(private audio: RecoverableAudio, private callbacks: RecoveryCallbacks, private visible: () => boolean) {}

  private current(attempt: number): boolean { return !this.disposed && this.busy && this.generation === attempt; }
  private foreground(attempt: number): boolean {
    if (!this.current(attempt)) return false;
    if (this.visible()) return true;
    this.cancel(); this.callbacks.interrupted(); return false;
  }
  private invalidate() {
    this.generation++; this.busy = false; clearTimeout(this.timer); this.timer = undefined;
    this.controller?.abort(); this.controller = undefined;
  }
  cancel() {
    const wasBusy = this.busy; this.invalidate();
    if (wasBusy && !this.disposed) this.callbacks.countdown(null);
  }
  dispose() { this.disposed = true; this.invalidate(); }
  private fail(attempt: number, error: unknown) {
    if (!this.current(attempt)) return;
    this.cancel();
    const message = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '声音恢复失败，请再次点击继续。';
    this.callbacks.error(message);
  }

  async start(): Promise<void> {
    if (this.disposed || this.busy) return;
    this.busy = true;
    const attempt = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.callbacks.countdown(0);
    try {
      // This call happens directly in the continue-button event, before any
      // timer or await can lose the browser's user activation.
      await waitForAudio(this.audio.unlock(), controller.signal, { ms: 8000, message: '声音恢复超过 8 秒，请再次点击继续。' });
      if (!this.foreground(attempt)) return;
      let remaining = 3;
      this.callbacks.countdown(remaining);
      const tick = () => {
        if (!this.foreground(attempt)) return;
        remaining--;
        if (remaining > 0) { this.callbacks.countdown(remaining); this.timer = setTimeout(tick, 1000); }
        else void finish();
      };
      const finish = async () => {
        try {
          this.callbacks.countdown(0);
          await waitForAudio(this.audio.resume(), controller.signal, { ms: 8000, message: '播放恢复超过 8 秒，请再次点击继续。' });
          if (!this.foreground(attempt)) return;
          this.busy = false; this.controller = undefined; this.timer = undefined;
          this.callbacks.countdown(null); this.callbacks.ready();
        } catch (error) { this.fail(attempt, error); }
      };
      this.timer = setTimeout(tick, 1000);
    } catch (error) {
      this.fail(attempt, error);
    }
  }
}
