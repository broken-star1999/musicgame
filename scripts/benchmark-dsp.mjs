/**
 * Signal-only paired evaluator. Old benchmark-signal.mjs remains historical.
 * prepare: metadata/source hashes only; freeze: verifies draft without analysis;
 * run: records the entire cohort consumed in the persistent ledger BEFORE any
 * algorithm module is loaded. Failure never restores final eligibility.
 * See --help. No downloads; reports never include audio, references or charts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { effectiveReferences, measure, uniqueHeads, measuredOnsetHeads, sourcePathComparison, pairedBootstrap } from './benchmark-signal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
export const GENRES = ['blues', 'classical', 'country', 'disco', 'hiphop', 'jazz', 'metal', 'pop', 'reggae', 'rock'];
const SUPPORT = ['src/core/analysis-fallback.ts', 'src/core/chart.ts', 'src/core/chart-constraints.ts', 'src/core/fingering.ts'];
const BOUNDARY = 'finite numeric references: 0 <= time <= PCM.frames/22050 inclusive; raw preserved; predictions not clipped';
const BOOTSTRAP = { seed: 20261030, replicates: 10000, strata: 'genre', confidence: .95, unit: 'paired clip', method: 'paired within-genre percentile bootstrap; conditional on fixed ten genres' };
const METRIC_PROFILE = { id: 'dsp-paired-v2', matching: 'distinct nearest in ascending reference order; each prediction used at most once; predictions are not clipped', tolerancesSeconds: [.05, .07], averaging: 'macro across all30 paired clips; optional minimum per-genre mean delta over all ten complete genres', epsilon: 1e-9, fourFinger: 'exact-time deduplicated heads within own measured candidates +/-20ms; baseline identity retention is diagnostic only; zero baseline count requires valid nonempty after chart when count gate enabled', uncertainty: 'Conditional fixed-systematic-subset description, not proof of song/artist/population independence.' };
const MODES = ['one', 'two', 'three', 'four'];
export const METRICS = ['head', 'clock', 'pulse'].flatMap(stage => [50, 70].flatMap(ms => ['F1', 'Precision', 'Recall'].map(stat => stage + ms + stat)));
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = message => { throw Error(message); };
const relative = value => {
  if (typeof value !== 'string' || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(x => x === '..' || x === '') || !value.endsWith('.ts')) fail('Expected repository-relative TypeScript source path');
  return value;
};
const hashMap = files => Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, sha(bytes)]));
function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function exclusiveJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function git(...args) { return execFileSync('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }); }
export function validateCommit(value) {
  if (!/^[a-f0-9]{40}$/.test(value || '')) fail('baselineCommit must be a full lowercase 40-hex immutable commit');
  if (git('rev-parse', value + '^{commit}').toString().trim() !== value) fail('baselineCommit must identify a commit directly');
}
function sourceClosure(read, entry) {
  const found = new Map();
  function visit(name) {
    relative(name); if (found.has(name)) return;
    const bytes = read(name); found.set(name, bytes);
    const imports = [...bytes.toString().matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]/g)];
    for (const match of imports) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1] || match[2] || match[3]));
      const candidates = path.posix.extname(base) ? [base] : [base + '.ts', base + '/index.ts'];
      let next;
      for (const candidate of candidates) { try { read(candidate); next = candidate; break; } catch {} }
      if (!next) fail('Unresolved frozen relative dependency: ' + name);
      visit(next);
    }
  }
  [entry, ...SUPPORT].forEach(visit); return found;
}
function sources(protocol) {
  validateCommit(protocol.baselineCommit);
  const before = sourceClosure(file => git('show', protocol.baselineCommit + ':' + file), relative(protocol.baselineEntry));
  const after = sourceClosure(file => fs.readFileSync(path.join(ROOT, file)), relative(protocol.candidateEntry));
  return { before, after, hashes: { before: hashMap(before), after: hashMap(after) } };
}
function environment() {
  return { evaluator: { 'scripts/benchmark-dsp.mjs': sha(fs.readFileSync(SELF)), 'scripts/benchmark-signal.mjs': sha(fs.readFileSync(path.join(ROOT, 'scripts/benchmark-signal.mjs'))) }, packageLockSha256: sha(fs.readFileSync(path.join(ROOT, 'package-lock.json'))), node: process.version };
}
export function validateSelection(indices) {
  if (!Array.isArray(indices) || indices.length !== 3 || new Set(indices).size !== 3 || indices.some(i => !Number.isInteger(i) || i < 0 || i > 99)) fail('Exactly three distinct integer GTZAN indices 0..99 required');
  return [...indices].sort((a, b) => a - b);
}
const namesFor = indices => GENRES.flatMap(genre => indices.map(index => genre + '.' + String(index).padStart(5, '0'))).sort();
export function inspectInput(folder, indices) {
  const expected = namesFor(validateSelection(indices));
  const actual = fs.readdirSync(folder).filter(file => file.endsWith('.reference.json')).map(file => file.slice(0, -15)).sort();
  if (!equal(actual, expected)) fail('Input must contain the exact ten-genres by three-indices selection');
  const pcmNames = fs.readdirSync(folder).filter(file => file.endsWith('.audio.f32')).map(file => file.slice(0, -10)).sort();
  if (!equal(pcmNames, expected)) fail('Missing or extra canonical PCM files');
  const clips = expected.map(name => {
    const pcm = fs.readFileSync(path.join(folder, name + '.audio.f32')), raw = fs.readFileSync(path.join(folder, name + '.reference.json'));
    if (!pcm.length || pcm.length % 4) fail(name + ': invalid f32le PCM length');
    for (let i = 0; i < pcm.length; i += 4) if (!Number.isFinite(pcm.readFloatLE(i))) fail(name + ': non-finite PCM sample');
    const refs = JSON.parse(raw); if (!Array.isArray(refs)) fail(name + ': reference JSON must be an array');
    const frames = pcm.length / 4, checked = effectiveReferences(refs, frames, 22050);
    return { clipId: name + '.wav', pcmSha256: sha(pcm), rawReferenceSha256: sha(raw), frames, references: checked.counts };
  });
  if (new Set(clips.map(x => x.pcmSha256)).size !== 30) fail('Duplicate canonical PCM inside the cohort');
  const fingerprint = sha(clips.map(x => x.clipId + '\0' + x.pcmSha256 + '\0' + x.rawReferenceSha256 + '\n').join(''));
  return { clips, fingerprint };
}
export function validateGate(gate, mode) {
  if (!gate || Object.keys(gate).some(key => !['constraints', 'fourFingerMinCountRatio'].includes(key)) || !Array.isArray(gate.constraints)) fail('Gate must contain constraints and optional fourFingerMinCountRatio only');
  if (mode === 'final' && gate.constraints.length === 0) fail('Final requires an explicitly predeclared nonempty gate');
  for (const item of gate.constraints) {
    if (!item || Object.keys(item).sort().join(',') !== 'metric,operator,target,value' || !METRICS.includes(item.metric) || !['macroDelta', 'ciLow95', 'perClipDeltaMin', 'perGenreDeltaMin', 'afterMin'].includes(item.target) || !['>=', '>', '<=', '<'].includes(item.operator) || !Number.isFinite(item.value)) fail('Invalid registered metric gate constraint');
  }
  if (gate.fourFingerMinCountRatio !== undefined && (!Number.isFinite(gate.fourFingerMinCountRatio) || gate.fourFingerMinCountRatio < 0)) fail('Invalid four-finger count ratio');
}
export function validateRegistry(registry) {
  if (registry.schema !== 1 || registry.dataset !== 'gtzan' || registry.canonicalPCM !== 'mono f32le 22050Hz' || !Array.isArray(registry.clips) || !Array.isArray(registry.runs)) fail('Invalid persistent observed registry');
  const ids = new Set();
  for (const item of registry.clips) {
    if (!/^(blues|classical|country|disco|hiphop|jazz|metal|pop|reggae|rock)\.\d{5}\.wav$/.test(item.clipId) || ids.has(item.clipId) || !/^[a-f0-9]{64}$/.test(item.pcmSha256) || !/^[a-f0-9]{64}$/.test(item.rawReferenceSha256) || item.state !== 'observed') fail('Invalid or duplicate observed clip record');
    ids.add(item.clipId);
  }
}
export function assertNovel(registry, clips) {
  validateRegistry(registry);
  const ids = new Set(registry.clips.map(x => x.clipId)), pcm = new Set(registry.clips.map(x => x.pcmSha256));
  if (clips.some(x => ids.has(x.clipId) || pcm.has(x.pcmSha256))) fail('Final rejected: selected clip ID or canonical PCM has already been observed');
}
// Freeze records do not change observation state. The byte hash of the actual
// frozen protocol is separately registered, preventing post-freeze gate edits.
export const registryFingerprint = registry => sha(JSON.stringify({ schema: registry.schema, dataset: registry.dataset, canonicalPCM: registry.canonicalPCM, clips: registry.clips, runs: registry.runs }));
function ledgerLockPath(registryFile) {
  return path.join(ROOT, '.qa', 'dsp-ledger-locks', sha(fs.realpathSync(registryFile).toLowerCase()) + '.json');
}
function ledgerTransaction(registryFile, callback) {
  const lock = ledgerLockPath(registryFile);
  exclusiveJSON(lock, { pid: process.pid, created: new Date().toISOString(), purpose: 'ledger transaction only; never grants freshness' });
  try { const registry = json(registryFile); validateRegistry(registry); const result = callback(registry); atomicJSON(registryFile, registry); return result; }
  finally { fs.unlinkSync(lock); }
}
export function consumeCohort(registryFile, protocol, protocolSha256) {
  return ledgerTransaction(registryFile, registry => {
    if (!(registry.freezes || []).some(x => x.protocolSha256 === protocolSha256)) fail('Protocol was not registered by freeze, or its bytes changed after freezing');
    if (protocol.mode === 'final' && registryFingerprint(registry) !== protocol.registrySha256) fail('Observed ledger changed since freeze; prepare/freeze again without analysis');
    if (protocol.mode === 'final') assertNovel(registry, protocol.cohort.clips);
    const run = { runId: crypto.randomUUID(), mode: protocol.mode, state: 'consumed_before_algorithm_load', cohortId: protocol.cohort.id, inputFingerprintSha256: protocol.cohort.fingerprint, protocolSha256, baselineCommit: protocol.baselineCommit, candidateSourceSha256: sha(JSON.stringify(protocol.sourceHashes.after)), started: new Date().toISOString(), clipIds: protocol.cohort.clips.map(x => x.clipId) };
    for (const clip of protocol.cohort.clips) {
      const old = registry.clips.find(x => x.clipId === clip.clipId);
      if (old && (old.pcmSha256 !== clip.pcmSha256 || old.rawReferenceSha256 !== clip.rawReferenceSha256)) fail('Known clip identity has different PCM/reference bytes');
      if (!old) registry.clips.push({ clipId: clip.clipId, pcmSha256: clip.pcmSha256, rawReferenceSha256: clip.rawReferenceSha256, state: 'observed', cohortId: protocol.cohort.id, firstObservedRunId: run.runId });
    }
    registry.runs.push(run); return run;
  });
}
export function finishRun(registryFile, runId, state, reportSha256) {
  ledgerTransaction(registryFile, registry => {
    const run = registry.runs.find(x => x.runId === runId);
    if (!run || run.state !== 'consumed_before_algorithm_load' || !['completed_observed', 'failed_observed'].includes(state)) fail('Invalid monotonic ledger transition');
    run.state = state; run.finished = new Date().toISOString();
    if (reportSha256) run.reportSha256 = reportSha256;
    if (state === 'failed_observed') run.failure = { code: 'EVALUATION_ABORTED', summary: 'Evaluation did not complete. The entire selected cohort remains observed.' };
  });
}
export async function withConsumedRun(registryFile, protocol, protocolSha256, operation) {
  const run = consumeCohort(registryFile, protocol, protocolSha256);
  try {
    const result = await operation(run);
    finishRun(registryFile, run.runId, 'completed_observed', result?.reportSha256);
    return result;
  } catch (error) {
    try { finishRun(registryFile, run.runId, 'failed_observed'); } catch { console.error('Unable to finalize status; initial consumed ledger still prohibits freshness.'); }
    throw error;
  }
}
function assertProtocol(protocol, frozen) {
  if (protocol.schema !== 1 || !['diagnostic', 'final'].includes(protocol.mode) || protocol.noModels !== true || protocol.noPerClipParameters !== true || protocol.sampleRate !== 22050 || protocol.referenceBoundary !== BOUNDARY || !equal(protocol.bootstrap, BOOTSTRAP) || !equal(protocol.metricProfile, METRIC_PROFILE) || protocol.onsetToleranceSeconds !== .02) fail('Unsupported or changed DSP evaluation policy');
  if (protocol.state !== (frozen ? 'frozen' : 'draft') || (frozen && !protocol.frozenAt)) fail('Protocol must pass prepare then freeze before running');
  if (!/^[a-z0-9-]{1,100}$/.test(protocol.cohort?.id || '')) fail('Invalid cohort ID');
  validateSelection(protocol.cohort.indices); validateGate(protocol.gate, protocol.mode);
  if (!equal(protocol.environment, environment())) fail('Evaluator/package-lock/Node differs from protocol');
  const current = sources(protocol);
  if (!equal(protocol.sourceHashes, current.hashes)) fail('Baseline or candidate source closure differs from protocol');
  return current;
}
function checkInput(protocol, folder) {
  const data = inspectInput(folder, protocol.cohort.indices);
  if (!equal(protocol.cohort.clips, data.clips) || protocol.cohort.fingerprint !== data.fingerprint) fail('Input identity/reference QA differs from protocol');
  return data;
}
function snapshot(files) {
  const dir = path.join(ROOT, '.qa', 'benchmark-dsp-snapshots', sha(JSON.stringify(hashMap(files))));
  for (const [name, bytes] of files) {
    const target = path.join(dir, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) { if (sha(fs.readFileSync(target)) !== sha(bytes)) fail('Frozen source snapshot changed'); }
    else fs.writeFileSync(target, bytes);
  }
  return '/' + path.relative(ROOT, dir).replaceAll('\\', '/');
}
export function metricValues(data) {
  const result = {};
  for (const stage of ['head', 'clock', 'pulse']) for (const ms of [50, 70]) {
    const score = data[stage + ms];
    for (const [key, field] of [['F1', 'f1'], ['Precision', 'precision'], ['Recall', 'recall']]) result[stage + ms + key] = score[field];
  }
  return result;
}
export function gateResult(rows, confidence, gate) {
  const compare = (a, op, b) => op === '>=' ? a + 1e-9 >= b : op === '>' ? a > b : op === '<=' ? a - 1e-9 <= b : a < b;
  const genreMinimum = metric => {
    const groups = GENRES.map(genre => rows.filter(row => row.name.split('.')[0] === genre));
    if (rows.length !== 30 || groups.some(group => group.length !== 3)) return NaN;
    return Math.min(...groups.map(group => mean(group.map(row => row.deltas[metric]))));
  };
  const constraints = gate.constraints.map(item => {
    const actual = item.target === 'macroDelta' ? mean(rows.map(r => r.deltas[item.metric])) : item.target === 'ciLow95' ? confidence[item.metric].low95 : item.target === 'perClipDeltaMin' ? Math.min(...rows.map(r => r.deltas[item.metric])) : item.target === 'perGenreDeltaMin' ? genreMinimum(item.metric) : Math.min(...rows.map(r => r.variants.after.metrics[item.metric]));
    return { ...item, actual, passed: Number.isFinite(actual) && compare(actual, item.operator, item.value) };
  });
  const allModesValid = rows.every(r => ['before', 'after'].every(v => MODES.every(m => r.variants[v].modes[m].valid)));
  const allModesDeterministic = rows.every(r => ['before', 'after'].every(v => MODES.every(m => r.variants[v].modes[m].deterministic)));
  const retention = gate.fourFingerMinCountRatio === undefined || rows.every(r => r.fourFinger.beforeActualHeads ? r.fourFinger.actualHeadCountRatio + 1e-9 >= gate.fourFingerMinCountRatio : r.variants.after.modes.four.valid && r.variants.after.modes.four.notes > 0);
  return { passed: allModesValid && allModesDeterministic && retention && constraints.every(x => x.passed), constraints, allModesValid, allModesDeterministic, fourFingerCount: retention, identityRetentionIsDiagnosticOnly: true };
}
async function evaluate(protocol, folder, frozenSources) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
  try {
    const load = async (prefix, entry) => ({ analyze: (await server.ssrLoadModule(prefix + '/' + entry)).analyzeAudio, basic: (await server.ssrLoadModule(prefix + '/src/core/analysis-fallback.ts')).basicAnalysis, ...await server.ssrLoadModule(prefix + '/src/core/chart.ts'), ...await server.ssrLoadModule(prefix + '/src/core/chart-constraints.ts'), ...await server.ssrLoadModule(prefix + '/src/core/fingering.ts') });
    const modules = { before: await load(snapshot(frozenSources.before), protocol.baselineEntry), after: await load(snapshot(frozenSources.after), protocol.candidateEntry) }, rows = [];
    for (const clip of protocol.cohort.clips) {
      const name = clip.clipId.slice(0, -4), pcm = fs.readFileSync(path.join(folder, name + '.audio.f32')), raw = fs.readFileSync(path.join(folder, name + '.reference.json'));
      if (sha(pcm) !== clip.pcmSha256 || sha(raw) !== clip.rawReferenceSha256) fail('Input changed after preflight');
      const samples = Float32Array.from({ length: clip.frames }, (_, i) => pcm.readFloatLE(i * 4)), duration = clip.frames / 22050;
      const { valid: reference, counts: references } = effectiveReferences(JSON.parse(raw), clip.frames, 22050);
      const row = { name, pcmSha256: clip.pcmSha256, rawReferenceSha256: clip.rawReferenceSha256, duration, references, variants: {} }, analyses = {}, four = {};
      for (const variant of ['before', 'after']) {
        const api = modules[variant], analysis = api.basic(api.analyze(samples.slice(), 22050)); analyses[variant] = analysis;
        if (analysis.recognition?.engine !== 'signal') fail(name + ': expected signal-only analysis');
        const data = { bpm: analysis.bpm, clockConfidence: analysis.rhythm?.confidence ?? 0, modes: {}, roleCounts: Object.fromEntries(['beat', 'half', 'quarter', 'free', 'unclassified'].map(role => [role, (analysis.pulse?.onsets || []).filter(x => (x.role || 'unclassified') === role).length])) };
        for (const ms of [50, 70]) {
          data['clock' + ms] = measure(reference, analysis.rhythm?.beats || [], ms / 1000);
          data['pulse' + ms] = measure(reference, (analysis.pulse?.onsets || []).map(x => x.time), ms / 1000);
        }
        for (const mode of MODES) {
          const chart = api.generateChart(analysis, mode), repeated = api.generateChart(analysis, mode), limit = api.DIFFICULTIES[mode].max, heads = uniqueHeads(chart.notes);
          const valid = chart.notes.length > 0 && api.isPlayableChart(chart.notes, limit, duration) && api.validateFingering(chart.notes, limit, duration) && api.peakFingers(chart.notes) <= limit && chart.fingering?.checked === true;
          data.modes[mode] = { notes: chart.notes.length, uniqueHeads: heads.length, valid, deterministic: equal(chart, repeated), routeChecked: chart.fingering?.checked ?? false, chartSha256: sha(JSON.stringify(chart)), peakFingers: api.peakFingers(chart.notes) };
          if (mode === 'one') for (const ms of [50, 70]) data['head' + ms] = measure(reference, heads, ms / 1000);
          if (mode === 'four') { four[variant] = measuredOnsetHeads(chart.notes, analysis.candidates ?? analysis.onsets, .02); data.modes.four.measuredOnsets = four[variant].counts; }
        }
        data.metrics = metricValues(data); row.variants[variant] = data;
      }
      row.deltas = Object.fromEntries(METRICS.map(key => [key, row.variants.after.metrics[key] - row.variants.before.metrics[key]]));
      const matched = measure(four.before.actual, four.after.actual, .02);
      row.fourFinger = { beforeActualHeads: four.before.actual.length, afterActualHeads: four.after.actual.length, actualHeadCountRatio: four.before.actual.length ? four.after.actual.length / four.before.actual.length : null, matchedBaselineActualHeads: matched.hits, matchedBaselineActualHeadRatio: four.before.actual.length ? matched.hits / four.before.actual.length : null };
      row.sourcePath = sourcePathComparison(analyses.before.pulse?.sections || [], analyses.after.pulse?.sections || [], duration);
      rows.push(row); console.log(JSON.stringify({ clip: name, complete: rows.length, mode: protocol.mode }));
    }
    return rows;
  } finally { await server.close(); }
}
function parseArgs(argv) {
  const command = argv.shift(), flags = {};
  const allowed = ['mode', 'input', 'output', 'protocol', 'registry', 'baseline-commit', 'baseline-entry', 'candidate-entry', 'indices', 'cohort-id', 'selection-protocol', 'gate', 'lock-token'];
  while (argv.length) { const key = argv.shift(); if (!key.startsWith('--') || !allowed.includes(key.slice(2)) || flags[key.slice(2)] !== undefined || !argv.length || argv[0].startsWith('--')) fail('Unknown/duplicate/missing CLI option'); flags[key.slice(2)] = argv.shift(); }
  return { command, flags };
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help') {
    console.log('prepare --mode diagnostic|final --baseline-commit <40hex> --indices 0,7,19 --cohort-id <id> --selection-protocol <file> --input <folder> --output <draft.json> [--gate <json>] [--candidate-entry src/core/analysis.ts] [--registry benchmarks/dsp-cohorts.json]\nfreeze --protocol <draft.json> --input <folder> --output <frozen.json> [--registry ...]\nrun --protocol <frozen.json> --input <folder> --output <report.json> [--registry ...]\nrecover-lock --registry <ledger> --lock-token <exact stale lock SHA256>; only a dead process lock can be removed, never observation history.\nNo analysis in prepare/freeze. GTZAN clips already registered in the persistent history are observed. Final requires zero ID/PCM overlap; diagnostic may repeat observed clips. Install frozen package-lock dependencies with npm ci for reproduction.'); return;
  }
  const { command, flags: f } = parseArgs([...argv]), registryFile = path.resolve(f.registry || path.join(ROOT, 'benchmarks/dsp-cohorts.json'));
  if (!['prepare', 'freeze', 'run', 'recover-lock'].includes(command)) fail('Expected prepare, freeze, run or recover-lock');
  const allowedByCommand = command === 'prepare' ? ['mode', 'input', 'output', 'registry', 'baseline-commit', 'baseline-entry', 'candidate-entry', 'indices', 'cohort-id', 'selection-protocol', 'gate'] : command === 'recover-lock' ? ['registry', 'lock-token'] : ['input', 'output', 'protocol', 'registry'];
  if (Object.keys(f).some(key => !allowedByCommand.includes(key))) fail('CLI option does not apply to this command');
  if (command === 'recover-lock') {
    const lock = ledgerLockPath(registryFile), bytes = fs.readFileSync(lock), value = JSON.parse(bytes);
    if (sha(bytes) !== f['lock-token']) fail('Stale lock token mismatch');
    try { process.kill(value.pid, 0); fail('Lock process is alive; cannot recover'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(lock); console.log('Removed dead ledger transaction lock; observed registry is unchanged'); return;
  }
  for (const key of ['input', 'output']) if (!f[key]) fail('Missing --' + key);
  const input = path.resolve(f.input), output = path.resolve(f.output);
  if (fs.existsSync(output) || (command === 'run' && fs.existsSync(output + '.paired.csv'))) fail('Refuse to overwrite existing output');
  validateRegistry(json(registryFile));
  if (command === 'prepare') {
    if (!['diagnostic', 'final'].includes(f.mode) || !f['cohort-id'] || !f['selection-protocol']) fail('Prepare requires mode, cohort-id and predeclared selection-protocol');
    const indices = validateSelection((f.indices || '').split(',').map(Number)), data = inspectInput(input, indices);
    const protocol = { schema: 1, state: 'draft', mode: f.mode, baselineCommit: f['baseline-commit'], baselineEntry: f['baseline-entry'] || 'src/core/analysis.ts', candidateEntry: f['candidate-entry'] || 'src/core/analysis.ts', noModels: true, noPerClipParameters: true, sampleRate: 22050, referenceBoundary: BOUNDARY, onsetToleranceSeconds: .02, metricProfile: METRIC_PROFILE, bootstrap: BOOTSTRAP, environment: environment(), registrySha256: registryFingerprint(json(registryFile)), cohort: { id: f['cohort-id'], indices, selectionProtocolSha256: sha(fs.readFileSync(f['selection-protocol'])), ...data }, gate: f.gate ? json(f.gate) : { constraints: [] }, interpretation: 'Beat-reference compatibility is not all-event musical accuracy. Conditional small-cohort CIs do not prove song/artist independence. Four-finger count, identities and source paths reported separately.' };
    protocol.sourceHashes = sources(protocol).hashes; assertProtocol(protocol, false);
    if (protocol.mode === 'final') assertNovel(json(registryFile), data.clips);
    exclusiveJSON(output, protocol); console.log(JSON.stringify({ state: 'draft', algorithmCalls: 0 })); return;
  }
  if (!f.protocol) fail('Missing --protocol');
  const protocolBytes = fs.readFileSync(f.protocol), protocol = JSON.parse(protocolBytes), current = assertProtocol(protocol, command === 'run');
  checkInput(protocol, input);
  if (protocol.mode === 'final' && registryFingerprint(json(registryFile)) !== protocol.registrySha256) fail('Registry changed since preparation/freeze');
  if (protocol.mode === 'final') assertNovel(json(registryFile), protocol.cohort.clips);
  if (command === 'freeze') {
    const frozen = { ...protocol, state: 'frozen', frozenAt: new Date().toISOString() }, frozenBytes = JSON.stringify(frozen, null, 2) + '\n';
    ledgerTransaction(registryFile, registry => {
      if (protocol.mode === 'final') { if (registryFingerprint(registry) !== protocol.registrySha256) fail('Registry changed during freeze'); assertNovel(registry, protocol.cohort.clips); }
      registry.freezes ||= [];
      registry.freezes.push({ protocolSha256: sha(frozenBytes), mode: frozen.mode, cohortId: frozen.cohort.id, inputFingerprintSha256: frozen.cohort.fingerprint, gateSha256: sha(JSON.stringify(frozen.gate)), frozenAt: frozen.frozenAt });
    });
    exclusiveJSON(output, frozen); console.log(JSON.stringify({ state: 'frozen', algorithmCalls: 0 })); return;
  }
  const completed = await withConsumedRun(registryFile, protocol, sha(protocolBytes), async run => {
    const rows = await evaluate(protocol, input, current);
    assertProtocol(protocol, true); checkInput(protocol, input);
    const confidence = pairedBootstrap(rows, METRICS, protocol.bootstrap), gate = gateResult(rows, confidence, protocol.gate);
    const report = { schema: 1, mode: protocol.mode, interpretation: protocol.mode === 'final' ? 'One frozen final execution; this entire cohort is now observed regardless of gate outcome.' : 'Observed diagnostic only; repeatable, never a new unseen confirmation.', protocolSha256: sha(protocolBytes), protocol, runId: run.runId, tracks: rows.length, referenceTotals: Object.fromEntries(['raw', 'effective', 'excluded'].map(key => [key, rows.reduce((sum, r) => sum + r.references[key], 0)])), aggregate: Object.fromEntries(['before', 'after'].map(v => [v, Object.fromEntries(METRICS.map(key => [key, mean(rows.map(r => r.variants[v].metrics[key]))]))])), confidence, gate, regressions: Object.fromEntries(METRICS.map(key => [key, rows.filter(r => r.deltas[key] < -1e-9).map(r => r.name)])), rows };
    exclusiveJSON(output, report);
    const columns = ['name', ...METRICS.map(key => 'delta_' + key), 'beforeFourActualHeads', 'afterFourActualHeads', 'fourCountRatio', 'matchedBaselineIdentityRatio', 'sourceChangedDurationRatio'];
    const csv = [columns, ...rows.map(r => [r.name, ...METRICS.map(key => r.deltas[key]), r.fourFinger.beforeActualHeads, r.fourFinger.afterActualHeads, r.fourFinger.actualHeadCountRatio ?? '', r.fourFinger.matchedBaselineActualHeadRatio ?? '', r.sourcePath.changedDurationRatio])].map(row => row.join(',')).join('\n') + '\n';
    fs.writeFileSync(output + '.paired.csv', csv, { flag: 'wx' });
    return { reportSha256: sha(fs.readFileSync(output)), summary: { mode: protocol.mode, tracks: rows.length, gatePassed: gate.passed, observed: true } };
  });
  console.log(JSON.stringify(completed.summary));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
