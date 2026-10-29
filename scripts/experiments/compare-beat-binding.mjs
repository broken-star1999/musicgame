// Rejected research experiment, never imported by the website. Writes only a temporary module in .qa.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createServer } from 'vite';
import * as ort from 'onnxruntime-web/wasm';

const args = process.argv.slice(2), flag = key => args.includes(key);
const option = (key, fallback) => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : fallback; };
if (flag('--help')) {
  console.log('node scripts/experiments/compare-beat-binding.mjs [--data LOCAL_DATA_DIR] [--out REPORT.json] [--holdout]\n--holdout requires exactly genre indices 3,11,23, with no development overlap. Missing logits use the shipped small0 ONNX/WASM and are cached with hashes. No parameter tuning flags.');
  process.exit(0);
}
const folder = option('--data', '.qa/gtzan-eval');
const prototypeFile = '.qa/median-binding-events.ts';
const output = option('--out', flag('--holdout') ? '.qa/median-binding-holdout-report.json' : '.qa/median-binding-prototype-report.json');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const pcm = file => { const bytes = fs.readFileSync(file); return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4)); };
const published = JSON.parse(fs.readFileSync('benchmarks/gtzan-30-v7.json', 'utf8'));
const names = fs.readdirSync(folder).filter(name => name.endsWith('.reference.json')).map(name => name.replace('.reference.json', '')).sort();
if (names.length !== 30) throw new Error(`Expected 30 paired tracks, found ${names.length}; data preparation is incomplete.`);
if (flag('--holdout')) {
  const expected = [...new Set(published.rows.map(row => row.name.split('.')[0]))].flatMap(genre => [3, 11, 23].map(index => `${genre}.${String(index).padStart(5, '0')}`)).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Holdout must contain the predeclared 3,11,23 indices of all ten genres.');
  if (names.some(name => published.rows.some(row => row.name === name))) throw new Error('Holdout overlaps development data.');
}
for (const name of names) fs.accessSync(`${folder}/${name}.audio.f32`);
function measure(reference, predicted, tolerance = 0.07) {
  const used = new Set(); let hits = 0;
  for (const time of reference) {
    let nearest = -1, distance = tolerance;
    predicted.forEach((at, i) => { if (!used.has(i) && Math.abs(at - time) <= distance) { nearest = i; distance = Math.abs(at - time); } });
    if (nearest >= 0) { used.add(nearest); hits++; }
  }
  const precision = hits / Math.max(1, predicted.length), recall = hits / Math.max(1, reference.length);
  return { hits, predicted: predicted.length, reference: reference.length, precision, recall, f1: 2 * precision * recall / Math.max(1e-8, precision + recall) };
}

