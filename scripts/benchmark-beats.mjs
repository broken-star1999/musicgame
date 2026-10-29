/** Offline developer benchmark. Input music/annotations remain outside source
 * control; this program writes aggregate/per-track metrics, never audio. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'vite';
import * as ort from 'onnxruntime-web/wasm';

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []));
if (!options.data) throw new Error('Usage: node scripts/benchmark-beats.mjs --data LOCAL_PCM_AND_REFERENCE_DIRECTORY [--baseline OLD_CORE_DIRECTORY] [--out REPORT.json]');
const config = JSON.parse(fs.readFileSync('src/core/beat-model-config.json', 'utf8'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function pcm(file) { const bytes = fs.readFileSync(file); return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4)); }
function measure(reference, predicted, tolerance) {
  const used = new Set(), errors = [];
  for (const time of reference) {
    let best = -1, distance = tolerance;
    predicted.forEach((at, i) => { if (!used.has(i) && Math.abs(at - time) <= distance) { best = i; distance = Math.abs(at - time); } });
    if (best >= 0) { used.add(best); errors.push(distance); }
  }
  const precision = errors.length / Math.max(1, predicted.length), recall = errors.length / Math.max(1, reference.length);
  return { f1: 2 * precision * recall / Math.max(1e-8, precision + recall), precision, recall, matchedMeanErrorMs: errors.reduce((sum, value) => sum + value * 1000, 0) / Math.max(1, errors.length) };
}
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
let session;
try {
  const { analyzeAudio } = await server.ssrLoadModule('/src/core/analysis.ts');
  const { applyBeatRecognition } = await server.ssrLoadModule('/src/core/recognition.ts');
  const { generateChart, DIFFICULTIES } = await server.ssrLoadModule('/src/core/chart.ts');
  const { beatSpectrogram } = await server.ssrLoadModule('/src/core/beat-features.ts');
  const { runBeatModel } = await server.ssrLoadModule('/src/core/beat-inference.ts');
  const { isPlayableChart } = await server.ssrLoadModule('/src/core/chart-constraints.ts');
  let oldAnalysis = analyzeAudio, oldChart = generateChart;
  if (options.baseline) {
    oldAnalysis = (await server.ssrLoadModule(path.resolve(options.baseline, 'analysis.ts'))).analyzeAudio;
    oldChart = (await server.ssrLoadModule(path.resolve(options.baseline, 'chart.ts'))).generateChart;
  }
  const bytes = fs.readFileSync(`public/models/${config.file}`);
  if (digest(bytes) !== config.sha256) throw new Error('Model checksum does not match the published configuration');
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const names = fs.readdirSync(options.data).filter(name => name.endsWith('.reference.json')).map(name => name.replace('.reference.json', '')).sort();
  const rows = [];
  for (const name of names) {
    const samples = pcm(path.join(options.data, `${name}.audio.f32`)), reference = JSON.parse(fs.readFileSync(path.join(options.data, `${name}.reference.json`), 'utf8'));
    const start = performance.now(), logits = await runBeatModel(session, beatSpectrogram(samples));
    const enhanced = applyBeatRecognition(analyzeAudio(samples, 22050), logits), basic = oldAnalysis(samples, 22050);
    const before = oldChart(basic, 'one'), after = generateChart(enhanced, 'one');
    const charts = {};
    for (const difficulty of ['one', 'two', 'three', 'four']) {
      const chart = difficulty === 'one' ? after : generateChart(enhanced, difficulty);
      if (!isPlayableChart(chart.notes, DIFFICULTIES[difficulty].max, chart.duration) || !chart.fingering?.checked) throw new Error(`${name}: invalid ${difficulty} chart`);
      charts[difficulty] = { notes: chart.notes.length, fingerLimit: chart.fingerLimit };
    }
    const row = { name, audioPcmSha256: digest(Buffer.from(samples.buffer)), duration: samples.length / 22050, seconds: (performance.now() - start) / 1000,
      beforeClock70: measure(reference, basic.rhythm?.beats ?? [], .07), afterClock70: measure(reference, enhanced.rhythm.beats, .07),
      beforeClock50: measure(reference, basic.rhythm?.beats ?? [], .05), afterClock50: measure(reference, enhanced.rhythm.beats, .05),
      beforeSingleHeads70: measure(reference, before.notes.map(note => note.time), .07), afterSingleHeads70: measure(reference, after.notes.map(note => note.time), .07), charts };
    rows.push(row); console.log(JSON.stringify({ name, beforeF1: row.beforeClock70.f1, afterF1: row.afterClock70.f1, seconds: row.seconds }));
  }
  if (!rows.length) throw new Error('No .audio.f32 / .reference.json fixture pairs were found');
  const keys = ['beforeClock70', 'afterClock70', 'beforeClock50', 'afterClock50', 'beforeSingleHeads70', 'afterSingleHeads70'];
  const average = Object.fromEntries(keys.map(key => [key, Object.fromEntries(['f1', 'precision', 'recall'].map(metric => [metric, rows.reduce((sum, row) => sum + row[key][metric], 0) / rows.length]))]));
  const sourceFiles = ['analysis', 'beat-decoder', 'beat-features', 'beat-inference', 'recognition', 'musical-events', 'chart', 'onset-selection', 'patterns', 'phrases', 'chroma', 'rhythm'];
  const report = { schema: 1, date: new Date().toISOString(), pipeline: 7, runtime: 'shipped ONNX model / ONNX Runtime WASM, single thread', modelSha256: config.sha256,
    baseline: options.baseline ? 'external old core; source hashes included' : 'current lightweight signal analysis',
    baselineSourceSha256: options.baseline ? Object.fromEntries(['analysis', 'chart'].map(name => [name, digest(fs.readFileSync(path.join(options.baseline, `${name}.ts`)))])) : undefined,
    sourceSha256: Object.fromEntries(sourceFiles.map(name => [name, digest(fs.readFileSync(`src/core/${name}.ts`))])),
    notes: 'Beat-reference F1 is not gameplay accuracy or a rating of all melody/offbeat notes. These files form a development comparison subset, not the full GTZAN benchmark. Audio and beat annotations are not distributed in this report.', tracks: rows.length, average, rows };
  const output = options.out || '.qa/beat-benchmark-report.json'; fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, tracks: rows.length, average }, null, 2));
} finally { if (session) await session.release(); await server.close(); }
