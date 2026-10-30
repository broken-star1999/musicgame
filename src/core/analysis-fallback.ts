import type { Analysis } from '../types';

export const ANALYSIS_STALL_MS = 45000;

export function basicAnalysis(analysis: Analysis, reason?: string): Analysis {
  return { ...analysis, recognition: { engine: 'signal', ...(reason ? { warning: `${reason}，已使用纯算法识别，可直接游玩或稍后重试模型辅助。` } : {}) } };
}
