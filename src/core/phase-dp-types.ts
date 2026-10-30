export interface Onset {
    time: number;
    strength: number;
    band: number;
    attack?: number;
    boundary?: true;
    role?: 'beat' | 'half' | 'quarter' | 'free';
}
export interface Rhythm {
    beats: number[];
    tempo: {
        time: number;
        bpm: number;
    }[];
    confidence: number;
    downbeats: number[];
    meterConfidence: number;
}
export interface Features {
    frames: number;
    envelope: Float64Array;
    base: number;
    local: Float64Array;
}
export interface Shape {
    qmin: number;
    qmax: number;
    L: number;
    logs: Float64Array;
}
export interface MessageState {
    period: number;
    score: number;
    code: number;
}
export interface Messages {
    values: Float64Array;
    codes: Uint8Array;
}
export interface Workspace {
    x: Float64Array;
    score: Float64Array;
    code: Uint8Array;
    m: Float64Array;
    b: Float64Array;
    hull: Uint16Array;
    start: Float64Array;
    values: Float64Array;
    codes: Uint8Array;
    fallbacks: number;
    queries: number;
    freeScore: number;
    freeLog: number;
}
export interface Ending {
    end: number;
    code: number;
    objective: number;
}
export interface DpOptions {
    qmin?: number;
    last?: number;
    base?: number;
    capture?: boolean;
}
export interface BruteResult extends Shape, Ending {
    path: number[];
    trace: Uint8Array;
    states: Float64Array | null;
    bestScores: Float64Array;
    bestCodes: Uint8Array;
}
export interface DpResult extends BruteResult {
    stats: {
        queries: number;
        numericalFallbacks: number;
        typedBytes: number;
        scoreStorage: string;
    };
}
export interface GreedyTrace {
    path: number[];
    end: number;
    score: number;
    scores: Float64Array;
    periods: Float64Array;
    previous: Int32Array;
}
export interface PhaseInput {
    envelope: Float64Array;
    local: Float64Array;
    duration: number;
    bpm: number;
    onsets: readonly Onset[];
    localHopSeconds?: number;
}
export interface PhaseResult {
    path: number[];
    objective: number;
    end: number;
    endCode: number;
    diagnostics: {
        stepSeconds: number;
        qmin: number;
        qmax: number;
        lagStates: number;
        explicitDpTypedBytes: number;
        expandedLocalBytes: number;
        numericalFallbacks: number;
        queries: number;
    };
}
