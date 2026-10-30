import type { Analysis, Onset } from '../types';
import type { TempoBlock } from './tempo-families';
export interface Tagged extends Onset {
    label?: string;
    extra?: {
        owner: string;
    };
}
export function analysisFixture(selected: Tagged[], candidates: Tagged[], beats: number[], mixed: Tagged[] = candidates): Analysis {
    return { duration: 3, bpm: 120, confidence: .9, fingerprint: 'independent-contract', onsets: mixed, pulse: { onsets: selected, sections: [] }, candidates, rhythm: { beats, tempo: [], confidence: .9, downbeats: [], meterConfidence: 0 }, energy: [], energyStep: .05, waveform: [] };
}
// Only the fields consumed by the phase projection are supplied. This is not
// a mocked full investigator trace or a claim of how anchors were inferred.
export function gateBlocks(...blocks: {
    supported: boolean;
    refAnchors: number[];
    preferredPeriod: number | null;
    phaseAmbiguous?: boolean;
}[]): TempoBlock[] { return blocks as TempoBlock[]; }
export function frozen<T>(value: T): T {
    if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
        for (const child of Object.values(value))
            frozen(child);
        Object.freeze(value);
    }
    return value;
}
