import { describe, expect, it } from 'vitest';
import type { Analysis, Onset } from '../types';
import { annotateSignalEvents } from './signal-events';
import { generateChart } from './chart';
import { analyzeAudio } from './analysis';

const onset = (time: number, strength = 0.2, band = 0): Onset => ({ time, strength, band });
function analysis(pulse: Onset[], beats = [1, 1.5, 2, 2.5, 3]): Analysis {
  return { duration: 5, bpm: 120, confidence: 0.1, fingerprint: 'signal-roles', onsets: pulse,
    pulse: { onsets: pulse, sections: [{ start: 0, end: 5, band: 'low', support: 0.2 }] },
    candidates: [...pulse], energy: [], energyStep: 0.05, waveform: [],
    rhythm: { beats, tempo: [], confidence: 0.1, downbeats: [], meterConfidence: 0 } };
}

describe('selected-source DSP attack roles', () => {
  it('retains weak primary attacks instead of louder nearby ornaments in actual low-finger charts', () => {
    const beats = [1, 1.5, 2, 2.5, 3];
    const original = analysis(beats.flatMap(time => [onset(time, 0.09), onset(time + 0.1, 1)]), beats);
    const annotated = annotateSignalEvents(original);
    expect(annotated.pulse!.onsets.filter(event => event.role === 'beat').map(event => event.time)).toEqual(beats);
    for (const difficulty of ['one', 'two'] as const) {
      const before = generateChart(original, difficulty), after = generateChart(annotated, difficulty);
      const matches = (times: number[]) => beats.filter(time => times.some(at => Math.abs(time - at) < 0.05)).length;
      expect(matches(before.notes.map(note => note.time))).toBe(0);
      expect(matches(after.notes.map(note => note.time))).toBe(beats.length);
      expect(after.notes.every(note => original.pulse!.onsets.some(event => event.time === note.time))).toBe(true);
    }
  });

  it('adds only role metadata while preserving every original time, event field and analysis array', () => {
    const pulse = [onset(0.3, 0.5), { ...onset(1.0173529, 0.2), attack: 0.7 }, onset(1.19, 0.9), onset(1.52), onset(2.02), onset(3.8, 0.8)];
    const original = analysis(pulse), before = structuredClone(original);
    const annotated = annotateSignalEvents(original);
    expect(original).toEqual(before);
    expect(annotated.pulse!.onsets).toHaveLength(pulse.length);
    expect(annotated.pulse!.onsets.map(event => event.time)).toEqual(pulse.map(event => event.time));
    annotated.pulse!.onsets.forEach((event, i) => {
      const { role: _role, ...actual } = event;
      expect(actual).toEqual(pulse[i]);
    });
    expect(annotated.onsets).toBe(original.onsets); expect(annotated.candidates).toBe(original.candidates);
    expect(annotated.rhythm).toBe(original.rhythm); expect(annotated.energy).toBe(original.energy);
    expect(annotated.pulse!.sections).toBe(original.pulse!.sections);
    expect(annotated.pulse!.onsets.find(event => event.time === 1.0173529)?.role).toBe('beat');
    expect(annotated.pulse!.onsets.find(event => event.time === 1.19)).toBe(pulse[2]);
    expect(annotated.pulse!.onsets.find(event => event.time === 1.19)?.role).toBeUndefined();
    expect(annotated.pulse!.onsets.some(event => event.role === 'free')).toBe(false);
  });

  it('classifies existing half/quarter attacks against the DSP rhythm', () => {
    const pulse = [1, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875, 2].map(time => onset(time, 0.5));
    const annotated = annotateSignalEvents(analysis(pulse, [1, 1.5, 2]));
    expect(annotated.pulse!.onsets.map(event => event.role)).toEqual(['beat', 'quarter', 'half', 'quarter', 'beat', 'quarter', 'half', 'quarter', 'beat']);
  });

  it('requires three measured primary attacks even when many hypothetical grid beats exist', () => {
    const original = analysis([onset(1), onset(1.25), onset(1.5), onset(1.75), onset(3.8)]);
    expect(annotateSignalEvents(original)).toBe(original);
    expect(original.pulse!.onsets.every(event => event.role === undefined)).toBe(true);
  });

  it('does not borrow a louder or closer candidate from another band', () => {
    const pulse = [onset(1.02, 0.09, 0), onset(1.52, 0.09, 0), onset(2.02, 0.09, 0)];
    const original = analysis(pulse, [1, 1.5, 2]);
    original.candidates = [onset(1, 1, 2), onset(1.5, 1, 2), onset(2, 1, 2)];
    const annotated = annotateSignalEvents(original);
    expect(annotated.pulse!.onsets.map(event => ({ time: event.time, band: event.band, role: event.role })))
      .toEqual(pulse.map(event => ({ time: event.time, band: 0, role: 'beat' })));
    expect(annotated.candidates).toBe(original.candidates);
  });

  it('keeps valid bindings despite zero global confidence without relabeling the engine', () => {
    const original = analysis([onset(1), onset(1.5), onset(2)]);
    original.confidence = 0; original.rhythm!.confidence = 0;
    const annotated = annotateSignalEvents(original);
    expect(annotated.pulse!.onsets.every(event => event.role === 'beat')).toBe(true);
    expect(annotated.confidence).toBe(0); expect(annotated.rhythm!.confidence).toBe(0);
    expect(annotated.recognition).toBeUndefined();
  });

  it('leaves absent or insufficient timing evidence unchanged', () => {
    const noPulse = { ...analysis([onset(1), onset(1.5), onset(2)]), pulse: undefined };
    const noRhythm = { ...analysis([onset(1), onset(1.5), onset(2)]), rhythm: undefined };
    const emptyClock = analysis([onset(1), onset(1.5), onset(2)], []);
    const belowThreshold = analysis([onset(1, 0.01), onset(1.5, 0.01), onset(2, 0.01)]);
    for (const original of [noPulse, noRhythm, emptyClock, belowThreshold]) expect(annotateSignalEvents(original)).toBe(original);
  });

  it('does not count a boundary as the third measured beat or let it steal a real attack', () => {
    const opening: Onset = { ...onset(1, 1), boundary: true };
    const short = analysis([opening, onset(1.5), onset(2)], [1, 1.5, 2]);
    expect(annotateSignalEvents(short)).toBe(short);
    const regular = [onset(1.02, 0.09), onset(1.5, 0.09), onset(2, 0.09)];
    const annotated = annotateSignalEvents(analysis([opening, ...regular], [1, 1.5, 2]));
    expect(annotated.pulse!.onsets[0]).toBe(opening);
    expect(annotated.pulse!.onsets[0].role).toBeUndefined();
    expect(annotated.pulse!.onsets.slice(1).every(event => event.role === 'beat')).toBe(true);
    expect(annotated.pulse!.onsets.map(event => event.time)).toEqual([1, 1.02, 1.5, 2]);
  });

  it('attaches signal roles at the end of actual PCM analysis without adding attacks', () => {
    const rate = 22050, truth = Array.from({ length: 16 }, (_, i) => 0.8 + i * 0.5);
    const pcm = new Float32Array(rate * 10);
    for (const time of truth) for (let i = 0; i < rate * 0.12; i++) {
      const t = i / rate;
      pcm[Math.round(time * rate) + i] += Math.sin(2 * Math.PI * 100 * t) * Math.exp(-t * 45) * Math.min(1, t * 1000);
    }
    const result = analyzeAudio(pcm, rate);
    expect(result.pulse!.onsets.filter(event => event.role === 'beat').length).toBeGreaterThanOrEqual(3);
    expect(result.pulse!.onsets).toHaveLength(truth.length);
    for (const event of result.pulse!.onsets) expect(Math.min(...truth.map(time => Math.abs(time - event.time)))).toBeLessThan(0.05);
    expect(result.recognition).toBeUndefined();
  });
});
