import { describe, expect, it, vi } from 'vitest';
import type { Chart } from '../types';
import { JudgmentEngine } from './judgment';

const chart: Chart = {
  version: 7, generator: 'signal', fingerprint: 'hold-tail', difficulty: 'one',
  duration: 4, bpm: 120,
  notes: [{ id: 0, lane: 0, time: 1, type: 'hold', endTime: 2 }],
};

function startedHold() {
  const onHit = vi.fn(), engine = new JudgmentEngine(chart, false, onHit);
  const hold = engine.input(0, 1, 'press')!;
  return { engine, hold, onHit };
}

describe('hold tails require holding through the endpoint', () => {
  it.each([1, 45, 90, 140])('loses the tail when released %i ms early and cannot regain it later', earlyMs => {
    const { engine, hold, onHit } = startedHold();
    engine.release(hold, 2 - earlyMs / 1000);
    expect(hold).toMatchObject({ head: 'perfect', tail: 'miss', held: false });
    expect(engine.result()).toMatchObject({ score: 500_000, accuracy: 50, maxCombo: 1, counts: { perfect: 1, great: 0, good: 0, miss: 1 } });
    expect(engine.combo).toBe(0);
    engine.update(2); engine.update(3); engine.release(hold, 3);
    expect(engine.judged).toBe(2); expect(onHit).toHaveBeenCalledTimes(2);
    expect(engine.regrab(0)).toBeUndefined();
  });

  it.each([2, 2.001, 2.4])('awards the tail at release time %f even if a render update has not run', releaseTime => {
    const { engine, hold, onHit } = startedHold();
    engine.release(hold, releaseTime);
    engine.update(3); engine.release(hold, 3);
    expect(engine.result()).toMatchObject({ score: 1_000_000, accuracy: 100, counts: { perfect: 2, great: 0, good: 0, miss: 0 } });
    expect(engine.judged).toBe(2); expect(onHit).toHaveBeenCalledTimes(2);
  });

  it('automatically completes the tail while held, without a precisely timed release', () => {
    const { engine, hold, onHit } = startedHold();
    engine.update(1.999); expect(hold.tail).toBeUndefined();
    engine.update(2);
    expect(hold).toMatchObject({ tail: 'perfect', tailAt: 2, held: false });
    engine.update(3); engine.release(hold, 3.5);
    expect(engine.result().score).toBe(1_000_000); expect(onHit).toHaveBeenCalledTimes(2);
  });

  it.each([
    [0.5e-9, 'perfect'], [2e-9, 'miss'],
  ] as const)('uses only endpoint floating-point tolerance: %f seconds early gives %s', (early, grade) => {
    const { engine, hold } = startedHold();
    engine.release(hold, 2 - early);
    expect(hold.tail).toBe(grade);
  });

  it('can regrab a paused hold and complete its original tail', () => {
    const { engine, hold } = startedHold();
    engine.suspendHolds(); expect(hold.held).toBe(false);
    expect(engine.regrab(0)).toBe(hold); engine.resumeHolds(1.5);
    engine.update(2); engine.release(hold, 2.1);
    expect(engine.result()).toMatchObject({ score: 1_000_000, counts: { perfect: 2, miss: 0 } });
  });

  it('still fails an early release after regrabbing a paused hold', () => {
    const { engine, hold } = startedHold();
    engine.suspendHolds(); engine.regrab(0); engine.resumeHolds(1.5);
    engine.release(hold, 1.999); engine.update(3);
    expect(engine.result()).toMatchObject({ score: 500_000, counts: { perfect: 1, miss: 1 } });
  });

  it('fails an ungrabbed hold on resume and never awards the tail again', () => {
    const { engine, hold, onHit } = startedHold();
    engine.suspendHolds(); engine.resumeHolds(1.5);
    engine.update(2); engine.release(hold, 2.5);
    expect(engine.result()).toMatchObject({ score: 500_000, counts: { perfect: 1, miss: 1 } });
    expect(onHit).toHaveBeenCalledTimes(2);
  });
});
