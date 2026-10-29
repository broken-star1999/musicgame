import type { Analysis, Onset, Rhythm } from '../types';
import { beatPosition, timeAtBeat } from './rhythm';

/** Bind game events to measured attacks near the learned beat clock. Beat
 * hypotheses by themselves never create notes in a rest or a silent intro. */
export function musicalEvents(analysis: Analysis, rhythm: Rhythm): Onset[] {
  if (rhythm.beats.length < 2) return [];
  const candidates = analysis.candidates ?? analysis.onsets;
  const events: Onset[] = [];
  const used = new Set<Onset>();
  const pick = (target: number, tolerance: number, role: NonNullable<Onset['role']>) => {
    let best: Onset | undefined, bestScore = -Infinity;
    for (const candidate of candidates) {
      if (used.has(candidate) || candidate.time < 0 || candidate.time > analysis.duration - 0.18) continue;
      const distance = Math.abs(candidate.time - target);
      if (distance > tolerance || candidate.strength < 0.08) continue;
      const score = (1 - distance / tolerance) * 0.75 + Math.min(1, candidate.strength) * 0.25;
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    if (best) { used.add(best); events.push({ ...best, role }); }
  };
  for (let i = 0; i < rhythm.beats.length; i++) {
    const at = rhythm.beats[i], span = i + 1 < rhythm.beats.length ? rhythm.beats[i + 1] - at : at - rhythm.beats[i - 1];
    pick(at, Math.min(0.09, span * 0.2), 'beat');
  }
  for (let i = 0; i + 1 < rhythm.beats.length; i++) {
    const at = rhythm.beats[i], span = rhythm.beats[i + 1] - at;
    pick(at + span * 0.5, Math.min(0.05, span * 0.12), 'half');
    for (const fraction of [0.25, 0.75]) pick(at + span * fraction, Math.min(0.03, span * 0.07), 'quarter');
  }
  // Strong expressive attacks can supplement the hardest mode, but must be
  // distinct from already selected events. No arbitrary time quantization.
  for (const candidate of candidates) {
    if (candidate.strength < 0.7 || candidate.time > analysis.duration - 0.18 || events.some(event => Math.abs(event.time - candidate.time) < 0.1)) continue;
    const position = beatPosition(rhythm.beats, candidate.time, analysis.bpm);
    if (candidate.time < rhythm.beats[0] - 0.15 || candidate.time > rhythm.beats.at(-1)! + 0.15) continue;
    const beat = Math.floor(position), end = timeAtBeat(rhythm.beats, beat + 1, analysis.bpm);
    if (!events.some(event => event.role === 'free' && event.time >= timeAtBeat(rhythm.beats, beat, analysis.bpm) && event.time < end)) events.push({ ...candidate, role: 'free' });
  }
  return events.sort((a, b) => a.time - b.time || (a.role === 'beat' ? -1 : 1));
}
