import { generateChart } from './chart';
import type { Analysis, Difficulty, Chart } from '../types';

export type ChartRequest = { analysis: Analysis; difficulty: Difficulty; bpmOverride?: number };
export type ChartResponse = { type: 'progress'; value: number; stage: string } | { type: 'done'; chart: Chart } | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<ChartRequest>) => {
  const send = (data: ChartResponse) => self.postMessage(data);
  try {
    const { analysis, difficulty, bpmOverride } = event.data;
    const chart = generateChart(analysis, difficulty, bpmOverride, (value, stage) => send({ type: 'progress', value, stage }));
    send({ type: 'done', chart });
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : '谱面生成失败，请重试。' }); }
};
