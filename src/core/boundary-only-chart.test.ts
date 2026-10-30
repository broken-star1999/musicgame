import { describe, expect, it } from 'vitest';
import type { Analysis, Difficulty } from '../types';
import { generateChart } from './chart';

function sparseAnalysis(regularStrength = .05): Analysis {
  const onsets: Analysis['onsets'] = [
    { time: 1024 * .22 / 22050, strength: 1, band: 2, boundary: true },
    { time: 5, strength: .05, band: 1 },
    { time: 10, strength: regularStrength, band: 1 },
    { time: 15, strength: .05, band: 1 },
  ];
  return {
    duration: 21, bpm: 120, confidence: 0, fingerprint: 'sparse-with-opening-cue',
    onsets, candidates: onsets, pulse: { onsets, sections: [] },
    rhythm: { beats: [], tempo: [], confidence: 0, downbeats: [], meterConfidence: 0 },
    energy: [], energyStep: .05, waveform: [],
  };
}

const modes: Difficulty[] = ['one', 'two', 'three', 'four'];

describe('a recording boundary cannot be the entire playable chart', () => {
  it.each(modes)('rejects %s mode when only the unconfirmed opening cue survives selection', mode => {
    expect(() => generateChart(sparseAnalysis(), mode)).toThrow(/没有足够清晰的起音/);
  });

  it.each(modes)('preserves the opening cue alongside a real selected attack in %s mode', mode => {
    const analysis = sparseAnalysis(.7), chart = generateChart(analysis, mode);
    expect(chart.notes.some(note => note.time === analysis.onsets[0].time)).toBe(true);
    expect(chart.notes.some(note => note.time === 10)).toBe(true);
    expect(chart.fingering?.checked).toBe(true);
  });
});
