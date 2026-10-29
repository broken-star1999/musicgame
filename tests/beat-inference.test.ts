import { expect, it } from 'vitest';
import fs from 'node:fs';
import * as ort from 'onnxruntime-web/wasm';
import config from '../src/core/beat-model-config.json';
import reference from './fixtures/beat-model-reference.json';
import { beatSpectrogram } from '../src/core/beat-features';
import { runBeatModel } from '../src/core/beat-inference';
import { analyzeAudio } from '../src/core/analysis';
import { applyBeatRecognition } from '../src/core/recognition';
import { generateChart } from '../src/core/chart';

// Independent ground truth is the list of synthesis start times, not the model.
// Louder irregular bass occupies the SAME band as the quieter steady drum.
function sameBandMixture() {
  const rate = 22050, samples = new Float32Array(rate * 32);
  const round = (value: number) => { const floor = Math.floor(value); return value - floor === 0.5 ? floor + floor % 2 : Math.round(value); };
  const add = (start: number, frequency: number, volume: number, attack: number, decay: number) => {
    const at = round(start * rate);
    for (let i = 0; i < Math.floor(rate * 0.25) && at + i < samples.length; i++) {
      const t = i / rate;
      samples[at + i] += Math.sin(2 * Math.PI * frequency * t) * Math.min(1, t / attack) * Math.exp(-t * decay) * volume;
    }
  };
  const beats = Array.from({ length: 60 }, (_, i) => 1 + i * 0.5);
  beats.forEach(time => add(time, 100, 0.25, 0.00125, 36));
  for (let i = 0; i < 54; i++) add(10.3 + i * 0.38 + (i * 17 % 13) * 0.013, 140, 0.75, 0.018, 12);
  return { samples, beats };
}

it('runs the shipped WASM model, matches native inference across chunk edges, and keeps the quiet drum playable', async () => {
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(`public/models/${config.file}`)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  try {
    const { samples, beats } = sameBandMixture();
    const logits = await runBeatModel(session, beatSpectrogram(samples));
    expect(config.checkpointSha256).toBe(reference.checkpointSha256);
    for (const row of reference.rows) row.logits.forEach((value: number, channel: number) => {
      expect(Math.abs(logits[row.frame * 2 + channel] - value), `frame ${row.frame}, channel ${channel}`).toBeLessThan(0.02);
    });
    const analysis = applyBeatRecognition(analyzeAudio(samples, 22050), logits), chart = generateChart(analysis, 'one');
    const hits = beats.filter(time => chart.notes.some(note => Math.abs(note.time - time) < 0.05));
    const extras = chart.notes.filter(note => !beats.some(time => Math.abs(note.time - time) < 0.06));
    expect(hits.length).toBeGreaterThanOrEqual(55);
    expect(extras.length).toBeLessThanOrEqual(2);
    expect(chart.notes.some(note => note.type === 'hold')).toBe(false);
    expect(chart.generator).toBe('beat-this');
  } finally { await session.release(); }
}, 120000);
