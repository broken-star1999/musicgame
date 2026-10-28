import { describe, expect, it } from 'vitest';
import type { Analysis, Chart, Note } from '../types';
import { reusePhraseTemplates } from './phrases';

function fixture(differentMelody = false) {
  const anchor = 0.2, length = 4, step = 0.05, duration = 13.3;
  const onsets = Array.from({ length: 24 }, (_, i) => ({ time: anchor + i * 0.5 + (i >= 8 ? [0.005, -0.004, 0.006, 0][i % 4] : 0), strength: 0.8, band: i % 8 % 3 }));
  const chroma = Array.from({ length: Math.ceil(duration / step) }, (_, frame) => {
    const time = frame * step, phrase = Math.max(0, Math.floor((time - anchor) / length));
    const phase = Math.max(0, Math.floor(((time - anchor) % length) / 0.5));
    const pitch = ([0, 4, 7, 4, 0, 5, 9, 5][phase] + (differentMelody ? phrase : 0)) % 12;
    return Array.from({ length: 12 }, (_, k) => k === pitch ? 1 : 0);
  });
  const analysis: Analysis = { duration, bpm: 120, confidence: 1, fingerprint: 'phrases', onsets, energy: Array(300).fill(0.7), energyStep: step, waveform: [], chroma, chromaStep: step };
  const types = ['tap', 'left', 'hold', 'tap', 'right', 'tap', 'up', 'tap'] as const;
  const notes: Note[] = onsets.map((onset, i) => ({ id: i, time: onset.time, lane: i < 8 ? i % 4 : 3 - i % 4, type: i < 8 ? types[i % 8] : 'tap', ...(i === 2 ? { endTime: onset.time + 0.65 } : {}) }));
  const chart: Chart = { version: 2, fingerprint: 'phrases', difficulty: 'normal', duration, bpm: 120, notes };
  return { analysis, chart };
}

describe('similar phrases reuse playable key templates', () => {
  it('reuses lanes/actions while keeping each occurrence’s actual audio times', () => {
    const { analysis, chart } = fixture();
    const output = reusePhraseTemplates(analysis, chart, 3);
    expect(output.repetition?.reused).toBe(2);
    const source = output.notes.slice(0, 8).map(n => [n.lane, n.type]);
    expect(output.notes.slice(8, 16).map(n => [n.lane, n.type])).toEqual(source);
    expect(output.notes.slice(16, 24).map(n => [n.lane, n.type])).toEqual(source);
    output.notes.forEach((note, i) => expect(note.time).toBe(analysis.onsets[i].time));
    expect(output.notes[10].endTime! - output.notes[10].time).toBeCloseTo(0.65);
    expect(output).toEqual(reusePhraseTemplates(analysis, chart, 3));
  });

  it('does not treat identical drum timing as an identical melody', () => {
    const { analysis, chart } = fixture(true);
    expect(reusePhraseTemplates(analysis, chart, 3).repetition?.reused).toBe(0);
  });

  it('requires tonal evidence and falls back safely without chroma', () => {
    const { analysis, chart } = fixture();
    expect(reusePhraseTemplates({ ...analysis, chroma: undefined }, chart, 3).notes).toEqual(chart.notes);
    expect(reusePhraseTemplates({ ...analysis, chroma: analysis.chroma!.map(() => Array(12).fill(0)) }, chart, 3).repetition?.reused).toBe(0);
  });

  it('rejects a template that would collide with a hold from the preceding phrase', () => {
    const { analysis, chart } = fixture();
    chart.notes[7] = { ...chart.notes[7], lane: 0, type: 'hold', endTime: 4.4 };
    const output = reusePhraseTemplates(analysis, chart, 3);
    expect(output.notes.find(n => Math.abs(n.time - analysis.onsets[8].time) < 0.01)?.lane).toBe(chart.notes[8].lane);
    const ends = [-100, -100, -100, -100];
    for (const note of output.notes) { expect(note.time - ends[note.lane]).toBeGreaterThanOrEqual(0.1); ends[note.lane] = note.endTime || note.time; }
  });
});
