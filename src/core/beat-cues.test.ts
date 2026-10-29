import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chart, Note } from '../types';
import { BeatCues } from './beat-cues';

class FakeOscillator {
  type = ''; frequency = { setValueAtTime: vi.fn() };
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class FakeGain {
  gain = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  connect = vi.fn(); disconnect = vi.fn();
}
class FakeContext {
  currentTime = 100; state: AudioContextState = 'running'; destination = {};
  oscillators: FakeOscillator[] = []; gains: FakeGain[] = [];
  createOscillator = vi.fn(() => { const node = new FakeOscillator(); this.oscillators.push(node); return node; });
  createGain = vi.fn(() => { const node = new FakeGain(); this.gains.push(node); return node; });
  suspend = vi.fn(); resume = vi.fn();
}
const chart = (...notes: (number | Partial<Note> & { time: number })[]) => ({
  duration: 20,
  notes: notes.map((note, id) => ({ id, lane: 0, type: 'tap', ...(typeof note === 'number' ? { time: note } : note) })),
} as Chart);
let context: FakeContext;
const cues = (notes: Chart, volume = 0.8) => new BeatCues(notes, volume, context as unknown as AudioContext);
beforeEach(() => { context = new FakeContext(); });
afterEach(() => vi.unstubAllGlobals());

describe('optional autoplay head cue scheduling', () => {
  it('starts disabled and schedules only when enabled', () => {
    const aid = cues(chart(1)); aid.update(0.95);
    expect(context.createOscillator).not.toHaveBeenCalled();
    aid.setEnabled(true); aid.update(0.95);
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].start).toHaveBeenCalledWith(100.05);
    expect(context.oscillators[0].stop).toHaveBeenCalledWith(100.072);
  });

  it('maps original note times to the explicit audio clock with a 120 ms lookahead', () => {
    const aid = cues(chart(2, 2.1, 2.13)); aid.setEnabled(true); aid.update(2, 100);
    expect(context.oscillators.map(node => node.start.mock.calls[0][0])).toEqual([100, 100.1]);
    context.currentTime = 100.02; aid.update(2.02, 100.02);
    expect(context.oscillators.map(node => node.start.mock.calls[0][0])).toEqual([100, 100.1, 100.13]);
    aid.update(2.02, 100.02); expect(context.oscillators).toHaveLength(3);
  });

  it('merges same-time chord heads and never cues a long-note tail', () => {
    const aid = cues(chart({ time: 1, type: 'hold', endTime: 2 }, { time: 1, lane: 1 }, { time: 1, lane: 3 }));
    aid.setEnabled(true); aid.update(0.95);
    expect(context.oscillators).toHaveLength(1);
    context.currentTime = 101; aid.update(1.95);
    expect(context.oscillators).toHaveLength(1);
  });

  it('skips all past heads on enable and does not catch up after a long frame', () => {
    const aid = cues(chart(0, 0.4, 0.8, 1, 1.4, 2)); aid.setEnabled(true); aid.update(0.95);
    expect(context.oscillators).toHaveLength(1);
    context.currentTime = 101; aid.update(1.95);
    expect(context.oscillators).toHaveLength(2); expect(context.oscillators[1].start).toHaveBeenCalledWith(101.05);
  });

  it('stops every active and future cue on pause and locates the resume position afresh', () => {
    const aid = cues(chart(1, 1.1, 2)); aid.setEnabled(true); aid.update(1);
    const old = [...context.oscillators]; expect(old).toHaveLength(2);
    aid.pause();
    for (const node of old) { expect(node.stop).toHaveBeenCalledTimes(2); expect(node.disconnect).toHaveBeenCalledOnce(); expect(node.onended).toBeNull(); }
    expect(context.gains.every(gain => gain.disconnect.mock.calls.length === 1)).toBe(true);
    context.currentTime = 150; aid.update(1.95);
    expect(context.oscillators).toHaveLength(3); expect(context.oscillators[2].start).toHaveBeenCalledWith(150.05);
  });

  it('stops cues on disable, and re-enabling never replays the beginning', () => {
    const aid = cues(chart(0, 1, 5)); aid.setEnabled(true); aid.update(0.95); aid.setEnabled(false);
    expect(context.oscillators[0].disconnect).toHaveBeenCalledOnce();
    context.currentTime = 104; aid.update(4.95); expect(context.oscillators).toHaveLength(1);
    aid.setEnabled(true); aid.update(4.95);
    expect(context.oscillators).toHaveLength(2); expect(context.oscillators[1].start).toHaveBeenCalledWith(104.05);
  });

