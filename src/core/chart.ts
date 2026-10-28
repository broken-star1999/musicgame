import type { Analysis, Chart, Difficulty, Note, NoteType } from '../types';

export const DIFFICULTIES = {
  easy: { label: '简单', english: 'EASY', gap: 0.25, threshold: 0.2, swipe: 0.08, chord: 0.05, max: 2 },
  normal: { label: '普通', english: 'NORMAL', gap: 0.16, threshold: 0.105, swipe: 0.17, chord: 0.16, max: 3 },
  hard: { label: '困难', english: 'HARD', gap: 0.105, threshold: 0.055, swipe: 0.25, chord: 0.3, max: 4 },
} as const;

function randomFrom(text: string) {
  let state = 2166136261;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619);
  return () => { state += 0x6d2b79f5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function generateChart(analysis: Analysis, difficulty: Difficulty, bpmOverride?: number): Chart {
  const config = DIFFICULTIES[difficulty], random = randomFrom(analysis.fingerprint + difficulty);
  const bpm = bpmOverride || analysis.bpm, beat = 60 / bpm;
  const notes: Note[] = [], busyUntil = [-10, -10, -10, -10];
  let lastTime = -10, previousLane = -1;
  const strengthSorted = analysis.onsets.map(x => x.strength).sort((a, b) => a - b);
  const threshold = Math.min(config.threshold, strengthSorted[Math.floor(strengthSorted.length * 0.45)] || config.threshold);
  const anchor = analysis.onsets[0]?.time || 0;
  for (let i = 0; i < analysis.onsets.length; i++) {
    const onset = analysis.onsets[i];
    if (onset.strength < threshold || onset.time > analysis.duration - 0.18) continue;
    const grid = anchor + Math.round((onset.time - anchor) / (beat / 2)) * beat / 2;
    // Keep expressive/variable-tempo attacks; only snap if already very close.
    const time = Math.abs(grid - onset.time) < 0.025 ? grid : onset.time;
    if (time - lastTime < config.gap) continue;
    const active = busyUntil.filter(x => x > time).length;
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
    notes.push({ id: notes.length, lane, time, type, ...(endTime ? { endTime } : {}) });
    busyUntil[lane] = (endTime || time) + 0.16;
    previousLane = lane; lastTime = time;
    const chordLanes = [0, 1, 2, 3].filter(l => busyUntil[l] <= time - 0.1);
    let freeFingers = config.max - active - 1;
    if (onset.strength > 0.38 && random() < config.chord) {
      for (const other of chordLanes) {
        if (freeFingers-- <= 0) break;
        notes.push({ id: notes.length, lane: other, time, type: 'tap' });
        busyUntil[other] = time + 0.18;
        if (random() < 0.65) break;
      }
    }
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((note, i) => { note.id = i; });
  return { version: 1, fingerprint: analysis.fingerprint, difficulty, duration: analysis.duration, bpm, notes };
}

export function countTypes(chart: Chart) {
  return chart.notes.reduce((counts, note) => { counts[note.type]++; return counts; }, { tap: 0, hold: 0, left: 0, right: 0, up: 0 });
}
