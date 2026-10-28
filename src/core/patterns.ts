import type { Analysis, NoteType } from '../types';
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

/** Sustained energy AND stable tonal evidence; duration follows the signal. */
export function sustainedEnd(analysis: Analysis, time: number, beat: number): number | undefined {
  const at = pitchAt(analysis, time + 0.15);
  let end = time, supported = 0;
  const maxEnd = Math.min(analysis.duration - 0.2, time + Math.min(2.2, beat * 4));
  for (let t = time + 0.1; t <= maxEnd; t += 0.05) {
    const energy = analysis.energy[Math.floor(t / analysis.energyStep)] || 0;
    const pitch = pitchAt(analysis, t);
    const similarity = at && pitch ? at.reduce((sum, value, k) => sum + value * pitch[k], 0) : 1;
    if (energy < 0.18 || similarity < 0.72) { if (t > time + 0.35) break; continue; }
    end = t; supported++;
  }
  return end - time >= Math.max(0.5, beat) && supported * 0.05 >= (end - time) * 0.7 ? end : undefined;
}

/** Swipe direction is game choreography, guided by local melodic movement. */
export function phraseSwipe(analysis: Analysis, time: number, phase: number): NoteType {
  const before = pitchAt(analysis, time - 0.12), after = pitchAt(analysis, time + 0.12);
  const centroid = (values: number[]) => values.reduce((sum, value, k) => sum + value * k, 0) / Math.max(1e-6, values.reduce((a, b) => a + b, 0));
  const movement = before && after ? centroid(after) - centroid(before) : 0;
  if (movement > 0.7 || Math.round(phase * 2) % 7 === 0) return 'up';
  return movement < -0.5 || Math.round(phase * 2) % 2 === 0 ? 'left' : 'right';
}
