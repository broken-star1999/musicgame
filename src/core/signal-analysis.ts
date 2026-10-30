import { mergeClockOnsets } from './clock-evidence';
import { reinforceCoincidentOnsets } from './clock-evidence';
import type { Analysis, Onset } from '../types';
import FFT from 'fft.js';
import { trackBeats } from './rhythm';
import { extractTonalFeatures } from './chroma';
import { followRhythmSource } from './rhythm-source';
import { annotateSignalEvents } from './signal-events';
export function fingerprint(samples: Float32Array): string {
    let hash = 2166136261;
    for (let i = 0; i < samples.length; i += 31) {
        hash = Math.imul(hash ^ Math.round(samples[i] * 32767), 16777619);
    }
    return `${samples.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}
export function estimateTempo(onsets: Onset[]): {
    bpm: number;
    confidence: number;
} {
    if (onsets.length < 4)
        return { bpm: 120, confidence: 0 };
    const scores = new Float64Array(201);
    // A weighted inter-onset histogram tolerates subdivisions and missing beats.
    for (let i = 0; i < onsets.length; i++) {
        for (let j = i + 1; j < Math.min(i + 10, onsets.length); j++) {
            const delta = onsets[j].time - onsets[i].time;
            if (delta < 0.2 || delta > 3)
                continue;
            let bpm = 60 / delta;
            while (bpm < 80)
                bpm *= 2;
            while (bpm > 180)
                bpm /= 2;
            const weight = Math.sqrt(onsets[i].strength * onsets[j].strength) / Math.sqrt(j - i);
            for (let k = Math.max(60, Math.floor(bpm - 3)); k <= Math.min(200, Math.ceil(bpm + 3)); k++) {
                scores[k] += weight * Math.exp(-0.5 * ((k - bpm) / 1.3) ** 2);
            }
        }
    }
    let best = 120;
    for (let k = 80; k <= 180; k++)
        if (scores[k] > scores[best])
            best = k;
    const beat = 60 / best;
    const anchor = onsets.reduce((a, b) => a.strength > b.strength ? a : b).time;
    let aligned = 0, total = 0;
    for (const onset of onsets) {
        const phase = (onset.time - anchor) / (beat / 2);
        const err = Math.abs(phase - Math.round(phase)) * beat / 2;
        aligned += onset.strength * Math.exp(-0.5 * (err / 0.045) ** 2);
        total += onset.strength;
    }
    return { bpm: best, confidence: Math.min(1, aligned / Math.max(total, 1e-8)) };
}
export function analyzeAudio(samples: Float32Array, sampleRate: number, progress?: (value: number, stage: string) => void): Analysis {
    const n = 1024, hop = Math.round(sampleRate * 0.01);
    const frames = Math.max(0, Math.floor((samples.length - n) / hop) + 1);
    if (!frames)
        throw new Error('音频太短，请选择至少 2 秒的音乐。');
    const flux = new Float64Array(frames), rms = new Float64Array(frames), bands = new Uint8Array(frames);
    const bandEnvelopes = Array.from({ length: 3 }, () => new Float64Array(frames));
    const bandMax = [0, 0, 0];
    const transform = new FFT(n), input = new Float64Array(n), spectrum = transform.createComplexArray();
    const previous = new Float64Array(n / 2), current = new Float64Array(n / 2);
    const window = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    let maxRms = 0, maxFlux = 0;
    for (let f = 0; f < frames; f++) {
        let square = 0;
        for (let j = 0; j < n; j++) {
            const x = samples[f * hop + j];
            input[j] = x * window[j];
            square += x * x;
        }
        rms[f] = Math.sqrt(square / n);
        maxRms = Math.max(maxRms, rms[f]);
        transform.realTransform(spectrum, input);
        const bandFlux = [0, 0, 0], rawBandFlux = [0, 0, 0];
        for (let k = 1; k < n / 2; k++) {
            const amplitude = Math.hypot(spectrum[k * 2], spectrum[k * 2 + 1]);
            current[k] = Math.log1p(amplitude);
        }
        for (let k = 1; k < n / 2; k++) {
            // Compare with nearby previous frequencies, not only the same FFT bin.
            // A moving harmonic (vibrato/bend) is not necessarily a new attack.
            const radius = Math.max(1, Math.round(k * 0.035));
            let reference = previous[k];
            for (let bin = Math.max(1, k - radius); bin <= Math.min(n / 2 - 1, k + radius); bin++)
                reference = Math.max(reference, previous[bin]);
            const difference = Math.max(0, current[k] - reference);
            const freq = k * sampleRate / n;
            const band = freq < 250 ? 0 : freq < 2500 ? 1 : 2;
            bandFlux[band] += difference;
            rawBandFlux[band] += Math.max(0, current[k] - previous[k]);
        }
        previous.set(current);
        // Equalize the number of bins so the high band does not dominate all songs.
        bandFlux[0] *= 3;
        bandFlux[1] *= 1.3;
        bandFlux[2] *= 0.65;
        for (let band = 0; band < 3; band++) {
            bandEnvelopes[band][f] = bandFlux[band];
            bandMax[band] = Math.max(bandMax[band], bandFlux[band]);
        }
        flux[f] = bandFlux[0] + bandFlux[1] + bandFlux[2];
        // Keep the unsuppressed amplitude reference: reducing the noise floor must
        // not automatically amplify weaker residual fluctuations into extra notes.
        maxFlux = Math.max(maxFlux, rawBandFlux[0] * 3 + rawBandFlux[1] * 1.3 + rawBandFlux[2] * 0.65);
        bands[f] = bandFlux.indexOf(Math.max(...bandFlux));
        if (f % 256 === 0)
            progress?.(0.05 + f / frames * 0.72, '正在寻找声音起点');
    }
    if (maxRms < 0.0005 || maxFlux < 0.001)
        throw new Error('这段音频接近静音，没有检测到可用的节奏。');
    progress?.(0.8, '正在估计节拍');
    const onsets: Onset[] = [];
    let boundaryOnset: Onset | undefined;
    // A loud passage elsewhere must not erase audible attacks in a quiet one.
    // Keep the absolute RMS floor and the independent spectral/local-peak gates.
    for (let f = 0; f < frames - 2; f++) {
        if ((f > 0 && flux[f] < flux[f - 1]) || flux[f] <= flux[f + 1] || rms[f] < 0.0008)
            continue;
        const local = Array.from(flux.slice(Math.max(0, f - 20), Math.min(frames, f + 16))).sort((a, b) => a - b);
        const median = local[Math.floor(local.length / 2)];
        if (flux[f] < median * 1.65 + maxFlux * 0.018 || flux[f] < maxFlux * 0.035)
            continue;
        const time = Math.max(0, (f * hop + n * 0.22) / sampleRate);
        const onset = { time, strength: flux[f] / maxFlux, band: bands[f] };
        // No previous frame exists at f0. Preserve this left-censored candidate,
        // but isolate it before deduplication so it cannot replace a regular peak.
        if (f === 0) {
            boundaryOnset = { ...onset, boundary: true };
            continue;
        }
        const last = onsets[onsets.length - 1];
        if (last && time - last.time < 0.085) {
            if (onset.strength > last.strength)
                onsets[onsets.length - 1] = onset;
        }
        else
            onsets.push(onset);
    }
    const boundaryStreams: (Onset | undefined)[] = [];
    const streams = bandEnvelopes.map((envelope, band) => {
        const events: Onset[] = [];
        const reference = Math.max(maxFlux * 0.03, bandMax[band]);
        for (let f = 0; f < frames - 2; f++) {
            if ((f > 0 && envelope[f] < envelope[f - 1]) || envelope[f] <= envelope[f + 1] || rms[f] < 0.0008)
                continue;
            const local = Array.from(envelope.slice(Math.max(0, f - 20), Math.min(frames, f + 16))).sort((a, b) => a - b);
            if (envelope[f] < local[Math.floor(local.length / 2)] * 1.8 + reference * 0.035 || envelope[f] < Math.max(reference * 0.09, maxFlux * 0.012))
                continue;
            const event = { time: Math.max(0, (f * hop + n * 0.22) / sampleRate), strength: envelope[f] / reference, band };
            if (f === 0) {
                boundaryStreams[band] = { ...event, boundary: true };
                continue;
            }
            const last = events.at(-1);
            if (last && event.time - last.time < 0.04) {
                if (event.strength > last.strength)
                    events[events.length - 1] = event;
            }
            else
                events.push(event);
        }
        return events;
    });
    progress?.(0.82, '正在选择各乐段稳定的节奏主线');
    const pulse = followRhythmSource(streams, onsets, samples.length / sampleRate);
    if (pulse.onsets.length < 3 && onsets.length < 3)
        throw new Error('没有找到足够的声音起点，试试鼓点更清楚的音乐。');
    const musicalOnsets = pulse.onsets.length >= 3 ? pulse.onsets : onsets;
    const tempo = estimateTempo(musicalOnsets);
    progress?.(0.83, '正在提取乐句音高与持续声音特征');
    const { chroma, tonalEnergy } = extractTonalFeatures(samples, sampleRate, hop, rms);
    progress?.(0.86, '正在跟踪连续拍点与局部速度');
    const rhythm = trackBeats(reinforceCoincidentOnsets(mergeClockOnsets(onsets, musicalOnsets), streams, 'weighted'), samples.length / sampleRate, tempo.bpm, musicalOnsets);
    const energy: number[] = [];
    for (let i = 0; i < frames; i += 5)
        energy.push(rms[i] / maxRms);
    const waveform: number[] = [];
    const step = Math.max(1, Math.floor(samples.length / 160));
    for (let i = 0; i < 160; i++) {
        let sum = 0, count = 0;
        for (let j = i * step; j < Math.min(samples.length, (i + 1) * step); j += 8) {
            sum += samples[j] ** 2;
            count++;
        }
        waveform.push(Math.sqrt(sum / Math.max(count, 1)));
    }
    const maxWave = Math.max(...waveform, 0.0001);
    progress?.(1, '谱面分析完成');
    // Inference above uses exactly the regular f1+ evidence. Restore only the
    // selected opening source's possible boundary cue after its clock is fixed.
    const openingBand = pulse.sections[0]?.band;
    const boundary = openingBand === 'mixed' ? boundaryOnset : boundaryStreams[['low', 'mid', 'high'].indexOf(openingBand)];
    const pulseOnsets = boundary && !musicalOnsets.some(event => Math.abs(event.time - boundary.time) <= 0.085)
        ? [boundary, ...musicalOnsets] : musicalOnsets;
    const rawOnsets = boundaryOnset ? [boundaryOnset, ...onsets] : onsets;
    const candidates = [...rawOnsets, ...streams.flat(), ...boundaryStreams.flatMap(event => event ? [event] : [])].sort((a, b) => a.time - b.time);
    return annotateSignalEvents({ duration: samples.length / sampleRate, ...tempo, rhythm, pulse: { ...pulse, onsets: pulseOnsets }, candidates, onsets: rawOnsets, energy, energyStep: hop * 5 / sampleRate, chroma, tonalEnergy, chromaStep: hop * 5 / sampleRate, waveform: waveform.map(x => x / maxWave), fingerprint: fingerprint(samples) });
}
