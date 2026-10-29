import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class FakeContext {
  currentTime = 100; state: AudioContextState = 'running'; destination = {};
  sources: FakeSource[] = [];
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  createBufferSource = vi.fn(() => { const source = new FakeSource(); this.sources.push(source); return source; });
  createGain = vi.fn(() => this.gain);
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
}

let context: FakeContext, provider: ReturnType<typeof vi.fn>, Transport: typeof import('./audio-transport')['Transport'];
const buffer = { duration: 12 } as AudioBuffer;
beforeEach(async () => {
  vi.resetModules(); context = new FakeContext(); provider = vi.fn(() => context);
  vi.doMock('./audio-context', () => ({ audioContext: provider }));
  ({ Transport } = await import('./audio-transport'));
});
afterEach(() => { vi.doUnmock('./audio-context'); });

describe('independent pauseable song transport', () => {
  it('maps song times back to the exact current audio timeline across pause and resume', async () => {
    const transport = new Transport(buffer, 1);
    expect(transport.audioTime(1)).toBe(103.5);
    context.currentTime = 104; expect(transport.audioTime(transport.time())).toBe(context.currentTime);
    await transport.pause(); expect(transport.audioTime(2)).toBeUndefined();
    context.currentTime = 150; await transport.resume();
    expect(transport.audioTime(2)).toBe(150.5);
    context.currentTime = 151; expect(transport.audioTime(transport.time())).toBe(context.currentTime);
    transport.stop(); expect(transport.audioTime(2)).toBeUndefined();
  });
  it('captures one context and schedules the initial lead on its timeline', () => {
    const transport = new Transport(buffer, 0.6);
    expect(provider).toHaveBeenCalledOnce(); expect(transport.time()).toBe(-2.5);
    expect(context.sources[0].start).toHaveBeenCalledWith(102.5, 0);
    expect(context.gain.gain.value).toBe(0.6); expect(context.gain.connect).toHaveBeenCalledWith(context.destination);
    context.currentTime = 103; expect(transport.time()).toBe(0.5);
  });

  it('freezes synchronously while the shared context remains running', async () => {
    const transport = new Transport(buffer, 1, 0); context.currentTime = 104.25;
    const paused = transport.pause(); expect(transport.time()).toBe(4.25);
    context.currentTime = 120; expect(transport.time()).toBe(4.25); expect(context.state).toBe('running');
    expect(context.suspend).not.toHaveBeenCalled(); expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce(); expect(context.sources[0].buffer).toBeNull();
    await paused; await transport.pause(); expect(context.sources[0].stop).toHaveBeenCalledOnce();
  });

  it('resumes from the frozen offset with a continuous clock and one new source', async () => {
    const transport = new Transport(buffer, 1, 0); context.currentTime = 103.5; await transport.pause();
    context.currentTime = 150; await transport.resume();
    expect(context.sources[1].start).toHaveBeenCalledWith(150, 3.5); expect(transport.time()).toBe(3.5);
    await transport.resume(); expect(context.sources).toHaveLength(2); expect(context.resume).not.toHaveBeenCalled();
    context.currentTime = 151.25; expect(transport.time()).toBe(4.75);
    await transport.pause(); context.currentTime = 200; await transport.resume();
    expect(context.sources[2].start).toHaveBeenCalledWith(200, 4.75); expect(transport.time()).toBe(4.75);
  });

  it('continues only the remaining negative lead after pausing the opening countdown', async () => {
    const transport = new Transport(buffer, 1); context.currentTime = 101; await transport.pause();
    expect(transport.time()).toBe(-1.5); context.currentTime = 200;
    await transport.resume(); expect(context.sources[1].start).toHaveBeenCalledWith(201.5, 0);
    expect(transport.time()).toBe(-1.5); context.currentTime = 202; expect(transport.time()).toBe(0.5);
  });

  it('unlocks within the method call but does not play or advance a paused song', async () => {
    const transport = new Transport(buffer, 1, 0); context.currentTime = 102; await transport.pause();
    context.state = 'suspended'; const unlocked = transport.unlock();
    expect(context.resume).toHaveBeenCalledOnce(); expect(context.sources).toHaveLength(1);
    context.currentTime = 130; await unlocked; expect(transport.time()).toBe(2);
    await transport.resume(); expect(context.sources[1].start).toHaveBeenCalledWith(130, 2);
  });

  it('cannot advance a paused song when the system or another owner resumes the context', async () => {
    const transport = new Transport(buffer, 1, 0); context.currentTime = 103; await transport.pause();
    context.state = 'suspended'; context.currentTime = 108; await context.resume();
    context.currentTime = 150; expect(transport.time()).toBe(3); expect(context.sources).toHaveLength(1);
  });

  it('rejects song resume while the context is still suspended without creating a source', async () => {
    const transport = new Transport(buffer, 1, 0); await transport.pause(); context.state = 'suspended';
    await expect(transport.resume()).rejects.toThrow(/系统暂停/);
    expect(context.sources).toHaveLength(1); expect(context.resume).not.toHaveBeenCalled();
    await transport.unlock(); await transport.resume(); expect(context.sources).toHaveLength(2);
  });

  it('makes stopped pause/resume/unlock inert and releases nodes only once', async () => {
    const transport = new Transport(buffer, 1, 0); context.currentTime = 103; transport.stop(); transport.stop();
    context.currentTime = 160; context.state = 'suspended';
    await transport.pause(); await transport.resume(); await transport.unlock();
    expect(transport.time()).toBe(3); expect(context.sources).toHaveLength(1);
    expect(context.resume).not.toHaveBeenCalled(); expect(context.suspend).not.toHaveBeenCalled();
    expect(context.sources[0].stop).toHaveBeenCalledOnce(); expect(context.gain.disconnect).toHaveBeenCalledOnce();
  });

  it('does not start a source when an earlier unlock resolves after stop', async () => {
    let complete: () => void;
    context.resume.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    const transport = new Transport(buffer, 1, 0); await transport.pause();
    const pending = transport.unlock(); transport.stop(); complete!(); await pending;
    await transport.resume(); expect(context.sources).toHaveLength(1); expect(context.gain.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the clock advancing past natural audio end for final chart settlement', async () => {
    const transport = new Transport(buffer, 1, 0), source = context.sources[0];
    context.currentTime = 112; source.onended?.();
    expect(source.buffer).toBeNull(); expect(source.disconnect).toHaveBeenCalledOnce();
    context.currentTime = 112.6; expect(transport.time()).toBeCloseTo(12.6);
    await transport.pause(); context.currentTime = 140; await transport.resume();
    expect(context.sources).toHaveLength(1); expect(transport.time()).toBeCloseTo(12.6);
    context.currentTime = 141; expect(transport.time()).toBeCloseTo(13.6);
  });

  it('ignores a stale ended callback after a later source has replaced it', async () => {
    const transport = new Transport(buffer, 1, 0), ended = context.sources[0].onended!;
    context.currentTime = 103; await transport.pause(); await transport.resume();
    const current = context.sources[1]; ended();
    expect(current.disconnect).not.toHaveBeenCalled(); expect(current.buffer).toBe(buffer);
    context.currentTime = 104; expect(transport.time()).toBe(4);
    await transport.pause(); expect(current.stop).toHaveBeenCalledOnce();
  });

  it('cleans up a failed source start and leaves the frozen position available for retry', async () => {
    const transport = new Transport(buffer, 1, 0); context.currentTime = 103; await transport.pause();
    const failed = new FakeSource(); failed.start.mockImplementation(() => { throw new Error('resource unavailable'); });
    context.createBufferSource.mockReturnValueOnce(failed);
    await expect(transport.resume()).rejects.toThrow(/恢复失败/);
    expect(failed.disconnect).toHaveBeenCalledOnce(); expect(failed.buffer).toBeNull();
    context.currentTime = 120; expect(transport.time()).toBe(3);
    await transport.resume(); expect(context.sources.at(-1)!.start).toHaveBeenCalledWith(120, 3);
  });
});
