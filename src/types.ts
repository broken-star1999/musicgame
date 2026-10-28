export type Difficulty = 'one' | 'two' | 'three' | 'four';
export type ScrollMode = 'perspective' | 'screen';
export type NoteType = 'tap' | 'hold' | 'left' | 'right' | 'up';
export type Grade = 'perfect' | 'great' | 'good' | 'miss';
export interface Onset { time: number; strength: number; band: number }
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
  rhythm?: Rhythm;
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
  version: 1 | 2 | 3 | 4;
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
export interface Settings { difficulty: Difficulty; speed: number; scrollMode: ScrollMode; volume: number; offset: number; vibration: boolean }
export interface Result {
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  autoplay: boolean;
}
export interface Track { name: string; artist: string; buffer: AudioBuffer; analysis: Analysis; demo: boolean }
export type WorkerRequest = { samples: Float32Array; sampleRate: number };
export type WorkerResponse = { type: 'progress'; value: number; stage: string } | { type: 'done'; analysis: Analysis } | { type: 'error'; message: string };
