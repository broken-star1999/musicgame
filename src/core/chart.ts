import type { Analysis, Chart, Difficulty, Note, NoteType } from '../types';
import { reusePhraseTemplates } from './phrases';
import { fingerReleaseTime } from './chart-constraints';
import { beatPosition, chartBeats, snapToBeat, timeAtBeat } from './rhythm';
import { phrasePattern, phraseSwipe, sustainedEnd } from './patterns';
import { FINGER_MODEL, planFingering, validateFingering } from './fingering';
import { selectMusicalOnsets } from './onset-selection';

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

export function generateChart(analysis: Analysis, difficulty: Difficulty, bpmOverride?: number, progress?: (value: number, stage: string) => void): Chart {
  const config = DIFFICULTIES[difficulty], random = randomFrom(analysis.fingerprint + difficulty);
  const bpm = bpmOverride || analysis.bpm, beats = chartBeats(analysis, bpmOverride);
  const patternCache = new Map<number, number>();
  progress?.(0.12, '正在按连续拍点组织乐句');
  const notes: Note[] = [], busyUntil = [-10, -10, -10, -10], fingerUntil = [-10, -10, -10, -10];
  let lastTime = -10, previousLane = -1;
  const strengthSorted = analysis.onsets.map(x => x.strength).sort((a, b) => a - b);
  const threshold = Math.min(config.threshold, (strengthSorted[Math.floor(strengthSorted.length * 0.75)] || config.threshold) * 0.55);
  const noteTime = (onset: Analysis['onsets'][number]) => bpmOverride !== undefined || (analysis.rhythm?.confidence ?? 1) >= 0.45 ? snapToBeat(onset.time, beats, bpm) : onset.time;
  const selected = selectMusicalOnsets(analysis.onsets.filter(onset => onset.time <= analysis.duration - 0.18), config.gap, threshold, noteTime);
  // Motif progression and repetition compare the same retained musical layer,
  // rather than letting rejected ornaments change every subsequent lane.
  const musicalAnalysis = { ...analysis, onsets: selected };
  // Chords emphasize retained phrase accents within the available finger budget.
  const accents = new Map<number, number>();
  if (config.max > 1) selected.forEach((onset, index) => {
    if (onset.strength <= 0.38 || onset.time > analysis.duration - 0.18) return;
    const phrase = Math.floor(beatPosition(beats, onset.time, bpm) / 8), current = accents.get(phrase);
    if (current === undefined || onset.strength > selected[current].strength) accents.set(phrase, index);
  });
  const chordAnchors = new Set(accents.values());
  for (let i = 0; i < selected.length; i++) {
    const onset = selected[i];
    if (onset.strength < threshold || onset.time > analysis.duration - 0.18) continue;
    // Preserve expressive attacks; only gently snap already-close subdivisions.
    const time = noteTime(onset);
    const position = beatPosition(beats, time, bpm);
    const beat = timeAtBeat(beats, Math.floor(position) + 1, bpm) - timeAtBeat(beats, Math.floor(position), bpm);
    const pattern = phrasePattern(musicalAnalysis, beats, bpm, time, config.max, patternCache);
    const plannedChord = chordAnchors.has(i);
    if (time - lastTime < config.gap - 1e-6) continue;
    const active = fingerUntil.filter(x => x > time + 1e-6).length;
    if (active >= config.max) continue;
    const candidates = [0, 1, 2, 3].filter(l => busyUntil[l] <= time - 0.1)
      .sort((a, b) => Math.abs(a - pattern.lane) + Number(a === previousLane) * 0.6 - Math.abs(b - pattern.lane) - Number(b === previousLane) * 0.6);
    if (!candidates.length) continue;
    const lane = candidates[0];
    let type: NoteType = 'tap';
    let endTime: number | undefined;
    const sustain = sustainedEnd(analysis, time, beat);
    const phraseStart = Math.round(pattern.phase * 2) % 8 === 0;
    if (sustain !== undefined && (phraseStart || random() < 0.18) && time + 0.5 < analysis.duration - 0.2) {
      type = 'hold';
      endTime = sustain;
    } else if (onset.strength > threshold * 1.3 && random() < config.swipe * (pattern.phase >= 5 ? 1.6 : 0.75)) {
      type = phraseSwipe(analysis, time, pattern.phase);
    }
    const note: Note = { id: notes.length, lane, time, type, strength: onset.strength, pattern: pattern.name, ...(endTime ? { endTime } : {}) };
    notes.push(note); fingerUntil[lane] = fingerReleaseTime(note);
    busyUntil[lane] = (endTime || time) + 0.16;
    previousLane = lane; lastTime = time;
    const chordLanes = [0, 1, 2, 3].filter(l => busyUntil[l] <= time - 0.1);
    const freeFingers = config.max - active - 1;
    if (plannedChord || (onset.strength > 0.38 && random() < config.chord)) {
      const target = onset.strength > 0.85 ? config.max : Math.min(config.max, onset.strength > 0.6 ? 3 : 2);
      const extraNotes = plannedChord ? Math.min(freeFingers, Math.max(0, target - active - 1)) : Math.min(freeFingers, random() < 0.3 ? 2 : 1);
      let added = 0;
      for (const other of chordLanes) {
        if (added >= extraNotes) break;
        notes.push({ id: notes.length, lane: other, time, type: 'tap', strength: onset.strength * 0.7, pattern: pattern.name });
        busyUntil[other] = time + 0.18; fingerUntil[other] = time + 0.1; added++;
      }
    }
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((note, i) => { note.id = i; });
  progress?.(0.48, '正在匹配相似乐句与按键模板');
  const chart = reusePhraseTemplates(bpmOverride === undefined ? musicalAnalysis : { ...musicalAnalysis, rhythm: undefined }, { version: 5, fingerprint: analysis.fingerprint, difficulty, fingerLimit: config.max, duration: analysis.duration, bpm, notes }, config.max);
  progress?.(0.72, '正在规划整段指法与移动路线');
  const plan = planFingering(chart.notes, config.max);
  const checked = validateFingering(plan.notes, config.max, chart.duration);
  if (!checked || !plan.notes.length) throw new Error('这段音乐暂时无法生成符合指法的谱面，请更换指法或歌曲重试。');
  progress?.(1, '谱面与指法路线已检查');
  return { ...chart, notes: plan.notes, patterns: [...new Set(plan.notes.map(note => note.pattern).filter((name): name is string => !!name))], fingering: { checked, adjusted: plan.adjusted, omitted: plan.omitted, peakStrain: plan.peakStrain, model: FINGER_MODEL } };
}

export function countTypes(chart: Chart) {
  return chart.notes.reduce((counts, note) => { counts[note.type]++; return counts; }, { tap: 0, hold: 0, left: 0, right: 0, up: 0 });
}
