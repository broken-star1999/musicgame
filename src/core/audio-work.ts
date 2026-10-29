export interface AudioWorkOptions {
  signal?: AbortSignal;
  progress?: (value: number, stage: string) => void;
}

export function checkAudioAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Audio processing cancelled', 'AbortError');
}

/** Reject promptly, but retain handlers on native work that cannot be aborted.
 * Callers must also stop scheduling work and release their audio nodes. */
export function waitForAudio<T>(work: Promise<T>, signal?: AbortSignal, timeout?: { ms: number; message: string }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (action: () => void) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); action();
    };
    const aborted = () => finish(() => reject(new DOMException('Audio processing cancelled', 'AbortError')));
    signal?.addEventListener('abort', aborted, { once: true });
    work.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal?.aborted) aborted();
    if (timeout && !finished) timer = setTimeout(() => finish(() => reject(new Error(timeout.message))), timeout.ms);
  });
}

export async function yieldAudio(signal?: AbortSignal): Promise<void> {
  await waitForAudio(new Promise<void>(resolve => setTimeout(resolve, 0)), signal);
  checkAudioAbort(signal);
}
