import { describe, expect, it } from 'vitest';
import { canvasPoint, gameViewport } from './viewport';
import { stageLayout } from './layout';
import { JudgmentEngine, swipeDirection } from './judgment';
import type { Chart } from '../types';

describe('landscape fallback for portrait-locked phones', () => {
  it.each([[390, 844], [360, 800], [320, 568]])('uses the full %i x %i portrait viewport as a horizontal game', (width, height) => {
    const viewport = gameViewport(width, height);
    expect(viewport.rotated).toBe(true);
    expect(viewport.width).toBe(height);
    expect(viewport.height).toBe(width);
    expect(viewport.width).toBeGreaterThan(viewport.height);
  });

  it('keeps natural landscape dimensions and viewport offsets', () => {
    expect(gameViewport(844, 390, 8, 15)).toMatchObject({ width: 844, height: 390, rotated: false, offsetLeft: 8, offsetTop: 15 });
  });

  it('maps regular canvas points after CSS scaling', () => {
    const point = canvasPoint(210, 170, { left: 10, top: 20, width: 400, height: 300 }, 800, 600, false);
    expect(point).toEqual({ x: 400, y: 300 });
  });

  const logicalWidth = 844, logicalHeight = 321;
  // The game's 49px header and 20px footer rotate with the canvas. Its physical
  // rectangle is 321px wide and 844px high, with optional safe-area offsets.
  const rect = { left: 28, top: 11, width: logicalHeight, height: logicalWidth };
  const screenPoint = (x: number, y: number) => ({ clientX: rect.left + rect.width - y, clientY: rect.top + x });
  const logicalPoint = (x: number, y: number) => {
    const screen = screenPoint(x, y);
    return canvasPoint(screen.clientX, screen.clientY, rect, logicalWidth, logicalHeight, true);
  };

  it('maps all four rotated touch targets to their original lanes', () => {
    const layout = stageLayout(logicalWidth, logicalHeight);
    const chart: Chart = { version: 1, fingerprint: 'rotation', difficulty: 'four', bpm: 120, duration: 5, notes: [0, 1, 2, 3].map(lane => ({ id: lane, lane, type: 'tap', time: 1 })) };
    const engine = new JudgmentEngine(chart);
    for (let lane = 0; lane < 4; lane++) {
      const x = (layout.xAt(lane, layout.hitY) + layout.xAt(lane + 1, layout.hitY)) / 2;
      const point = logicalPoint(x, layout.hitY + 20);
      const mappedLane = layout.laneAt(point.x, point.y);
      expect(mappedLane).toBe(lane);
      engine.input(mappedLane!, 1, 'press');
    }
    expect(engine.counts.perfect).toBe(4);
    expect(engine.result().score).toBe(1_000_000);
  });

  it.each([
    ['left', -40, 0],
    ['right', 40, 0],
    ['up', 0, -40],
  ] as const)('interprets %s relative to the rotated game, not the physical phone', (direction, dx, dy) => {
    const from = logicalPoint(420, 270), to = logicalPoint(420 + dx, 270 + dy);
    expect(swipeDirection(to.x - from.x, to.y - from.y)).toBe(direction);
  });

  it('allows rotated holds to keep their lane through head and tail', () => {
    const layout = stageLayout(logicalWidth, logicalHeight), point = logicalPoint(logicalWidth * 0.4, layout.hitY + 20);
    const lane = layout.laneAt(point.x, point.y)!;
    const chart: Chart = { version: 1, fingerprint: 'hold', difficulty: 'three', bpm: 120, duration: 5, notes: [{ id: 0, lane, type: 'hold', time: 1, endTime: 2 }] };
    const engine = new JudgmentEngine(chart);
    const hold = engine.input(lane, 1, 'press'); engine.update(2); engine.release(hold, 2.1);
    expect(engine.counts.perfect).toBe(2);
  });

  it('does not turn a hidden zero-sized canvas into a valid touch target', () => {
    const point = canvasPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 844, 321, true);
    expect(stageLayout(844, 321).laneAt(point.x, point.y)).toBeNull();
  });
});
