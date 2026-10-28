import { describe, expect, it } from 'vitest';
import { beatPosition, chartBeats, snapToBeat, timeAtBeat, trackBeats } from './rhythm';
import type { Analysis, Onset } from '../types';

const attacks = (times: number[]): Onset[] => times.map((time, i) => ({ time, strength: i % 4 === 0 ? 1 : 0.7, band: i % 4 === 0 ? 0 : 1 }));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('continuous beat tracking in audio time', () => {
  it('tracks 120 BPM after leading silence with supported four-beat accents', () => {
    const times = Array.from({ length: 32 }, (_, i) => 1.2 + i * 0.5), rhythm = trackBeats(attacks(times), 18, 120);
    expect(rhythm.beats[0]).toBeGreaterThanOrEqual(1.15);
    expect(rhythm.confidence).toBeGreaterThan(0.6);
    for (const time of times.slice(1, -1)) expect(Math.min(...rhythm.beats.map(beat => Math.abs(beat - time)))).toBeLessThan(0.035);
    expect(rhythm.downbeats.length).toBeGreaterThan(4);
    expect(median(rhythm.tempo.map(point => point.bpm))).toBeCloseTo(120, 0);
  });

  it('adapts from 120 to 150 BPM rather than extending a fixed grid', () => {
    const times = [...Array.from({ length: 20 }, (_, i) => 0.8 + i * 0.5), ...Array.from({ length: 24 }, (_, i) => 10.8 + i * 0.4)];
    const rhythm = trackBeats(attacks(times), 21, 120);
    expect(median(rhythm.tempo.filter(point => point.time < 8).map(point => point.bpm))).toBeCloseTo(120, 0);
    expect(median(rhythm.tempo.filter(point => point.time > 14).map(point => point.bpm))).toBeCloseTo(150, 0);
    for (const time of times.filter(time => time > 13 && time < 19)) expect(Math.min(...rhythm.beats.map(beat => Math.abs(beat - time)))).toBeLessThan(0.05);
  });

  it('keeps a pulse through missing drum hits and does not call uniform accents a known meter', () => {
    const times = Array.from({ length: 28 }, (_, i) => 0.5 + i * 0.5).filter((_, i) => i !== 10 && i !== 11);
    const rhythm = trackBeats(times.map(time => ({ time, strength: 1, band: 1 })), 15, 120);
    expect(rhythm.beats.some(time => Math.abs(time - 5.5) < 0.05)).toBe(true);
    expect(rhythm.meterConfidence).toBeLessThan(0.12); expect(rhythm.downbeats).toEqual([]);
  });

  it('has no invented beat evidence when too few attacks are available', () => expect(trackBeats(attacks([1, 2]), 4, 120).beats).toEqual([]));

  it('maps expressive recording times to beat coordinates and back', () => {
    const beats = [1, 1.5, 2, 2.4, 2.8];
    for (const time of [0.5, 1, 1.23, 2.21, 2.8, 3.4]) expect(timeAtBeat(beats, beatPosition(beats, time, 120), 120)).toBeCloseTo(time, 8);
    expect(snapToBeat(2.207, beats, 120)).toBeCloseTo(2.2);
    expect(snapToBeat(2.17, beats, 120)).toBe(2.17);
  });

  it('lets an explicit BPM correction replace the analysis grid without changing attacks', () => {
    const analysis = { duration: 6, bpm: 120, onsets: attacks([1, 1.5, 2]), rhythm: { beats: [1, 1.5, 2], confidence: 1 } } as Analysis;
    expect(chartBeats(analysis)).toEqual([1, 1.5, 2]);
    expect(chartBeats(analysis, 150).slice(0, 3)).toEqual([1, 1.4, 1.8]);
    expect(analysis.onsets.map(onset => onset.time)).toEqual([1, 1.5, 2]);
  });

  it('uses a conservative tempo reference when the tracked pulse is uncertain', () => {
    const analysis = { duration: 4, bpm: 120, onsets: attacks([1, 1.5, 2]), rhythm: { beats: [1, 1.7, 2.6], confidence: 0.2 } } as Analysis;
    expect(chartBeats(analysis).slice(0, 3)).toEqual([1, 1.5, 2]);
  });
});
