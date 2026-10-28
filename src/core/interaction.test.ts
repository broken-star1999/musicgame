import { describe, expect, it, vi } from 'vitest';
import { HitFeedback } from './haptics';
import { JudgmentEngine } from './judgment';
import { stageLayout, noteScreenY } from './layout';
import { noteOpacity } from '../components/renderer';
import { canvasPoint } from './viewport';
import type { Chart } from '../types';

describe('full-height touch lanes and extended judgment road', () => {
  it.each([[844, 321], [568, 251], [1280, 493]])('uses the visible lane at every height at %i x %i', (width, height) => {
    const layout = stageLayout(width, height);
    for (const y of [0, height * 0.15, height * 0.5, layout.frameTop, layout.hitY, height]) {
      for (let lane = 0; lane < 4; lane++) expect(layout.laneAt((layout.xAt(lane, y) + layout.xAt(lane + 1, y)) / 2, y)).toBe(lane);
      expect(layout.laneAt(layout.xAt(0, y) - 1, y)).toBeNull();
      expect(layout.laneAt(layout.xAt(4, y) + 1, y)).toBeNull();
    }
    expect(layout.laneAt(width / 2, -1)).toBeNull();
    expect(layout.laneAt(width / 2, height + 1)).toBeNull();
  });

  it('keeps upper-track touch mapping correct when the page is rotated', () => {
    const width = 844, height = 321, rect = { left: 20, top: 0, width: height, height: width };
    const layout = stageLayout(width, height);
    for (const y of [10, 90, 210]) for (let lane = 0; lane < 4; lane++) {
      const x = (layout.xAt(lane, y) + layout.xAt(lane + 1, y)) / 2;
      const point = canvasPoint(rect.left + height - y, x, rect, width, height, true);
      expect(layout.laneAt(point.x, point.y)).toBe(lane);
    }
  });

  it('still requires the correct timing after expanding the touch region', () => {
    const chart: Chart = { version: 2, fingerprint: 'touch', difficulty: 'normal', duration: 3, bpm: 120, notes: [{ id: 0, lane: 0, time: 1, type: 'tap' }] };
    const engine = new JudgmentEngine(chart), layout = stageLayout(844, 321);
    const lane = layout.laneAt((layout.xAt(0, 30) + layout.xAt(1, 30)) / 2, 30)!;
    engine.input(lane, 0.5, 'press'); expect(engine.judged).toBe(0);
    engine.input(lane, 1, 'press'); expect(engine.counts.perfect).toBe(1);
  });

  it('lets missed notes cross the lower rail and fade instead of disappearing at the line', () => {
    const chart: Chart = { version: 2, fingerprint: 'miss', difficulty: 'normal', duration: 3, bpm: 120, notes: [{ id: 0, lane: 0, time: 1, type: 'tap' }] };
    const engine = new JudgmentEngine(chart); engine.update(1.15);
    expect(engine.states[0].head).toBe('miss');
    expect(noteScreenY(1, 1.16, 2.3, 260, 'perspective')).toBeGreaterThan(260);
    expect(noteOpacity(engine.states[0], 1.16)).toBeGreaterThan(0);
    expect(noteOpacity(engine.states[0], 1.5)).toBe(0);
  });
});

describe('optional hit vibration', () => {
  const hit = { lane: 0, grade: 'perfect' as const, at: 1, type: 'tap' as const };
  it('uses short pulses and coalesces simultaneous chords', () => {
    const vibrate = vi.fn(() => true); let now = 100;
    const feedback = new HitFeedback(true, { vibrate }, () => now);
    feedback.hit(hit); feedback.hit({ ...hit, lane: 1 });
    expect(vibrate.mock.calls).toHaveLength(1); expect(vibrate).toHaveBeenCalledWith(10);
    now += 40; feedback.hit({ ...hit, type: 'up' }); expect(vibrate).toHaveBeenLastCalledWith(16);
    feedback.stop(); expect(vibrate).toHaveBeenLastCalledWith(0);
  });
  it('never vibrates on misses or when disabled for autoplay', () => {
    const vibrate = vi.fn(() => true);
    new HitFeedback(true, { vibrate }).hit({ ...hit, grade: 'miss' });
    new HitFeedback(false, { vibrate }).hit(hit);
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('does not interrupt gameplay when vibration is missing or blocked', () => {
    expect(() => new HitFeedback(true, {}).hit(hit)).not.toThrow();
    expect(() => new HitFeedback(true, { vibrate: () => { throw new Error('blocked'); } }).hit(hit)).not.toThrow();
  });
  it('receives both hold judgments from the engine', () => {
    const callback = vi.fn();
    const chart: Chart = { version: 2, fingerprint: 'hold-feedback', difficulty: 'normal', duration: 4, bpm: 120, notes: [{ id: 0, lane: 0, time: 1, type: 'hold', endTime: 2 }] };
    const engine = new JudgmentEngine(chart, false, callback);
    engine.input(0, 1, 'press'); engine.update(2);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, expect.objectContaining({ tail: false }));
    expect(callback).toHaveBeenNthCalledWith(2, expect.objectContaining({ tail: true }));
  });
});