const source = fs.readFileSync('src/core/musical-events.ts', 'utf8');
const originalBlock = `    const at = rhythm.beats[i], span = i + 1 < rhythm.beats.length ? rhythm.beats[i + 1] - at : at - rhythm.beats[i - 1];\n    pick(at, Math.min(0.09, span * 0.2), 'beat');`;
const changedBlock = `    const at = rhythm.beats[i];\n    const nearby = [];\n    for (let j = Math.max(0, i - 4); j <= Math.min(rhythm.beats.length - 2, i + 4); j++) {\n      const interval = rhythm.beats[j + 1] - rhythm.beats[j];\n      if (interval > 0) nearby.push(interval);\n    }\n    nearby.sort((a, b) => a - b);\n    const center = Math.floor(nearby.length / 2);\n    const span = nearby.length % 2 ? nearby[center] : (nearby[center - 1] + nearby[center]) / 2;\n    pick(at, Math.min(0.09, span * 0.2), 'beat');`;
if (source.split(originalBlock).length !== 2) throw new Error('Primary-beat source differs from the fixed experiment; abort instead of changing another stage.');
const modifiedSource = source.replace(originalBlock, changedBlock).replace("from '../types'", "from '../src/types'").replace("from './rhythm'", "from '../src/core/rhythm'");
fs.mkdirSync(path.dirname(prototypeFile), { recursive: true }); fs.writeFileSync(prototypeFile, modifiedSource);

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
let session;
try {
  const { analyzeAudio } = await server.ssrLoadModule('/src/core/analysis.ts');
  const { applyBeatRecognition } = await server.ssrLoadModule('/src/core/recognition.ts');
  const { musicalEvents } = await server.ssrLoadModule('/.qa/median-binding-events.ts');
  const { generateChart, DIFFICULTIES, countTypes } = await server.ssrLoadModule('/src/core/chart.ts');
  const { isPlayableChart, peakFingers } = await server.ssrLoadModule('/src/core/chart-constraints.ts');
  const { validateFingering } = await server.ssrLoadModule('/src/core/fingering.ts');
  const { neuralPeaks } = await server.ssrLoadModule('/src/core/beat-decoder.ts');
  const { beatSpectrogram } = await server.ssrLoadModule('/src/core/beat-features.ts');
  const { runBeatModel } = await server.ssrLoadModule('/src/core/beat-inference.ts');
  const model = JSON.parse(fs.readFileSync('src/core/beat-model-config.json', 'utf8'));
  const inferenceSourceSha256 = Object.fromEntries(['beat-features', 'beat-inference'].map(name => [name, digest(fs.readFileSync(`src/core/${name}.ts`))]));
  const rows = [];
  for (const name of names) {
    const started = performance.now(), prefix = `${folder}/${name}`, samples = pcm(`${prefix}.audio.f32`), audioSha256 = digest(Buffer.from(samples.buffer));
    let logits, logitsOrigin;
    if (fs.existsSync(`${prefix}.logits.f32`)) {
      logits = pcm(`${prefix}.logits.f32`);
      if (fs.existsSync(`${prefix}.logits.meta.json`)) {
        const metadata = JSON.parse(fs.readFileSync(`${prefix}.logits.meta.json`, 'utf8'));
        if (metadata.modelSha256 !== model.sha256 || metadata.audioSha256 !== audioSha256 || metadata.logitsSha256 !== digest(Buffer.from(logits.buffer)) || JSON.stringify(metadata.inferenceSourceSha256) !== JSON.stringify(inferenceSourceSha256)) throw new Error(`${name}: cached logits provenance does not match the current shipped pipeline.`);
        logitsOrigin = 'verified cache of shipped ONNX/WASM';
      } else {
        if (path.resolve(folder) !== path.resolve('.qa/gtzan-eval')) throw new Error(`${name}: custom dataset logits lack model/input provenance.`);
        logitsOrigin = 'existing development native small0 logits, checked against published WASM baseline metrics';
      }
    } else {
      if (!session) {
        const bytes = fs.readFileSync(`public/models/${model.file}`);
        if (digest(bytes) !== model.sha256) throw new Error('Shipped model checksum mismatch.');
        ort.env.wasm.numThreads = 1;
        session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      }
      console.log(JSON.stringify({ name, stage: 'running shipped small0 WASM' }));
      logits = await runBeatModel(session, beatSpectrogram(samples));
      fs.writeFileSync(`${prefix}.logits.f32`, Buffer.from(logits.buffer));
      fs.writeFileSync(`${prefix}.logits.meta.json`, JSON.stringify({ date: new Date().toISOString(), modelSha256: model.sha256, audioSha256, logitsSha256: digest(Buffer.from(logits.buffer)), inferenceSourceSha256, runtime: 'shipped ONNX model / ONNX Runtime WASM, single thread' }, null, 2) + '\n');
      logitsOrigin = 'fresh shipped ONNX/WASM';
    }
    const reference = JSON.parse(fs.readFileSync(`${prefix}.reference.json`, 'utf8'));
    const basic = analyzeAudio(samples, 22050), before = applyBeatRecognition(basic, logits);
    const after = { ...before, pulse: { onsets: musicalEvents(basic, before.rhythm), sections: [] } };
    const heads = analysis => analysis.pulse.onsets.filter(event => event.role === 'beat').map(event => event.time);
    const bound = { before: measure(reference, heads(before)), after: measure(reference, heads(after)) };
    const bound50 = { before: measure(reference, heads(before), 0.05), after: measure(reference, heads(after), 0.05) };
    const charts = {};
    for (const mode of ['one', 'two', 'three', 'four']) {
      const baseline = generateChart(before, mode), proposed = generateChart(after, mode), max = DIFFICULTIES[mode].max;
      const snapshot = chart => ({ notes: chart.notes.length, density: chart.notes.length / chart.duration, peakFingers: peakFingers(chart.notes), omitted: chart.fingering.omitted, types: countTypes(chart),
        valid: isPlayableChart(chart.notes, max, chart.duration) && validateFingering(chart.notes, max, chart.duration) && peakFingers(chart.notes) <= max,
        headScore: measure(reference, chart.notes.map(note => note.time)),
        headScore50: measure(reference, chart.notes.map(note => note.time), 0.05),
        uniqueHeadScore: measure(reference, [...new Set(chart.notes.map(note => note.time))]),
        uniqueHeadScore50: measure(reference, [...new Set(chart.notes.map(note => note.time))], 0.05) });
      charts[mode] = { before: snapshot(baseline), after: snapshot(proposed) };
      if (!charts[mode].before.valid || !charts[mode].after.valid) throw new Error(`${name}/${mode}: invalid baseline/prototype chart`);
    }
    const clockScore = measure(reference, before.rhythm.beats);
    const previousPublished = published.rows.find(row => row.name === name);
    const row = { name, audioSha256, annotationSha256: digest(fs.readFileSync(`${prefix}.reference.json`)), logitsSha256: digest(Buffer.from(logits.buffer)), logitsOrigin, clockUnchanged: before.rhythm === after.rhythm,
      publishedClockExact: previousPublished ? Math.abs(clockScore.f1 - previousPublished.afterClock70.f1) < 1e-8 : null,
      publishedSingleExact: previousPublished ? Math.abs(charts.one.before.headScore.f1 - previousPublished.afterSingleHeads70.f1) < 1e-8 : null,
      modelBpm: before.bpm, bound, bound50, charts, clockScore, clockScore50: measure(reference, before.rhythm.beats, 0.05), rawScore: measure(reference, neuralPeaks(logits)), rawScore50: measure(reference, neuralPeaks(logits), 0.05),
      runtimeSeconds: (performance.now() - started) / 1000,
      boundHeadTimes: { before: heads(before), after: heads(after) } };
    rows.push(row); console.log(JSON.stringify({ name, bound: [bound.before.f1, bound.after.f1], one: [charts.one.before.headScore.f1, charts.one.after.headScore.f1], counts: Object.fromEntries(Object.entries(charts).map(([mode, values]) => [mode, [values.before.notes, values.after.notes]])) }));
  }
  const mean = selector => rows.reduce((sum, row) => sum + selector(row), 0) / rows.length;
  const comparison = selector => ({ before: { f1: mean(row => selector(row).before.f1), precision: mean(row => selector(row).before.precision), recall: mean(row => selector(row).before.recall) },
    after: { f1: mean(row => selector(row).after.f1), precision: mean(row => selector(row).after.precision), recall: mean(row => selector(row).after.recall) },
    improved: rows.filter(row => selector(row).after.f1 > selector(row).before.f1 + 1e-9).map(row => row.name),
    regressed: rows.filter(row => selector(row).after.f1 < selector(row).before.f1 - 1e-9).map(row => row.name),
    tied: rows.filter(row => Math.abs(selector(row).after.f1 - selector(row).before.f1) <= 1e-9).length });
  const aggregate = { tracks: rows.length, sourceClockUnchanged: rows.every(row => row.clockUnchanged), publishedBaselineExact: rows.filter(row => row.publishedClockExact && row.publishedSingleExact).length,
    bound: comparison(row => row.bound), one: comparison(row => ({ before: row.charts.one.before.headScore, after: row.charts.one.after.headScore })),
    bound50: comparison(row => row.bound50), one50: comparison(row => ({ before: row.charts.one.before.headScore50, after: row.charts.one.after.headScore50 })),
    modeDensity: Object.fromEntries(['one', 'two', 'three', 'four'].map(mode => [mode, { before: mean(row => row.charts[mode].before.density), after: mean(row => row.charts[mode].after.density) }])),
    allChartsValid: rows.every(row => Object.values(row.charts).every(chart => chart.before.valid && chart.after.valid)) };
  const report = { date: new Date().toISOString(), dataset: flag('--holdout') ? 'predeclared independent indices 3,11,23 in all ten GTZAN genres' : 'existing 30 development tracks', inputDirectory: folder,
    protocol: 'Primary beat binding only: replace adjacent next interval with median of up to nine positive intervals indexed i-4..i+4 (edge-clipped). Preserve min(.09,span*.2), score, used-set priority, half/quarter/free binding, raw/decoded clock and all chart logic. No per-track tuning.',
    warning: 'Beat annotation F1 is not all musical-note quality. Do not infer subjective improvement from averages. Both variants consume identical logits and rhythm; only primary attack binding differs.',
    modelSha256: model.sha256, inferenceSourceSha256,
    sourceSha256: Object.fromEntries(['analysis', 'beat-decoder', 'recognition', 'musical-events', 'onset-selection', 'chart', 'patterns', 'phrases', 'fingering'].map(name => [name, digest(fs.readFileSync(`src/core/${name}.ts`))])),
    originalSourceSha256: digest(source), modifiedSourceSha256: digest(modifiedSource), originalBlock, changedBlock, aggregate, rows };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output, aggregate }));
} finally { if (session) await session.release(); await server.close(); }
