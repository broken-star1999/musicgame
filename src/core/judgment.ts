import type { Chart, Grade, Note, NoteType, Result } from '../types';

export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.14 };
export const WEIGHTS: Record<Grade, number> = { perfect: 1, great: 0.75, good: 0.4, miss: 0 };
export function gradeFor(delta: number): Grade {
  const error = Math.abs(delta);
  return error <= WINDOWS.perfect + 1e-9 ? 'perfect' : error <= WINDOWS.great + 1e-9 ? 'great' : error <= WINDOWS.good + 1e-9 ? 'good' : 'miss';
}
export function swipeDirection(dx: number, dy: number): NoteType | null {
  if (Math.hypot(dx, dy) < 24) return null;
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return dx < 0 ? 'left' : 'right';
  if (dy < 0 && Math.abs(dy) > Math.abs(dx) * 1.3) return 'up';
  return null;
}
export type NoteState = { note: Note; head?: Grade; tail?: Grade; held: boolean };
export interface Hit { lane: number; grade: Grade; at: number; type: NoteType }

export class JudgmentEngine {
  states: NoteState[];
  counts: Record<Grade, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  combo = 0;
  maxCombo = 0;
  earned = 0;
  judged = 0;
  total: number;
  hits: Hit[] = [];
  private cursor = 0;
  private laneIndices: number[][];
  private activeHolds = new Set<NoteState>();
  constructor(public chart: Chart, public autoplay = false) {
    this.states = chart.notes.map(note => ({ note, held: false }));
    this.total = chart.notes.reduce((sum, n) => sum + (n.type === 'hold' ? 2 : 1), 0);
    this.laneIndices = [0, 1, 2, 3].map(lane => this.states.flatMap((s, i) => s.note.lane === lane ? [i] : []));
  }
  private record(state: NoteState, grade: Grade, time: number, tail = false) {
    if (tail ? state.tail !== undefined : state.head !== undefined) return;
    if (tail) { state.tail = grade; state.held = false; this.activeHolds.delete(state); }
    else state.head = grade;
    this.counts[grade]++; this.judged++; this.earned += WEIGHTS[grade];
    this.combo = grade === 'miss' ? 0 : this.combo + 1; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.hits.push({ lane: state.note.lane, grade, at: time, type: state.note.type });
    if (this.hits.length > 20) this.hits.shift();
  }
  input(lane: number, time: number, action: 'press' | 'left' | 'right' | 'up'): NoteState | undefined {
    if (this.autoplay) return;
    this.update(time);
    for (const index of this.laneIndices[lane] || []) {
      const state = this.states[index];
      if (state.head !== undefined) continue;
      const delta = time - state.note.time;
      if (delta < -WINDOWS.good) break;
      if (delta > WINDOWS.good) continue;
      const matches = action === 'press' ? state.note.type === 'tap' || state.note.type === 'hold' : state.note.type === action;
      // The first unjudged note owns the lane's timing window.
      if (!matches) return;
      const grade = gradeFor(delta);
      this.record(state, grade, time);
      if (state.note.type === 'hold') { state.held = true; this.activeHolds.add(state); }
      return state;
    }
  }
  release(state: NoteState | undefined, time: number) {
    if (!state || !state.held || state.tail !== undefined) return;
    this.record(state, time >= state.note.endTime! - WINDOWS.great ? 'perfect' : 'miss', time, true);
  }
  update(time: number) {
    if (this.autoplay) {
      while (this.cursor < this.states.length && this.states[this.cursor].note.time <= time) {
        const state = this.states[this.cursor++];
        this.record(state, 'perfect', state.note.time);
        if (state.note.type === 'hold') { state.held = true; this.activeHolds.add(state); }
      }
    } else {
      while (this.cursor < this.states.length && this.states[this.cursor].note.time < time - WINDOWS.good) {
        const state = this.states[this.cursor++];
        if (state.head === undefined) {
          this.record(state, 'miss', time);
          if (state.note.type === 'hold') this.record(state, 'miss', time, true);
        }
      }
    }
    for (const state of this.activeHolds) if (time >= state.note.endTime!) this.record(state, 'perfect', state.note.endTime!, true);
  }
  // Pausing suspends timing and releases capture, but held notes can be re-grabbed.
  suspendHolds() { if (!this.autoplay) for (const state of this.activeHolds) state.held = false; }
  regrab(lane: number): NoteState | undefined {
    const state = [...this.activeHolds].find(s => s.note.lane === lane && !s.held);
    if (state) state.held = true;
    return state;
  }
  resumeHolds(time: number) {
    for (const state of this.activeHolds) if (!state.held) this.record(state, 'miss', time, true);
  }
  result(): Result {
    return { score: Math.round(this.earned / Math.max(1, this.total) * 1_000_000), accuracy: this.judged ? this.earned / this.judged * 100 : 100, maxCombo: this.maxCombo, counts: { ...this.counts }, autoplay: this.autoplay };
  }
}
