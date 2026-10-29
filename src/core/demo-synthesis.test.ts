import { Buffer } from 'node:buffer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_FRAMES, DEMO_SAMPLE_RATE, synthesizeDemo } from './demo-synthesis';
import { createDemo as createLegacyDemo } from './test-fixtures/demo-e122c16';

// Every byte is compared with the historical function in this runtime. The
// recorded Windows/Node24 hash is provenance only, not a cross-platform golden.
const pcmBytes = (data: Float32Array) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
let reference: Float32Array;
// Full 46.85s synthesis has a larger budget on shared CI; lifecycle tests do not.
beforeAll(() => { reference = createLegacyDemo().getChannelData(0); }, 30000);

afterEach(() => { vi.doUnmock('./audio-context'); vi.unstubAllGlobals(); });

describe('original demo PCM remains unchanged', () => {
  it('fills the caller PCM byte-for-byte like the historical implementation in the same runtime', () => {
    const data = new Float32Array(DEMO_FRAMES), progress = vi.fn();
    synthesizeDemo(data, progress);
    expect(DEMO_SAMPLE_RATE).toBe(44100); expect(DEMO_FRAMES).toBe(2066085);
    expect(DEMO_FRAMES / DEMO_SAMPLE_RATE).toBe(46.85);
    expect(pcmBytes(data).equals(pcmBytes(reference))).toBe(true);
    const values = progress.mock.calls.map(([value]) => value);
    expect(values[0]).toBe(0); expect(values.at(-1)).toBe(1);
    expect(values.length).toBeGreaterThanOrEqual(25);
    values.forEach((value, index) => { expect(value).toBeGreaterThanOrEqual(index ? values[index - 1] : 0); expect(value).toBeLessThanOrEqual(1); });
  }, 30000);

  it('reuses nonzero caller memory without mixing in stale samples or changing RNG order', () => {
    const data = new Float32Array(DEMO_FRAMES).fill(0.75);
    synthesizeDemo(data);
    expect(pcmBytes(data).equals(pcmBytes(reference))).toBe(true);
  }, 30000);

  it('keeps the synchronous API writing directly into its AudioBuffer channel', async () => {
    vi.resetModules();
    const data = new Float32Array(DEMO_FRAMES), getChannelData = vi.fn(() => data);
    const buffer = { sampleRate: DEMO_SAMPLE_RATE, length: DEMO_FRAMES, duration: 46.85, getChannelData };
    const createBuffer = vi.fn(() => buffer);
    vi.doMock('./audio-context', () => ({ audioContext: () => ({ createBuffer }) }));
    const { createDemo } = await import('./audio');
    expect(createDemo()).toBe(buffer);
    expect(createBuffer).toHaveBeenCalledExactlyOnceWith(1, DEMO_FRAMES, DEMO_SAMPLE_RATE);
    expect(getChannelData).toHaveBeenCalledExactlyOnceWith(0);
    expect(pcmBytes(data).equals(pcmBytes(reference))).toBe(true);
  }, 30000);

  it('rejects a wrong-size destination before modifying it', () => {
    const data = new Float32Array(4).fill(0.25);
    expect(() => synthesizeDemo(data)).toThrow(/长度无效/);
    expect([...data]).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});
