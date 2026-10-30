import { describe, expect, it } from 'vitest';
import type { Analysis, Onset } from '../types';
import { followRhythmSource, periodicSupport } from './rhythm-source';
import { generateChart } from './chart';

const regular = (band: number, from = 0.6, to = 32, strength = 0.65) => Array.from({ length: Math.floor((to - from) / 0.5) + 1 }, (_, i) => ({ time: from + i * 0.5, strength, band }));
const irregular = (band: number, duration = 32): Onset[] => Array.from({ length: Math.floor(duration * 3) }, (_, i) => ({ time: 0.2 + i / 3 + (i * 17 % 13) * 0.013, strength: 0.7 + (i % 3) * 0.1, band }));

describe('one coherent rhythm source across a recording', () => {
  it('keeps quieter regular bass attacks while louder irregular midrange attacks change', () => {
    const low = regular(0, 0.6, 32, 0.4), mid = irregular(1), mixed = [...low, ...mid].sort((a, b) => a.time - b.time);
    const pulse = followRhythmSource([low, mid, []], mixed, 32);
    expect(pulse.sections.every(section => section.band === 'low')).toBe(true);
    expect(pulse.onsets).toEqual(low);
    expect(periodicSupport(low)).toBeGreaterThan(0.98);
  });
  it('can follow a middle-frequency piano rhythm without low-frequency drums', () => {
    const mid = regular(1);
    const pulse = followRhythmSource([[], mid, []], mid, 32);
    expect(pulse.onsets).toEqual(mid);
    expect(pulse.sections.every(section => section.band === 'mid')).toBe(true);
  });
  it('preserves measured attacks when the same rhythm part changes tempo', () => {
    const low = [...regular(0, 0.6, 15.6), ...Array.from({length:40},(_,i)=>({time:16.1+i*0.4,strength:0.8,band:0}))];
    const pulse = followRhythmSource([low, [], []], low, 33);
    expect(pulse.onsets).toEqual(low);
    expect(pulse.sections.every(section => section.band === 'low')).toBe(true);
  });
  it('changes source when the old part ends, preserves rests and never fills an invented beat', () => {
    const low = regular(0, 0.6, 11.6), high = regular(2, 20.6, 31.6);
    const pulse = followRhythmSource([low, [], high], [...low, ...high], 32);
    expect(pulse.onsets).toEqual([...low, ...high]);
    expect(pulse.sections[0].band).toBe('low');
    expect(pulse.sections.at(-1)!.band).toBe('high');
    expect(pulse.onsets.some(event => event.time > 12 && event.time < 20)).toBe(false);
  });
  it('retains expressive measured attacks when no isolated band is dependable', () => {
    const mixed = [{ time: 0.6, strength: 1, band: 0 }, { time: 1.337, strength: 0.6, band: 1 }, { time: 3.043, strength: 0.9, band: 2 }];
    const pulse = followRhythmSource([[], [], []], mixed, 5);
    expect(pulse.onsets).toEqual(mixed);
    expect(pulse.sections.every(section => section.band === 'mixed')).toBe(true);
  });
  it('is deterministic and keeps attack timing continuous through same-phase salience changes', () => {
    const low = regular(0), mid = regular(1).map(event => ({ ...event, strength: event.time >= 12 && event.time < 16 ? 1 : 0.55 }));
    const pulse = followRhythmSource([low, mid, []], [...low, ...mid].sort((a, b) => a.time - b.time), 32);
    expect(pulse).toEqual(followRhythmSource([low, mid, []], [...low, ...mid].sort((a, b) => a.time - b.time), 32));
    expect(new Set(pulse.sections.map(section => section.band)).size).toBe(1);
    expect(pulse.onsets.map(event => event.time)).toEqual(low.map(event => event.time));
    pulse.onsets.forEach(event => expect([...low, ...mid]).toContain(event));
  });
  it('keeps clear following beats in one-finger mode even with continuous tonal accompaniment', () => {
    const onsets = regular(0, 0.6, 7.6, 0.8);
    const analysis: Analysis = { duration: 9, bpm: 120, confidence: 1, fingerprint: 'steady-with-pad', onsets, pulse: { onsets, sections: [] }, energy: Array(200).fill(0.8), energyStep: 0.05, waveform: [], chroma: Array.from({length:200},()=>[1,...Array(11).fill(0)]), chromaStep:0.05 };
    const chart = generateChart(analysis, 'one');
    expect(chart.notes).toHaveLength(onsets.length);
    chart.notes.forEach((note, i) => expect(Math.abs(note.time - onsets[i].time)).toBeLessThanOrEqual(0.0181));
  });
});
