import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeAudio, estimateTempo } from './analysis';
import { generateChart } from './chart';
import type { Analysis } from '../types';
import * as source from './rhythm-source';
import * as clock from './rhythm';

const RATE = 22050;

// Ground truth is the independently scheduled waveform attack, including an
// attack at sample zero. No FFT frame or detector offset is used to make it.
function drums(times: number[]): Float32Array {
  const samples = new Float32Array(Math.ceil((times.at(-1)! + 1) * RATE));
  for (const time of times) {
    const start = Math.round(time * RATE);
    for (let i = 0; i < Math.floor(RATE * 0.12); i++) {
      const t = i / RATE;
      samples[start + i] += Math.sin(2 * Math.PI * 100 * t) * Math.min(1, t * 1000) * Math.exp(-t * 45);
    }
  }
  return samples;
}

function expectMeasuredAttacks(analysis: Analysis, truth: number[]) {
  // Test both detectors: the chosen pulse can come from a band even if the
  // mixed detector has already recovered the first attack, or vice versa.
  for (const found of [analysis.onsets, analysis.pulse!.onsets]) {
    expect(found).toHaveLength(truth.length);
    truth.forEach(time => expect(Math.min(...found.map(onset => Math.abs(onset.time - time)))).toBeLessThan(0.05));
    found.forEach(onset => expect(Math.min(...truth.map(time => Math.abs(onset.time - time)))).toBeLessThan(0.05));
  }
}

describe('signal onset detection at the start of a file', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps the sample-zero drum together with all later beats in a playable chart', () => {
    const truth = Array.from({ length: 20 }, (_, i) => i * 0.5), analysis = analyzeAudio(drums(truth), RATE);
    expectMeasuredAttacks(analysis, truth);
    const chart = generateChart(analysis, 'one');
    expect(chart.notes).toHaveLength(truth.length);
    truth.forEach(time => expect(Math.min(...chart.notes.map(note => Math.abs(note.time - time)))).toBeLessThan(0.05));
    expect(chart.notes[0].time).toBeGreaterThanOrEqual(0);
    expect(chart.notes[0].time).toBeLessThan(0.05);
    const opening = analysis.pulse!.onsets[0];
    expect(opening.boundary).toBe(true);
    expect(opening.role).toBeUndefined();
    expect(analysis.pulse!.onsets.filter(event => !event.boundary)).toHaveLength(truth.length - 1);
  });

  it.each([0.1, 1.2])('preserves attacks and leaves a %f second silent lead empty', lead => {
    const truth = Array.from({ length: 20 }, (_, i) => lead + i * 0.5), analysis = analyzeAudio(drums(truth), RATE);
    expectMeasuredAttacks(analysis, truth);
    expect(analysis.onsets.every(onset => onset.time >= lead - 0.05)).toBe(true);
    expect(analysis.pulse!.onsets.every(onset => onset.time >= lead - 0.05)).toBe(true);
  });

  it('preserves real irregular attack times rather than adding a fixed-rate first note', () => {
    const truth = [0, 0.57, 1.19, 1.92, 2.76, 3.87];
    const analysis = analyzeAudio(drums(truth), RATE);
    // The independent source planner may retain a subset for an irregular
    // rhythm. The detector must recover every attack, and neither output may
    // invent a metronome event in place of a real waveform attack.
    expect(analysis.onsets).toHaveLength(truth.length);
    truth.forEach(time => expect(Math.min(...analysis.onsets.map(onset => Math.abs(onset.time - time)))).toBeLessThan(0.05));
    [...analysis.onsets, ...analysis.pulse!.onsets].forEach(onset => expect(Math.min(...truth.map(time => Math.abs(onset.time - time)))).toBeLessThan(0.05));
    expect(analysis.onsets[0].time).toBeLessThan(0.05);
  });

  it('still rejects silence without fabricating an opening attack', () => {
    expect(() => analyzeAudio(new Float32Array(RATE * 4), RATE)).toThrow(/静音/);
  });

  it('requires three regular attacks rather than counting the possible boundary cue', () => {
    expect(() => analyzeAudio(drums([0, 0.5, 1]), RATE)).toThrow(/足够的声音起点/);
  });

  it('keeps the boundary out of source, tempo and clock inference and restores only its selected band', () => {
    const select = vi.spyOn(source, 'followRhythmSource'), track = vi.spyOn(clock, 'trackBeats');
    const analysis = analyzeAudio(drums(Array.from({ length: 20 }, (_, i) => i * 0.5)), RATE);
    expect(select).toHaveBeenCalledTimes(1); expect(track).toHaveBeenCalledTimes(1);
    const [streams, mixed] = select.mock.calls[0], chosen = select.mock.results[0].value;
    expect([...mixed, ...streams.flat()].every(event => !event.boundary && event.time > 0.05)).toBe(true);
    expect(mixed).toEqual(analysis.onsets.filter(event => !event.boundary));
    expect(track.mock.calls[0][0]).toBe(chosen.onsets);
    expect(analysis.rhythm).toBe(track.mock.results[0].value);
    const tempo = estimateTempo(chosen.onsets);
    expect({ bpm: analysis.bpm, confidence: analysis.confidence }).toEqual(tempo);
    const openingBand = chosen.sections[0].band;
    const expected = openingBand === 'mixed' ? analysis.onsets.find(event => event.boundary)
      : analysis.candidates!.find(event => event.boundary && !analysis.onsets.includes(event) && event.band === ['low', 'mid', 'high'].indexOf(openingBand));
    expect(analysis.pulse!.onsets[0]).toBe(expected);
    expect(analysis.pulse!.onsets[0].role).toBeUndefined();
    expect(analysis.pulse!.onsets.filter(event => !event.boundary).map(({ role: _role, ...event }) => event)).toEqual(chosen.onsets);
  });

  it('does not let a strong boundary peak swallow a nearby measured attack before inference', () => {
    const select = vi.spyOn(source, 'followRhythmSource');
    const truth = [0, ...Array.from({ length: 20 }, (_, i) => 0.05 + i * 0.5)];
    const analysis = analyzeAudio(drums(truth), RATE), regularMixed = select.mock.calls[0][1];
    expect(analysis.onsets.some(event => event.boundary)).toBe(true);
    expect(regularMixed.some(event => Math.abs(event.time - 0.05) < 0.025)).toBe(true);
    // A nearby regular cue takes precedence over the unconfirmed opening edge.
    expect(analysis.pulse!.onsets.some(event => event.time < 0.09 && !event.boundary)).toBe(true);
    expect(analysis.pulse!.onsets.every(event => !event.boundary)).toBe(true);
    expect(regularMixed.every(event => !event.boundary)).toBe(true);
  });

  it('does not turn the beginning of a sustained tone into a playable sequence of drum beats', () => {
    const tone = Float32Array.from({ length: RATE * 4 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / RATE) * 0.25);
    expect(() => analyzeAudio(tone, RATE)).toThrow(/足够的声音起点/);
  });
});