  it('repositions and cancels the old window when seeking backwards', () => {
    const aid = cues(chart(1, 4, 4.1)); aid.setEnabled(true); aid.update(3.95);
    const old = context.oscillators[0]; context.currentTime = 101; aid.update(0.95);
    expect(old.disconnect).toHaveBeenCalledOnce(); expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[1].start).toHaveBeenCalledWith(101.05);
  });

  it('drops a stale pending window when the clock mapping jumps forwards', () => {
    const aid = cues(chart(1, 8)); aid.setEnabled(true); aid.update(0.95);
    context.currentTime = 100.01; aid.update(7.95);
    expect(context.oscillators[0].disconnect).toHaveBeenCalledOnce();
    expect(context.oscillators[1].start).toHaveBeenCalledWith(100.06);
  });

  it('has a short faded envelope scaled by music volume and no global audio side effects', () => {
    const aid = cues(chart(1), 0.5); aid.setEnabled(true); aid.update(0.95);
    const gain = context.gains[0];
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 100.05);
    const attack = gain.gain.linearRampToValueAtTime.mock.calls[0];
    expect(attack[0]).toBe(0.0275); expect(attack[1]).toBeCloseTo(100.052, 9);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 100.072);
    expect(context.suspend).not.toHaveBeenCalled(); expect(context.resume).not.toHaveBeenCalled();
  });

  it('allocates no sound nodes when the music volume is zero', () => {
    const aid = cues(chart(1), 0); aid.setEnabled(true); aid.update(0.95); aid.pause(); aid.dispose();
    expect(context.createOscillator).not.toHaveBeenCalled(); expect(context.createGain).not.toHaveBeenCalled();
  });

  it('cleans naturally ended nodes and ignores their late duplicate callback', () => {
    const aid = cues(chart(1)); aid.setEnabled(true); aid.update(0.95);
    const node = context.oscillators[0], ended = node.onended!;
    ended(); ended(); aid.pause();
    expect(node.disconnect).toHaveBeenCalledOnce(); expect(context.gains[0].disconnect).toHaveBeenCalledOnce();
    expect(node.stop).toHaveBeenCalledOnce();
  });

  it('bounds a dense lookahead window and retires elapsed nodes even without ended events', () => {
    const aid = cues(chart(...Array.from({ length: 1000 }, (_, i) => 1 + i * 0.0001), 2));
    aid.setEnabled(true); aid.update(1);
    expect(context.oscillators.length).toBeLessThanOrEqual(16);
    context.currentTime = 101; aid.update(1.95);
    expect(context.oscillators.slice(0, -1).every(node => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.oscillators.at(-1)!.start).toHaveBeenCalledWith(101.05);
  });

  it('stops and resets its window if the audio context is interrupted', () => {
    const aid = cues(chart(1, 2)); aid.setEnabled(true); aid.update(0.95);
    context.state = 'suspended'; aid.update(0.96);
    expect(context.oscillators[0].disconnect).toHaveBeenCalledOnce();
    context.state = 'running'; context.currentTime = 110; aid.update(1.95);
    expect(context.oscillators.at(-1)!.start).toHaveBeenCalledWith(110.05);
  });

  it('disposes idempotently and never creates another node afterward', () => {
    const aid = cues(chart(1, 2)); aid.setEnabled(true); aid.update(0.95);
    aid.dispose(); aid.dispose(); aid.setEnabled(true); aid.pause(); aid.update(1.95);
    expect(context.oscillators).toHaveLength(1); expect(context.oscillators[0].disconnect).toHaveBeenCalledOnce();
    expect(context.gains[0].disconnect).toHaveBeenCalledOnce();
  });

  it.each(['oscillator', 'gain', 'start', 'stop'] as const)('contains a failing %s API and cleans partial nodes without affecting music', failure => {
    if (failure === 'oscillator') context.createOscillator.mockImplementation(() => { throw new Error('Unsupported'); });
    if (failure === 'gain') context.createGain.mockImplementation(() => { throw new Error('Quota'); });
    if (failure === 'start' || failure === 'stop') {
      const create = context.createOscillator.getMockImplementation()!;
      context.createOscillator.mockImplementation(() => { const node = create(); node[failure].mockImplementation(() => { throw new Error('Unavailable'); }); return node; });
    }
    const aid = cues(chart(1)); aid.setEnabled(true);
    expect(() => aid.update(0.95)).not.toThrow();
    const attempts = context.createOscillator.mock.calls.length;
    aid.update(0.96); expect(context.createOscillator.mock.calls.length).toBe(attempts);
    expect(context.oscillators.every(node => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.gains.every(node => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.suspend).not.toHaveBeenCalled(); expect(context.resume).not.toHaveBeenCalled();
  });
});
