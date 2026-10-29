import { analyzeAudio } from './analysis';
import type { WorkerRequest, WorkerResponse } from '../types';
import { applyBeatRecognition } from './recognition';

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const send = (data: WorkerResponse) => self.postMessage(data);
  try {
    let analysis = analyzeAudio(event.data.samples, event.data.sampleRate, (value, stage) => send({ type: 'progress', value: value * 0.3, stage }));
    if (event.data.recognitionMode === 'basic') analysis = { ...analysis, recognition: { engine: 'signal' } };
    else try {
      const { inferBeatLogits } = await import('./beat-inference');
      const logits = await inferBeatLogits(event.data.samples, event.data.assetBase, (value, stage) => send({ type: 'progress', value: 0.3 + value * 0.66, stage }));
      analysis = applyBeatRecognition(analysis, logits);
    } catch {
      analysis = { ...analysis, recognition: { engine: 'signal', warning: '增强节拍识别未完成，当前为基础谱面，可重新分析。' } };
    }
    send({ type: 'progress', value: 1, stage: '音乐识别完成' });
    send({ type: 'done', analysis });
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : '音频分析失败，请重试。' }); }
};
