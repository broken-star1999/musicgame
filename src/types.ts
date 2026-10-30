export type Difficulty = 'one' | 'two' | 'three' | 'four';
export type ScrollMode = 'perspective' | 'screen';
export type NoteType = 'tap' | 'hold' | 'left' | 'right' | 'up';
export type Grade = 'perfect' | 'great' | 'good' | 'miss';
export type RecognitionMode = 'enhanced' | 'basic';
export interface Onset { time: number; strength: number; band: number; attack?: number; boundary?: true; role?: 'beat' | 'half' | 'quarter' | 'free' }
export interface RhythmSection { start: number; end: number; band: 'low' | 'mid' | 'high' | 'mixed'; support: number }
export interface Rhythm {
  beats: number[];
  tempo: { time: number; bpm: number }[];
  confidence: number;
  downbeats: number[];
  meterConfidence: number;
}
export interface Analysis {
  duration: number;
  bpm: number;
  confidence: number;
  onsets: Onset[];
  energy: number[];
  energyStep: number;
  waveform: number[];
  fingerprint: string;
  chroma?: number[][];
  chromaStep?: number;
  tonalEnergy?: number[][];
  candidates?: Onset[];
  rhythm?: Rhythm;
  pulse?: { onsets: Onset[]; sections: RhythmSection[] };
  recognition?: { engine: 'beat-this' | 'signal'; model?: string; warning?: string; rawBeats?: number };
}
export interface Note {
  id: number;
  lane: number;
  time: number;
  type: NoteType;
  endTime?: number;
  finger?: number;
  strength?: number;
  pattern?: string;
}
export interface Chart {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  generator?: 'beat-this' | 'signal';
  fingerprint: string;
  difficulty: Difficulty;
  duration: number;
  bpm: number;
  notes: Note[];
  fingerLimit?: 1 | 2 | 3 | 4;
  fingering?: { checked: boolean; adjusted: number; omitted: number; peakStrain: number; model: string };
  patterns?: string[];
  repetition?: { detected: number; reused: number; notesReused: number; phraseBeats: number };
}
export interface Settings { difficulty: Difficulty; speed: number; scrollMode: ScrollMode; volume: number; offset: number; vibration: boolean; recognition: RecognitionMode }
export interface Result {
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  autoplay: boolean;
}
export interface Track { name: string; artist: string; buffer: AudioBuffer; analysis: Analysis; demo: boolean }
/** Omitted/undefined fields keep the baseline value. Explicit null removes an
 * optional result field; required numeric fields cannot be cleared. */
export interface AnalysisPatch {
  bpm?: number;
  confidence?: number;
  rhythm?: Rhythm | null;
  pulse?: Analysis['pulse'] | null;
  recognition?: Analysis['recognition'] | null;
}
export type WorkerRequest = { samples: Float32Array; sampleRate: number; assetBase: string; recognitionMode?: RecognitionMode };
export type WorkerResponse = { type: 'progress'; value: number; stage: string } | { type: 'baseline'; analysis: Analysis } | { type: 'patch'; patch: AnalysisPatch } | { type: 'done'; analysis: Analysis } | { type: 'error'; message: string };
