/** Fixed coarse-hop PLP experiment. Independent mathematical implementation of
 * FMP's local Fourier phase/overlap-add definition; not a librosa port.
 * Window index k=0..799 has physical coordinate u=k-400 frames from its centre.
 * X=sum(E[c+u]w[k]exp(-i*omega*u)); reconstruction is w*cos(omega*u+arg(X)). */
export const PLP_CONFIG = Object.freeze({
    frameRate: 100, windowFrames: 800, hopFrames: 200,
    minBpm: 50, maxBpm: 60 / .27, minPeakGapFrames: 25,
    coordinate: 'u=k-400; symmetric Hann centroid u=-0.5',
    phase: 'negative-sign DTFT; positive arg(X) in reconstruction',
    framing: 'centres 0,200,...<=last audio frame; zero outside input',
    prior: 'uniform; no input BPM or GT',
});
const N = PLP_CONFIG.windowFrames, HALF = N / 2, HOP = PLP_CONFIG.hopFrames;
const GRID = Object.freeze([...Array.from({ length: 173 }, (_, i) => 50 + i), PLP_CONFIG.maxBpm]);
type PulseWindow = { centreFrame: number; startFrame: number; firstInputFrame: number; lastInputFrame: number;
    positiveWeightedSamples: number; inputWeightedSum: number; active: boolean;
    bpm: number | null; magnitude: number; real: number; imaginary: number; phaseRadiansLocal: number | null };
export type LocalPulseResult = { path: number[]; allPeaks: number[]; localMaxima: number[]; outsideLastHorizon: number[];
    pulse: Float64Array; signedPulse: Float64Array; tempogram: Float64Array; tempoGrid: number[];
    windows: PulseWindow[]; lastFrame: number; normalizationMax: number;
    work: { windows: number; activeWindows: number; zeroWindows: number; complexDotPairs: number;
        synthesizedSamples: number; basisTrigValues: number; explicitTypedBytes: number; localMaxima: number; retainedPeaks: number } };
