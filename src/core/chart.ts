import type { Analysis, Chart, Difficulty, Note, NoteType } from '../types';
import { reusePhraseTemplates } from './phrases';
import { fingerReleaseTime } from './chart-constraints';

export const DIFFICULTIES = {
  one: { label: '单指', english: '1 FINGER', description: '单指轮换，无双押；长按期间不插入其他操作。', gap: 0.3, threshold: 0.23, swipe: 0.06, chord: 0, max: 1 },
  two: { label: '二指', english: '2 FINGERS', description: '最多二指同时操作，可双押或长按配合单点。', gap: 0.23, threshold: 0.16, swipe: 0.1, chord: 0.14, max: 2 },
  three: { label: '三指', english: '3 FINGERS', description: '最多三指同时操作，加入三押与更多长按配合。', gap: 0.16, threshold: 0.105, swipe: 0.18, chord: 0.24, max: 3 },
  four: { label: '四指', english: '4 FINGERS', description: '最多四指同时操作，重音可出现四轨同时按键。', gap: 0.105, threshold: 0.055, swipe: 0.25, chord: 0.36, max: 4 },
} as const;

function randomFrom(text: string) {
  let state = 2166136261;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619);
  return () => { state += 0x6d2b79f5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function generateChart(analysis: Analysis, difficulty: Difficulty, bpmOverride?: number): Chart {
  const config = DIFFICULTIES[difficulty], random = randomFrom(analysis.fingerprint + difficulty);
  const bpm = bpmOverride || analysis.bpm, beat = 60 / bpm;
  const notes: Note[] = [], busyUntil = [-10, -10, -10, -10], fingerUntil = [-10, -10, -10, -10];
  let lastTime = -10, previousLane = -1;
  const strengthSorted = analysis.onsets.map(x => x.strength).sort((a, b) => a - b);
  const threshold = Math.min(config.threshold, strengthSorted[Math.floor(strengthSorted.length * 0.45)] || config.threshold);
  const anchor = analysis.onsets[0]?.time || 0;
  // Reserve a little breathing room before each phrase's strongest accent,
  // so a four-finger mode can actually place four keys instead of perpetually
  // finding one lane still recovering from the preceding fast note.
  const accents = new Map<number, number>();
  if (config.max > 1) analysis.onsets.forEach((onset, index) => {
    if (onset.strength <= 0.38 || onset.time > analysis.duration - 0.18) return;
    const phrase = Math.floor((onset.time - anchor) / (beat * 8)), current = accents.get(phrase);
    if (current === undefined || onset.strength > analysis.onsets[current].strength) accents.set(phrase, index);
  });
  const chordAnchors = new Set(accents.values()), accentTimes = [...chordAnchors].map(index => analysis.onsets[index].time);
  for (let i = 0; i < analysis.onsets.length; i++) {
    const onset = analysis.onsets[i];
    if (onset.strength < threshold || onset.time > analysis.duration - 0.18) continue;
    const grid = anchor + Math.round((onset.time - anchor) / (beat / 2)) * beat / 2;
    // Keep expressive/variable-tempo attacks; only snap if already very close.
    const time = Math.abs(grid - onset.time) < 0.025 ? grid : onset.time;
    const plannedChord = chordAnchors.has(i);
    if (!plannedChord && accentTimes.some(at => at > time && at - time < 0.29)) continue;
    if (time - lastTime < config.gap) continue;
    const active = fingerUntil.filter(x => x > time + 1e-6).length;
    if (active >= config.max) continue;
    const candidates = [0, 1, 2, 3].filter(l => busyUntil[l] <= time - 0.1 && l !== previousLane);
    if (!candidates.length) continue;
    const lane = candidates[(Math.floor(random() * candidates.length) + onset.band) % candidates.length];
    let type: NoteType = 'tap';
    let endTime: number | undefined;
    const energyAt = (t: number) => analysis.energy[Math.min(analysis.energy.length - 1, Math.floor(t / analysis.energyStep))] || 0;
    const sustain = [0.15, 0.3, 0.45].every(dt => energyAt(time + dt) > 0.18);
    if (sustain && random() < 0.15 && time + beat * 1.5 < analysis.duration - 0.2) {
      type = 'hold';
      endTime = Math.min(time + Math.max(0.5, Math.min(2, beat * (random() > 0.65 ? 3 : 1.5))), analysis.duration - 0.15);
    } else if (onset.strength > threshold * 1.3 && random() < config.swipe) {
      type = (['left', 'right', 'up'] as const)[Math.floor(random() * 3)];
    }
    const note: Note = { id: notes.length, lane, time, type, ...(endTime ? { endTime } : {}) };
    notes.push(note); fingerUntil[lane] = fingerReleaseTime(note);
    busyUntil[lane] = (endTime || time) + 0.16;
    previousLane = lane; lastTime = time;
    const chordLanes = [0, 1, 2, 3].filter(l => busyUntil[l] <= time - 0.1);
    const freeFingers = config.max - active - 1;
    if (plannedChord || (onset.strength > 0.38 && random() < config.chord)) {
      const extraNotes = plannedChord || onset.strength > 0.65 || random() < 0.4 ? freeFingers : Math.min(1, freeFingers);
      let added = 0;
      for (const other of chordLanes) {
        if (added >= extraNotes) break;
        notes.push({ id: notes.length, lane: other, time, type: 'tap' });
        busyUntil[other] = time + 0.18; fingerUntil[other] = time + 0.1; added++;
      }
    }
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((note, i) => { note.id = i; });
  return reusePhraseTemplates(analysis, { version: 3, fingerprint: analysis.fingerprint, difficulty, fingerLimit: config.max, duration: analysis.duration, bpm, notes }, config.max);
}

export function countTypes(chart: Chart) {
  return chart.notes.reduce((counts, note) => { counts[note.type]++; return counts; }, { tap: 0, hold: 0, left: 0, right: 0, up: 0 });
}
