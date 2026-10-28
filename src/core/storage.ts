import type { Difficulty, Result, Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = { difficulty: 'two', speed: 5, scrollMode: 'perspective', volume: 0.75, offset: 0, vibration: true };
export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem('beatfall:settings') || '{}');
    const legacy: Record<string, Difficulty> = { easy: 'two', normal: 'three', hard: 'four' };
    return {
      difficulty: ['one', 'two', 'three', 'four'].includes(v.difficulty) ? v.difficulty : ['easy', 'normal', 'hard'].includes(v.difficulty) ? legacy[v.difficulty] : 'two',
      scrollMode: v.scrollMode === 'screen' ? 'screen' : 'perspective',
      vibration: v.vibration !== false,
      speed: typeof v.speed === 'number' ? Math.max(2, Math.min(10, v.speed)) : 5,
      volume: typeof v.volume === 'number' ? Math.max(0, Math.min(1, v.volume)) : 0.75,
      offset: typeof v.offset === 'number' ? Math.max(-300, Math.min(300, v.offset)) : 0,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: Settings) { try { localStorage.setItem('beatfall:settings', JSON.stringify(settings)); } catch { /* Storage can be disabled in private browsing. */ } }
export function bestScore(key: string): number { try { const v = Number(localStorage.getItem(`beatfall:best:${key}`)); return Number.isFinite(v) ? v : 0; } catch { return 0; } }
export function saveBest(key: string, result: Result) {
  if (result.autoplay) return;
  try { if (result.score > bestScore(key)) localStorage.setItem(`beatfall:best:${key}`, String(result.score)); } catch { /* Optional local best. */ }
}
