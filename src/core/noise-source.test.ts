import { describe, expect, it } from 'vitest';
import { analyzeAudio } from './analysis';
import { generateChart } from './chart';

const RATE = 22050;

function stationaryNoise(): Float32Array {
  const samples = new Float32Array(21 * RATE);
  let state = 101;
  for (let i = 0; i < samples.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    samples[i] = .008 * ((state >>> 0) / 4294967296 * 2 - 1);
  }
  return samples;
}

describe('abstaining when no rhythm source has support', () => {
  it('rejects stationary noise whose low-band fluctuations have no supported source', () => {
    expect(() => analyzeAudio(stationaryNoise(), RATE)).toThrow(/没有找到足够的声音起点/);
  });

  it('preserves quiet audible drum attacks over the same noise floor', () => {
    const samples = stationaryNoise();
    const truth = Array.from({ length: 32 }, (_, i) => 1.2 + i * .5);
    for (const time of truth) {
      const start = Math.round(time * RATE);
      for (let i = 0; i < Math.floor(RATE * .12); i++) {
        const t = i / RATE;
        samples[start + i] += .02 * Math.sin(2 * Math.PI * 100 * t)
          * Math.min(1, t * 1000) * Math.exp(-45 * t);
      }
    }
    const analysis = analyzeAudio(samples, RATE);
    const chart = generateChart(analysis, 'one');
    for (const time of truth) {
      expect(chart.notes.some(note => Math.abs(note.time - time) <= .05)).toBe(true);
    }
  });
});
