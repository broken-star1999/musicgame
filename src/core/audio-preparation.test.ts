import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMono, SAMPLE_RATE } from './audio';

function audio(rate: number, seconds: number, channels = 1): AudioBuffer {
  const data = Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: Math.floor(rate * seconds) }, (_, i) => Math.sin(i * 0.07 + channel) * 0.3));
  return { sampleRate: rate, duration: data[0].length / rate, length: data[0].length, numberOfChannels: channels, getChannelData: (channel: number) => data[channel] } as AudioBuffer;
}

function offline(render?: (buffer: AudioBuffer, from: number, length: number, rate: number) => Promise<AudioBuffer>) {
  const records: { frames: number; rate: number; source: { buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }; filters: { disconnect: ReturnType<typeof vi.fn> }[] }[] = [];
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    private offset = 0;
    private source = { buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn((_when = 0, at = 0) => { this.offset = at; }), stop: vi.fn(), disconnect: vi.fn() };
    private filters: { disconnect: ReturnType<typeof vi.fn> }[] = [];
    constructor(_channels: number, private frames: number, private rate: number) { records.push({ frames, rate, source: this.source, filters: this.filters }); }
    createBufferSource() { return this.source; }
    createBiquadFilter() {
      const filter = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      this.filters.push(filter); return filter;
    }
    async startRendering() {
      const buffer = this.source.buffer!, from = Math.round(this.offset * buffer.sampleRate);
      if (render) return render(buffer, from, this.frames, this.rate);
      // Passthrough isolates window indexing. Native filter equivalence is
      // separately checked with real OfflineAudioContext in browser QA.
      const data = Float32Array.from({ length: this.frames }, (_, i) => buffer.getChannelData(0)[from + i]);
      return { sampleRate: this.rate, length: data.length, duration: data.length / this.rate, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
    }
  });
  return records;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded cancellable audio preparation', () => {
  it('retains global sample phase through preroll and partial final windows', async () => {
    const records = offline(), buffer = audio(44100, 8.13);
    const output = await prepareMono(buffer);
    expect(output.length).toBe(Math.floor(buffer.duration * SAMPLE_RATE));
    expect(records.length).toBe(3);
    // The independent expected signal is the mean of each pair of input
    // samples at 44.1 -> 22.05 kHz, including immediately around both seams.
    for (const time of [0, 3.9998, 4, 4.0001, 7.9998, 8, 8.0001, 8.129]) {
      const i = Math.floor(time * SAMPLE_RATE);
      const expected = (buffer.getChannelData(0)[i * 2] + buffer.getChannelData(0)[i * 2 + 1]) / 2;
      expect(output[i]).toBeCloseTo(expected, 7);
    }
    expect(records.every(record => record.frames <= 44100 * 4.05)).toBe(true);
    expect(records.every(record => record.source.buffer === null && record.source.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('bounds temporary high-rate output independently of total song length', async () => {
    const records = offline(), progress = vi.fn(), buffer = audio(96000, 12.1);
    const output = await prepareMono(buffer, { progress });
    expect(output.length).toBe(Math.floor(buffer.duration * SAMPLE_RATE));
    expect(records).toHaveLength(4);
    expect(Math.max(...records.map(record => record.frames))).toBeLessThanOrEqual(96000 * 4.05);
    expect(progress.mock.calls.map(call => call[0])).toEqual([0, ...[4, 8, 12].map(time => time / buffer.duration), 1]);
  });

  it('aborts the current render, disconnects nodes, and ignores late native completion', async () => {
    let complete: (buffer: AudioBuffer) => void;
    const records = offline(() => new Promise(resolve => { complete = resolve; }));
    const controller = new AbortController(), progress = vi.fn();
    const preparing = prepareMono(audio(48000, 9), { signal: controller.signal, progress });
    const failure = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await failure;
    expect(records).toHaveLength(1); expect(records[0].source.stop).toHaveBeenCalledOnce();
    expect(records[0].source.disconnect).toHaveBeenCalledOnce(); expect(records[0].source.buffer).toBeNull();
    expect(records[0].filters.every(filter => filter.disconnect.mock.calls.length === 1)).toBe(true);
    complete!(audio(48000, 4)); await Promise.resolve(); await Promise.resolve();
    expect(records).toHaveLength(1); expect(progress).toHaveBeenCalledTimes(1);
  });

  it('rejects an unresponsive native render after 45 seconds and cleans up', async () => {
    vi.useFakeTimers(); const records = offline(() => new Promise(() => {}));
    const preparing = prepareMono(audio(48000, 5)), failure = expect(preparing).rejects.toThrow(/45 秒没有响应/);
    await vi.advanceTimersByTimeAsync(45000); await failure;
    expect(records).toHaveLength(1); expect(records[0].source.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create a render or allocate work for a pre-cancelled request', async () => {
    const records = offline(), controller = new AbortController(); controller.abort();
    await expect(prepareMono(audio(48000, 5), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(records).toHaveLength(0);
  });

  it('yields between direct mixing windows so a page event can cancel the task', async () => {
    vi.stubGlobal('OfflineAudioContext', undefined);
    const controller = new AbortController(), progress = vi.fn(value => { if (value > 0) setTimeout(() => controller.abort(), 0); });
    await expect(prepareMono(audio(SAMPLE_RATE, 12, 2), { signal: controller.signal, progress })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress.mock.calls.filter(call => call[0] > 0)).toHaveLength(1);
  });

  it('keeps native low-rate interpolation in one uninterrupted render', async () => {
    const result = audio(SAMPLE_RATE, 8.3), records = offline(async () => result);
    expect(await prepareMono(audio(16000, 8.3))).toBe(result.getChannelData(0));
    expect(records).toHaveLength(1); expect(records[0].rate).toBe(SAMPLE_RATE); expect(records[0].filters).toHaveLength(0);
  });
});
