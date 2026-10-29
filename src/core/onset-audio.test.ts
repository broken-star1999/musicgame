import { describe, expect, it } from 'vitest';
import { analyzeAudio } from './analysis';
import { generateChart } from './chart';

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

export function layeredFixture() {
  const times = Array.from({ length: 120 }, (_, i) => 1 + i * 0.5), samples = new Float32Array(RATE * 62);
  for (const start of times) for (let j = 0; j < RATE * 0.14; j++) {
    const t = j / RATE;
    samples[Math.round(start * RATE) + j] += Math.sin(2 * Math.PI * 100 * t) * Math.exp(-t * 36) * Math.min(1, t * 800) * 0.25;
  }
  for (let note = 0; note < 150; note++) {
    const start = 0.3 + note * 0.4 + (note * 17 % 13) * 0.013;
    const frequency = 440 * 2 ** ((note * 7 % 17) / 12), volume = start < 20 ? 0.2 : start < 40 ? 0.6 : 0.85;
    for (let j = 0; j < RATE * 0.22 && Math.round(start * RATE) + j < samples.length; j++) {
      const t = j / RATE;
      let wave = 0;
      for (let harmonic = 1; harmonic <= 5; harmonic++) wave += Math.sin(2 * Math.PI * frequency * harmonic * t) / harmonic;
      samples[Math.round(start * RATE) + j] += wave * Math.min(1, t * 40) * Math.exp(-t * 12) * volume;
    }
  }
  return { samples, times };
}

describe('audio onset quality through sustained vibrato', () => {
  it('keeps a full minute of quieter drum timing when a louder irregular lead changes volume', () => {
    const { samples, times } = layeredFixture();
    const analysis = analyzeAudio(samples, RATE), chart = generateChart(analysis, 'one');
    const heads = chart.notes.map(note => note.time);
    const errors = times.map(time => Math.min(...heads.map(head => Math.abs(head - time))));
    for (const from of [0, 40, 80]) expect(errors.slice(from, from + 40).filter(error => error < 0.05).length).toBeGreaterThanOrEqual(38);
    const offbeat = heads.filter(head => !times.some(time => Math.abs(time - head) < 0.06));
    expect(offbeat.length).toBeLessThanOrEqual(3);
    const signed = (from: number) => times.slice(from, from + 40).map(time => heads.reduce((best, head) => Math.abs(head - time) < Math.abs(best - time) ? head : best, Infinity) - time).sort((a, b) => a - b)[20];
    expect(Math.abs(signed(80) - signed(0))).toBeLessThan(0.02);
  }, 15000);
  it('keeps drum attacks throughout the recording without transcribing continuous vibrato as extra taps', () => {
    const { samples, times } = vibratoFixture(), analysis = analyzeAudio(samples, RATE);
    const recall = times.filter(time => analysis.onsets.some(onset => Math.abs(onset.time - time) < 0.05)).length / times.length;
    const artifacts = analysis.onsets.filter(onset => onset.time > 0.8 && !times.some(time => Math.abs(onset.time - time) < 0.08));
    expect(recall).toBeGreaterThanOrEqual(0.95);
    expect(artifacts.length).toBeLessThanOrEqual(2);
  });
});
