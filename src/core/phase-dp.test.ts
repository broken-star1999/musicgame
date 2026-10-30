import { describe, expect, it } from 'vitest';
import { bruteMessages, exactBrute, exactHull, hullMessages, shape } from './phase-dp-kernel';
import type { MessageState } from './phase-dp-types';
import { phaseDP } from './phase-dp';

describe('complete last-lag state tracking', () => {
  it('retains a lower scoring prefix that wins the next transition', () => {
    const states: MessageState[] = [{ period: 50, score: 9.9, code: 1 }, { period: 100, score: 10, code: 2 }];
    const result = hullMessages(states, Float64Array.of(Math.log(50)));
    expect(result.codes[0]).toBe(1);
    expect(result.values[0]).toBe(9.9);
  });

  it('retains finite negative prefixes when they beat restarting at another period', () => {
    const states: MessageState[] = [{ period: 50, score: -.01, code: 1 }, { period: 100, score: 0, code: 0 }];
    const result = hullMessages(states, Float64Array.of(Math.log(50)));
    expect(result.codes[0]).toBe(1);
    expect(result.values[0]).toBe(-.01);
  });

  it('preserves the free state when a one-ULP advantage disappears after subtraction', () => {
    const states: MessageState[] = [{ period: 120, score: .25, code: 0 }, { period: 120, score: .25000000000000006, code: 96 }];
    const queries = Float64Array.of(Math.log(25));
    const result = hullMessages(states, queries), oracle = bruteMessages(states, queries);
    expect(result.codes).toEqual(oracle.codes);
    expect(result.values).toEqual(oracle.values);
    expect(result.codes[0]).toBe(0);
  });

  for (const kind of ['straight', 'phase-offset', 'tempo-change', 'positive-background'] as const) {
    it(`matches an independent full time-by-lag oracle for ${kind}`, () => {
      const frames = 260, envelope = new Float64Array(frames);
      const local = Float64Array.from({ length: frames }, (_, frame) => kind === 'tempo-change' && frame >= 130 ? 33 : 50);
      const offset = kind === 'phase-offset' ? 17 : 0;
      for (let frame = 0; frame < frames; frame++) {
        const period = frame < 130 || kind !== 'tempo-change' ? 50 : 33;
        const distance = Math.min((frame + period - offset) % period, period - (frame + period - offset) % period);
        envelope[frame] = Math.exp(-distance * distance / 5) + (kind === 'positive-background' ? .08 : 0);
      }
      const result = exactHull(envelope, local, { capture: true });
      const oracle = exactBrute(envelope, local);
      expect(result.states).toEqual(oracle.states);
      expect(result.trace).toEqual(oracle.trace);
      expect(result.bestCodes).toEqual(oracle.bestCodes);
      expect(result.path).toEqual(oracle.path);
      expect(result.objective).toBe(oracle.objective);
      expect(result.path.every((frame, index) => index === 0 || frame > result.path[index - 1])).toBe(true);
    });
  }

  it('bounds a five-minute maximum-period clock without capturing a full score table', () => {
    const duration = 300, frames = duration * 100 + 1;
    const envelope = new Float64Array(frames), local = Float64Array.of(120);
    const onsets = [0, 1, 2, 3].map(time => ({ time, strength: 1, band: 0 }));
    const result = phaseDP({ envelope, local, duration, bpm: 50, onsets });
    expect(result.diagnostics.lagStates).toBe(156);
    expect(result.diagnostics.explicitDpTypedBytes).toBeLessThan(5_300_000);
    expect(result.diagnostics.expandedLocalBytes).toBe(frames * 8);
  });

  it('rejects periods that cannot fit the trace codec and invalid clock metadata', () => {
    expect(() => shape(Float64Array.of(190))).toThrow('Trace codec');
    expect(() => phaseDP({ envelope: Float64Array.of(0), local: Float64Array.of(50), duration: 0, bpm: NaN, onsets: [] })).toThrow('Invalid clock metadata');
  });
});
