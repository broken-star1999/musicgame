import type { Analysis, Onset, RhythmSection } from '../types';

const NAMES = ['low', 'mid', 'high', 'mixed'] as const;
const BLOCK = 4;

/** Repeating attacks are a useful rhythm reference even when another band is
 * louder. This measures local periodic support, not instrument identity. */
export function periodicSupport(events: Onset[]): number {
  if (events.length < 4 || events.at(-1)!.time - events[0].time < 1) return 0;
  let best = 0;
  const total = events.reduce((sum, event) => sum + Math.sqrt(event.strength), 0);
  for (let period = 0.3; period <= 0.86; period += 0.01) {
    let x = 0, y = 0;
    for (const event of events) {
      const angle = event.time / period * Math.PI * 2, weight = Math.sqrt(event.strength);
      x += Math.cos(angle) * weight; y += Math.sin(angle) * weight;
    }
    best = Math.max(best, Math.hypot(x, y) / Math.max(1e-8, total));
  }
  return best;
}

/** Four-second sections, overlapping context, and a switch-penalized path.
 * No metronome notes are synthesized; every output retains a measured attack. */
export function followRhythmSource(streams: Onset[][], mixed: Onset[], duration: number): NonNullable<Analysis['pulse']> {
  const sources = [...streams.slice(0, 3), mixed];
  while (sources.length < 4) sources.splice(sources.length - 1, 0, []);
  const count = Math.max(1, Math.ceil(duration / BLOCK));
  const emissions: number[][] = [], supports: number[][] = [];
  for (let block = 0; block < count; block++) {
    const start = block * BLOCK, end = Math.min(duration, start + BLOCK);
    const context = sources.map(events => events.filter(event => event.time >= Math.max(0, start - 2) && event.time < Math.min(duration, end + 2)));
    const local = sources.map(events => events.filter(event => event.time >= start && event.time < end));
    const support = context.map(periodicSupport);
    const levels = local.map(events => events.reduce((sum, event) => sum + event.strength, 0));
    const maxLevel = Math.max(...levels, 1e-8);
    const score = context.map((events, band) => {
      if (!local[band].length) return local.every(part => !part.length) ? 0 : -10;
      if (band < 3 && (events.length < 4 || support[band] < 0.42)) return -2;
      // Prefer an identifiable repeating band, but retain expressive mixed
      // attacks when no band has enough evidence. Quiet regular attacks can win.
      return band === 3 ? 0.36 + support[band] * 0.3 : support[band] * 0.85 + Math.min(1, levels[band] / maxLevel) * 0.12 + [0.04, 0.015, 0][band];
    });
    emissions.push(score); supports.push(support);
  }
  const values = emissions.map(() => Array<number>(4).fill(-Infinity));
  const previous = emissions.map(() => Array<number>(4).fill(-1));
  values[0] = [...emissions[0]];
  for (let block = 1; block < count; block++) for (let band = 0; band < 4; band++) {
    for (let before = 0; before < 4; before++) {
      const value = values[block - 1][before] + emissions[block][band] - (before === band ? 0 : 0.24);
      if (value > values[block][band]) { values[block][band] = value; previous[block][band] = before; }
    }
  }
  const path = new Int8Array(count);
  path[count - 1] = values[count - 1].indexOf(Math.max(...values[count - 1]));
  for (let block = count - 1; block > 0; block--) path[block - 1] = previous[block][path[block]];
  const onsets: Onset[] = [], sections: RhythmSection[] = [];
  for (let block = 0; block < count; block++) {
    const band = path[block], start = block * BLOCK, end = Math.min(duration, start + BLOCK);
    sections.push({ start, end, band: NAMES[band], support: supports[block][band] });
    for (const onset of sources[band]) {
      if (onset.time < start || onset.time >= end) continue;
      const last = onsets.at(-1);
      // At a source change two detectors can describe the same physical attack.
      if (last && onset.time - last.time < 0.085) {
        if (onset.strength > last.strength) onsets[onsets.length - 1] = onset;
      } else onsets.push(onset);
    }
  }
  return { onsets, sections };
}
