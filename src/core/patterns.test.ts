import { describe, expect, it } from 'vitest';
import { phrasePattern, phraseSwipe, sustainedEnd } from './patterns';
import type { Analysis } from '../types';

const analysis: Analysis = { bpm: 120, duration: 10, confidence: 1, fingerprint: 'motif', onsets: Array.from({ length: 16 }, (_, i) => ({ time: i * 0.5, strength: 0.7, band: 0 })), energy: Array.from({ length: 200 }, (_, i) => i < 25 ? 0.8 : 0), energyStep: 0.05, waveform: [], chromaStep: 0.05, chroma: Array.from({ length: 200 }, () => [1, ...Array(11).fill(0)]) };

describe('musically organized phrase vocabulary', () => {
  it('can use both horizontal directions on whole-beat rhythms without tonal movement', () => {
    expect(phraseSwipe({ ...analysis, chroma: undefined }, 1, 1)).toBe('right');
    expect(phraseSwipe({ ...analysis, chroma: undefined }, 1, 2)).toBe('left');
    expect(phraseSwipe({ ...analysis, chroma: undefined }, 1, 0)).toBe('up');
  });
  it('gives matching rhythms the same phrase vocabulary across different recording positions', () => {
    const beats = Array.from({ length: 21 }, (_, i) => i * 0.5);
    const first = Array.from({ length: 8 }, (_, i) => phrasePattern(analysis, beats, 120, i * 0.5, 3));
    const repeated = Array.from({ length: 8 }, (_, i) => phrasePattern(analysis, beats, 120, 4 + i * 0.5, 3));
    expect(repeated).toEqual(first);
    expect(new Set(first.map(value => value.lane)).size).toBeGreaterThan(2);
  });

  it('uses neighboring lanes for single-finger motifs', () => {
    const beats = Array.from({ length: 21 }, (_, i) => i * 0.5);
    for (let i = 0; i < 16; i++) expect([1, 2]).toContain(phrasePattern(analysis, beats, 120, i * 0.25, 1).lane);
  });

  it('ends a sustain at the observed energy drop rather than a randomly chosen duration', () => {
    expect(sustainedEnd(analysis, 0, 0.5)).toBeCloseTo(1.2, 3);
    expect(sustainedEnd(analysis, 1, 0.5)).toBeUndefined();
  });

  it('does not mistake loud unpitched energy for a sustained tonal event', () => {
    expect(sustainedEnd({ ...analysis, chroma: analysis.chroma!.map(() => Array(12).fill(0)) }, 0, 0.5)).toBeUndefined();
  });
});
