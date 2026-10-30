import type { PhaseInput, PhaseResult } from './phase-dp-types';
import { exactHull } from './phase-dp-kernel';
const STEP = .01;
export function phaseDP({ envelope, local, duration, bpm, onsets, localHopSeconds = 2 }: PhaseInput): PhaseResult {
    if (!(duration >= 0 && Number.isFinite(duration) && bpm > 0 && Number.isFinite(bpm) && localHopSeconds > 0 && Number.isFinite(localHopSeconds)))
        throw Error('Invalid clock metadata');
    const frames = Math.ceil(duration / STEP) + 1;
    if (envelope.length !== frames || !local.length || !onsets.length)
        throw Error('Invalid clock shape');
    for (const value of envelope)
        if (!Number.isFinite(value))
            throw Error('Invalid envelope');
    for (const value of local)
        if (!(value > 0 && Number.isFinite(value)))
            throw Error('Invalid local lag');
    const last = onsets.at(-1)!.time;
    if (!(last >= 0 && Number.isFinite(last)))
        throw Error('Invalid last onset');
    // local values are periods IN100Hz FRAMES, not seconds or BPM.
    const expanded = Float64Array.from({ length: frames }, (_, t) => local[Math.min(local.length - 1, Math.round(t * STEP / localHopSeconds))]);
    const result = exactHull(envelope, expanded, { qmin: 25, last: Math.min(frames - 1, Math.round(last / STEP)), base: 60 / bpm / STEP });
    return { path: result.path, objective: result.objective, end: result.end, endCode: result.code,
        diagnostics: { stepSeconds: STEP, qmin: result.qmin, qmax: result.qmax, lagStates: result.L, explicitDpTypedBytes: result.stats.typedBytes,
            expandedLocalBytes: expanded.byteLength, numericalFallbacks: result.stats.numericalFallbacks, queries: result.stats.queries } };
}
