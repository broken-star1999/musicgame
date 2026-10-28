import { describe, expect, it } from 'vitest';
import { planFingering, validateFingering } from './fingering';
import { peakFingers } from './chart-constraints';
import type { Note } from '../types';

const note = (lane: number, time: number, endTime?: number): Note => ({ id: 0, lane, time, type: endTime ? 'hold' : 'tap', ...(endTime ? { endTime } : {}) });

describe('whole-chart touch-finger motion planning', () => {
  const trap = [note(1, 1, 4), note(2, 1, 4), note(0, 1.5), note(3, 1.7)];

  it('detects a three-finger route that occupancy counting alone would allow', () => {
    expect(peakFingers(trap)).toBe(3);
    const plan = planFingering(trap, 3, false);
    expect(plan.omitted).toBe(1);
    expect(validateFingering(plan.notes, 3, 6)).toBe(true);
  });

  it('repairs the blocked route by changing a lane while preserving every musical timestamp', () => {
    const plan = planFingering(trap, 3);
    expect(plan.omitted).toBe(0); expect(plan.adjusted).toBeGreaterThan(0);
    expect(plan.notes.map(n => n.time)).toEqual(trap.map(n => n.time));
    expect(validateFingering(plan.notes, 3, 6)).toBe(true);
  });

  it('replaces rapid single-finger full-width jumps with a reachable route', () => {
    const notes = [note(0, 1), note(3, 1.3), note(0, 1.6), note(3, 1.9)];
    const plan = planFingering(notes, 1);
    expect(plan.notes.length).toBe(4); expect(plan.adjusted).toBeGreaterThan(0);
    expect(validateFingering(plan.notes, 1, 4)).toBe(true);
    for (let i = 1; i < plan.notes.length; i++) expect(Math.abs(plan.notes[i].lane - plan.notes[i - 1].lane)).toBeLessThan(3);
  });

  it('assigns four distinct ordered fingers to a four-key chord', () => {
    const plan = planFingering([0, 1, 2, 3].map(lane => note(lane, 1)), 4);
    expect(plan.notes.map(n => n.finger)).toEqual([0, 1, 2, 3]);
    expect(validateFingering(plan.notes, 4, 3)).toBe(true);
  });

  it('does not reuse a held finger for intervening taps', () => {
    const plan = planFingering([note(0, 1, 2.5), note(3, 1.5), note(2, 1.9)], 2);
    expect(plan.omitted).toBe(0);
    expect(plan.notes[0].finger).not.toBe(plan.notes[1].finger);
    expect(plan.notes[0].finger).not.toBe(plan.notes[2].finger);
    expect(validateFingering(plan.notes, 2, 4)).toBe(true);
  });

  it('rejects a forged proof that reuses a held finger or crosses held fingers', () => {
    const held = [{ ...note(0, 1, 3), finger: 0 }, { ...note(1, 2), finger: 0 }];
    expect(validateFingering(held, 2, 5)).toBe(false);
    const crossing = [{ ...note(1, 1, 3), finger: 1 }, { ...note(3, 2), finger: 0 }];
    expect(validateFingering(crossing, 3, 5)).toBe(false);
  });

  it('is deterministic and records actual finger assignments for the complete output', () => {
    const notes = Array.from({ length: 100 }, (_, i) => note(i % 4, 0.5 + i * 0.23));
    const first = planFingering(notes, 3);
    expect(first).toEqual(planFingering(notes, 3));
    expect(first.omitted).toBe(0); expect(first.notes.every(n => n.finger !== undefined)).toBe(true);
    expect(validateFingering(first.notes, 3, 25)).toBe(true);
  });
});
