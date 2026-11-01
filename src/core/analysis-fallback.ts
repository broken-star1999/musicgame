import type { Analysis } from '../types';

export const ANALYSIS_STALL_MS = 45000;

export function basicAnalysis(analysis: Analysis): Analysis {
  return { ...analysis, recognition: { engine: 'signal' } };
}
