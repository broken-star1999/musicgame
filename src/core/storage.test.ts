import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestScore, DEFAULT_SETTINGS, loadSettings, saveBest, saveSettings } from './storage';
import type { Result, Settings } from '../types';

function storage() {
  const entries = new Map<string, string>();
  const getItem = vi.fn((key: string) => entries.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { entries.set(key, value); });
  vi.stubGlobal('localStorage', { getItem, setItem });
  return { entries, getItem, setItem };
}
const scoreKey = 'beatfall:best:test-song';
const result = (score: number, autoplay = false): Result => ({ score, autoplay, accuracy: 90, maxCombo: 10, counts: { perfect: 8, great: 1, good: 1, miss: 0 } });
afterEach(() => vi.unstubAllGlobals());

describe('best scores respect the normalized game score contract', () => {
  it.each(['-1', '0.5', '1000001', 'Infinity', '-Infinity', 'NaN', 'broken', ''])('ignores damaged stored score %s without deleting history', stored => {
    const { entries, setItem } = storage(); entries.set(scoreKey, stored);
    expect(bestScore('test-song')).toBe(0);
    expect(entries.get(scoreKey)).toBe(stored); expect(setItem).not.toHaveBeenCalled();
  });

  it.each([0, 1, 999999, 1000000])('reads a valid legacy score of %s without rewriting it', score => {
    const { entries, setItem } = storage(); entries.set(scoreKey, String(score));
    expect(bestScore('test-song')).toBe(score); expect(setItem).not.toHaveBeenCalled();
    expect(entries.get(scoreKey)).toBe(String(score));
  });

  it('allows a real result to replace an invalid oversized historical score', () => {
    const { entries } = storage(); entries.set(scoreKey, '9999999');
    saveBest('test-song', result(625000));
    expect(bestScore('test-song')).toBe(625000); expect(entries.get(scoreKey)).toBe('625000');
  });

  it('preserves lower or tied manual results and saves only a higher valid best', () => {
    const { entries, setItem } = storage(); entries.set(scoreKey, '900000');
    saveBest('test-song', result(899999)); saveBest('test-song', result(900000));
    expect(setItem).not.toHaveBeenCalled(); expect(bestScore('test-song')).toBe(900000);
    saveBest('test-song', result(1000000)); expect(bestScore('test-song')).toBe(1000000);
    expect(setItem).toHaveBeenCalledOnce();
  });

  it('never records an automatic demonstration or touches its historical best', () => {
    const { entries, getItem, setItem } = storage(); entries.set(scoreKey, '600000');
    saveBest('test-song', result(1000000, true));
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled(); expect(entries.get(scoreKey)).toBe('600000');
  });

  it.each([-1, 0.25, 1000001, NaN, Infinity, -Infinity])('does not persist an invalid manual score of %s', score => {
    const { entries, getItem, setItem } = storage(); entries.set(scoreKey, '600000');
    saveBest('test-song', result(score));
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled(); expect(entries.get(scoreKey)).toBe('600000');
  });

  it('returns zero for absent or unreadable history and does not overwrite an unreadable best', () => {
    const { entries, getItem, setItem } = storage(); expect(bestScore('test-song')).toBe(0);
    entries.set(scoreKey, '900000'); getItem.mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    expect(bestScore('test-song')).toBe(0); expect(() => saveBest('test-song', result(500000))).not.toThrow();
    expect(setItem).not.toHaveBeenCalled(); expect(entries.get(scoreKey)).toBe('900000');
  });

  it('keeps an old best when storage refuses a new score', () => {
    const { entries, setItem } = storage(); entries.set(scoreKey, '600000');
    setItem.mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(() => saveBest('test-song', result(1000000))).not.toThrow(); expect(bestScore('test-song')).toBe(600000);
  });
});

describe('settings recover from damaged or unavailable browser storage', () => {
  it('roundtrips all supported settings without changing their values', () => {
    storage();
    const settings: Settings = { difficulty: 'four', speed: 8.5, scrollMode: 'screen', volume: 0.35, offset: -125, vibration: false, recognition: 'basic' };
    saveSettings(settings); expect(loadSettings()).toEqual(settings);
  });

  it.each(['{broken', 'null', '[]', 'true', '42', '"wrong shape"'])('recovers defaults from malformed settings %s', stored => {
    const { entries, setItem } = storage(); entries.set('beatfall:settings', stored);
    const settings = loadSettings(); expect(settings).toEqual(DEFAULT_SETTINGS); expect(settings).not.toBe(DEFAULT_SETTINGS);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('clamps finite out-of-range numeric settings while keeping valid fractional values', () => {
    const { entries } = storage();
    entries.set('beatfall:settings', '{"speed":-10,"volume":2,"offset":-999}');
    expect(loadSettings()).toMatchObject({ speed: 2, volume: 1, offset: -300 });
    entries.set('beatfall:settings', '{"speed":99,"volume":-1,"offset":999}');
    expect(loadSettings()).toMatchObject({ speed: 10, volume: 0, offset: 300 });
    entries.set('beatfall:settings', '{"speed":2.5,"volume":0.05,"offset":1.5}');
    expect(loadSettings()).toMatchObject({ speed: 2.5, volume: 0.05, offset: 1.5 });
  });

  it('uses numeric defaults for overflow or string values and safe defaults for unknown enums', () => {
    const { entries } = storage();
    entries.set('beatfall:settings', '{"speed":1e999,"volume":-1e999,"offset":1e999}');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    entries.set('beatfall:settings', '{"difficulty":"unknown","speed":"7","volume":"0.5","offset":"20","scrollMode":true,"recognition":4,"vibration":"false"}');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps defaults independent and tolerates read and write denial', () => {
    const { getItem, setItem } = storage();
    const first = loadSettings(); first.speed = 9;
    expect(loadSettings().speed).toBe(5); expect(DEFAULT_SETTINGS.speed).toBe(5);
    getItem.mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    setItem.mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
});
