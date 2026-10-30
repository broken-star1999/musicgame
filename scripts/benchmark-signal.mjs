/** Reproducible, paired signal-only benchmark. No music is downloaded/distributed.
 * Prepare (does NOT inspect input or analyze audio):
 *   node scripts/benchmark-signal.mjs --prepare-protocol --output .qa/final.draft.json
 * After the parent freezes the source hashes and gate, execute ONCE:
 *   node scripts/benchmark-signal.mjs --input <prepared-folder> --output <report.json> --protocol <frozen-protocol.json>
 * Baseline dependencies are restored from git show 27649b3 into ignored .qa.
 * Reports contain clip identifiers, hashes and summary counts, never audio,
 * reference arrays, note arrays, or absolute local input paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const BASELINE = '27649b3811a084890b8968e2e7a4149df14eb3cb';
const GENRES = ['blues', 'classical', 'country', 'disco', 'hiphop', 'jazz', 'metal', 'pop', 'reggae', 'rock'];
const ENTRIES = ['src/core/analysis.ts', 'src/core/analysis-fallback.ts', 'src/core/chart.ts', 'src/core/chart-constraints.ts', 'src/core/fingering.ts'];
const BOUNDARY = 'finite numeric reference times with 0 <= time <= pcmFloat32Frames / sampleRate; inclusive; raw inputs remain unchanged';
const EPSILON = 1e-9;
const FINAL_SELECTION_SHA256 = '6e1e43ef36e049f912cc5bb9f61b8836a54663937a5842f5f1bc3da9e4143d96';
const FINAL_INPUT_SHA256 = '70a07fa13da8cc4145f05a71ec6bc5506dc655eded4b1f9282c81303754118a5';
const PARENT_GATE = { averaging: 'macro across exactly 30 clips; absolute metric deltas', epsilon: EPSILON, head70MinGain: .02, head50F1MinDelta: 0, head50PrecisionMinDelta: 0, head50RecallMinDelta: 0, head70CILowerExclusive: 0, pulseRecallMinDelta: -.005, clockF1MinDelta: -.005, fourFingerPerClipActualHeadCountMinRatio: .95, fourFingerRetentionDefinition: 'deduplicated note heads within own measured candidates +/-20ms; after count / V7 count per clip; V7 zero requires a nonempty valid after chart', allFourModesValidAndDeterministic: true, originalV7HeadMatchingIsDiagnosticOnly: true };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const safeRelative = value => { if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw Error('Protocol source paths must be repository-relative'); return value.replaceAll('\\', '/'); };
const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });

export function effectiveReferences(raw, frames, sampleRate = 22050) {
  const duration = frames / sampleRate, valid = [], excluded = [];
  for (const [index, time] of raw.entries()) {
    const reason = typeof time !== 'number' || !Number.isFinite(time) ? 'non_finite_or_non_numeric' : time < 0 ? 'before_pcm_start' : time > duration ? 'after_pcm_end' : null;
    if (reason) excluded.push({ index, reason }); else valid.push(time);
  }
  if (!valid.every((time, i) => !i || time > valid[i - 1])) throw Error('Effective reference beats must be strictly increasing');
  return { valid, counts: { raw: raw.length, effective: valid.length, excluded: excluded.length, reasons: Object.fromEntries(['non_finite_or_non_numeric', 'before_pcm_start', 'after_pcm_end'].map(reason => [reason, excluded.filter(item => item.reason === reason).length])) } };
}

// Same distinct-nearest convention as the earlier project comparator. Predictions
// are NOT clipped: only the common reference boundary policy is applied.
export function measure(reference, predicted, tolerance = .07) {
  const used = new Set(); let hits = 0;
  for (const time of reference) {
    let best = -1, distance = tolerance;
    predicted.forEach((at, i) => { if (Number.isFinite(at) && !used.has(i) && Math.abs(at - time) <= distance) { best = i; distance = Math.abs(at - time); } });
    if (best >= 0) { used.add(best); hits++; }
  }
  return { hits, predicted: predicted.length, reference: reference.length, precision: hits / Math.max(1, predicted.length), recall: hits / Math.max(1, reference.length), f1: 2 * hits / Math.max(1, predicted.length + reference.length) };
}

export function uniqueHeads(notes) {
  return [...new Set(notes.map(note => note.time))].sort((a, b) => a - b);
}
export function measuredOnsetHeads(notes, candidates, tolerance = .02) {
  const unique = uniqueHeads(notes), actual = unique.filter(time => candidates.some(event => Math.abs(event.time - time) <= tolerance));
  return { unique, actual, counts: { notesIncludingChords: notes.length, uniqueHeads: unique.length, measuredOnsetHeads: actual.length, headsWithoutMeasuredCandidate: unique.length - actual.length } };
}
export function sourcePathComparison(before, after, duration) {
  const bounds = [...new Set([0, duration, ...before.flatMap(s => [s.start, s.end]), ...after.flatMap(s => [s.start, s.end])].filter(time => Number.isFinite(time) && time >= 0 && time <= duration))].sort((a, b) => a - b);
  const beforeSeconds = {}, afterSeconds = {}; let changedSeconds = 0, segmentsChanged = 0;
  for (let i = 1; i < bounds.length; i++) {
    const middle = (bounds[i] + bounds[i - 1]) / 2, span = bounds[i] - bounds[i - 1];
    const a = before.find(s => s.start <= middle && middle < s.end)?.band ?? 'unassigned';
    const b = after.find(s => s.start <= middle && middle < s.end)?.band ?? 'unassigned';
    beforeSeconds[a] = (beforeSeconds[a] || 0) + span; afterSeconds[b] = (afterSeconds[b] || 0) + span;
    if (a !== b) { changedSeconds += span; segmentsChanged++; }
  }
  return { changed: changedSeconds > EPSILON, changedSeconds, changedDurationRatio: changedSeconds / duration, segmentsCompared: bounds.length - 1, segmentsChanged, changedSegmentRatio: segmentsChanged / Math.max(1, bounds.length - 1), beforeSeconds, afterSeconds };
}
function quantile(sorted, q) { const at = (sorted.length - 1) * q, low = Math.floor(at); return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low); }
function randomGenerator(seed) { let state = seed >>> 0; return () => { state += 0x6D2B79F5; let x = state; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }

export function pairedBootstrap(rows, keys, { seed = 20261030, replicates = 10000 } = {}) {
  const groups = new Map(); for (const row of rows) { const genre = row.name.split('.')[0]; if (!groups.has(genre)) groups.set(genre, []); groups.get(genre).push(row); }
  const random = randomGenerator(seed), draws = Object.fromEntries(keys.map(key => [key, []]));
  for (let draw = 0; draw < replicates; draw++) {
    const sample = []; for (const group of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group)) for (let i = 0; i < group.length; i++) sample.push(group[Math.floor(random() * group.length)]);
    for (const key of keys) draws[key].push(mean(sample.map(row => row.deltas[key])));
  }
  return Object.fromEntries(keys.map(key => { const sorted = draws[key].sort((a, b) => a - b); return [key, { mean: mean(rows.map(row => row.deltas[key])), low95: quantile(sorted, .025), high95: quantile(sorted, .975), seed, replicates, method: 'paired within-genre percentile bootstrap; conditional on the fixed ten genres' }]; }));
}

export function evaluateGate(rows, confidence, gate) {
  const delta = key => mean(rows.map(row => row.deltas[key]));
  const checks = {
    head70Gain: delta('head70F1') + EPSILON >= gate.head70MinGain,
    head50F1: delta('head50F1') + EPSILON >= gate.head50F1MinDelta,
    head50Precision: delta('head50Precision') + EPSILON >= gate.head50PrecisionMinDelta,
    head50Recall: delta('head50Recall') + EPSILON >= gate.head50RecallMinDelta,
    head70PairedConfidence: confidence.head70F1.low95 > gate.head70CILowerExclusive,
    pulseRecall: delta('pulseRecall70') + EPSILON >= gate.pulseRecallMinDelta,
    clockF1: delta('clock70F1') + EPSILON >= gate.clockF1MinDelta,
    allModesValid: rows.every(row => ['before', 'after'].every(v => Object.values(row.variants[v].modes).every(mode => mode.valid))),
    allModesDeterministic: rows.every(row => ['before', 'after'].every(v => Object.values(row.variants[v].modes).every(mode => mode.deterministic))),
    fourFingerPerClipActualHeadCount: rows.every(row => row.fourFinger.beforeActualHeads === 0 ? row.variants.after.modes.four.valid && row.variants.after.modes.four.notes > 0 : row.fourFinger.actualHeadCountRatio + EPSILON >= gate.fourFingerPerClipActualHeadCountMinRatio),
  };
  return { passed: Object.values(checks).every(Boolean), checks, macroDeltas: Object.fromEntries(Object.keys(rows[0].deltas).map(key => [key, delta(key)])), failedRetentionClips: rows.filter(row => row.fourFinger.beforeActualHeads > 0 && row.fourFinger.actualHeadCountRatio + EPSILON < gate.fourFingerPerClipActualHeadCountMinRatio).map(row => row.name) };
}

// Follow relative source imports recursively, including type-only dependencies.
function dependencySources(read) {
  const found = new Map();
  function visit(file) {
    file = safeRelative(file); if (found.has(file)) return;
    const bytes = read(file); found.set(file, bytes);
    const text = bytes.toString('utf8'), expressions = [...text.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]/g)];
    for (const match of expressions) {
      const specifier = match[1] || match[2] || match[3], base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      let loaded = false;
      for (const candidate of path.posix.extname(base) ? [base] : [base + '.ts', base + '.json', base + '/index.ts']) {
        try { read(candidate); visit(candidate); loaded = true; break; } catch (error) { if (found.has(candidate)) throw error; }
      }
      if (!loaded) throw Error(`Cannot resolve frozen relative dependency: ${file} -> ${specifier}`);
    }
  }
  for (const file of ENTRIES) visit(file);
  return found;
}
function frozenSources() {
  const before = dependencySources(file => git('show', `${BASELINE}:${file}`));
  const after = dependencySources(file => fs.readFileSync(path.join(ROOT, file)));
  const hashes = files => Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, bytes]) => [file, sha(bytes)]));
  return { before, after, baselineSourceSha256: hashes(before), candidateSourceSha256: hashes(after) };
}
function draftProtocol() {
  const sources = frozenSources();
  return { schema: 1, state: 'draft_do_not_run', parentFinalFreeze: false, frozenAt: null, runId: 'signal-final-2-17-31', evaluatorSha256: sha(fs.readFileSync(SELF)), baselineCommit: BASELINE, baselineSourceSha256: sources.baselineSourceSha256, candidateSourceSha256: sources.candidateSourceSha256,
    cohort: { label: 'final-2-17-31', genres: GENRES, indices: [2, 17, 31], selectionProtocolSha256: FINAL_SELECTION_SHA256, inputFingerprintSha256: FINAL_INPUT_SHA256 },
    inputSources: { dataset: 'https://huggingface.co/datasets/sanchit-gandhi/gtzan/tree/4bd857132cb0e731bef3ec68558e7acc0a85f144', originalDataset: 'https://huggingface.co/datasets/marsyas/gtzan/tree/d2146561ecc7df707d9e6b8318885fe6a39668a2', annotations: 'https://github.com/CPJKU/beat_this_annotations/tree/fd9fcc0896cb78730bae735102c8753ef3a3badd/gtzan/annotations/beats', preparation: 'scripts/prepare-beat-benchmark.py; 22050Hz mono f32le; original reference JSON preserved' },
    noModels: true, noPerTrackParameters: true, sampleRate: 22050, referenceBoundary: BOUNDARY, onsetToleranceSeconds: .02, matcher: 'distinct nearest; 70ms and 50ms; no leading-time trim; predicted events are not clipped',
    bootstrap: { seed: 20261030, replicates: 10000, strata: 'genre', confidence: .95, unit: 'paired clip within genre', limitation: 'Descriptive uncertainty for this fixed, small systematic subset; not proof of song/artist/population independence or musical quality.' },
    gate: { ...PARENT_GATE },
    interpretation: 'Single-finger head F1 measures primary-beat selection compatibility only. Four-finger measured-onset head counts, V7 onset identities retained, source-path changes, density and validity are separate. Higher F1 is not a full musical-quality claim; never alter this gate after seeing final results.' };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function equivalent(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equivalent(value, b[index]));
  if (a && b && typeof a === 'object' && typeof b === 'object') { const keys = Object.keys(a).sort(); return same(keys, Object.keys(b).sort()) && keys.every(key => equivalent(a[key], b[key])); }
  return Object.is(a, b);
}
function assertProtocol(protocol, sources) {
  if (protocol.state !== 'frozen' || protocol.parentFinalFreeze !== true || !protocol.frozenAt) throw Error('Evaluation is sealed: the parent must freeze final source hashes and gate first');
  if (protocol.evaluatorSha256 !== sha(fs.readFileSync(SELF))) throw Error('Evaluator differs from the frozen protocol');
  if (protocol.baselineCommit !== BASELINE || !equivalent(protocol.baselineSourceSha256, sources.baselineSourceSha256) || !equivalent(protocol.candidateSourceSha256, sources.candidateSourceSha256)) throw Error('Algorithm source hashes differ from the frozen protocol');
  if (protocol.sampleRate !== 22050 || protocol.referenceBoundary !== BOUNDARY || protocol.onsetToleranceSeconds !== .02) throw Error('Reference/onset boundary policy differs from the predeclared evaluation');
  if (!same(protocol.cohort.genres, GENRES) || !same(protocol.cohort.indices, [2, 17, 31]) || !/^[a-z0-9-]{1,100}$/.test(protocol.runId)) throw Error('Final cohort/run identifier does not match the predeclared selection');
  if (protocol.cohort.selectionProtocolSha256 !== FINAL_SELECTION_SHA256 || protocol.cohort.inputFingerprintSha256 !== FINAL_INPUT_SHA256) throw Error('Frozen final data identity changed');
  if (protocol.noModels !== true || protocol.noPerTrackParameters !== true) throw Error('Only the frozen uniform signal-only comparison is supported');
  if (protocol.bootstrap.seed !== 20261030 || protocol.bootstrap.replicates !== 10000 || protocol.bootstrap.strata !== 'genre' || protocol.bootstrap.confidence !== .95) throw Error('Bootstrap differs from the frozen predeclared method');
  if (!equivalent(protocol.gate, PARENT_GATE)) throw Error('Gate differs from the predeclared parent-approved gate');
}

function snapshotBaseline(sources) {
  const base = path.join(ROOT, '.qa', 'benchmark-signal-baseline', BASELINE);
  for (const [file, bytes] of sources.before) {
    const target = path.join(base, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) { if (sha(fs.readFileSync(target)) !== sha(bytes)) throw Error(`Existing baseline snapshot changed: ${file}`); }
    else fs.writeFileSync(target, bytes);
  }
  return '/' + path.relative(ROOT, base).replaceAll('\\', '/');
}
function writeCSV(file, rows) {
  const columns = ['name', 'rawReferences', 'effectiveReferences', 'excludedReferences', 'beforeHead70', 'afterHead70', 'deltaHead70', 'deltaHead50', 'deltaHead50Precision', 'deltaHead50Recall', 'deltaPulseRecall70', 'deltaClock70', 'beforeFourActualHeads', 'afterFourActualHeads', 'fourActualHeadCountRatio', 'matchedV7FourHeadRatio', 'sourceChangedDurationRatio'];
  const entries = rows.map(row => [row.name, row.references.raw, row.references.effective, row.references.excluded, row.variants.before.modes.one.score70.f1, row.variants.after.modes.one.score70.f1, row.deltas.head70F1, row.deltas.head50F1, row.deltas.head50Precision, row.deltas.head50Recall, row.deltas.pulseRecall70, row.deltas.clock70F1, row.fourFinger.beforeActualHeads, row.fourFinger.afterActualHeads, row.fourFinger.actualHeadCountRatio, row.fourFinger.matchedV7ActualHeadRatio, row.sourcePath.changedDurationRatio]);
  fs.writeFileSync(file, [columns, ...entries].map(row => row.map(value => value === null ? '' : String(value)).join(',')).join('\n') + '\n');
}

export async function main(argv = process.argv.slice(2)) {
  const flags = new Map(); for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) throw Error('Use --input folder --output report.json --protocol frozen.json'); flags.set(argv[i], argv[i + 1]?.startsWith('--') || i + 1 === argv.length ? true : argv[++i]); }
  if (flags.has('--help')) { console.log('Prepare only: --prepare-protocol --output draft.json\nExecute once after parent freeze: --input folder --output report.json --protocol frozen.json'); return; }
  if (flags.has('--prepare-protocol')) { if (typeof flags.get('--output') !== 'string') throw Error('Protocol preparation needs --output'); const protocol = draftProtocol(); fs.writeFileSync(flags.get('--output'), JSON.stringify(protocol, null, 2) + '\n'); console.log(JSON.stringify({ status: 'draft_protocol_only_no_input_read_or_algorithm_run', baselineCommit: BASELINE, baselineModules: Object.keys(protocol.baselineSourceSha256).length, candidateModules: Object.keys(protocol.candidateSourceSha256).length })); return; }
  for (const flag of ['--input', '--output', '--protocol']) if (typeof flags.get(flag) !== 'string') throw Error(`Missing ${flag}; evaluation remains sealed`);
  const protocolBytes = fs.readFileSync(flags.get('--protocol')), protocol = JSON.parse(protocolBytes), sources = frozenSources(); assertProtocol(protocol, sources);
  const input = path.resolve(flags.get('--input')), output = path.resolve(flags.get('--output'));
  if (fs.existsSync(output)) throw Error('Refuse to overwrite an existing evaluation report');
  const names = fs.readdirSync(input).filter(file => file.endsWith('.reference.json')).map(file => file.slice(0, -15)).sort();
  const expectedNames = GENRES.flatMap(genre => [2, 17, 31].map(index => `${genre}.${String(index).padStart(5, '0')}`)).sort();
  if (!same(names, expectedNames)) throw Error('Input does not match the fixed final 2/17/31 selection');
  const inputs = names.map(name => { const audio = fs.readFileSync(path.join(input, name + '.audio.f32')), referenceBytes = fs.readFileSync(path.join(input, name + '.reference.json')); if (audio.length % 4) throw Error(`${name}: invalid float32 PCM length`); return { name, audio, referenceBytes, audioSha256: sha(audio), referenceSha256: sha(referenceBytes) }; });
  const fingerprint = sha(Buffer.from(inputs.map(item => `${item.name}.wav\0${item.audioSha256}\0${item.referenceSha256}\n`).join('')));
  if (fingerprint !== protocol.cohort.inputFingerprintSha256) throw Error('Final input fingerprint differs from the frozen data');
  const lockDir = path.join(ROOT, '.qa', 'benchmark-signal-runs'); fs.mkdirSync(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, protocol.runId + '.json');
  const descriptor = fs.openSync(lockFile, 'wx'); const lock = { state: 'started_final_evaluation', started: new Date().toISOString(), protocolSha256: sha(protocolBytes), inputFingerprintSha256: fingerprint, runId: protocol.runId };
  fs.writeFileSync(descriptor, JSON.stringify(lock, null, 2)); fs.closeSync(descriptor);
  let server;
  try {
    const baselineRoot = snapshotBaseline(sources), { createServer } = await import('vite'); server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
    const load = async prefix => ({ analyze: (await server.ssrLoadModule(`${prefix}/src/core/analysis.ts`)).analyzeAudio, basic: (await server.ssrLoadModule(`${prefix}/src/core/analysis-fallback.ts`)).basicAnalysis, ...(await server.ssrLoadModule(`${prefix}/src/core/chart.ts`)), ...(await server.ssrLoadModule(`${prefix}/src/core/chart-constraints.ts`)), ...(await server.ssrLoadModule(`${prefix}/src/core/fingering.ts`)) });
    const modules = { before: await load(baselineRoot), after: await load('') }, rows = [];
    for (const item of inputs) {
      const frames = item.audio.length / 4, samples = Float32Array.from({ length: frames }, (_, i) => item.audio.readFloatLE(i * 4)), duration = frames / protocol.sampleRate;
      const { valid: reference, counts: references } = effectiveReferences(JSON.parse(item.referenceBytes), frames, protocol.sampleRate);
      const row = { name: item.name, audioSha256: item.audioSha256, rawReferenceSha256: item.referenceSha256, pcmFrames: frames, duration, references, variants: {} }, analyses = {}, four = {};
      for (const variant of ['before', 'after']) {
        const api = modules[variant], analysis = api.basic(api.analyze(samples, protocol.sampleRate)); analyses[variant] = analysis;
        if (analysis.recognition?.engine !== 'signal') throw Error(`${item.name}/${variant}: expected signal-only analysis`);
        const data = { bpm: analysis.bpm, clockConfidence: analysis.rhythm?.confidence ?? 0, clock70: measure(reference, analysis.rhythm?.beats || []), pulse70: measure(reference, (analysis.pulse?.onsets || []).map(event => event.time)), pulseEvents: analysis.pulse?.onsets.length || 0, roleCounts: Object.fromEntries(['beat', 'half', 'quarter', 'free', 'unclassified'].map(role => [role, (analysis.pulse?.onsets || []).filter(event => (event.role || 'unclassified') === role).length])), modes: {} };
        for (const mode of ['one', 'two', 'three', 'four']) {
          const chart = api.generateChart(analysis, mode), repeated = api.generateChart(analysis, mode), limit = api.DIFFICULTIES[mode].max;
          const valid = api.isPlayableChart(chart.notes, limit, duration) && api.validateFingering(chart.notes, limit, duration) && api.peakFingers(chart.notes) <= limit;
          const deterministic = same(chart, repeated), heads = uniqueHeads(chart.notes);
          data.modes[mode] = { notes: chart.notes.length, uniqueHeads: heads.length, valid, deterministic, routeChecked: chart.fingering?.checked ?? false, omitted: chart.fingering?.omitted ?? null, peakFingers: api.peakFingers(chart.notes), chartSha256: sha(JSON.stringify(chart)) };
          if (mode === 'one') { data.modes.one.score70 = measure(reference, heads); data.modes.one.score50 = measure(reference, heads, .05); }
          if (mode === 'four') { four[variant] = measuredOnsetHeads(chart.notes, analysis.candidates ?? analysis.onsets, protocol.onsetToleranceSeconds); data.modes.four.measuredOnsets = four[variant].counts; }
        }
        row.variants[variant] = data;
      }
      const b = row.variants.before, a = row.variants.after;
      row.deltas = { head70F1: a.modes.one.score70.f1 - b.modes.one.score70.f1, head50F1: a.modes.one.score50.f1 - b.modes.one.score50.f1, head70Precision: a.modes.one.score70.precision - b.modes.one.score70.precision, head70Recall: a.modes.one.score70.recall - b.modes.one.score70.recall, head50Precision: a.modes.one.score50.precision - b.modes.one.score50.precision, head50Recall: a.modes.one.score50.recall - b.modes.one.score50.recall, pulseRecall70: a.pulse70.recall - b.pulse70.recall, clock70F1: a.clock70.f1 - b.clock70.f1 };
      const matched = measure(four.before.actual, four.after.actual, protocol.onsetToleranceSeconds);
      row.fourFinger = { beforeActualHeads: four.before.actual.length, afterActualHeads: four.after.actual.length, actualHeadCountRatio: four.before.actual.length ? four.after.actual.length / four.before.actual.length : null, matchedV7ActualHeads: matched.hits, matchedV7ActualHeadRatio: four.before.actual.length ? matched.hits / four.before.actual.length : null, originalV7IdentityRetentionIsNotAQualityGate: true };
      row.sourcePath = sourcePathComparison(analyses.before.pulse?.sections || [], analyses.after.pulse?.sections || [], duration); rows.push(row);
      console.log(JSON.stringify({ clip: row.name, complete: rows.length, paired: true }));
    }
    const current = frozenSources(); if (!same(sources.candidateSourceSha256, current.candidateSourceSha256)) throw Error('Candidate source changed during evaluation; no complete result is valid');
    const confidence = pairedBootstrap(rows, Object.keys(rows[0].deltas), protocol.bootstrap), gate = evaluateGate(rows, confidence, protocol.gate);
    const aggregate = Object.fromEntries(['before', 'after'].map(variant => [variant, { head70F1: mean(rows.map(row => row.variants[variant].modes.one.score70.f1)), head50F1: mean(rows.map(row => row.variants[variant].modes.one.score50.f1)), head50Precision: mean(rows.map(row => row.variants[variant].modes.one.score50.precision)), head50Recall: mean(rows.map(row => row.variants[variant].modes.one.score50.recall)), pulseRecall70: mean(rows.map(row => row.variants[variant].pulse70.recall)), clock70F1: mean(rows.map(row => row.variants[variant].clock70.f1)), fourFingerMeanUniqueActualHeads: mean(rows.map(row => row.fourFinger[variant === 'before' ? 'beforeActualHeads' : 'afterActualHeads'])) }]));
    const result = { schema: 1, date: new Date().toISOString(), protocolSha256: sha(protocolBytes), protocol, inputFingerprintSha256: fingerprint, tracks: rows.length, referenceTotals: Object.fromEntries(['raw', 'effective', 'excluded'].map(key => [key, rows.reduce((sum, row) => sum + row.references[key], 0)])), aggregate, confidence, gate, improved: rows.filter(row => row.deltas.head70F1 > EPSILON).map(row => row.name), regressed: rows.filter(row => row.deltas.head70F1 < -EPSILON).map(row => row.name), sourcePathChangedClips: rows.filter(row => row.sourcePath.changed).map(row => row.name), rows };
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); writeCSV(output.replace(/\.json$/i, '') + '.paired.csv', rows);
    lock.state = 'completed_observed_do_not_rerun_or_describe_as_unseen'; lock.reportSha256 = sha(fs.readFileSync(output)); lock.gatePassed = gate.passed; fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
    console.log(JSON.stringify({ status: 'completed_once', tracks: rows.length, gatePassed: gate.passed, checks: gate.checks, referenceTotals: result.referenceTotals }));
  } catch (error) { lock.state = 'aborted_some_inputs_may_be_observed_do_not_auto_rerun'; lock.error = error.message; fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2)); throw error; }
  finally { await server?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
