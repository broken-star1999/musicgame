import type { Note } from '../types';

// Reserve time to finish a swipe or lift after a hold before reusing a finger.
export function fingerReleaseTime(note: Note): number {
  return note.type === 'hold' ? note.endTime! + 0.14 : note.time + (note.type === 'tap' ? 0.1 : 0.18);
}

export function peakFingers(notes: Note[]): number {
  const events = notes.flatMap(note => [
    { at: Math.round(note.time * 1e6), change: 1 },
    { at: Math.round(fingerReleaseTime(note) * 1e6), change: -1 },
  ]).sort((a, b) => a.at - b.at || a.change - b.change);
  let active = 0, peak = 0;
  for (const event of events) { active += event.change; peak = Math.max(peak, active); }
  return peak;
}

/** Check both lane collisions and the hands needed by the complete timeline. */
export function isPlayableChart(notes: Note[], maxFingers: number, duration: number): boolean {
  const laneEnds = [-100, -100, -100, -100], fingerEnds = [-100, -100, -100, -100];
  let previous = -Infinity;
  for (const note of notes) {
    if (!Number.isInteger(note.lane) || note.lane < 0 || note.lane > 3 || !Number.isFinite(note.time) || note.time < 0 || note.time < previous) return false;
    if (note.type === 'hold' && (!Number.isFinite(note.endTime) || note.endTime! <= note.time)) return false;
    const end = note.endTime ?? note.time;
    if (note.time - laneEnds[note.lane] < 0.1 - 1e-6 || end > duration - 0.1) return false;
    if (fingerEnds.filter(until => until > note.time + 1e-6).length >= maxFingers) return false;
    laneEnds[note.lane] = end; fingerEnds[note.lane] = fingerReleaseTime(note); previous = note.time;
  }
  return true;
}
