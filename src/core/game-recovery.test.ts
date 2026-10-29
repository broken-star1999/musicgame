import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameRecovery } from './game-recovery';

function deferred() {
  let resolve: () => void, reject: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve: resolve!, reject: reject! };
}
function session() {
  const audio = { unlock: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
  const callbacks = { countdown: vi.fn(), ready: vi.fn(), error: vi.fn(), interrupted: vi.fn() };
  let visible = true;
  return { audio, callbacks, recovery: new GameRecovery(audio, callbacks, () => visible), hide: () => { visible = false; } };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('session-owned audio recovery', () => {
  it('unlocks directly in the click stack, then waits a full three seconds before starting music', async () => {
    const { audio, callbacks, recovery } = session();
    const starting = recovery.start();
    expect(audio.unlock).toHaveBeenCalledOnce(); expect(callbacks.countdown).toHaveBeenLastCalledWith(0);
    expect(audio.resume).not.toHaveBeenCalled();
    await starting; expect(callbacks.countdown).toHaveBeenLastCalledWith(3);
    await vi.advanceTimersByTimeAsync(2999); expect(audio.resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(audio.resume).toHaveBeenCalledOnce(); expect(callbacks.ready).toHaveBeenCalledOnce();
    expect(callbacks.countdown.mock.calls.map(call => call[0])).toEqual([0, 3, 2, 1, 0, null]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('ignores an old unlock %s after a new countdown begins', async completion => {
    const { audio, callbacks, recovery } = session(), old = deferred();
    audio.unlock.mockReturnValueOnce(old.promise);
    void recovery.start(); recovery.cancel(); await recovery.start();
    if (completion === 'resolve') old.resolve(); else old.reject(new Error('old unlock failure'));
    await tick(); expect(callbacks.countdown).toHaveBeenLastCalledWith(3);
    expect(callbacks.error).not.toHaveBeenCalled(); expect(callbacks.ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000); expect(callbacks.ready).toHaveBeenCalledOnce();
  });

  it('does not let a late playback resume finish a later attempt early', async () => {
    const { audio, callbacks, recovery } = session(), old = deferred();
    audio.resume.mockReturnValueOnce(old.promise);
    await recovery.start(); await vi.advanceTimersByTimeAsync(3000);
    expect(audio.resume).toHaveBeenCalledOnce(); expect(callbacks.ready).not.toHaveBeenCalled();
    recovery.cancel(); await recovery.start(); old.resolve(); await tick();
    expect(callbacks.countdown).toHaveBeenLastCalledWith(3); expect(callbacks.ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2999); expect(audio.resume).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(callbacks.ready).toHaveBeenCalledOnce();
  });

  it('disposes a retired game without any callback affecting its replacement', async () => {
    const first = session(), next = session(), pending = deferred();
    first.audio.unlock.mockReturnValueOnce(pending.promise);
    void first.recovery.start(); first.recovery.dispose(); first.callbacks.countdown.mockClear();
    await next.recovery.start(); pending.reject(new Error('retired session')); await tick();
    expect(first.callbacks.countdown).not.toHaveBeenCalled(); expect(first.callbacks.error).not.toHaveBeenCalled();
    expect(first.audio.resume).not.toHaveBeenCalled(); expect(next.callbacks.countdown).toHaveBeenLastCalledWith(3);
    await first.recovery.start(); expect(first.audio.unlock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000); expect(next.callbacks.ready).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an unresponsive unlock at eight seconds and allows another click', async () => {
    const { audio, callbacks, recovery } = session(); audio.unlock.mockReturnValueOnce(new Promise(() => {}));
    void recovery.start(); await vi.advanceTimersByTimeAsync(8000);
    expect(callbacks.error).toHaveBeenCalledWith(expect.stringMatching(/声音恢复超过 8 秒/));
    expect(callbacks.countdown).toHaveBeenLastCalledWith(null); expect(vi.getTimerCount()).toBe(0);
    await recovery.start(); await vi.advanceTimersByTimeAsync(3000); expect(callbacks.ready).toHaveBeenCalledOnce();
  });

  it('bounds a future delayed playback start and reports a recoverable failure', async () => {
    const { audio, callbacks, recovery } = session(); audio.resume.mockReturnValueOnce(new Promise(() => {}));
    await recovery.start(); await vi.advanceTimersByTimeAsync(11000);
    expect(callbacks.error).toHaveBeenCalledWith(expect.stringMatching(/播放恢复超过 8 秒/));
    expect(callbacks.ready).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('interrupts a countdown on backgrounding and never resumes audio', async () => {
    const { audio, callbacks, recovery, hide } = session();
    await recovery.start(); hide(); await vi.advanceTimersByTimeAsync(3000);
    expect(callbacks.interrupted).toHaveBeenCalledOnce(); expect(audio.resume).not.toHaveBeenCalled();
    expect(callbacks.ready).not.toHaveBeenCalled(); expect(callbacks.countdown).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces repeated clicks and cancels both pending timers and promises', async () => {
    const { audio, callbacks, recovery } = session();
    await Promise.all([recovery.start(), recovery.start(), recovery.start()]);
    expect(audio.unlock).toHaveBeenCalledOnce(); recovery.cancel(); recovery.cancel();
    await vi.advanceTimersByTimeAsync(9000);
    expect(audio.resume).not.toHaveBeenCalled(); expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.countdown.mock.calls.filter(call => call[0] === null)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps native error messages readable and permits retry after a rejection', async () => {
    const { audio, callbacks, recovery } = session(); audio.unlock.mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'));
    await recovery.start(); expect(callbacks.error).toHaveBeenCalledWith('声音恢复失败，请再次点击继续。');
    audio.resume.mockRejectedValueOnce(new Error('音频已中断，请再次点击继续。'));
    await recovery.start(); await vi.advanceTimersByTimeAsync(3000);
    expect(callbacks.error).toHaveBeenLastCalledWith('音频已中断，请再次点击继续。');
    await recovery.start(); await vi.advanceTimersByTimeAsync(3000); expect(callbacks.ready).toHaveBeenCalledOnce();
  });
});
