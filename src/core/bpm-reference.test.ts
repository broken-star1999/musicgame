import { describe, expect, it } from 'vitest';
import type { Analysis } from '../types';
import { resolveBpmReference } from './bpm-reference';
import { chartBeats } from './rhythm';
import { generateChart } from './chart';
import { annotateSignalEvents } from './signal-events';

const beats = [...Array.from({ length: 12 }, (_, i) => 1 + i * 0.5), ...Array.from({ length: 12 }, (_, i) => 7 + i * 0.4)];
const analysis: Analysis = {
  fingerprint: 'variable-bpm-reference', duration: 13, bpm: 128, confidence: 0.8,
  onsets: beats.map(time => ({ time, strength: 0.9, band: 0 })), energy: Array(130).fill(0.5), energyStep: 0.1, waveform: [],
  rhythm: { beats, tempo: [], confidence: 0.8, downbeats: [], meterConfidence: 0 },
};

describe('manual BPM reference preserves automatic local timing until edited', () => {
  it('regenerates an unchanged BPM against the original variable beat map', () => {
    const reference = resolveBpmReference('128', analysis.bpm);
    expect(reference).toBeUndefined(); expect(chartBeats(analysis, reference)).toBe(beats);
    expect(generateChart(analysis, 'one', reference)).toEqual(generateChart(analysis, 'one'));
  });
  it('uses an explicitly edited fixed reference and restores the original chart after reverting', () => {
    const manual = resolveBpmReference('140', analysis.bpm), grid = chartBeats(analysis, manual);
    expect(manual).toBe(140); expect(grid === beats).toBe(false);
    expect(grid[1] - grid[0]).toBeCloseTo(60 / 140, 8);
    const restored = resolveBpmReference(String(analysis.bpm), analysis.bpm);
    expect(chartBeats(analysis, restored)).toBe(beats);
    expect(generateChart(analysis, 'two', restored)).toEqual(generateChart(analysis, 'two'));
  });
  it.each(['', ' ', 'NaN', 'Infinity', '0', '29.9', '300.1'])('rejects invalid input %j', draft => {
    expect(() => resolveBpmReference(draft, analysis.bpm)).toThrow(/30～300/);
  });
  it.each([30, 300, 127.5])('accepts a valid explicitly edited reference %s', bpm => {
    expect(resolveBpmReference(String(bpm), analysis.bpm)).toBe(bpm);
  });
  it('reclassifies automatic DSP roles when the fixed manual tempo changes', () => {
    const times = Array.from({ length: 9 }, (_, i) => 1 + i * 0.25);
    const pulse = times.map(time => ({ time, strength: 0.1, band: 0 }));
    const auto = annotateSignalEvents({ ...analysis, duration: 5, onsets: pulse, pulse: { onsets: pulse, sections: [] }, rhythm: { ...analysis.rhythm!, beats: [1, 1.5, 2, 2.5, 3] } });
    expect(generateChart(auto, 'one').notes.some(note => note.time === 1.75)).toBe(false);
    const fixed = generateChart(auto, 'one', 80);
    expect(fixed.notes.some(note => note.time === 1.75)).toBe(true);
    expect(fixed.notes.every(note => times.some(time => Math.abs(time - note.time) <= 0.0181))).toBe(true);
    expect(auto.pulse!.onsets.find(event => event.time === 1.75)?.role).toBe('half');
  });
});
