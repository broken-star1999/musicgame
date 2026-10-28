import { describe, expect, it } from 'vitest';
import { extractChroma } from './chroma';

describe('separate harmonic windows for phrase matching', () => {
  it('resolves stable C4 and F-sharp4 without changing the transient detector', () => {
    const rate = 22050, hop = 220;
    const samples = Float32Array.from({ length: rate * 3 }, (_, i) => {
      const frequency = i < rate * 1.5 ? 261.6256 : 369.9944, time = i / rate;
      return (Math.sin(2 * Math.PI * frequency * time) + 0.35 * Math.sin(4 * Math.PI * frequency * time)) * 0.4;
    });
    const rms = new Float64Array(Math.floor((samples.length - 1024) / hop) + 1).fill(0.4);
    const features = extractChroma(samples, rate, hop, rms);
    expect(features[20].indexOf(Math.max(...features[20]))).toBe(0);
    expect(features[45].indexOf(Math.max(...features[45]))).toBe(6);
    expect(Math.hypot(...features[20])).toBeCloseTo(1, 5);
  });

  it('keeps silent windows as zero evidence', () => {
    const features = extractChroma(new Float32Array(22050), 22050, 220, new Float64Array(90));
    expect(features.every(frame => frame.every(value => value === 0))).toBe(true);
  });
});