let cached: { cosine: Float64Array; sine: Float64Array; hann: Float64Array } | undefined;
function basis() {
    if (cached) return cached;
    const cosine = new Float64Array(GRID.length * N), sine = new Float64Array(GRID.length * N), hann = new Float64Array(N);
    for (let k = 0; k < N; k++) hann[k] = .5 - .5 * Math.cos(2 * Math.PI * k / (N - 1));
    for (let f = 0; f < GRID.length; f++) {
        const omega = 2 * Math.PI * GRID[f] / 60 / PLP_CONFIG.frameRate;
        for (let k = 0; k < N; k++) {
            const angle = omega * (k - HALF), index = f * N + k;
            cosine[index] = Math.cos(angle); sine[index] = Math.sin(angle);
        }
    }
    return cached = { cosine, sine, hann };
}
export function localPulse(envelope: Float64Array, lastFrame = envelope.length - 1): LocalPulseResult {
    if (!Number.isInteger(lastFrame) || (envelope.length && (lastFrame < 0 || lastFrame >= envelope.length))) throw Error('Invalid PLP horizon');
    for (const value of envelope) if (!(value >= 0 && Number.isFinite(value))) throw Error('Invalid PLP envelope');
    const { cosine, sine, hann } = basis(), windowCount = Math.ceil(envelope.length / HOP);
    const tempogram = new Float64Array(windowCount * GRID.length), signedPulse = new Float64Array(envelope.length), pulse = new Float64Array(envelope.length);
    const weighted = new Float64Array(N), blocked = new Uint8Array(envelope.length), windows: PulseWindow[] = [];
    let complexDotPairs = 0, synthesizedSamples = 0, activeWindows = 0;
    for (let n = 0; n < windowCount; n++) {
        const centre = n * HOP, start = centre - HALF;
        weighted.fill(0); let positive = 0, inputWeightedSum = 0;
        for (let k = 0; k < N; k++) {
            const frame = start + k;
            if (frame < 0 || frame >= envelope.length) continue;
            const value = envelope[frame] * hann[k]; weighted[k] = value;
            if (value > 0) { positive++; inputWeightedSum += value; }
        }
        let winner = -1, winnerPower = 0, winnerReal = 0, winnerImaginary = 0;
        if (positive) for (let f = 0; f < GRID.length; f++) {
            let real = 0, imaginary = 0; const offset = f * N;
            for (let k = 0; k < N; k++) {
                const value = weighted[k]; if (value === 0) continue;
                real += value * cosine[offset + k]; imaginary -= value * sine[offset + k];
            }
            complexDotPairs += positive;
            const power = real * real + imaginary * imaginary;
            tempogram[n * GRID.length + f] = Math.sqrt(power);
            // Strict comparison gives the lower grid tempo on an exact tie.
            if (power > winnerPower) { winner = f; winnerPower = power; winnerReal = real; winnerImaginary = imaginary; }
        }
        const magnitude = Math.sqrt(winnerPower), active = winner >= 0 && magnitude > 0;
        windows.push({ centreFrame: centre, startFrame: start, firstInputFrame: Math.max(0, start), lastInputFrame: Math.min(envelope.length - 1, start + N - 1),
            positiveWeightedSamples: positive, inputWeightedSum, active,
            bpm: active ? GRID[winner] : null, magnitude, real: winnerReal, imaginary: winnerImaginary,
            phaseRadiansLocal: active ? Math.atan2(winnerImaginary, winnerReal) : null });
        if (!active) continue;
        activeWindows++;
        const phaseCosine = winnerReal / magnitude, phaseSine = winnerImaginary / magnitude, offset = winner * N;
        for (let k = 0; k < N; k++) {
            const frame = start + k;
            if (frame < 0 || frame >= envelope.length) continue;
            signedPulse[frame] += hann[k] * (cosine[offset + k] * phaseCosine - sine[offset + k] * phaseSine);
            synthesizedSamples++;
        }
    }
    let normalizationMax = 0;
    for (let i = 0; i < pulse.length; i++) normalizationMax = Math.max(normalizationMax, pulse[i] = Math.max(0, signedPulse[i]));
    if (normalizationMax > 0) for (let i = 0; i < pulse.length; i++) pulse[i] /= normalizationMax;
    const localMaxima: number[] = [];
    for (let i = 0; i < pulse.length; i++) if (pulse[i] > 0 && (i === 0 || pulse[i] > pulse[i - 1]) && (i + 1 === pulse.length || pulse[i] >= pulse[i + 1])) localMaxima.push(i);
    const priority = [...localMaxima].sort((a, b) => pulse[b] - pulse[a] || a - b), allPeaks: number[] = [];
    for (const frame of priority) {
        if (blocked[frame]) continue;
        allPeaks.push(frame);
        for (let k = Math.max(0, frame - PLP_CONFIG.minPeakGapFrames + 1); k <= Math.min(pulse.length - 1, frame + PLP_CONFIG.minPeakGapFrames - 1); k++) blocked[k] = 1;
    }
    allPeaks.sort((a, b) => a - b);
    return { path: allPeaks.filter(frame => frame <= lastFrame), allPeaks, localMaxima, outsideLastHorizon: allPeaks.filter(frame => frame > lastFrame),
        pulse, signedPulse, tempogram, tempoGrid: [...GRID], windows, lastFrame, normalizationMax,
        work: { windows: windowCount, activeWindows, zeroWindows: windowCount - activeWindows, complexDotPairs, synthesizedSamples,
            basisTrigValues: cosine.length + sine.length,
            explicitTypedBytes: cosine.byteLength + sine.byteLength + hann.byteLength + weighted.byteLength + blocked.byteLength + tempogram.byteLength + signedPulse.byteLength + pulse.byteLength,
            localMaxima: localMaxima.length, retainedPeaks: allPeaks.length } };
}