describe('boundary cues stay at measured time when compiling a chart', () => {
  it.each([undefined, 118])('does not extrapolate a boundary before zero with reference %s', bpmOverride => {
    const beats = Array.from({ length: 16 }, (_, i) => 0.76 + i * 0.51);
    const regular = beats.map(time => ({ time, strength: 0.7, band: 0, role: 'beat' as const }));
    const boundary: Analysis['onsets'][number] = { time: 1024 * 0.22 / RATE, strength: 1, band: 0, boundary: true };
    const analysis: Analysis = {
      duration: 10, bpm: 117, confidence: 0.9, fingerprint: 'boundary-before-grid',
      onsets: [boundary, ...regular], pulse: { onsets: [boundary, ...regular], sections: [] },
      energy: [], energyStep: 0.05, waveform: [],
      rhythm: { beats, tempo: [], confidence: 0.9, downbeats: [], meterConfidence: 0 },
    };
    // This valid extrapolated grid would snap the cue to -5ms automatically
    // (also negative at the explicit 118 BPM reference), failing validation.
    expect(clock.snapToBeat(boundary.time, clock.chartBeats(analysis, bpmOverride), bpmOverride ?? analysis.bpm)).toBeLessThan(0);
    const chart = generateChart(analysis, 'one', bpmOverride);
    expect(chart.notes.every(note => note.time >= 0)).toBe(true);
    expect(chart.notes[0].time).toBe(boundary.time);
    const control = generateChart({ ...analysis, onsets: regular, pulse: { ...analysis.pulse!, onsets: regular } }, 'one', bpmOverride);
    expect(chart.notes.slice(1).map(note => note.time)).toEqual(control.notes.map(note => note.time));
    expect(boundary.role).toBeUndefined();
  });

  it('keeps a real sample-zero attack playable before a later 0.51s drum sequence', () => {
    const truth = [0, ...Array.from({ length: 18 }, (_, i) => 0.79 + i * 0.51)];
    const analysis = analyzeAudio(drums(truth), RATE), boundary = analysis.pulse!.onsets.find(event => event.boundary)!;
    expect(boundary).toBeDefined(); expect(boundary.role).toBeUndefined();
    const regular = analysis.pulse!.onsets.filter(event => !event.boundary);
    const control: Analysis = { ...analysis, onsets: analysis.onsets.filter(event => !event.boundary), pulse: { ...analysis.pulse!, onsets: regular } };
    for (const bpmOverride of [undefined, 118]) {
      expect(clock.snapToBeat(boundary.time, clock.chartBeats(analysis, bpmOverride), bpmOverride ?? analysis.bpm)).toBeLessThan(0);
      const chart = generateChart(analysis, 'one', bpmOverride), withoutBoundary = generateChart(control, 'one', bpmOverride);
      expect(chart.notes.every(note => note.time >= 0)).toBe(true);
      expect(chart.notes[0].time).toBe(boundary.time);
      expect(chart.notes.slice(1).map(note => note.time)).toEqual(withoutBoundary.notes.map(note => note.time));
    }
    expect(analysis.pulse!.onsets.find(event => event.boundary)).toBe(boundary);
    expect(boundary.role).toBeUndefined();
  });
});
