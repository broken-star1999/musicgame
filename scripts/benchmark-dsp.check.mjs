// Native Node checks: no real music, model, download or production-source edits.
// node --test scripts/benchmark-dsp.check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENRES, METRICS, sha, validateSelection, validateCommit, inspectInput, validateGate, assertNovel, registryFingerprint, consumeCohort, finishRun, withConsumedRun, gateResult, main } from './benchmark-dsp.mjs';
import { effectiveReferences, measure, measuredOnsetHeads, sourcePathComparison, pairedBootstrap } from './benchmark-signal.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = '27649b3811a084890b8968e2e7a4149df14eb3cb';
fs.mkdirSync(path.join(ROOT, '.qa'), { recursive: true });
const workspace = fs.mkdtempSync(path.join(ROOT, '.qa', 'dsp-check-'));
const publicLedger = path.join(ROOT, 'benchmarks/dsp-cohorts.json'), publicBefore = sha(fs.readFileSync(publicLedger));
const originalEvaluator = sha(fs.readFileSync(path.join(ROOT, 'scripts/benchmark-signal.mjs')));
const empty = () => ({ schema: 1, dataset: 'gtzan', canonicalPCM: 'mono f32le 22050Hz', clips: [], runs: [], freezes: [] });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
let sequence = 0;
function ledger(registry = empty()) { const file = path.join(workspace, 'ledger-' + sequence++ + '.json'); write(file, registry); return file; }
function clip(index = 4) { return { clipId: 'blues.' + String(index).padStart(5, '0') + '.wav', pcmSha256: sha('synthetic-pcm-' + index), rawReferenceSha256: sha('synthetic-ref-' + index) }; }
function protocol(file, mode = 'final', clips = [clip()]) {
  const bytesHash = sha('frozen-synthetic-' + sequence++), registry = JSON.parse(fs.readFileSync(file));
  registry.freezes.push({ protocolSha256: bytesHash }); write(file, registry);
  return { protocolSha256: bytesHash, protocol: { mode, registrySha256: registryFingerprint(registry), baselineCommit: BASELINE, sourceHashes: { after: {} }, cohort: { id: 'synthetic-only', fingerprint: sha(JSON.stringify(clips)), clips } } };
}
test.after(() => {
  assert.equal(sha(fs.readFileSync(publicLedger)), publicBefore, 'real observed ledger must stay untouched');
  assert.equal(sha(fs.readFileSync(path.join(ROOT, 'scripts/benchmark-signal.mjs'))), originalEvaluator);
  // No recursive deletion: preserve ignored fixtures and failed evidence.
  write(path.join(workspace, 'result.json'), { syntheticOnly: true, publicLedgerUnchanged: true, oldEvaluatorUnchanged: true });
});
test('reference boundary is physical, inclusive and identical for both variants', () => {
  const raw = [-.01, 0, .01, .02, .020001, NaN, 'x'], copy = [...raw];
  const a = effectiveReferences(raw, 441), b = effectiveReferences(raw, 441);
  assert.deepEqual(a, b); assert.deepEqual(raw, copy);
  assert.deepEqual(a.valid, [0, .01, .02]);
  assert.deepEqual(a.counts, { raw: 7, effective: 3, excluded: 4, reasons: { non_finite_or_non_numeric: 2, before_pcm_start: 1, after_pcm_end: 1 } });
  assert.throws(() => effectiveReferences([.02, .01], 441), /strictly increasing/);
});
test('50/70ms scoring is distinct, one-to-one and does not clip predictions', () => {
  assert.equal(measure([0, .5, 1], [0, .56, 1.09], .05).hits, 1);
  assert.equal(measure([0, .5, 1], [0, .56, 1.09], .07).hits, 2);
  assert.equal(measure([0, .01], [0], .07).hits, 1);
  const scored = measure([0], [-.01, 100], .07); assert.equal(scored.predicted, 2); assert.equal(scored.precision, .5);
});
test('four-finger provenance counts unique heads, specific identities and source changes separately', () => {
  const data = measuredOnsetHeads([{ time: .1 }, { time: .1 }, { time: .5 }, { time: .9 }], [{ time: .1 }, { time: .51 }]);
  assert.deepEqual(data.counts, { notesIncludingChords: 4, uniqueHeads: 3, measuredOnsetHeads: 2, headsWithoutMeasuredCandidate: 1 });
  assert.equal(measure(data.actual, [.115, .9], .02).hits, 1);
  const changed = sourcePathComparison([{ start: 0, end: 1, band: 0 }], [{ start: 0, end: .5, band: 0 }, { start: .5, end: 1, band: 1 }], 1);
  assert.equal(changed.changedDurationRatio, .5); assert.equal(changed.changedSegmentRatio, .5);
});
test('bootstrap is deterministic paired within-genre, all18 metric IDs registered', () => {
  const rows = GENRES.flatMap((g, i) => [0, 1, 2].map(n => ({ name: g + '.' + n, deltas: { x: (i + n) / 100 } })));
  const opts = { seed: 20261030, replicates: 10000 };
  assert.deepEqual(pairedBootstrap(rows, ['x'], opts), pairedBootstrap(rows, ['x'], opts));
  assert.equal(METRICS.length, 18); assert.equal(new Set(METRICS).size, 18);
});
test('persistent observed history retains the original120 and rejects reuse under another label', () => {
  const registry = JSON.parse(fs.readFileSync(publicLedger));
  const historicIds = GENRES.flatMap(genre => [0, 7, 19, 3, 11, 23, 5, 13, 29, 2, 17, 31].map(index => `${genre}.${String(index).padStart(5, '0')}.wav`));
  assert.equal(historicIds.length, 120);
  for (const clipId of historicIds) assert(registry.clips.some(clip => clip.clipId === clipId), `Lost observation history: ${clipId}`);
  assert.equal(new Set(registry.clips.map(x => x.pcmSha256)).size, registry.clips.length);
  assert.throws(() => assertNovel(registry, [{ ...registry.clips[0] }]), /already been observed/);
  assert.throws(() => assertNovel(registry, [{ ...clip(99), pcmSha256: registry.clips[0].pcmSha256 }]), /already been observed/);
  assert.throws(() => assertNovel(registry, [{ ...registry.clips[0], pcmSha256: sha('different') }]), /already been observed/);
});
test('whole cohort consumed before callback; failure retains all identities and cannot rerun final', async () => {
  const file = ledger(), clips = [clip(4), clip(12), clip(28)], p = protocol(file, 'final', clips);
  await assert.rejects(withConsumedRun(file, p.protocol, p.protocolSha256, () => {
    const current = JSON.parse(fs.readFileSync(file));
    assert.equal(current.clips.length, 3); assert.equal(current.runs[0].state, 'consumed_before_algorithm_load');
    throw Error('synthetic algorithm failure');
  }), /synthetic algorithm failure/);
  const current = JSON.parse(fs.readFileSync(file)); assert.equal(current.runs[0].state, 'failed_observed');
  assert.equal(current.runs[0].failure.code, 'EVALUATION_ABORTED');
  assert.equal(fs.readFileSync(file, 'utf8').includes('synthetic algorithm failure'), false);
  assert.throws(() => assertNovel(current, clips), /already been observed/);
  const renamed = protocol(file, 'final', clips);
  assert.throws(() => consumeCohort(file, renamed.protocol, renamed.protocolSha256), /already been observed/);
});
test('diagnostic may repeat frozen synthetic inputs; newly diagnosed clips cannot later become final', async () => {
  const file = ledger(), p = protocol(file, 'diagnostic');
  await withConsumedRun(file, p.protocol, p.protocolSha256, async () => ({}));
  await withConsumedRun(file, p.protocol, p.protocolSha256, async () => ({}));
  const current = JSON.parse(fs.readFileSync(file)); assert.equal(current.runs.length, 2);
  assert.throws(() => assertNovel(current, p.protocol.cohort.clips), /already been observed/);
});
test('unregistered/edited frozen bytes and invalid monotonic transitions reject before callback', () => {
  const file = ledger(), p = protocol(file);
  assert.throws(() => consumeCohort(file, p.protocol, sha('edited-gate')), /not registered/);
  assert.equal(JSON.parse(fs.readFileSync(file)).runs.length, 0);
  const run = consumeCohort(file, p.protocol, p.protocolSha256);
  finishRun(file, run.runId, 'failed_observed');
  assert.throws(() => finishRun(file, run.runId, 'completed_observed'), /monotonic/);
});
test('gate is explicit and frozen; count ratio cannot be replaced by chord note count', () => {
  assert.throws(() => validateGate({ constraints: [] }, 'final'), /nonempty/);
  assert.throws(() => validateGate({ constraints: [{ metric: 'made-up', target: 'macroDelta', operator: '>=', value: 0 }] }, 'final'), /registered/);
  const gate = { constraints: [{ metric: 'clock70F1', target: 'macroDelta', operator: '>=', value: .01 }, { metric: 'clock70F1', target: 'ciLow95', operator: '>', value: 0 }], fourFingerMinCountRatio: .95 };
  validateGate(gate, 'final');
  const modes = Object.fromEntries(['one', 'two', 'three', 'four'].map(m => [m, { valid: true, deterministic: true, notes: 100 }]));
  const rows = [{ variants: { before: { modes }, after: { modes } }, deltas: { clock70F1: .1 }, fourFinger: { beforeActualHeads: 10, actualHeadCountRatio: .9 } }];
  const result = gateResult(rows, { clock70F1: { low95: .02 } }, gate);
  assert.equal(result.constraints.every(x => x.passed), true); assert.equal(result.passed, false); assert.equal(result.fourFingerCount, false);
});
test('CLI rejects ambiguous flags, mutable refs and invalid selections', async () => {
  assert.throws(() => validateCommit('main'), /40-hex/);
  assert.throws(() => validateSelection([1, 1, 2]), /distinct/);
  assert.throws(() => validateSelection([1, 2, 100]), /distinct/);
  for (const args of [['run', '--mode', 'final'], ['run', '--force', 'yes'], ['prepare', '--mode', 'final', '--mode', 'diagnostic']]) await assert.rejects(main(args), /option/);
});
test('synthetic prepare/freeze no algorithms; changed gate or source/input manifest rejected before run', async () => {
  const folder = path.join(workspace, 'synthetic-input'); fs.mkdirSync(folder);
  const indices = [4, 12, 28];
  let id = 1;
  for (const genre of GENRES) for (const index of indices) {
    const name = genre + '.' + String(index).padStart(5, '0'), pcm = Buffer.alloc(22050 * 3 * 4), unique = id++;
    pcm.writeFloatLE(unique / 100, 0);
    for (let click = .2; click < 2.9; click += .4) for (let k = 0; k < 1102; k++) {
      const at = Math.round(click * 22050) + k, t = k / 22050;
      pcm.writeFloatLE(.7 * Math.exp(-t * 80) * (Math.sin(2 * Math.PI * (150 + unique) * t) + .3 * Math.sin(2 * Math.PI * 2100 * t)), at * 4);
    }
    fs.writeFileSync(path.join(folder, name + '.audio.f32'), pcm); write(path.join(folder, name + '.reference.json'), [-.01, 0, .01, 3, 3.001]);
  }
  const inspected = inspectInput(folder, indices); assert.equal(inspected.clips.length, 30); assert.equal(inspected.clips[0].references.excluded, 2);
  const file = ledger(), selection = path.join(workspace, 'selection.json'), gate = path.join(workspace, 'gate.json'), draft = path.join(workspace, 'draft.json'), frozen = path.join(workspace, 'frozen.json'), output = path.join(workspace, 'never-run.json');
  write(selection, { syntheticOnly: true, indices, exactGenres: GENRES });
  write(gate, { constraints: [{ metric: 'clock70F1', target: 'macroDelta', operator: '>=', value: 0 }] });
  await main(['prepare', '--mode', 'final', '--baseline-commit', BASELINE, '--indices', indices.join(','), '--cohort-id', 'synthetic-not-real-gtzan', '--selection-protocol', selection, '--input', folder, '--output', draft, '--registry', file, '--gate', gate]);
  assert.equal(JSON.parse(fs.readFileSync(file)).runs.length, 0);
  await main(['freeze', '--protocol', draft, '--input', folder, '--output', frozen, '--registry', file]);
  assert.equal(JSON.parse(fs.readFileSync(file)).runs.length, 0);
  const original = JSON.parse(fs.readFileSync(frozen));
  const edited = structuredClone(original); edited.gate.constraints[0].value = -1; write(frozen, edited);
  await assert.rejects(main(['run', '--protocol', frozen, '--input', folder, '--output', output, '--registry', file]), /not registered/);
  const sourceEdited = structuredClone(original); sourceEdited.sourceHashes.after['src/core/analysis.ts'] = sha('changed'); write(frozen, sourceEdited);
  await assert.rejects(main(['run', '--protocol', frozen, '--input', folder, '--output', output, '--registry', file]), /source closure/);
  write(frozen, original);
  const target = path.join(folder, inspected.clips[0].clipId.slice(0, -4) + '.audio.f32');
  const bytes = fs.readFileSync(target); bytes.writeFloatLE(.888, 0); fs.writeFileSync(target, bytes);
  await assert.rejects(main(['run', '--protocol', frozen, '--input', folder, '--output', output, '--registry', file]), /identity/);
  assert.equal(JSON.parse(fs.readFileSync(file)).runs.length, 0); assert.equal(fs.existsSync(output), false);
  // A complete pipeline smoke uses only these generated three-second signals.
  // Invalid charts, if any, must be reported rather than skip clips/fabricate notes.
  bytes.writeFloatLE(.01, 0); fs.writeFileSync(target, bytes);
  await main(['run', '--protocol', frozen, '--input', folder, '--output', output, '--registry', file]);
  const report = JSON.parse(fs.readFileSync(output)), observed = JSON.parse(fs.readFileSync(file));
  assert.equal(report.tracks, 30); assert.equal(report.referenceTotals.raw, 150);
  assert.equal(report.referenceTotals.effective, 90); assert.equal(report.referenceTotals.excluded, 60);
  assert.equal(Object.keys(report.aggregate.after).length, 18);
  assert.equal(observed.runs[0].state, 'completed_observed'); assert.equal(observed.clips.length, 30);
  assert.equal(fs.existsSync(output + '.paired.csv'), true);
  const publicText = fs.readFileSync(output, 'utf8') + fs.readFileSync(file, 'utf8');
  assert.equal(publicText.includes(ROOT), false); assert.equal(publicText.includes(ROOT.replaceAll('\\', '\\\\')), false);
  assert.equal(publicText.includes('"audio":'), false); assert.equal(publicText.includes('"notes": ['), false);
  await assert.rejects(main(['run', '--protocol', frozen, '--input', folder, '--output', output + '.repeat', '--registry', file]), /Registry changed|already been observed/);
});
