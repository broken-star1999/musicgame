export type Difficulty = 'easy' | 'normal' | 'hard';
export type ScrollMode = 'perspective' | 'screen';
export type NoteType = 'tap' | 'hold' | 'left' | 'right' | 'up';
export type Grade = 'perfect' | 'great' | 'good' | 'miss';
export interface Onset { time: number; strength: number; band: number }
export interface Analysis {
  duration: number;
  bpm: number;
  confidence: number;
  onsets: Onset[];
  energy: number[];
  energyStep: number;
  waveform: number[];
  fingerprint: string;
}
export interface Note {
  id: number;
  lane: number;
  time: number;
  type: NoteType;
  endTime?: number;
}
export interface Chart {
  version: 1;
  fingerprint: string;
  difficulty: Difficulty;
  duration: number;
  bpm: number;
  notes: Note[];
}
export interface Settings { difficulty: Difficulty; speed: number; scrollMode: ScrollMode; volume: number; offset: number }
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
