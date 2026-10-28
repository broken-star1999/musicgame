import type { Note } from '../types';
import { fingerReleaseTime, isPlayableChart } from './chart-constraints';

export const FINGER_MODEL = 'ordered-touch-v1';
const EPS = 1e-6;
type Finger = { lane: number; freeAt: number; lastAt: number; strain: number };
type Link = { previous?: Link; note: Note };
type State = { fingers: Finger[]; laneEnds: number[]; cost: number; peak: number; tail?: Link; adjusted: number; omitted: number };
export interface FingerPlan { notes: Note[]; adjusted: number; omitted: number; peakStrain: number; cost: number }

/** Travel budget in lane widths at a common touch height, independent of scroll speed. */
export function minimumTravelTime(distance: number): number { return distance < 0.05 ? 0 : 0.05 + distance * 0.09; }

function initial(fingers: number, mirror = false): State {
  const homes = fingers === 1 ? [1.5] : fingers === 2 ? [0.5, 2.5] : fingers === 3 ? (mirror ? [0.25, 1.75, 2.75] : [0.25, 1.25, 2.75]) : [0, 1, 2, 3];
  return { fingers: homes.map(lane => ({ lane, freeAt: -100, lastAt: -100, strain: 0 })), laneEnds: [-100, -100, -100, -100], cost: 0, peak: 0, adjusted: 0, omitted: 0 };
}

function assign(state: State, note: Note, finger: number, lane: number): State | null {
  const current = state.fingers[finger], distance = Math.abs(current.lane - lane);
  if (current.freeAt > note.time + EPS || note.time - current.freeAt + EPS < minimumTravelTime(distance) || note.time - current.lastAt < 0.12 - EPS) return null;
  if (note.time - state.laneEnds[lane] < 0.1 - EPS) return null;
  for (let i = 0; i < state.fingers.length; i++) {
    if (i === finger) continue;
    const other = state.fingers[i];
    // A finger must not cross a captured/held finger, nor occupy its lane.
    if (other.freeAt > note.time + EPS && (Math.abs(lane - other.lane) < 0.5 || (i < finger ? lane < other.lane : lane > other.lane))) return null;
  }
  const elapsed = Math.max(0.12, note.time - current.lastAt), strain = current.strain * Math.exp(-elapsed / 0.8) + 0.3 / elapsed;
  const movement = distance * distance / Math.max(0.15, Math.min(2, note.time - current.freeAt));
  const fingers = [...state.fingers]; fingers[finger] = { lane, freeAt: fingerReleaseTime(note), lastAt: note.time, strain };
  const laneEnds = [...state.laneEnds]; laneEnds[lane] = note.endTime ?? note.time;
  const adjusted = lane !== note.lane;
  const home = state.fingers.length === 4 ? Math.abs(finger - lane) * 0.35 : 0;
  return {
    fingers, laneEnds, cost: state.cost + movement * 0.18 + strain * 0.12 + Math.abs(lane - note.lane) * 1.4 + home,
    peak: Math.max(state.peak, strain), adjusted: state.adjusted + Number(adjusted), omitted: state.omitted,
    tail: { previous: state.tail, note: { ...note, lane, finger } },
  };
}

/** Beam search over the entire recording. Lane changes precede last-resort omissions. */
export function planFingering(notes: Note[], fingers: number, allowLaneChanges = true, beamWidth = 24): FingerPlan {
  let beam = fingers === 3 ? [initial(fingers), initial(fingers, true)] : [initial(fingers)];
  for (const note of notes) {
    const next: State[] = [];
    const lanes = allowLaneChanges ? [note.lane, ...[0, 1, 2, 3].filter(lane => lane !== note.lane).sort((a, b) => Math.abs(a - note.lane) - Math.abs(b - note.lane))] : [note.lane];
    for (const state of beam) for (const lane of lanes) for (let finger = 0; finger < fingers; finger++) {
      const candidate = assign(state, note, finger, lane); if (candidate) next.push(candidate);
    }
    if (!next.length) {
      // The music timestamp is never moved to solve a hand conflict.
      beam = beam.map(state => ({ ...state, omitted: state.omitted + 1, cost: state.cost + 100 + (note.strength ?? 0.5) * 100 }));
      continue;
    }
    next.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>(); beam = [];
    for (const state of next) {
      const key = state.fingers.map(f => `${f.lane}:${Math.round(f.freeAt * 1000)}:${Math.round(f.lastAt * 1000)}`).join('|') + '/' + state.laneEnds.map(t => Math.round(t * 1000)).join(',');
      if (seen.has(key)) continue;
      seen.add(key); beam.push(state); if (beam.length >= beamWidth) break;
    }
  }
  const best = beam.sort((a, b) => a.cost - b.cost)[0], output: Note[] = [];
  for (let link = best.tail; link; link = link.previous) output.push(link.note);
  output.reverse();
  // Re-laning a chord can change lane order; preserve a stable canonical ordering.
  output.sort((a, b) => a.time - b.time || a.lane - b.lane);
  return { notes: output.map((note, id) => ({ ...note, id })), adjusted: best.adjusted, omitted: best.omitted, peakStrain: best.peak, cost: best.cost };
}

/** Replay the explicit proof without searching or silently dropping any notes. */
export function validateFingering(notes: Note[], fingers: number, duration: number): boolean {
  if (!isPlayableChart(notes, fingers, duration)) return false;
  for (const mirror of fingers === 3 ? [false, true] : [false]) {
    let state: State | null = initial(fingers, mirror);
    for (const note of notes) {
      if (!Number.isInteger(note.finger) || note.finger! < 0 || note.finger! >= fingers) { state = null; break; }
      state = assign(state, note, note.finger!, note.lane); if (!state) break;
    }
    if (state) return true;
  }
  return false;
}
