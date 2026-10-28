import { analyzeAudio } from './analysis';
import type { WorkerRequest, WorkerResponse } from '../types';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const send = (data: WorkerResponse) => self.postMessage(data);
  try {
    const analysis = analyzeAudio(event.data.samples, event.data.sampleRate, (value, stage) => send({ type: 'progress', value, stage }));
    send({ type: 'done', analysis });
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : '音频分析失败，请重试。' }); }
};
