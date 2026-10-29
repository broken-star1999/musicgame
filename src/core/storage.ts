import type { Difficulty, Result, Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = { difficulty: 'two', speed: 5, scrollMode: 'perspective', volume: 0.75, offset: 0, vibration: true, recognition: 'enhanced' };
export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem('beatfall:settings') || '{}');
    const legacy: Record<string, Difficulty> = { easy: 'two', normal: 'three', hard: 'four' };
    return {
      difficulty: ['one', 'two', 'three', 'four'].includes(v.difficulty) ? v.difficulty : ['easy', 'normal', 'hard'].includes(v.difficulty) ? legacy[v.difficulty] : 'two',
      scrollMode: v.scrollMode === 'screen' ? 'screen' : 'perspective',
      vibration: v.vibration !== false,
      recognition: v.recognition === 'basic' ? 'basic' : 'enhanced',
      speed: typeof v.speed === 'number' && Number.isFinite(v.speed) ? Math.max(2, Math.min(10, v.speed)) : 5,
      volume: typeof v.volume === 'number' && Number.isFinite(v.volume) ? Math.max(0, Math.min(1, v.volume)) : 0.75,
      offset: typeof v.offset === 'number' && Number.isFinite(v.offset) ? Math.max(-300, Math.min(300, v.offset)) : 0,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: Settings) { try { localStorage.setItem('beatfall:settings', JSON.stringify(settings)); } catch { /* Storage can be disabled in private browsing. */ } }
function validScore(value: number): boolean { return Number.isInteger(value) && value >= 0 && value <= 1_000_000; }
function readBest(key: string): number {
  const value = Number(localStorage.getItem(`beatfall:best:${key}`));
  return validScore(value) ? value : 0;
}
export function bestScore(key: string): number { try { return readBest(key); } catch { return 0; } }
export function saveBest(key: string, result: Result) {
  if (result.autoplay || !validScore(result.score)) return;
  // If the old score cannot be read, do not risk overwriting an unknown best.
  try { if (result.score > readBest(key)) localStorage.setItem(`beatfall:best:${key}`, String(result.score)); } catch { /* Optional local best. */ }
}
