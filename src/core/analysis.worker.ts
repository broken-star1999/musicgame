import { analyzeAudio } from './analysis';
import { basicAnalysis } from './analysis-fallback';
import type { WorkerRequest, WorkerResponse } from '../types';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const send = (data: WorkerResponse) => self.postMessage(data);
  try {
    const analysis = analyzeAudio(event.data.samples, event.data.sampleRate, (value, stage) => send({ type: 'progress', value, stage }));
    send({ type: 'progress', value: 1, stage: '音乐分析完成' });
    send({ type: 'done', analysis: basicAnalysis(analysis) });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '音频分析失败，请重试。' });
  }
};
