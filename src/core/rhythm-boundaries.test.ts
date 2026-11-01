import { describe, expect, it } from 'vitest';
import { trackBeats, trimClockTail } from './rhythm';
import { gateClockEvidence } from './phase-gate';
import { investigateTempo } from './tempo-families';
import type { Onset } from '../types';

const attacks = (times: number[], strength = 1): Onset[] => times.map(time => ({ time, strength, band: 0 }));

describe('clock evidence boundaries', () => {
  it('includes the exact 80 ms boundary and excludes a later frame', () => {
    const path = [7, 32, 57, 82];
    trimClockTail(path, attacks([.49]));
    expect(path).toEqual([7, 32, 57]);
    const outside = [7, 32, 57];
    trimClockTail(outside, attacks([.489999]));
    expect(outside).toEqual([7, 32]);
  });

  it('ends at the last supported beat when a later auxiliary attack is gated out', () => {
    const source = attacks([0, .5, 1, 1.5]);
    const onsets = [...source, { time: 2.2, strength: .2, band: 1 }];
    const investigation = investigateTempo(onsets, 3, 120);
    const projected = gateClockEvidence(onsets, investigation.blocks, source);
    expect(projected.at(-1)?.strength).toBe(0);
    const rhythm = trackBeats(onsets, 3, 120, source);
    expect(rhythm.beats).toEqual([0, .5, 1, 1.5]);
    expect(rhythm.confidence).toBe(1);
    expect(rhythm.tempo.every(point => point.bpm === 120)).toBe(true);
  });

  it('retains an audible final beat', () => {
    const onsets = attacks([0, .5, 1, 1.5, 2]);
    expect(trackBeats(onsets, 3, 120, onsets).beats).toEqual([0, .5, 1, 1.5, 2]);
  });

  it('preserves continuity through an internal rest', () => {
    const onsets = attacks([0, .5, 1, 4, 4.5, 5]);
    expect(trackBeats(onsets, 6, 120).beats).toEqual([0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  });

  it('returns an empty clock when no positive evidence remains', () => {
    const rhythm = trackBeats(attacks([0, .5, 1, 1.5], 0), 3, 120);
    expect(rhythm).toEqual({ beats: [], tempo: [], confidence: 0, downbeats: [], meterConfidence: 0 });
  });

  it('does not mutate caller-owned source or mixed events', () => {
    const source = attacks([0, .5, 1, 1.5]);
    const mixed = [...source, { time: 2.2, strength: .2, band: 1 }];
    const original = structuredClone({ source, mixed });
    trackBeats(mixed, 3, 120, source);
    expect({ source, mixed }).toEqual(original);
  });
});
