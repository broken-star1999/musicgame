import { describe, expect, it } from 'vitest';
import { analyzeAudio } from './analysis';

const RATE = 22050;
export function vibratoFixture() {
  const times = Array.from({ length: 20 }, (_, i) => 1 + i * 0.5), samples = new Float32Array(RATE * 12);
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / RATE;
    phase += 2 * Math.PI * 440 * 2 ** (0.45 * Math.sin(time * 2 * Math.PI * 6) / 12) / RATE;
    if (time >= 0.6 && time < 11.5) {
      const envelope = Math.min(1, (time - 0.6) * 40, (11.5 - time) * 10);
      for (let harmonic = 1; harmonic <= 7; harmonic++) samples[i] += Math.sin(phase * harmonic) * envelope * 0.12 / harmonic;
    }
  }
  for (const start of times) for (let j = 0; j < RATE * 0.12; j++) {
    const time = j / RATE;
    samples[Math.round(start * RATE) + j] += Math.sin(2 * Math.PI * 100 * time) * Math.exp(-time * 45) * Math.min(1, time * 1000) * 0.8;
  }
  return { samples, times };
}

describe('audio onset quality through sustained vibrato', () => {
  it('keeps drum attacks throughout the recording without transcribing continuous vibrato as extra taps', () => {
    const { samples, times } = vibratoFixture(), analysis = analyzeAudio(samples, RATE);
    const recall = times.filter(time => analysis.onsets.some(onset => Math.abs(onset.time - time) < 0.05)).length / times.length;
    const artifacts = analysis.onsets.filter(onset => onset.time > 0.8 && !times.some(time => Math.abs(onset.time - time) < 0.08));
    expect(recall).toBeGreaterThanOrEqual(0.95);
    expect(artifacts.length).toBeLessThanOrEqual(2);
  });
});
