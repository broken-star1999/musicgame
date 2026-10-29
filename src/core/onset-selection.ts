import type { Onset } from '../types';

/** Weighted interval scheduling: a quiet pickup must not evict a nearby accent.
 * Squared salience makes one clear attack preferable to several weak artifacts.
 * Only selects original recording times; it never invents or retimes an attack. */
export function selectMusicalOnsets(onsets: Onset[], gap: number, threshold: number, timing = (onset: Onset) => onset.time): Onset[] {
  const events = onsets.filter(onset => onset.strength >= threshold).sort((a, b) => a.time - b.time);
  const times = events.map(timing);
  const scores = new Float64Array(events.length + 1), previous = new Int32Array(events.length);
  const take = new Uint8Array(events.length);
  for (let i = 0; i < events.length; i++) {
    let low = 0, high = i;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (times[i] - times[middle] >= gap - 1e-6) low = middle + 1;
      else high = middle;
    }
    previous[i] = low;
    const value = scores[low] + events[i].strength ** 2 + 0.005;
    if (value > scores[i] + 1e-10) { scores[i + 1] = value; take[i] = 1; }
    else scores[i + 1] = scores[i];
  }
  const selected: Onset[] = [];
  for (let i = events.length - 1; i >= 0;) {
    if (take[i]) { selected.push(events[i]); i = previous[i] - 1; }
    else i--;
  }
  return selected.reverse();
}
