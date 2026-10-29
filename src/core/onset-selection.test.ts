import { describe, expect, it } from 'vitest';
import { selectMusicalOnsets } from './onset-selection';
import { generateChart } from './chart';
import type { Analysis, Onset } from '../types';

const onset = (time: number, strength: number): Onset => ({ time, strength, band: 0 });
describe('salient musical attacks survive density reduction', () => {
  it('keeps a quiet learned beat ahead of a louder ornament while thinning higher modes', () => {
    const events: Onset[] = [{ time: 1, strength: 0.09, band: 0, role: 'beat' }, { time: 1.1, strength: 1, band: 1, role: 'half' }, { time: 1.5, strength: 0.1, band: 0, role: 'beat' }];
    expect(selectMusicalOnsets(events, 0.23, 0.16).map(value => value.time)).toEqual([1, 1.5]);
    expect(selectMusicalOnsets(events, 0.08, 0.08)).toEqual(events);
  });
  it('keeps a clear beat instead of the weak attack immediately before it', () => {
    const events = Array.from({ length: 16 }, (_, i) => [onset(1 + i * 0.5 - 0.12, 0.25), onset(1 + i * 0.5, 1)]).flat();
    expect(selectMusicalOnsets(events, 0.23, 0.16).map(value => value.time)).toEqual(Array.from({ length: 16 }, (_, i) => 1 + i * 0.5));
    const analysis: Analysis = { duration: 10, bpm: 120, confidence: 0, fingerprint: 'weak-pickups', onsets: events, energy: [], energyStep: 0.05, waveform: [], rhythm: { beats: [], tempo: [], confidence: 0, downbeats: [], meterConfidence: 0 } };
    for (const mode of ['one', 'two', 'three'] as const) {
      const chart = generateChart(analysis, mode);
      expect(new Set(chart.notes.map(note => note.time))).toEqual(new Set(Array.from({ length: 16 }, (_, i) => 1 + i * 0.5)));
    }
  });
  it('prefers a strong center to two weak neighbors and keeps genuine offbeats when there is room', () => {
    expect(selectMusicalOnsets([onset(1, 0.2), onset(1.15, 1), onset(1.3, 0.2), onset(1.65, 0.6)], 0.23, 0.1).map(value => value.time)).toEqual([1.15, 1.65]);
    expect(selectMusicalOnsets([onset(1, 1), onset(1.25, 0.8), onset(1.5, 1)], 0.23, 0.1)).toHaveLength(3);
  });
  it('uses final snapped spacing without changing original timestamps or input order', () => {
    const events = [onset(1.249, 1), onset(1.01, 0.3), onset(1.5, 0.8)], copy = structuredClone(events);
    const selected = selectMusicalOnsets(events, 0.24, 0.1, event => Math.round(event.time * 4) / 4);
    expect(selected.map(event => event.time)).toEqual([1.01, 1.249, 1.5]);
    expect(events).toEqual(copy);
  });
  it('is deterministic and retains no selected attacks within the minimum spacing', () => {
    const events = Array.from({ length: 200 }, (_, i) => onset(i * 0.09, 0.1 + (i * 13 % 19) / 20));
    const selected = selectMusicalOnsets(events, 0.23, 0.2);
    expect(selected).toEqual(selectMusicalOnsets(events, 0.23, 0.2));
    selected.forEach((value, i) => { expect(events).toContain(value); if (i) expect(value.time - selected[i - 1].time).toBeGreaterThanOrEqual(0.23); });
  });
});
