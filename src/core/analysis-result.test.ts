import { describe, expect, it } from 'vitest';
import type { Analysis, AnalysisPatch } from '../types';
import { makeAnalysisPatch, mergeAnalysisPatch } from './analysis-result';
import { basicAnalysis } from './analysis-fallback';
import { applyBeatRecognition } from './recognition';

function signalAnalysis(): Analysis {
  const onsets = Array.from({ length: 18 }, (_, index) => ({ time: 1 + index * 0.5, strength: 0.9, band: 0 }));
  return {
    fingerprint: 'patch-identity', duration: 12, bpm: 120, confidence: 0.4,
    onsets, candidates: [...onsets], energy: Array(240).fill(0.4), energyStep: 0.05,
    waveform: [0.3, 0.5, 0.4], chromaStep: 0.05,
    chroma: Array.from({ length: 240 }, () => Array(12).fill(0.1)),
    tonalEnergy: Array.from({ length: 240 }, () => Array(12).fill(0.4)),
    rhythm: { beats: onsets.map(onset => onset.time), tempo: [], confidence: 0.4, downbeats: [], meterConfidence: 0 },
    pulse: { onsets, sections: [{ start: 0, end: 12, band: 'low', support: 0.4 }] },
  };
}
const largeFields = ['chroma', 'tonalEnergy', 'energy', 'waveform', 'onsets', 'candidates'] as const;

describe('small enhanced-analysis result patches', () => {
  it('reconstructs the actual recognition result across structured clones while retaining baseline arrays', () => {
    const workerBaseline = signalAnalysis(), logits = new Float32Array(600 * 2).fill(-8);
    for (const onset of workerBaseline.onsets) logits[Math.round(onset.time * 50) * 2] = 6;
    const enhanced = applyBeatRecognition(workerBaseline, logits);
    const outgoing = makeAnalysisPatch(workerBaseline, enhanced);
    const pageBaseline = structuredClone(workerBaseline), incoming = structuredClone(outgoing);
    const merged = mergeAnalysisPatch(pageBaseline, incoming);
    expect(merged).toEqual(structuredClone(enhanced));
    for (const field of largeFields) {
      expect(outgoing).not.toHaveProperty(field);
      expect(merged[field], `${field} should not be cloned twice`).toBe(pageBaseline[field]);
    }
    expect(merged.fingerprint).toBe(pageBaseline.fingerprint); expect(merged.energyStep).toBe(pageBaseline.energyStep);
    expect(merged.chromaStep).toBe(pageBaseline.chromaStep); expect(pageBaseline.recognition).toBeUndefined();
  });

  it('sends only recognition metadata for an enhanced failure and replaces stale model metadata', () => {
    const baseline = { ...signalAnalysis(), recognition: { engine: 'beat-this' as const, model: 'older', rawBeats: 99 } };
    const fallback = basicAnalysis(baseline, '模型下载失败');
    const patch = makeAnalysisPatch(baseline, fallback), merged = mergeAnalysisPatch(baseline, structuredClone(patch));
    expect(Object.keys(patch)).toEqual(['recognition']); expect(merged).toEqual(fallback);
    expect(merged.recognition).toEqual({ engine: 'signal', warning: expect.stringContaining('模型下载失败') });
    expect(merged.recognition).not.toHaveProperty('model'); expect(merged.recognition).not.toHaveProperty('rawBeats');
    for (const field of largeFields) expect(merged[field]).toBe(baseline[field]);
    expect(merged.rhythm).toBe(baseline.rhythm); expect(merged.pulse).toBe(baseline.pulse);
  });

  it('preserves omitted or undefined fields but clears optional fields explicitly marked null', () => {
    const baseline = { ...signalAnalysis(), recognition: { engine: 'signal' as const } };
    const merged = mergeAnalysisPatch(baseline, { bpm: undefined, confidence: undefined, rhythm: undefined, pulse: null, recognition: null });
    expect(merged.bpm).toBe(baseline.bpm); expect(merged.confidence).toBe(baseline.confidence); expect(merged.rhythm).toBe(baseline.rhythm);
    expect(merged).not.toHaveProperty('pulse'); expect(merged).not.toHaveProperty('recognition');
    expect(baseline.pulse).toBeDefined(); expect(baseline.recognition).toBeDefined();
    expect(makeAnalysisPatch(baseline, merged)).toEqual({ pulse: null, recognition: null });
    expect(mergeAnalysisPatch(baseline, structuredClone(makeAnalysisPatch(baseline, merged)))).toEqual(merged);
  });

  it('does not add unchanged properties or overwrite baseline data with unsupported patch fields', () => {
    const baseline = signalAnalysis(); expect(makeAnalysisPatch(baseline, baseline)).toEqual({});
    const merged = mergeAnalysisPatch(baseline, { bpm: 128, duration: 1, chroma: [[999]], fingerprint: 'wrong-song' } as unknown as AnalysisPatch);
    expect(merged.bpm).toBe(128); expect(merged.duration).toBe(12); expect(merged.fingerprint).toBe('patch-identity');
    expect(merged.chroma).toBe(baseline.chroma); expect(merged.pulse).toBe(baseline.pulse);
    for (const field of largeFields) expect(merged[field]).toBe(baseline[field]);
  });
});
