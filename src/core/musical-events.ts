import type { Analysis, Onset, Rhythm } from '../types';
import { beatPosition, timeAtBeat } from './rhythm';
type Work = {
    sortComparisons: number;
    binaryComparisons: number;
    rangeVisits: number;
    targets: number;
};
function indexByTime(candidates: Onset[], work?: Work): Uint32Array {
    const indices: number[] = [];
    // Nonfinite times never win the original pick: distance/score is nonfinite.
    // They remain in the untouched original-order free pass below.
    for (let i = 0; i < candidates.length; i++)
        if (Number.isFinite(candidates[i].time))
            indices.push(i);
    return Uint32Array.from(indices).sort((a, b) => {
        if (work)
            work.sortComparisons++;
        return candidates[a].time - candidates[b].time || a - b;
    });
}
function range(candidates: Onset[], index: Uint32Array, target: number, tolerance: number, work?: Work): [
    number,
    number
] {
    if (work)
        work.targets++;
    // Zero/negative/NaN tolerance cannot yield a score > -Infinity in the oracle.
    if (!(tolerance > 0))
        return [0, 0];
    let low = 0, high = index.length;
    // Search with the ORIGINAL rounded subtraction/comparison. target +/- tol
    // can exclude valid points after catastrophic cancellation near zero.
    while (low < high) {
        const middle = (low + high) >>> 1, time = candidates[index[middle]].time;
        if (work)
            work.binaryComparisons++;
        if (time < target && Math.abs(time - target) > tolerance)
            low = middle + 1;
        else
            high = middle;
    }
    const from = low;
    low = from;
    high = index.length;
    while (low < high) {
        const middle = (low + high) >>> 1, time = candidates[index[middle]].time;
        if (work)
            work.binaryComparisons++;
        if (time > target && Math.abs(time - target) > tolerance)
            high = middle;
        else
            low = middle + 1;
    }
    if (work)
        work.rangeVisits += low - from;
    return [from, low];
}
/** Pick traversal uses a stable time index; all mathematics and free pass
 * retain the frozen oracle, including input/object identity and sort quirks. */
export function musicalEvents(analysis: Analysis, rhythm: Rhythm): Onset[] {
    if (rhythm.beats.length < 2)
        return [];
    const candidates = analysis.candidates ?? analysis.onsets;
    const index = indexByTime(candidates);
    const events: Onset[] = [], used = new Set<Onset>();
    const pick = (target: number, tolerance: number, role: NonNullable<Onset['role']>) => {
        let best: Onset | undefined, bestScore = -Infinity, bestInput = Infinity;
        const [from, to] = range(candidates, index, target, tolerance);
        for (let at = from; at < to; at++) {
            const input = index[at], candidate = candidates[input];
            if (used.has(candidate) || candidate.time < 0 || candidate.time > analysis.duration - 0.18)
                continue;
            const distance = Math.abs(candidate.time - target);
            if (distance > tolerance || candidate.strength < 0.08)
                continue;
            const score = (1 - distance / tolerance) * 0.75 + Math.min(1, candidate.strength) * 0.25;
            if (score > bestScore || best !== undefined && score === bestScore && input < bestInput) {
                best = candidate;
                bestScore = score;
                bestInput = input;
            }
        }
        if (best) {
            used.add(best);
            events.push({ ...best, role });
        }
    };
    for (let i = 0; i < rhythm.beats.length; i++) {
        const at = rhythm.beats[i], span = i + 1 < rhythm.beats.length ? rhythm.beats[i + 1] - at : at - rhythm.beats[i - 1];
        pick(at, Math.min(0.09, span * 0.2), 'beat');
    }
    for (let i = 0; i + 1 < rhythm.beats.length; i++) {
        const at = rhythm.beats[i], span = rhythm.beats[i + 1] - at;
        pick(at + span * 0.5, Math.min(0.05, span * 0.12), 'half');
        for (const fraction of [0.25, 0.75])
            pick(at + span * fraction, Math.min(0.03, span * 0.07), 'quarter');
    }
    for (const candidate of candidates) {
        if (candidate.strength < 0.7 || candidate.time > analysis.duration - 0.18 || events.some(event => Math.abs(event.time - candidate.time) < 0.1))
            continue;
        const position = beatPosition(rhythm.beats, candidate.time, analysis.bpm);
        if (candidate.time < rhythm.beats[0] - 0.15 || candidate.time > rhythm.beats.at(-1)! + 0.15)
            continue;
        const beat = Math.floor(position), end = timeAtBeat(rhythm.beats, beat + 1, analysis.bpm);
        if (!events.some(event => event.role === 'free' && event.time >= timeAtBeat(rhythm.beats, beat, analysis.bpm) && event.time < end))
            events.push({ ...candidate, role: 'free' });
    }
    return events.sort((a, b) => a.time - b.time || (a.role === 'beat' ? -1 : 1));
}
/** Geometry work accounting only: does not bind/select any events. */
export function indexedRangeWork(analysis: Analysis, rhythm: Rhythm) {
    const candidates = analysis.candidates ?? analysis.onsets;
    const work: Work = { sortComparisons: 0, binaryComparisons: 0, rangeVisits: 0, targets: 0 };
    if (rhythm.beats.length < 2)
        return { ...work, finiteIndex: 0, indexTypedArrayBytes: 0, oracleFullScanVisits: 0 };
    const index = indexByTime(candidates, work);
    for (let i = 0; i < rhythm.beats.length; i++) {
        const at = rhythm.beats[i], span = i + 1 < rhythm.beats.length ? rhythm.beats[i + 1] - at : at - rhythm.beats[i - 1];
        range(candidates, index, at, Math.min(0.09, span * .2), work);
    }
    for (let i = 0; i + 1 < rhythm.beats.length; i++) {
        const at = rhythm.beats[i], span = rhythm.beats[i + 1] - at;
        range(candidates, index, at + span * .5, Math.min(.05, span * .12), work);
        for (const fraction of [.25, .75])
            range(candidates, index, at + span * fraction, Math.min(.03, span * .07), work);
    }
    return { ...work, finiteIndex: index.length, indexTypedArrayBytes: index.byteLength, oracleFullScanVisits: candidates.length * work.targets };
}
