import type { Analysis, Chart, Note, Onset } from '../types';
import { isPlayableChart } from './chart-constraints';

interface Phrase { start: number; onsets: Onset[]; pitches: number[][] }
const PHRASE_BEATS = 8;
const SAMPLES = 32;
const MAX_TEMPLATES = 128;

function similarity(a: Phrase, b: Phrase, tolerance: number): Map<number, number> | null {
  if (a.onsets.length < 4 || b.onsets.length < 4) return null;
  if (Math.min(a.onsets.length, b.onsets.length) / Math.max(a.onsets.length, b.onsets.length) < 0.85) return null;
  let tonal = 0, tonalCount = 0, weak = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = a.pitches[i], y = b.pitches[i];
    // Phrase samples were normalized once when built; zero vectors are silence.
    if (!x.some(value => value > 0) || !y.some(value => value > 0)) continue;
    const cosine = x.reduce((sum, value, k) => sum + value * y[k], 0);
    tonal += cosine; tonalCount++; if (cosine < 0.75) weak++;
    const remaining = SAMPLES - i - 1;
    if (weak > SAMPLES * 0.15 || (tonal + remaining) / (tonalCount + remaining) < 0.88) return null;
  }
  // A matching drum pattern alone is not a matching melody.
  if (tonalCount < SAMPLES / 2 || tonal / tonalCount < 0.88 || weak > tonalCount * 0.15) return null;
  const matches = new Map<number, number>(), used = new Set<number>();
  let bands = 0, searchFrom = 0;
  for (let i = 0; i < a.onsets.length; i++) {
    let nearest = -1, error = tolerance;
    const phase = a.onsets[i].time - a.start;
    while (searchFrom < b.onsets.length && b.onsets[searchFrom].time - b.start < phase - tolerance) searchFrom++;
    for (let j = searchFrom; j < b.onsets.length && b.onsets[j].time - b.start <= phase + tolerance; j++) {
      const distance = Math.abs(b.onsets[j].time - b.start - phase);
      if (!used.has(j) && distance <= error) { error = distance; nearest = j; }
    }
    if (nearest >= 0) { matches.set(i, nearest); used.add(nearest); if (a.onsets[i].band === b.onsets[nearest].band) bands++; }
  }
  if (matches.size / Math.max(a.onsets.length, b.onsets.length) < 0.85 || bands / matches.size < 0.65) return null;
  return matches;
}

/** Reuse lanes/actions only; each occurrence keeps its own detected onset times. */
export function reusePhraseTemplates(analysis: Analysis, chart: Chart, maxFingers: number): Chart {
  const repetition = { detected: 0, reused: 0, notesReused: 0, phraseBeats: PHRASE_BEATS };
  if (!analysis.chroma?.length || !analysis.chromaStep || !analysis.onsets.length) return { ...chart, repetition };
  const length = PHRASE_BEATS * 60 / chart.bpm;
  // Candidate starts follow real attacks, so an intro/pickup or a small BPM
  // estimation error cannot shift all later phrases off the comparison grid.
  const starts = analysis.onsets.filter(onset => onset.time + length <= analysis.duration && onset.strength >= 0.055);
  const phrases: Phrase[] = starts.map(({ time: start }) => {
    const pitches = Array.from({ length: SAMPLES }, (_, sample) => {
      const time = start + (sample + 0.5) / SAMPLES * length;
      const center = Math.floor(time / analysis.chromaStep!), radius = Math.max(1, Math.round(0.08 / analysis.chromaStep!));
      const values = Array<number>(12).fill(0);
      for (let frame = Math.max(0, center - radius); frame <= Math.min(analysis.chroma!.length - 1, center + radius); frame++) {
        const pitch = analysis.chroma![frame]; for (let k = 0; k < 12; k++) values[k] += pitch[k];
      }
      const norm = Math.hypot(...values); return values.map(value => norm > 1e-8 ? value / norm : 0);
    });
    return { start, pitches, onsets: analysis.onsets.filter(onset => onset.time >= start - 1e-6 && onset.time < start + length - 1e-6 && onset.strength >= 0.055) };
  });
  let notes = chart.notes;
  const canonical: number[] = []; let candidatesSeen = 0;
  for (let targetIndex = 0; targetIndex < phrases.length; targetIndex++) {
    const target = phrases[targetIndex];
    let detected = false;
    for (const sourceIndex of canonical) {
      const source = phrases[sourceIndex];
      if (source.start + length > target.start + 0.06) continue;
      const matches = similarity(source, target, Math.min(0.08, 60 / chart.bpm * 0.16));
      if (!matches) continue;
      if (!detected) { repetition.detected++; detected = true; }
      const sourceNotes = chart.notes.filter(note => note.time >= source.start - 0.025 && note.time < source.start + length - 0.025);
      if (!sourceNotes.length) continue;
      const mapped: Note[] = [];
      for (const note of sourceNotes) {
        let nearest = -1, error = 0.055;
        source.onsets.forEach((onset, i) => { const d = Math.abs(onset.time - note.time); if (d < error) { nearest = i; error = d; } });
        const mappedIndex = matches.get(nearest);
        if (mappedIndex === undefined) continue;
        const time = target.onsets[mappedIndex].time;
        mapped.push({ ...note, time, ...(note.endTime !== undefined ? { endTime: time + note.endTime - note.time } : {}) });
      }
      if (mapped.length < sourceNotes.length * 0.85) continue;
      const candidate = [...notes.filter(note => note.time < target.start - 0.025 || note.time >= target.start + length - 0.025), ...mapped].sort((a, b) => a.time - b.time || a.lane - b.lane);
      if (!isPlayableChart(candidate, maxFingers, chart.duration)) continue;
      notes = candidate; repetition.reused++; repetition.notesReused += mapped.length;
      while (targetIndex + 1 < phrases.length && phrases[targetIndex + 1].start < target.start + length - 0.06) targetIndex++;
      break;
    }
    if (!detected) {
      // Keep a deterministic sample of earlier phrases rather than comparing
      // every attack against every previous attack on a dense five-minute song.
      candidatesSeen++;
      if (canonical.length < MAX_TEMPLATES) canonical.push(targetIndex);
      else {
        const slot = (Math.imul(candidatesSeen, 2654435761) >>> 0) % candidatesSeen;
        if (slot >= 8 && slot < MAX_TEMPLATES) { canonical[slot] = targetIndex; canonical.sort((a, b) => a - b); }
      }
    }
  }
  return { ...chart, notes: notes.map((note, id) => ({ ...note, id })), repetition };
}
