import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTIES, generateChart } from './chart';
import { fingerReleaseTime, isPlayableChart, peakFingers } from './chart-constraints';
import { loadSettings, saveSettings } from './storage';
import type { Analysis, Note } from '../types';

const analysis: Analysis = {
  fingerprint: 'finger-limits', bpm: 120, duration: 50, confidence: 1,
  onsets: Array.from({ length: 240 }, (_, i) => ({ time: 0.5 + i * 0.2, strength: i % 4 === 0 ? 1 : 0.6, band: i % 3 })),
  energy: Array(1000).fill(0.7), energyStep: 0.05, waveform: [],
};
const note = (lane: number, time: number, type: Note['type'] = 'tap', endTime?: number): Note => ({ id: lane, lane, time, type, ...(endTime !== undefined ? { endTime } : {}) });

describe('finger difficulty matches the generated music chart', () => {
  it.each(['one', 'two', 'three', 'four'] as const)('generates a deterministic, beat-aligned %s chart within its finger budget', difficulty => {
    const chart = generateChart(analysis, difficulty), max = DIFFICULTIES[difficulty].max;
    expect(chart).toEqual(generateChart(analysis, difficulty));
    expect(chart).toMatchObject({ version: 6, difficulty, fingerLimit: max, fingering: { checked: true } });
    expect(isPlayableChart(chart.notes, max, chart.duration)).toBe(true);
    expect(peakFingers(chart.notes)).toBe(max);
    for (const n of chart.notes) expect(Math.min(...analysis.onsets.map(onset => Math.abs(onset.time - n.time)))).toBeLessThan(0.0251);
  });

  it('makes the one-finger timeline sequential through holds and swipes', () => {
    const chart = generateChart(analysis, 'one');
    expect(chart.notes.some(n => n.type === 'hold')).toBe(true);
    for (let i = 1; i < chart.notes.length; i++) expect(chart.notes[i].time).toBeGreaterThanOrEqual(fingerReleaseTime(chart.notes[i - 1]) - 1e-6);
  });

  it('counts held fingers together with a simultaneous chord', () => {
    const notes = [note(0, 1, 'hold', 3), note(1, 2), note(2, 2)];
    expect(peakFingers(notes)).toBe(3);
    expect(isPlayableChart(notes, 2, 5)).toBe(false);
    expect(isPlayableChart(notes, 3, 5)).toBe(true);
  });

  it('reserves time to finish gestures instead of only comparing identical timestamps', () => {
    expect(isPlayableChart([note(0, 1, 'right'), note(1, 1.1)], 1, 5)).toBe(false);
    expect(isPlayableChart([note(0, 1, 'hold', 2), note(1, 2.05)], 1, 5)).toBe(false);
    expect(isPlayableChart([note(0, 1), note(1, 1.1)], 1, 5)).toBe(true);
  });
});

describe('persisted finger-mode settings and legacy migration', () => {
  it.each([
    ['one', 'one'], ['two', 'two'], ['three', 'three'], ['four', 'four'],
    ['easy', 'two'], ['normal', 'three'], ['hard', 'four'],
    ['invalid', 'two'], ['toString', 'two'], [null, 'two'],
  ])('loads %s as %s and preserves the other settings', (stored, expected) => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ difficulty: stored, speed: 7, vibration: false }), setItem });
    try {
      const settings = loadSettings();
      expect(settings).toMatchObject({ difficulty: expected, speed: 7, vibration: false });
      saveSettings(settings);
      expect(JSON.parse(setItem.mock.calls[0][1]).difficulty).toBe(expected);
    } finally { vi.unstubAllGlobals(); }
  });
});
