import { config } from './tempo-family-config';
export { config } from './tempo-family-config';
export interface TempoEvent {
    time: number;
    strength?: number;
    band?: number;
}
export interface TempoWork {
    rawPairs: number;
    acfProducts: number;
    predictions: number;
    phaseAnchorTrials: number;
    blocks: number;
    maximumRetainedPeriods: number;
    maximumRetainedPhases: number;
}
export interface PhaseEvidence {
    anchor: number;
    predictions: number;
    matched: number;
    coverage: number;
    meanResidual: number;
    unknown: boolean;
    supported: boolean;
}
interface PeriodEvidence {
    period: number;
    bpm: number;
    directIOI: number;
    acf: number;
    totalEvidence: number;
}
export interface PeriodHypothesis extends PeriodEvidence {
    phases: PhaseEvidence[];
}
export interface TempoFamily {
    representativePeriod: number;
    levels: {
        period: number;
        bpm: number;
        supported: boolean;
    }[];
}
interface HistogramPeak {
    interval: number;
    votes: number;
}
interface HistogramEvidence {
    peaks: HistogramPeak[];
    direct: (period: number) => number;
    pairs: number;
    anchors: number;
}
export type TempoAction = 'unknown-no-events' | 'seed-initialized-supported' | 'seed-initialized-unresolved' | 'keep-supported-reference' | 'keep-unknown-reference' | 'no-supported-fresh-hypothesis' | 'retain-level-with-octave-ambiguity' | 'phase-reacquired' | 'prefer-fresh-family';
export interface TempoBlock {
    time: number;
    from: number;
    to: number;
    preferredPeriod: number | null;
    preferredBpm: number | null;
    rememberedPeriod?: number;
    action: TempoAction;
    supported: boolean;
    referencePhaseCount?: number;
    refAnchors: number[];
    phaseAmbiguous: boolean;
    levelAmbiguous: boolean;
    oldReferenceEvidence: PhaseEvidence[];
    histogram?: {
        rawPairs: number;
        anchors: number;
        peaks: HistogramPeak[];
    };
    hypotheses: PeriodHypothesis[];
    families?: TempoFamily[];
}
export interface TempoInvestigation {
    version: string;
    scope: string;
    blocks: TempoBlock[];
    work: TempoWork;
}
const EPS = 1e-9;
const minT = config.periodHypotheses.minimumSeconds;
const maxT = config.periodHypotheses.maximumSeconds;
const clamp = (value: number): number => Math.max(minT, Math.min(maxT, value));
export function octaveRelated(a: number, b: number): boolean {
    const log = Math.log2(a / b), nearest = Math.round(log);
    return Math.abs(log - nearest) <= Math.log2(1 + config.periodHypotheses.octaveRelativeTolerance);
}
const distinctLevel = (a: number, b: number): boolean => Math.abs(Math.log2(a / b)) > .1;
function phaseDistance(a: number, b: number, period: number): number {
    const d = Math.abs(a - b) % period;
    return Math.min(d, period - d);
}
function histogram(events: readonly TempoEvent[], work: TempoWork): HistogramEvidence {
    const c = config.pairwiseIOI;
    const bins = new Float64Array(Math.round(c.maximumSeconds / c.histogramStep) + 1);
    const pairs: {
        delta: number;
        weight: number;
    }[] = [];
    for (let i = 0; i < events.length; i++) {
        const local: {
            delta: number;
            weight: number;
        }[] = [];
        let total = 0;
        for (let j = i + 1; j < Math.min(events.length, i + c.nextOnsets + 1); j++) {
            const delta = events[j].time - events[i].time;
            if (delta < c.minimumSeconds - EPS || delta > c.maximumSeconds + EPS)
                continue;
            const weight = 1 / Math.sqrt(j - i);
            local.push({ delta, weight });
            total += weight;
            work.rawPairs++;
        }
        for (const pair of local) {
            const weight = pair.weight / total;
            pairs.push({ delta: pair.delta, weight });
            const lo = Math.max(0, Math.floor((pair.delta - c.kernelRadiusSigma * c.kernelSigma) / c.histogramStep));
            const hi = Math.min(bins.length - 1, Math.ceil((pair.delta + c.kernelRadiusSigma * c.kernelSigma) / c.histogramStep));
            let norm = 0;
            for (let k = lo; k <= hi; k++)
                norm += Math.exp(-.5 * ((k * c.histogramStep - pair.delta) / c.kernelSigma) ** 2);
            for (let k = lo; k <= hi; k++)
                bins[k] += weight * Math.exp(-.5 * ((k * c.histogramStep - pair.delta) / c.kernelSigma) ** 2) / norm;
        }
    }
    const peaks: HistogramPeak[] = [];
    for (let i = Math.ceil(c.minimumSeconds / c.histogramStep); i < bins.length; i++) {
        if (bins[i] <= 0 || bins[i] < (bins[i - 1] ?? 0) || bins[i] <= (bins[i + 1] ?? -1))
            continue;
        let sum = 0, norm = 0;
        for (const pair of pairs)
            if (Math.abs(pair.delta - i * c.histogramStep) <= c.kernelSigma + EPS) {
                sum += pair.delta * pair.weight;
                norm += pair.weight;
            }
        peaks.push({ interval: norm ? sum / norm : i * c.histogramStep, votes: bins[i] });
    }
    peaks.sort((a, b) => b.votes - a.votes || a.interval - b.interval);
    const chosen: HistogramPeak[] = [];
    for (const p of peaks) {
        if (chosen.some(q => Math.abs(q.interval - p.interval) <= config.periodHypotheses.rawProposalMergeSeconds))
            continue;
        chosen.push(p);
        if (chosen.length === c.rawPeaks)
            break;
    }
    let maximum = 0;
    for (let i = Math.ceil(minT / c.histogramStep); i <= Math.floor(maxT / c.histogramStep); i++)
        maximum = Math.max(maximum, bins[i]);
    const direct = (period: number): number => {
        const at = period / c.histogramStep, i = Math.floor(at), f = at - i;
        return ((bins[i] ?? 0) * (1 - f) + (bins[i + 1] ?? 0) * f) / Math.max(EPS, maximum);
    };
    return { peaks: chosen, direct, pairs: pairs.length, anchors: events.length };
}
function unitEnvelope(events: readonly TempoEvent[], duration: number): Float64Array {
    const envelope = new Float64Array(Math.ceil(duration / config.step) + 1);
    for (const event of events) {
        const center = Math.round(event.time / config.step);
        for (let d = -4; d <= 4; d++)
            if (center + d >= 0 && center + d < envelope.length) {
                envelope[center + d] = Math.max(envelope[center + d], Math.exp(-d * d / 5));
            }
    }
    return envelope;
}
function acfAt(envelope: Float64Array, time: number, period: number, work: TempoWork, cache: Map<number, number>): number {
    const lag = Math.max(1, Math.round(period / config.step));
    if (cache.has(lag))
        return cache.get(lag)!;
    const center = Math.round(time / config.step), radius = Math.round(config.windowSeconds / 2 / config.step);
    const from = Math.max(0, center - radius), to = Math.min(envelope.length, center + radius);
    let dot = 0, a = 0, b = 0, sumA = 0, sumB = 0, count = 0;
    for (let i = from + lag; i < to; i++) {
        sumA += envelope[i];
        sumB += envelope[i - lag];
        count++;
        dot += envelope[i] * envelope[i - lag];
        a += envelope[i] ** 2;
        b += envelope[i - lag] ** 2;
        work.acfProducts++;
    }
    const covariance = count ? dot - sumA * sumB / count : 0;
    const varianceA = count ? Math.max(0, a - sumA * sumA / count) : 0;
    const varianceB = count ? Math.max(0, b - sumB * sumB / count) : 0;
    const value = covariance / Math.max(EPS, Math.sqrt(varianceA * varianceB));
    cache.set(lag, value);
    return value;
}
function coverage(anchor: number, period: number, matching: readonly TempoEvent[], from: number, to: number, domain: readonly [
    number,
    number
], acf: number, work: TempoWork): PhaseEvidence {
    const c = config.phaseHypotheses, start = Math.max(from, domain[0]), end = Math.min(to, domain[1] + EPS);
    const k = Math.ceil((start - anchor) / period - EPS);
    let cursor = 0, predictions = 0, matched = 0, error = 0;
    let first: number | null = null, last: number | null = null;
    for (let target = anchor + k * period; target < end; target += period) {
        predictions++;
        work.predictions++;
        if (first === null)
            first = target;
        last = target;
        while (cursor < matching.length && matching[cursor].time < target - c.matchTolerance - EPS)
            cursor++;
        let best = -1, distance = Infinity;
        for (let j = cursor; j < matching.length && matching[j].time <= target + c.matchTolerance + EPS; j++) {
            const d = Math.abs(matching[j].time - target);
            if (d < distance) {
                best = j;
                distance = d;
            }
        }
        if (best >= 0) {
            matched++;
            error += matching[best].time - target;
            cursor = best + 1;
        }
    }
    const unknown = predictions < c.minimumPredictions || first === null || last! - first < c.minimumPredictionSpan;
    const support = predictions ? matched / predictions : 0;
    return { anchor, predictions, matched, coverage: support, meanResidual: matched ? error / matched : 0, unknown, supported: !unknown && support >= c.coverageGate && acf >= c.acfGate };
}
function phases(events: readonly TempoEvent[], period: number, matching: readonly TempoEvent[], from: number, to: number, domain: readonly [
    number,
    number
], acf: number, work: TempoWork): PhaseEvidence[] {
    const all: PhaseEvidence[] = [];
    for (const event of events) {
        work.phaseAnchorTrials++;
        all.push(coverage(event.time, period, matching, from, to, domain, acf, work));
    }
    all.sort((a, b) => b.coverage - a.coverage || Math.abs(a.meanResidual) - Math.abs(b.meanResidual) || a.anchor - b.anchor);
    const chosen: PhaseEvidence[] = [];
    for (const phase of all) {
        if (chosen.some(other => phaseDistance(phase.anchor, other.anchor, period) < config.phaseHypotheses.separationSeconds - EPS))
            continue;
        chosen.push(phase);
        if (chosen.length === config.phaseHypotheses.maximum)
            break;
    }
    return chosen;
}
export function investigateTempo(events: readonly TempoEvent[], duration: number, seedBpm: number): TempoInvestigation {
    if (!events.every((event, i) => Number.isFinite(event.time) && event.time >= 0 && event.time <= duration && (!i || event.time > events[i - 1].time))) {
        throw Error('Strictly increasing measured event times required');
    }
    const envelope = unitEnvelope(events, duration);
    const work: TempoWork = { rawPairs: 0, acfProducts: 0, predictions: 0, phaseAnchorTrials: 0, blocks: 0, maximumRetainedPeriods: 0, maximumRetainedPhases: 0 };
    const seedPeriod = clamp(60 / seedBpm);
    const domain: readonly [
        number,
        number
    ] = events.length ? [events[0].time, events.at(-1)!.time] : [0, 0];
    const blocks: TempoBlock[] = [];
    let preferred = seedPeriod, references: {
        anchor: number;
    }[] = [], everInitialized = false;
    for (let time = 0; time <= Math.ceil(duration / config.blockSeconds) * config.blockSeconds; time += config.blockSeconds) {
        work.blocks++;
        const from = Math.max(0, time - config.windowSeconds / 2), to = Math.min(duration, time + config.windowSeconds / 2);
        const local = events.filter(event => event.time >= from && event.time < to);
        const matching = events.filter(event => event.time >= from - config.phaseHypotheses.matchTolerance && event.time < to + config.phaseHypotheses.matchTolerance);
        if (!local.length) {
            references = [];
            blocks.push({ time, from, to, preferredPeriod: null, preferredBpm: null, rememberedPeriod: preferred, refAnchors: [], action: 'unknown-no-events', supported: false, phaseAmbiguous: true, levelAmbiguous: true, hypotheses: [], oldReferenceEvidence: [] });
            continue;
        }
        const h = histogram(local, work), cache = new Map<number, number>(), proposals: number[] = [];
        for (const peak of h.peaks)
            for (const scale of config.periodHypotheses.peakAliases) {
                const period = peak.interval * scale;
                if (period < minT - EPS || period > maxT + EPS || proposals.some(p => Math.abs(p - period) < config.periodHypotheses.rawProposalMergeSeconds))
                    continue;
                proposals.push(period);
            }
        const reserved: number[] = [];
        for (const base of [preferred, seedPeriod])
            for (const scale of config.periodHypotheses.peakAliases) {
                const period = base * scale;
                if (period >= minT - EPS && period <= maxT + EPS && !reserved.some(p => Math.abs(p - period) < EPS))
                    reserved.push(period);
            }
        const evidence = (period: number): PeriodEvidence => {
            const acf = acfAt(envelope, time, period, work, cache), directIOI = h.direct(period);
            return { period, bpm: 60 / period, directIOI, acf, totalEvidence: directIOI + acf };
        };
        const rank = (a: PeriodEvidence, b: PeriodEvidence): number => b.totalEvidence - a.totalEvidence || b.directIOI - a.directIOI || Math.abs(Math.log(a.period / preferred)) - Math.abs(Math.log(b.period / preferred)) || a.period - b.period;
        const evidenceHypotheses: PeriodEvidence[] = proposals.map(evidence).sort(rank).slice(0, config.periodHypotheses.maximumRanked);
        for (const period of reserved)
            if (!evidenceHypotheses.some(hyp => Math.abs(hyp.period - period) < EPS))
                evidenceHypotheses.push(evidence(period));
        const hypotheses: PeriodHypothesis[] = evidenceHypotheses.map(hyp => ({ ...hyp, phases: phases(local, hyp.period, matching, from, to, domain, hyp.acf, work) })).sort(rank);
        const oldAcf = acfAt(envelope, time, preferred, work, cache);
        const oldEvidence = references.map(reference => coverage(reference.anchor, preferred, matching, from, to, domain, oldAcf, work));
        const viableOld = oldEvidence.filter(phase => phase.supported), fresh = hypotheses.filter(hyp => hyp.phases.some(phase => phase.supported));
        const best = fresh[0], same = hypotheses.find(hyp => Math.abs(hyp.period - preferred) < EPS);
        let action: TempoAction, supported = false;
        if (!everInitialized) {
            references = (same?.phases ?? []).map(phase => ({ anchor: phase.anchor + phase.meanResidual }));
            supported = !!same?.phases.some(phase => phase.supported);
            action = supported ? 'seed-initialized-supported' : 'seed-initialized-unresolved';
            everInitialized = true;
        }
        else if (viableOld.length) {
            references = viableOld.map(phase => ({ anchor: phase.anchor + phase.meanResidual }));
            supported = true;
            action = 'keep-supported-reference';
        }
        else if (oldEvidence.length && oldEvidence.every(phase => phase.unknown)) {
            action = 'keep-unknown-reference';
        }
        else if (!best) {
            action = 'no-supported-fresh-hypothesis';
            references = oldEvidence.map(phase => ({ anchor: phase.anchor }));
        }
        else if (octaveRelated(best.period, preferred) && distinctLevel(best.period, preferred)) {
            action = 'retain-level-with-octave-ambiguity';
            references = (same?.phases ?? oldEvidence).map(phase => ({ anchor: phase.anchor + phase.meanResidual }));
        }
        else {
            const before = preferred;
            preferred = best.period;
            references = best.phases.filter(phase => phase.supported).map(phase => ({ anchor: phase.anchor + phase.meanResidual }));
            supported = true;
            action = Math.abs(before - preferred) < EPS ? 'phase-reacquired' : 'prefer-fresh-family';
        }
        const alternatives = fresh.filter(hyp => octaveRelated(hyp.period, preferred) && distinctLevel(hyp.period, preferred));
        const families: TempoFamily[] = [];
        for (const hyp of hypotheses) {
            let group = families.find(group => octaveRelated(group.representativePeriod, hyp.period));
            if (!group) {
                group = { representativePeriod: hyp.period, levels: [] };
                families.push(group);
            }
            group.levels.push({ period: hyp.period, bpm: hyp.bpm, supported: hyp.phases.some(phase => phase.supported) });
        }
        work.maximumRetainedPeriods = Math.max(work.maximumRetainedPeriods, hypotheses.length);
        work.maximumRetainedPhases = Math.max(work.maximumRetainedPhases, ...hypotheses.map(hyp => hyp.phases.length));
        blocks.push({ time, from, to, preferredPeriod: preferred, preferredBpm: 60 / preferred, action, supported, referencePhaseCount: references.length, refAnchors: references.map(reference => reference.anchor), phaseAmbiguous: references.length !== 1, levelAmbiguous: alternatives.length > 0 || action === 'retain-level-with-octave-ambiguity', oldReferenceEvidence: oldEvidence, histogram: { rawPairs: h.pairs, anchors: h.anchors, peaks: h.peaks }, families, hypotheses });
    }
    return { version: config.version, scope: 'Synthetic event hypothesis investigation; no beat/note/role generation, no calibrated correctness probability', blocks, work };
}
