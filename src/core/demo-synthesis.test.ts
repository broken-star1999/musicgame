import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_FRAMES, DEMO_SAMPLE_RATE, synthesizeDemo } from './demo-synthesis';

// Captured BEFORE extraction from the original createDemo on 2026-10-30.
// Old function SHA256: 15fd1945089dc5b4b3dfe635075207d7ea996ac51f6603caec6b38c96e51a102.
const ORIGINAL_PCM_SHA256 = '36a3f9421d456dfa9829efa25223785da2d90963699d2352522a30d791cf5aaf';
const digest = (data: Float32Array) => createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

afterEach(() => { vi.doUnmock('./audio-context'); vi.unstubAllGlobals(); });

describe('original demo PCM remains unchanged', () => {
  it('fills the caller PCM with the exact original full-song hash and timing', () => {
    const data = new Float32Array(DEMO_FRAMES), progress = vi.fn();
    synthesizeDemo(data, progress);
    expect(DEMO_SAMPLE_RATE).toBe(44100); expect(DEMO_FRAMES).toBe(2066085);
    expect(DEMO_FRAMES / DEMO_SAMPLE_RATE).toBe(46.85);
    expect(digest(data)).toBe(ORIGINAL_PCM_SHA256);
    const values = progress.mock.calls.map(([value]) => value);
    expect(values[0]).toBe(0); expect(values.at(-1)).toBe(1);
    expect(values.length).toBeGreaterThanOrEqual(25);
    values.forEach((value, index) => { expect(value).toBeGreaterThanOrEqual(index ? values[index - 1] : 0); expect(value).toBeLessThanOrEqual(1); });
  });

  it('reuses nonzero caller memory without mixing in stale samples or changing RNG order', () => {
    const data = new Float32Array(DEMO_FRAMES).fill(0.75);
    synthesizeDemo(data);
    expect(digest(data)).toBe(ORIGINAL_PCM_SHA256);
  });

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
    expect(digest(data)).toBe(ORIGINAL_PCM_SHA256);
  });

  it('rejects a wrong-size destination before modifying it', () => {
    const data = new Float32Array(4).fill(0.25);
    expect(() => synthesizeDemo(data)).toThrow(/长度无效/);
    expect([...data]).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});
