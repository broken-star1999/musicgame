import type { Shape, MessageState, Messages, Workspace, Ending, DpOptions, DpResult, BruteResult } from './phase-dp-types';
// Exact last-lag states, bounded message ring and byte-coded backtrace.
const A = 1.1, B = 3.2;
export function shape(local: Float64Array, qmin: number = 25): Shape {
    let maximum = 0;
    for (const p of local) {
        if (!(p > 0 && Number.isFinite(p)))
            throw Error('Invalid local period');
        maximum = Math.max(maximum, p);
    }
    const qmax = Math.ceil(maximum * 1.5), L = qmax - qmin + 1;
    if (!(L > 0 && L < 255))
        throw Error('Trace codec requires1..254 states');
    return { qmin, qmax, L, logs: Float64Array.from({ length: L }, (_, i) => Math.log(qmin + i)) };
}
export function bruteMessages(states: readonly MessageState[], queryLogs: Float64Array): Messages {
    const values = new Float64Array(queryLogs.length), codes = new Uint8Array(queryLogs.length);
    for (let j = 0; j < queryLogs.length; j++) {
        let best = -Infinity, code = 255;
        for (const s of states) {
            if (!Number.isFinite(s.score))
                continue;
            const v = s.score - A * (queryLogs[j] - Math.log(s.period)) ** 2;
            if (v > best || (v === best && s.code < code)) {
                best = v;
                code = s.code;
            }
        }
        values[j] = best;
        codes[j] = code;
    }
    return { values, codes };
}
// Sorted slopes/queries; exact direct cost is evaluated for candidate winners.
// Near-ties fall back to all finite states. This is numerical protection only.
export function hullWorkspace(L: number): Workspace {
    return { x: new Float64Array(L + 1), score: new Float64Array(L + 1), code: new Uint8Array(L + 1), m: new Float64Array(L + 1), b: new Float64Array(L + 1),
        hull: new Uint16Array(L + 1), start: new Float64Array(L + 1), values: new Float64Array(L), codes: new Uint8Array(L), fallbacks: 0, queries: 0, freeScore: -Infinity, freeLog: 0 };
}
export function hullMessages(sortedStates: readonly MessageState[], queryLogs: Float64Array, w: Workspace = hullWorkspace(queryLogs.length)): Messages {
    let n = 0, maxAbs = 0;
    w.freeScore = -Infinity;
    for (const state of sortedStates)
        if (state.code === 0) {
            w.freeScore = state.score;
            w.freeLog = Math.log(state.period);
        }
    for (const s of sortedStates) {
        if (!Number.isFinite(s.score))
            continue;
        const x = Math.log(s.period);
        maxAbs = Math.max(maxAbs, Math.abs(s.score));
        if (n && x === w.x[n - 1]) {
            if (s.score > w.score[n - 1] || (s.score === w.score[n - 1] && s.code < w.code[n - 1])) {
                w.score[n - 1] = s.score;
                w.code[n - 1] = s.code;
            }
            continue;
        }
        w.x[n] = x;
        w.score[n] = s.score;
        w.code[n] = s.code;
        n++;
    }
    return queryHull(n, maxAbs, queryLogs, w);
}
function queryHull(n: number, maxAbs: number, queryLogs: Float64Array, w: Workspace): Messages {
    let count = 0;
    for (let i = 0; i < n; i++) {
        w.m[i] = 2 * A * w.x[i];
        w.b[i] = w.score[i] - A * w.x[i] ** 2;
        let cross = -Infinity;
        while (count) {
            const j = w.hull[count - 1];
            cross = (w.b[j] - w.b[i]) / (w.m[i] - w.m[j]);
            if (count === 1 || cross >= w.start[count - 1])
                break;
            count--;
        }
        w.hull[count] = i;
        w.start[count] = count ? cross : -Infinity;
        count++;
    }
    let pointer = 0;
    for (let k = 0; k < queryLogs.length; k++) {
        const x = queryLogs[k];
        while (pointer + 1 < count && w.start[pointer + 1] <= x)
            pointer++;
        let best = -Infinity, code = 255, second = -Infinity;
        for (let h = Math.max(0, pointer - 1); h <= Math.min(count - 1, pointer + 1); h++) {
            const i = w.hull[h], v = w.score[i] - A * (x - w.x[i]) ** 2, c = w.code[i];
            if (v > best || (v === best && c < code)) {
                second = best;
                best = v;
                code = c;
            }
            else if (v > second)
                second = v;
        }
        const epsilon = Math.max(1e-12, 64 * Number.EPSILON * (1 + Math.abs(best) + maxAbs + 100));
        if (second !== -Infinity && best - second <= epsilon) {
            w.fallbacks++;
            best = -Infinity;
            code = 255;
            for (let i = 0; i < n; i++) {
                const v = w.score[i] - A * (x - w.x[i]) ** 2, c = w.code[i];
                if (v > best || (v === best && c < code)) {
                    best = v;
                    code = c;
                }
            }
        }
        // Even a mathematically dominated same-period free state can tie after FP subtraction.
        // Code0 has priority on that exact numeric tie; do not discard it before query.
        const freeValue = w.freeScore - A * (x - w.freeLog) ** 2;
        if (freeValue > best || freeValue === best) {
            best = freeValue;
            code = 0;
        }
        w.values[k] = best;
        w.codes[k] = code;
    }
    w.queries += queryLogs.length;
    return { values: w.values, codes: w.codes };
}
function rowToHull(row: Float64Array, freeScore: number, freePeriod: number, s: Shape, w: Workspace): Messages {
    let n = 0, inserted = false, maxAbs = Math.abs(freeScore);
    const fx = Math.log(freePeriod);
    w.freeScore = freeScore;
    w.freeLog = fx;
    const push = (x: number, score: number, code: number): void => {
        if (!Number.isFinite(score))
            return;
        maxAbs = Math.max(maxAbs, Math.abs(score));
        if (n && x === w.x[n - 1]) {
            if (score > w.score[n - 1] || (score === w.score[n - 1] && code < w.code[n - 1])) {
                w.score[n - 1] = score;
                w.code[n - 1] = code;
            }
            return;
        }
        w.x[n] = x;
        w.score[n] = score;
        w.code[n] = code;
        n++;
    };
    for (let i = 0; i < s.L; i++) {
        if (!inserted && fx <= s.logs[i]) {
            push(fx, freeScore, 0);
            inserted = true;
        }
        push(s.logs[i], row[i], i + 1);
    }
    if (!inserted)
        push(fx, freeScore, 0);
    return queryHull(n, maxAbs, s.logs, w);
}
function ending(env: Float64Array, bestScores: Float64Array, bestCodes: Uint8Array, last: number, base: number): Ending {
    let end = last;
    for (let t = Math.max(0, last - Math.round(base * 1.2)); t <= last; t++)
        if (bestScores[t] + env[t] * .1 > bestScores[end] + env[end] * .1)
            end = t;
    return { end, code: bestCodes[end], objective: bestScores[end] };
}
function backtrace(trace: Uint8Array, T: number, s: Shape, chosen: Ending): number[] {
    let t = chosen.end, code = chosen.code;
    const path: number[] = [];
    for (let steps = 0; steps <= T; steps++) {
        path.push(t);
        if (code === 0) {
            path.reverse();
            return path;
        }
        if (code === 255 || code > s.L)
            throw Error('Invalid trace state');
        const previousCode = trace[t * s.L + code - 1];
        t -= s.qmin + code - 1;
        code = previousCode;
        if (t < 0)
            throw Error('Negative trace time');
    }
    throw Error('Trace cycle');
}
export function exactHull(env: Float64Array, local: Float64Array, { qmin = 25, last = env.length - 1, base = local[0], capture = false }: DpOptions = {}): DpResult {
    if (env.length !== local.length)
        throw Error('Shape mismatch');
    const s = shape(local, qmin), T = env.length, R = s.qmax + 1, ring = new Float64Array(R * s.L), ringCodes = new Uint8Array(R * s.L), trace = new Uint8Array(T * s.L).fill(255), row = new Float64Array(s.L), bestScores = new Float64Array(T), bestCodes = new Uint8Array(T), w = hullWorkspace(s.L), states = capture ? new Float64Array(T * (s.L + 1)).fill(-Infinity) : null;
    for (let t = 0; t < T; t++) {
        row.fill(-Infinity);
        let best = env[t], bestCode = 0;
        const low = Math.max(qmin, Math.floor(local[t] * .65)), high = Math.min(t, Math.ceil(local[t] * 1.5)), logLocal = Math.log(local[t]);
        if (states)
            states[t * (s.L + 1)] = env[t];
        for (let q = low; q <= high; q++) {
            const i = q - qmin, p = t - q, offset = (p % R) * s.L + i;
            const value = env[t] - B * (s.logs[i] - logLocal) ** 2 + ring[offset];
            row[i] = value;
            trace[t * s.L + i] = ringCodes[offset];
            if (states)
                states[t * (s.L + 1) + i + 1] = value;
            if (value > best) {
                best = value;
                bestCode = i + 1;
            }
        }
        bestScores[t] = best;
        bestCodes[t] = bestCode;
        const result = rowToHull(row, env[t], local[t], s, w), offset = (t % R) * s.L;
        ring.set(result.values, offset);
        ringCodes.set(result.codes, offset);
    }
    const chosen = ending(env, bestScores, bestCodes, last, base), path = backtrace(trace, T, s, chosen);
    return { ...s, ...chosen, path, trace, states, bestScores, bestCodes, stats: { queries: w.queries, numericalFallbacks: w.fallbacks,
            typedBytes: trace.byteLength + ring.byteLength + ringCodes.byteLength + row.byteLength + bestScores.byteLength + bestCodes.byteLength +
                Object.values(w).reduce((n: number, x: unknown) => n + (ArrayBuffer.isView(x) ? x.byteLength : 0), 0) + s.logs.byteLength + (states?.byteLength ?? 0), scoreStorage: 'ring; full states only for short oracle capture' } };
}
// Independent full time×state oracle. It does not use the hull or message ring.
export function exactBrute(env: Float64Array, local: Float64Array, { qmin = 25, last = env.length - 1, base = local[0] }: DpOptions = {}): BruteResult {
    const s = shape(local, qmin), T = env.length;
    if (T > 5000)
        throw Error('Short-fixture oracle only');
    const states = new Float64Array(T * (s.L + 1)).fill(-Infinity), trace = new Uint8Array(T * s.L).fill(255), bestScores = new Float64Array(T), bestCodes = new Uint8Array(T);
    for (let t = 0; t < T; t++) {
        const offset = t * (s.L + 1);
        states[offset] = env[t];
        let frameBest = env[t], frameCode = 0;
        for (let q = Math.max(qmin, Math.floor(local[t] * .65)); q <= Math.min(t, Math.ceil(local[t] * 1.5)); q++) {
            const p = t - q, pre = p * (s.L + 1), x = Math.log(q);
            let best = -Infinity, code = 255;
            for (let r = 0; r <= s.L; r++) {
                const old = states[pre + r];
                if (!Number.isFinite(old))
                    continue;
                const period = r === 0 ? local[p] : qmin + r - 1;
                const value = old - A * (x - Math.log(period)) ** 2;
                if (value > best) {
                    best = value;
                    code = r;
                }
            }
            const i = q - qmin, value = env[t] - B * (x - Math.log(local[t])) ** 2 + best;
            states[offset + i + 1] = value;
            trace[t * s.L + i] = code;
            if (value > frameBest) {
                frameBest = value;
                frameCode = i + 1;
            }
        }
        bestScores[t] = frameBest;
        bestCodes[t] = frameCode;
    }
    const chosen = ending(env, bestScores, bestCodes, last, base);
    return { ...s, ...chosen, path: backtrace(trace, T, s, chosen), trace, states, bestScores, bestCodes };
}
