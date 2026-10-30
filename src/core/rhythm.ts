import { gateClockEvidence } from './phase-gate';
import { phaseDP } from './phase-dp';
import { investigateTempo } from './tempo-families';
import type { Analysis, Onset, Rhythm } from '../types';
const STEP = 0.01;
/** Onset-envelope autocorrelation + a tempo-continuity dynamic program.
 * All positions are in recording time; the grid never creates chart notes. */
export function trackBeats(onsets: Onset[], duration: number, bpm: number, sourceOnsets?: Onset[]): Rhythm {
    if (onsets.length < 4)
        return { beats: [], tempo: [], confidence: 0, downbeats: [], meterConfidence: 0 };
    const investigation = investigateTempo(onsets, duration, bpm);
    const projected = gateClockEvidence(onsets, investigation.blocks, sourceOnsets);
    const frames = Math.ceil(duration / STEP) + 1, envelope = new Float64Array(frames);
    const reference = Math.max(1e-8, ...onsets.map(onset => onset.strength));
    for (const onset of projected) {
        const center = Math.round(onset.time / STEP);
        for (let d = -4; d <= 4; d++)
            if (center + d >= 0 && center + d < frames)
                envelope[center + d] = Math.max(envelope[center + d], onset.strength / reference * Math.exp(-d * d / 5));
    }
    const base = 60 / bpm / STEP;
    void base;
    const local = Float64Array.from(investigation.blocks, block => (block.preferredPeriod ?? block.rememberedPeriod ?? 60 / bpm) / STEP);
    const { path } = phaseDP({ envelope, local, duration, bpm, onsets });
    // Trim unsupported lead/tail beats; retain continuity across rests inside a song.
    while (path.length && path[0] * STEP < onsets[0].time - 0.08)
        path.shift();
    const beats = path.map(frame => frame * STEP);
    const tempo = beats.slice(1).map((time, i) => {
        const from = Math.max(0, i - 1), to = Math.min(beats.length - 1, i + 2);
        return { time, bpm: Math.round(60 * (to - from) / (beats[to] - beats[from]) * 10) / 10 };
    });
    const support = path.reduce((sum, frame) => sum + Math.min(1, envelope[frame]), 0) / Math.max(1, path.length);
    const deviation = path.slice(1).reduce((sum, frame, i) => sum + Math.log((frame - path[i]) / local[Math.min(local.length - 1, Math.round(frame * STEP / 2))]) ** 2, 0) / Math.max(1, path.length - 1);
    const accents = [0, 0, 0, 0], counts = [0, 0, 0, 0];
    beats.forEach((time, i) => {
        const nearby = onsets.filter(onset => Math.abs(onset.time - time) < 0.06);
        accents[i % 4] += nearby.reduce((sum, onset) => sum + onset.strength * (onset.band === 0 ? 1.2 : 1), 0);
        counts[i % 4]++;
    });
    const means = accents.map((value, i) => value / Math.max(1, counts[i])), sorted = [...means].sort((a, b) => b - a);
    const phase = means.indexOf(sorted[0]), meterConfidence = (sorted[0] - sorted[1]) / Math.max(0.01, sorted[0]);
    return { beats, tempo, confidence: Math.min(1, support * Math.exp(-20 * deviation)), downbeats: meterConfidence > 0.12 ? beats.filter((_, i) => i % 4 === phase) : [], meterConfidence };
}
export function beatPosition(beats: number[], time: number, fallbackBpm: number): number {
    if (beats.length < 2)
        return time * fallbackBpm / 60;
    let low = 0, high = beats.length - 1;
    while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (beats[middle] <= time)
            low = middle;
        else
            high = middle;
    }
    if (time < beats[0])
        low = 0;
    if (time >= beats.at(-1)!)
        low = beats.length - 2;
    return low + (time - beats[low]) / (beats[low + 1] - beats[low]);
}
export function timeAtBeat(beats: number[], position: number, fallbackBpm: number): number {
    if (beats.length < 2)
        return position * 60 / fallbackBpm;
    const index = Math.max(0, Math.min(beats.length - 2, Math.floor(position)));
    return beats[index] + (position - index) * (beats[index + 1] - beats[index]);
}
export function chartBeats(analysis: Analysis, bpmOverride?: number): number[] {
    if (bpmOverride === undefined && analysis.rhythm && (analysis.rhythm.confidence >= 0.45 || analysis.recognition?.engine === 'beat-this') && analysis.rhythm.beats.length > 1)
        return analysis.rhythm.beats;
    // A possible recording-boundary cue has no measured rise. It must not seed
    // either an automatic fallback grid or an explicit BPM reference.
    const bpm = bpmOverride || analysis.bpm, start = analysis.pulse?.onsets.find(onset => !onset.boundary && onset.role === 'beat')?.time
        ?? analysis.pulse?.onsets.find(onset => !onset.boundary)?.time ?? analysis.onsets.find(onset => !onset.boundary)?.time ?? 0;
    return Array.from({ length: Math.ceil((analysis.duration - start) * bpm / 60) + 1 }, (_, i) => start + i * 60 / bpm);
}
export function snapToBeat(time: number, beats: number[], bpm: number): number {
    const position = beatPosition(beats, time, bpm), whole = Math.floor(position);
    const fractions = [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1];
    let best = time, error = 0.018;
    for (const fraction of fractions) {
        const at = timeAtBeat(beats, whole + fraction, bpm), distance = Math.abs(at - time);
        if (distance < error) {
            best = at;
            error = distance;
        }
    }
    return best;
}
