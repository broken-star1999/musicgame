import type { Analysis, AnalysisPatch } from '../types';

/** Enhancement changes only recognition metadata and the derived beat/event
 * layer. Unchanged waveform, tonal and onset arrays cross the worker once. */
export function makeAnalysisPatch(baseline: Analysis, result: Analysis): AnalysisPatch {
  const patch: AnalysisPatch = {};
  if (result.bpm !== baseline.bpm) patch.bpm = result.bpm;
  if (result.confidence !== baseline.confidence) patch.confidence = result.confidence;
  if (result.rhythm !== baseline.rhythm) patch.rhythm = result.rhythm ?? null;
  if (result.pulse !== baseline.pulse) patch.pulse = result.pulse ?? null;
  if (result.recognition !== baseline.recognition) patch.recognition = result.recognition ?? null;
  return patch;
}

/** Merge only supported result fields. Undefined is a no-op, null clears an
 * optional field, and replacement metadata objects replace rather than blend. */
export function mergeAnalysisPatch(baseline: Analysis, patch: AnalysisPatch): Analysis {
  const result = { ...baseline };
  if (patch.bpm !== undefined) result.bpm = patch.bpm;
  if (patch.confidence !== undefined) result.confidence = patch.confidence;
  if (patch.rhythm === null) delete result.rhythm;
  else if (patch.rhythm !== undefined) result.rhythm = patch.rhythm;
  if (patch.pulse === null) delete result.pulse;
  else if (patch.pulse !== undefined) result.pulse = patch.pulse;
  if (patch.recognition === null) delete result.recognition;
  else if (patch.recognition !== undefined) result.recognition = patch.recognition;
  return result;
}
