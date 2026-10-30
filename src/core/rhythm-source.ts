import type { Analysis, Onset, RhythmSection } from '../types';

const NAMES = ['low', 'mid', 'high', 'mixed'] as const;
const BLOCK = 4, CONTEXT = 2, SUPPORT = 0.42, PHASE_GAP = 0.25, PERIOD_TIE = 1e-12;
type Evidence = { support: number; phase: number; period: number; eligible: boolean };
type Reference = { band: number; period: number; phase: number };

function phaseAtPeriod(events: Onset[], period: number): Evidence {
  const eligible = events.length >= 4 && events[events.length - 1].time - events[0].time >= 1;
  if (!eligible) return { support: 0, phase: 0, period, eligible: false };
  let x = 0, y = 0, total = 0;
  for (const event of events) {
    const weight = Math.sqrt(Math.max(0, event.strength)), angle = event.time / period * Math.PI * 2;
    x += Math.cos(angle) * weight; y += Math.sin(angle) * weight; total += weight;
  }
  return { support: Math.hypot(x, y) / Math.max(1e-8, total), phase: Math.atan2(y, x) / (Math.PI * 2), period, eligible };
}

function periodicEvidence(events: Onset[]): Evidence {
  let best = phaseAtPeriod(events, 0.3);
  for (let period = 0.3; period <= 0.86; period += 0.01) {
    const candidate = phaseAtPeriod(events, period);
    // An exact train also supports faster harmonics. Resolve only numerical
    // ties in favor of the longer period, rather than floating-point roundoff.
    if (candidate.support > best.support + PERIOD_TIE
      || (Math.abs(candidate.support - best.support) <= PERIOD_TIE && candidate.period > best.period)) best = candidate;
  }
  return best;
}

/** Keep the original scalar score for global source selection. The separate
 * period/phase evidence below is used only to judge actual source handoffs. */
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
function supported(evidence: Evidence): boolean { return evidence.eligible && evidence.support >= SUPPORT; }
function phaseGap(a: number, b: number): number { const delta = Math.abs(a - b) % 1; return Math.min(delta, 1 - delta); }

/** Preserve the global source path, then protect supported local references
 * at handoffs. This does not correct a source chosen wrongly from the opening.
 * Every output remains a measured attack; no metronome notes are synthesized. */
export function followRhythmSource(streams: Onset[][], mixed: Onset[], duration: number): NonNullable<Analysis['pulse']> {
  const sources = [...streams.slice(0, 3), mixed];
  while (sources.length < 4) sources.splice(sources.length - 1, 0, []);
  const count = Math.max(1, Math.ceil(duration / BLOCK));
  const emissions: number[][] = [], supports: number[][] = [];
  for (let block = 0; block < count; block++) {
    const start = block * BLOCK, end = Math.min(duration, start + BLOCK);
    const context = sources.map(events => events.filter(event => event.time >= Math.max(0, start - CONTEXT) && event.time < Math.min(duration, end + CONTEXT)));
    const local = sources.map(events => events.filter(event => event.time >= start && event.time < end));
    const support = context.map(periodicSupport);
    const levels = local.map(events => events.reduce((sum, event) => sum + event.strength, 0));
    const maxLevel = Math.max(...levels, 1e-8);
    const score = context.map((events, band) => {
      if (!local[band].length) return local.every(part => !part.length) ? 0 : -10;
      if (band < 3 && (events.length < 4 || support[band] < SUPPORT)) return -2;
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
  let reference: Reference | null = null, previousBand: number | null = null;
  for (let block = 0; block < count; block++) {
    const start = block * BLOCK, end = Math.min(duration, start + BLOCK), wanted: number = path[block];
    const context = sources.map(events => events.filter(event => event.time >= Math.max(0, start - CONTEXT) && event.time < Math.min(duration, end + CONTEXT)));
    const local = sources.map(events => events.filter(event => event.time >= start && event.time < end));

    let referenceNow: Evidence | null = null;
    const priorReference = reference as Reference | null;
    if (priorReference !== null) {
      const now = phaseAtPeriod(local[priorReference.band], priorReference.period);
      const contextual = phaseAtPeriod(context[priorReference.band], priorReference.period);
      // Keep the period as well as the source. A different per-window maximum
      // must not replace a still-supported trajectory. Refresh phase from audio.
      if (supported(now) && supported(contextual) && phaseGap(priorReference.phase, now.phase) <= PHASE_GAP) {
        referenceNow = now; reference = { band: priorReference.band, period: priorReference.period, phase: now.phase };
      } else reference = null;
    }
    const activeReference: Reference | null = reference;
    const handoff = previousBand !== null && wanted !== previousBand;
    let band: number = wanted;
    if (handoff && activeReference && referenceNow && wanted !== activeReference.band) {
      // Compare on the OLD reference period, not each source's own best period.
      const candidate = phaseAtPeriod(local[wanted], referenceNow.period);
      const contextual = phaseAtPeriod(context[wanted], referenceNow.period);
      const comparable = supported(candidate) && supported(contextual);
      const opposite = comparable && phaseGap(candidate.phase, referenceNow.phase) > PHASE_GAP;
      // Mixed cannot erase the reference and bridge to an opposite phase.
      // Named sources with a different supported tempo can still take over.
      if (opposite || (wanted === 3 && !comparable)) band = activeReference.band;
    }
    if (band < 3) {
      const compatible = referenceNow ? phaseAtPeriod(local[band], referenceNow.period) : null;
      const contextual = referenceNow ? phaseAtPeriod(context[band], referenceNow.period) : null;
      if (compatible && contextual && referenceNow && supported(compatible) && supported(contextual)
        && phaseGap(compatible.phase, referenceNow.phase) <= PHASE_GAP) {
        reference = { band, period: referenceNow.period, phase: compatible.phase };
      } else {
        const fresh = periodicEvidence(local[band]);
        reference = supported(fresh) ? { band, period: fresh.period, phase: fresh.phase } : null;
      }
    }
    // Compatible mixed output retains the named source, period and phase.
    sections.push({ start, end, band: NAMES[band], support: supports[block][band] });
    for (const onset of sources[band]) {
      if (onset.time < start || onset.time >= end) continue;
      const last = onsets.at(-1);
      if (last && onset.time - last.time < 0.085) {
        if (onset.strength > last.strength) onsets[onsets.length - 1] = onset;
      } else onsets.push(onset);
    }
    previousBand = band;
  }
  return { onsets, sections };
}
