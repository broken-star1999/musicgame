import { describe, expect, it } from 'vitest';
import { analyzeAudio } from './analysis';
import { generateChart } from './chart';

const RATE = 22050;
function kick(samples: Float32Array, time: number, amplitude: number, frequency = 100) {
  const start = Math.round(time * RATE);
  for (let i = 0; i < Math.floor(RATE * .12); i++) {
    const t = i / RATE;
    samples[start + i] += amplitude * Math.sin(2 * Math.PI * frequency * t) * Math.min(1, t * 1000) * Math.exp(-45 * t);
  }
}
function song(amplitudes: number[], background?: 'noise' | 'vibrato') {
  const truth = amplitudes.map((_, i) => 1.2 + i * .5);
  const samples = new Float32Array(Math.ceil(truth.at(-1)! + 4) * RATE);
  if (background) {
    let state = 101;
    for (let i = 0; i < samples.length; i++) {
      const time = i / RATE;
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      samples[i] = background === 'noise' ? .008 * ((state >>> 0) / 4294967296 * 2 - 1)
        : .006 * Math.sin(2 * Math.PI * (440 * time + .4 * Math.sin(2 * Math.PI * 5 * time)));
    }
  }
  truth.forEach((time, i) => kick(samples, time, amplitudes[i]));
  return { samples, truth };
}
function expectAttacks(samples: Float32Array, truth: number[]) {
  const analysis = analyzeAudio(samples, RATE), chart = generateChart(analysis, 'one');
  for (const stage of [analysis.onsets, analysis.pulse!.onsets, chart.notes]) {
    expect(stage).toHaveLength(truth.length);
    for (const time of truth) expect(Math.min(...stage.map(event => Math.abs(event.time - time)))).toBeLessThan(.05);
    for (const event of stage) expect(Math.min(...truth.map(time => Math.abs(event.time - time)))).toBeLessThan(.05);
  }
}

describe('quiet passages after or before louder music', () => {
  it.each([.1, .02])('retains actual drum attacks after an amplitude change to %f', gain => {
    const { samples, truth } = song(Array.from({ length: 24 }, (_, i) => i < 12 ? 1 : gain));
    expectAttacks(samples, truth);
  });

  it('retains a quiet opening when a later passage is fifty times louder', () => {
    const { samples, truth } = song(Array.from({ length: 24 }, (_, i) => i < 12 ? .02 : 1));
    expectAttacks(samples, truth);
  });

  it('keeps quiet beats on both sides of a brief loud accent', () => {
    const { samples, truth } = song(Array.from({ length: 48 }, (_, i) => i < 24 ? 1 : .02));
    kick(samples, truth[34], 1, 1000);
    expectAttacks(samples, truth);
  });

  it.each(['noise', 'vibrato'] as const)('does not turn sustained %s after the drums into extra playable beats', background => {
    const { samples, truth } = song(Array(24).fill(1), background);
    const analysis = analyzeAudio(samples, RATE);
    for (const mode of ['one', 'four'] as const) {
      const chart = generateChart(analysis, mode);
      expect(chart.notes.some(note => note.time > truth.at(-1)! + .1)).toBe(false);
      for (const time of truth) expect(Math.min(...chart.notes.map(note => Math.abs(note.time - time)))).toBeLessThan(.05);
    }
  });

  it('keeps the existing silence rejection for inaudibly small waveforms', () => {
    const { samples } = song(Array(24).fill(.0001));
    expect(() => analyzeAudio(samples, RATE)).toThrow(/静音/);
  });
});
