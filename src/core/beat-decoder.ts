import type { Rhythm } from '../types';

const FPS = 50;
const sigmoid = (value: number) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));

/** The published model's minimal +/- 3 frame peak picker. */
export function neuralPeaks(logits: Float32Array, channel = 0): number[] {
  const peaks: number[] = [], frames = logits.length / 2;
  let group: number[] = [];
  const flush = () => { if (group.length) peaks.push(group.reduce((sum, frame) => sum + frame, 0) / group.length / FPS); group = []; };
  for (let frame = 0; frame < frames; frame++) {
    const value = logits[frame * 2 + channel];
    let maximum = value > 0;
    for (let nearby = Math.max(0, frame - 3); maximum && nearby <= Math.min(frames - 1, frame + 3); nearby++) if (logits[nearby * 2 + channel] > value) maximum = false;
    if (!maximum) continue;
    if (group.length && frame - group.at(-1)! > 1) flush();
    group.push(frame);
  }
  flush();
  return peaks;
}

/** Beat-phase/tempo Viterbi decoder, following the standard DBN beat-state
 * formulation. States advance deterministically within a beat. Tempo can
 * change only at beat boundaries, with an exponential continuity prior.
 * Backpointers are stored only at boundaries, keeping memory O(T * tempi). */
export function decodeBeatClock(logits: Float32Array, tightness = 200): Rhythm {
  const frames = logits.length / 2, raw = neuralPeaks(logits);
  if (raw.length < 3) return { beats: raw, tempo: [], confidence: 0, downbeats: [], meterConfidence: 0 };
  const intervals = Array.from({ length: 91 }, (_, i) => i + 10), offsets: number[] = [];
  let states = 0;
  for (const interval of intervals) { offsets.push(states); states += interval; }
  let previous = new Float64Array(states), next = new Float64Array(states);
  const pointers = new Uint8Array(frames * intervals.length).fill(255);
  const transitionCosts = intervals.map(interval => intervals.map(before => -tightness * Math.abs(interval / before - 1)));
  const normalizers = intervals.map((_, before) => Math.log(transitionCosts.reduce((sum, row) => sum + (row[before] >= -20 ? Math.exp(row[before]) : 0), 0)));
  const transitions = transitionCosts.map(row => row.map((cost, index) => ({ index, cost: cost - normalizers[index], allowed: cost >= -20 })).filter(item => item.allowed));
  for (let frame = 0; frame < frames; frame++) {
    const probability = Math.max(1e-8, Math.min(1 - 1e-8, sigmoid(logits[frame * 2])));
    const beatLog = Math.log(probability), otherLog = Math.log((1 - probability) / 15);
    let largest = -Infinity;
    for (let index = 0; index < intervals.length; index++) {
      const interval = intervals[index], offset = offsets[index], width = Math.max(1, Math.ceil(interval / 16));
      let best = -Infinity, beforeIndex = 255;
      for (const transition of transitions[index]) {
        const value = previous[offsets[transition.index] + intervals[transition.index] - 1] + transition.cost;
        if (value > best) { best = value; beforeIndex = transition.index; }
      }
      next[offset] = best + beatLog;
      pointers[frame * intervals.length + index] = frame === 0 ? 255 : beforeIndex;
      largest = Math.max(largest, next[offset]);
      for (let phase = 1; phase < interval; phase++) {
        const value = previous[offset + phase - 1] + (phase < width ? beatLog : otherLog);
        next[offset + phase] = value; largest = Math.max(largest, value);
      }
    }
    // Bound cumulative magnitudes on long recordings; all path comparisons
    // preserve the same additive constant.
    if (frame % 256 === 255) for (let state = 0; state < states; state++) next[state] -= largest;
    [previous, next] = [next, previous];
  }
  let best = -Infinity, index = 0, phase = 0;
  for (let i = 0; i < intervals.length; i++) for (let p = 0; p < intervals[i]; p++) {
    if (previous[offsets[i] + p] > best) { best = previous[offsets[i] + p]; index = i; phase = p; }
  }
  let frame = frames - 1 - phase;
  const beats: number[] = [];
  while (frame >= 0) {
    const width = Math.max(1, Math.ceil(intervals[index] / 16));
    let peak = frame;
    for (let at = frame; at < Math.min(frames, frame + width); at++) if (logits[at * 2] > logits[peak * 2]) peak = at;
    beats.push(peak / FPS);
    const before = pointers[frame * intervals.length + index];
    if (before === 255) break;
    frame -= intervals[before]; index = before;
  }
  beats.reverse();
  const first = raw[0] - 0.15, last = raw.at(-1)! + 0.15;
  const proposed = beats.filter(time => time >= first && time <= last);
  const preserved = raw.filter(time => proposed.some(beat => Math.abs(beat - time) <= 0.07)).length / raw.length;
  // A tempo prior may repair isolated extra/missing peaks, but must not replace
  // the model with an unrelated phase or silently discard half its clear beats.
  // Keep the published peak output whenever the proposed clock changes >25%.
  const retained = preserved >= 0.75 && proposed.length >= raw.length * 0.75 && proposed.length <= raw.length * 1.25 ? proposed : raw;
  const support = retained.reduce((sum, time) => sum + sigmoid(logits[Math.round(time * FPS) * 2]), 0) / Math.max(1, retained.length);
  const coverage = retained.filter(time => logits[Math.round(time * FPS) * 2] > 0).length / Math.max(1, retained.length);
  const agreement = raw.filter(time => retained.some(beat => Math.abs(beat - time) <= 0.07)).length / raw.length;
  const confidence = 0.5 * support + 0.3 * coverage + 0.2 * agreement;
  const downbeats = [...new Set(neuralPeaks(logits, 1).map(time => { const beat = retained.reduce((nearest, at) => Math.abs(at - time) < Math.abs(nearest - time) ? at : nearest, Infinity); return Math.abs(beat - time) <= 0.1 ? beat : Infinity; }).filter(Number.isFinite))];
  // An individual 20 ms output step is too coarse for a useful BPM estimate.
  // Average neighboring intervals without moving any of the actual beat times.
  const tempo = retained.slice(1).map((time, i) => { const from = Math.max(0, i - 3), to = Math.min(retained.length - 1, i + 4); return { time, bpm: 60 * (to - from) / (retained[to] - retained[from]) }; });
  return { beats: retained, tempo, confidence, downbeats, meterConfidence: downbeats.length >= 2 ? confidence : 0 };
}
