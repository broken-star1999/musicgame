import { describe, expect, it, vi } from 'vitest';
import { analyzeAudio, estimateTempo } from './analysis';
import { countTypes, DIFFICULTIES, generateChart } from './chart';
import { gradeFor, JudgmentEngine, swipeDirection } from './judgment';
import type { Analysis, Chart, Note } from '../types';
import { createDemo, toMono } from './audio';
import { drawGame } from '../components/renderer';
import { noteScreenY, stageLayout } from './layout';
import { isPlayableChart, peakFingers } from './chart-constraints';

const RATE = 22050;
function clickTrack(times: number[], duration = Math.max(...times) + 1) {
  const data = new Float32Array(Math.ceil(duration * RATE));
  times.forEach((time, index) => {
    for (let j = 0; j < RATE * 0.12; j++) {
      const t = j / RATE, at = Math.floor(time * RATE) + j;
      if (at < data.length) data[at] += Math.sin(2 * Math.PI * (index % 2 ? 180 : 100) * t) * Math.exp(-t * 45) * Math.min(1, t * 1000);
    }
  });
  return data;
}
const fixture = (): Analysis => ({
  fingerprint: 'fixed-seed', duration: 45, bpm: 120, confidence: 1,
  onsets: Array.from({ length: 180 }, (_, i) => ({ time: i * 0.24 + 0.4, strength: i % 4 === 0 ? 0.95 : 0.25 + (i % 3) * 0.15, band: i % 3 })),
  energy: Array(900).fill(0.7), energyStep: 0.05, waveform: Array(160).fill(0.5),
});
function chartOf(notes: Omit<Note, 'id'>[]): Chart { return { version: 1, fingerprint: 'test', difficulty: 'three', bpm: 120, duration: 10, notes: notes.map((note, id) => ({ ...note, id })) }; }

describe('real audio onset analysis', () => {
  it('locates 120 BPM attacks within 50 ms, including leading silence', () => {
    const times = Array.from({ length: 20 }, (_, i) => 1.2 + i * 0.5);
    const analysis = analyzeAudio(clickTrack(times), RATE);
    expect(analysis.bpm).toBeGreaterThanOrEqual(119); expect(analysis.bpm).toBeLessThanOrEqual(121);
    expect(analysis.confidence).toBeGreaterThan(0.75);
    for (const time of times) expect(Math.min(...analysis.onsets.map(onset => Math.abs(onset.time - time)))).toBeLessThan(0.05);
    expect(analysis.onsets[0].time).toBeGreaterThan(1.15);
    expect(analysis.waveform).toHaveLength(160);
  });
  it('keeps attacks through a tempo change rather than generating a fixed metronome', () => {
    const times = [...Array.from({ length: 10 }, (_, i) => 0.8 + i * 0.5), ...Array.from({ length: 10 }, (_, i) => 5.8 + i * 0.4)];
    const analysis = analyzeAudio(clickTrack(times), RATE);
    for (const time of times) expect(Math.min(...analysis.onsets.map(onset => Math.abs(onset.time - time)))).toBeLessThan(0.05);
    const chart = generateChart(analysis, 'three');
    for (const note of chart.notes) expect(Math.min(...times.map(time => Math.abs(time - note.time)))).toBeLessThan(0.075);
  });
  it('rejects silence, sub-threshold noise and undersized files', () => {
    expect(() => analyzeAudio(new Float32Array(RATE * 3), RATE)).toThrow(/静音/);
    expect(() => analyzeAudio(Float32Array.from({ length: RATE * 2 }, (_, i) => Math.sin(i) * 0.00001), RATE)).toThrow(/静音/);
    expect(() => analyzeAudio(new Float32Array(30), RATE)).toThrow(/太短/);
  });
  it('reports low tempo confidence for too few attacks', () => expect(estimateTempo([{ time: 1, strength: 1, band: 0 }]).confidence).toBe(0));
});

describe('playable deterministic chart generation', () => {
  it('produces the same chart for the same music and difficulty', () => expect(generateChart(fixture(), 'four')).toEqual(generateChart(fixture(), 'four')));
  it.each(['one', 'two', 'three', 'four'] as const)('enforces lane spacing, duration, and finger limits for %s', difficulty => {
    const chart = generateChart(fixture(), difficulty);
    expect(chart.notes.length).toBeGreaterThan(20);
    const lastEnd = [-100, -100, -100, -100];
    for (let i = 0; i < chart.notes.length; i++) {
      const note = chart.notes[i];
      expect(note.id).toBe(i); expect(note.time).toBeGreaterThanOrEqual(i ? chart.notes[i - 1].time : 0);
      expect(note.time - lastEnd[note.lane]).toBeGreaterThanOrEqual(0.09);
      expect(note.endTime || note.time).toBeLessThan(chart.duration);
      lastEnd[note.lane] = note.endTime || note.time;
      const simultaneous = chart.notes.filter(n => n.time <= note.time + 0.00001 && (n.endTime ? n.endTime > note.time : Math.abs(n.time - note.time) < 0.00001));
      expect(simultaneous.length).toBeLessThanOrEqual(DIFFICULTIES[difficulty].max);
    }
  });
  it('increases density with difficulty and supports BPM correction', () => {
    expect(generateChart(fixture(), 'four').notes.length).toBeGreaterThan(generateChart(fixture(), 'one').notes.length);
    expect(generateChart(fixture(), 'three', 135).bpm).toBe(135);
  });
});

