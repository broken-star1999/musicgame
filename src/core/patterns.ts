import type { Analysis } from '../types';
import { beatPosition, timeAtBeat } from './rhythm';

const MOTIFS = [
  { name: '交替', lanes: [0, 2, 1, 3, 0, 2, 1, 3] },
  { name: '阶梯', lanes: [0, 1, 2, 3, 2, 1, 0, 1] },
  { name: '回转', lanes: [1, 2, 3, 2, 1, 0, 1, 2] },
  { name: '呼应', lanes: [0, 1, 0, 1, 2, 3, 2, 3] },
  { name: '展开', lanes: [1, 2, 0, 3, 1, 2, 0, 3] },
] as const;

export function phrasePattern(analysis: Analysis, beats: number[], bpm: number, time: number, fingers: number, cache = new Map<number, number>()) {
  const position = beatPosition(beats, time, bpm), phrase = Math.floor(position / 8);
  // The signature describes rhythm, not the absolute phrase number: repeated
  // rhythmic phrases choose the same vocabulary before tonal matching.
  let signature = cache.get(phrase);
  if (signature === undefined) {
    signature = 17;
    for (const event of analysis.onsets) {
      const at = beatPosition(beats, event.time, bpm);
      if (at >= phrase * 8 && at < (phrase + 1) * 8) signature = Math.imul(signature ^ Math.round((at - phrase * 8) * 4), 31) >>> 0;
    }
    cache.set(phrase, signature);
  }
  const motif = MOTIFS[signature % MOTIFS.length];
  const lanes: readonly number[] = fingers === 1 ? [1, 2, 1, 2, 2, 1, 2, 1] : motif.lanes;
  const start = timeAtBeat(beats, phrase * 8, bpm);
  const event = analysis.onsets.filter(onset => onset.time >= start - 0.025 && onset.time < time - 0.025).length;
  return { name: fingers === 1 ? '邻轨轮换' : motif.name, lane: lanes[event % lanes.length], phase: position - phrase * 8 };
}

function pitchAt(analysis: Analysis, time: number): number[] | undefined {
  return analysis.chroma?.[Math.max(0, Math.min(analysis.chroma.length - 1, Math.floor(time / (analysis.chromaStep || 0.05))))];
}

/** A hold needs a newly activated pitch component at this attack. A pad
 * already sounding before a drum hit cannot lend that drum a fake duration. */
export function sustainedEnd(analysis: Analysis, time: number, beat: number): number | undefined {
  if (!analysis.tonalEnergy?.length) return undefined;
  const step = analysis.chromaStep || 0.05;
  const tonalAt = (at: number) => analysis.tonalEnergy![Math.floor(at / step)];
  const before = Array<number>(12).fill(0), after = Array<number>(12).fill(0);
  let beforeCount = 0, afterCount = 0;
  for (const offset of [-0.25, -0.2, -0.15]) {
    const frame = tonalAt(time + offset);
    if (frame) { beforeCount++; frame.forEach((value, k) => { before[k] += value; }); }
  }
  for (const offset of [0.1, 0.15, 0.2]) {
    const frame = tonalAt(time + offset);
    if (frame) { afterCount++; frame.forEach((value, k) => { after[k] += value; }); }
  }
  before.forEach((value, k) => { before[k] = value / Math.max(1, beforeCount); });
  after.forEach((value, k) => { after[k] = value / Math.max(1, afterCount); });
  const total = after.reduce((sum, value) => sum + value, 0), pitch = pitchAt(analysis, time + 0.15);
  let component = -1, largestGain = 0;
  for (let k = 0; k < 12; k++) {
    const gain = after[k] - before[k] * 1.35;
    if (after[k] > Math.max(1e-6, before[k] * 1.8, total * 0.12) && (pitch?.[k] || 0) > 0.2 && gain > largestGain) { component = k; largestGain = gain; }
  }
  if (component < 0) return undefined;
  let end = time, supported = 0;
  const maxEnd = Math.min(analysis.duration - 0.2, time + Math.min(2.2, beat * 4));
  const floor = Math.max(after[component] * 0.35, before[component] * 1.3);
  for (let t = time + 0.1; t <= maxEnd; t += step) {
    const level = tonalAt(t)?.[component] || 0;
    if (level < floor) { if (t > time + 0.35) break; continue; }
    end = t; supported++;
  }
  return end - time >= Math.max(0.5, beat) && supported * step >= (end - time) * 0.7 ? end : undefined;
}

/** Gestures are phrase choreography. Pitch classes are circular and cannot
 * establish ascending/descending melody or octave motion. */
export function phraseSwipe(_analysis: Analysis, _time: number, phase: number): 'left' | 'right' | 'up' {
  if (Math.round(phase * 2) % 7 === 0) return 'up';
  return Math.round(phase) % 2 === 0 ? 'left' : 'right';
}