describe('built-in demonstration and canvas lifecycle', () => {
  it('includes all five note types in the original demo', () => {
    vi.stubGlobal('AudioContext', class {
      createBuffer(_channels: number, length: number, sampleRate: number) {
        const samples = new Float32Array(length);
        return { duration: length / sampleRate, length, sampleRate, numberOfChannels: 1, getChannelData: () => samples };
      }
    });
    try {
      const analysis = analyzeAudio(toMono(createDemo()), RATE);
      const counts = countTypes(generateChart(analysis, 'three'));
      for (const type of ['tap', 'hold', 'left', 'right', 'up'] as const) expect(counts[type], type).toBeGreaterThan(0);
      expect(generateChart(analysis, 'three').repetition?.reused).toBeGreaterThan(0);
      for (const difficulty of ['one', 'two', 'three', 'four'] as const) {
        const chart = generateChart(analysis, difficulty);
        expect(isPlayableChart(chart.notes, DIFFICULTIES[difficulty].max, chart.duration), difficulty).toBe(true);
        expect(peakFingers(chart.notes), difficulty).toBeLessThanOrEqual(DIFFICULTIES[difficulty].max);
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not project a zero-sized canvas during navigation or resizing', () => {
    const ctx = {} as CanvasRenderingContext2D, engine = new JudgmentEngine(chartOf([]));
    expect(() => drawGame(ctx, 500, 0, engine, 0, 5, [], false)).not.toThrow();
    expect(() => drawGame(ctx, 0, 350, engine, 0, 5, [], false)).not.toThrow();
    expect(() => drawGame(ctx, NaN, 350, engine, 0, 5, [], false)).not.toThrow();
  });
});

describe('perspective road and two-line judgment frame', () => {
  it.each([2, 5, 10])('keeps equal screen displacement in equal time at speed %i', speed => {
    const hitY = 320, travel = 3.6 - speed * 0.26, target = 10;
    const start = target - travel, interval = travel / 5;
    const positions = Array.from({ length: 6 }, (_, i) => noteScreenY(target, start + i * interval, travel, hitY));
    for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeCloseTo(hitY / 5, 8);
    expect(positions[0]).toBeCloseTo(0, 8); expect(positions.at(-1)).toBeCloseTo(hitY, 8);
  });
  it('keeps the hit time unchanged when scroll speed changes', () => {
    for (const mode of ['screen', 'perspective'] as const) for (const speed of [2, 5, 10]) expect(noteScreenY(12.345, 12.345, 3.6 - speed * 0.26, 280, mode)).toBe(280);
  });
  it.each([2, 5, 10])('preserves motion relative to local lane width at perspective speed %i', speed => {
    const layout = stageLayout(844, 321), travel = 3.6 - speed * 0.26;
    const step = 0.0001, ratios: number[] = [];
    for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const time = 10 - travel + progress * travel;
      const y = noteScreenY(10, time, travel, layout.hitY, 'perspective');
      const next = noteScreenY(10, time + step, travel, layout.hitY, 'perspective');
      ratios.push((next - y) / step / layout.roadWidth((next + y) / 2));
    }
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeCloseTo(1, 6);
    const farStep = noteScreenY(10, 10 - travel + step, travel, layout.hitY, 'perspective');
    const nearStep = layout.hitY - noteScreenY(10, 10 - step, travel, layout.hitY, 'perspective');
    expect(nearStep).toBeGreaterThan(farStep);
  });
  it.each([[844, 321], [1280, 493], [568, 251]])('aligns all four rendered lane boundaries and touch targets at %i x %i', (width, height) => {
    const layout = stageLayout(width, height);
    for (let lane = 0; lane < 4; lane++) {
      const center = (layout.xAt(lane, layout.hitY) + layout.xAt(lane + 1, layout.hitY)) / 2;
      expect(layout.laneAt(center, layout.hitY + 20)).toBe(lane);
      expect(layout.xAt(lane + 1, layout.hitY) - layout.xAt(lane, layout.hitY)).toBeCloseTo(width * 0.2);
      const above = layout.hitY - 10;
      expect(layout.laneAt((layout.xAt(lane, above) + layout.xAt(lane + 1, above)) / 2, above)).toBe(lane);
    }
    expect(layout.roadWidth(height)).toBeGreaterThan(layout.roadWidth(layout.hitY));
    expect(layout.frameTop).toBeLessThan(layout.hitY);
    expect(layout.laneAt(width / 2, 0)).toBe(2);
    expect(layout.laneAt(0, layout.hitY)).toBeNull();
  });
});

describe('timing and multi-touch judgment', () => {
  it('includes the exact judgment window boundaries', () => {
    expect(gradeFor(-0.045)).toBe('perfect'); expect(gradeFor(0.0451)).toBe('great');
    expect(gradeFor(0.09)).toBe('great'); expect(gradeFor(-0.14)).toBe('good'); expect(gradeFor(0.141)).toBe('miss');
  });
  it('classifies short directional swipes and rejects ambiguous/downward gestures', () => {
    expect(swipeDirection(23, 0)).toBeNull(); expect(swipeDirection(-30, 4)).toBe('left');
    expect(swipeDirection(32, 6)).toBe('right'); expect(swipeDirection(5, -30)).toBe('up');
    expect(swipeDirection(26, -26)).toBeNull(); expect(swipeDirection(0, 35)).toBeNull();
  });
  it('lets four lanes hit independently, without cross-triggering other lanes', () => {
    const engine = new JudgmentEngine(chartOf([0, 1, 2, 3].map(lane => ({ time: 1, type: 'tap', lane }))));
    for (let lane = 0; lane < 4; lane++) engine.input(lane, 1, 'press');
    expect(engine.counts.perfect).toBe(4); expect(engine.combo).toBe(4); expect(engine.result().score).toBe(1_000_000);
    engine.input(0, 1, 'press'); expect(engine.counts.perfect).toBe(4);
  });
  it('requires the correct gesture and judges its threshold time', () => {
    const engine = new JudgmentEngine(chartOf([{ time: 1, type: 'left', lane: 0 }]));
    engine.input(0, 0.99, 'press'); engine.input(0, 1, 'right'); engine.input(1, 1, 'left');
    expect(engine.judged).toBe(0); engine.input(0, 1.07, 'left'); expect(engine.counts.great).toBe(1);
  });
  it('scores hold head/tail equally and fails an early release', () => {
    const engine = new JudgmentEngine(chartOf([{ time: 1, endTime: 2, type: 'hold', lane: 0 }]));
    const state = engine.input(0, 1, 'press'); engine.release(state, 1.3); engine.update(3);
    expect(engine.counts).toEqual({ perfect: 1, great: 0, good: 0, miss: 1 }); expect(engine.result().score).toBe(500_000); expect(engine.combo).toBe(0);
  });
  it('finishes a held tail without requiring a timed release', () => {
    const engine = new JudgmentEngine(chartOf([{ time: 1, endTime: 2, type: 'hold', lane: 0 }]));
    const hold = engine.input(0, 1, 'press'); engine.update(2); engine.release(hold, 2.5);
    expect(engine.counts.perfect).toBe(2); expect(engine.result().score).toBe(1_000_000);
  });
  it('allows re-grabbing held notes during the resume countdown', () => {
    const engine = new JudgmentEngine(chartOf([{ time: 1, endTime: 3, type: 'hold', lane: 0 }]));
    engine.input(0, 1, 'press'); engine.suspendHolds();
    expect(engine.regrab(0)?.held).toBe(true); engine.resumeHolds(1.2); engine.update(3);
    expect(engine.counts.perfect).toBe(2); expect(engine.counts.miss).toBe(0);
  });
  it('fails a hold tail left ungrabbed after pause', () => {
    const engine = new JudgmentEngine(chartOf([{ time: 1, endTime: 3, type: 'hold', lane: 0 }]));
    engine.input(0, 1, 'press'); engine.suspendHolds(); engine.resumeHolds(1.2); engine.update(3);
    expect(engine.counts.miss).toBe(1); expect(engine.judged).toBe(2);
  });
  it('keeps autoplay holds intact across pause and resume', () => {
    const engine = new JudgmentEngine(chartOf([{ time: 1, endTime: 3, type: 'hold', lane: 0 }]), true);
    engine.update(1); engine.suspendHolds(); engine.resumeHolds(1.5); engine.update(3);
    expect(engine.counts.perfect).toBe(2); expect(engine.counts.miss).toBe(0);
  });
  it('flushes overdue misses before recording a new input between frames', () => {
    const engine = new JudgmentEngine(chartOf([{ time: 1, type: 'tap', lane: 0 }, { time: 1.27, type: 'tap', lane: 0 }]));
    engine.input(0, 1.15, 'press'); engine.update(1.16);
    expect(engine.counts.miss).toBe(1); expect(engine.combo).toBe(1);
  });
  it('counts both missed hold units, and autoplay finishes with perfect normalized score', () => {
    const chart = chartOf([{ time: 1, endTime: 2, type: 'hold', lane: 0 }, { time: 3, type: 'up', lane: 2 }]);
    const manual = new JudgmentEngine(chart); manual.update(4); expect(manual.counts.miss).toBe(3);
    const auto = new JudgmentEngine(chart, true); auto.update(1); auto.update(2); auto.update(4);
    expect(auto.result()).toMatchObject({ score: 1_000_000, accuracy: 100, maxCombo: 3, autoplay: true });
  });
});
