import { analyzeAudio } from './analysis';
import type { WorkerRequest, WorkerResponse } from '../types';
import { applyBeatRecognition } from './recognition';
import { basicAnalysis } from './analysis-fallback';

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const send = (data: WorkerResponse) => self.postMessage(data);
  try {
    let analysis = analyzeAudio(event.data.samples, event.data.sampleRate, (value, stage) => send({ type: 'progress', value: value * 0.3, stage }));
    if (event.data.recognitionMode === 'basic') analysis = basicAnalysis(analysis);
    else try {
      send({ type: 'baseline', analysis });
      send({ type: 'progress', value: 0.3, stage: '正在加载增强识别组件' });
      const { inferBeatLogits } = await import('./beat-inference');
      const logits = await inferBeatLogits(event.data.samples, event.data.assetBase, (value, stage) => send({ type: 'progress', value: 0.3 + value * 0.66, stage }));
      analysis = applyBeatRecognition(analysis, logits);
    } catch (error) {
      const reason = error instanceof Error && error.name === 'BeatResourceError' ? error.message : '增强节拍模型未能启动或完成识别';
      analysis = basicAnalysis(analysis, reason);
    }
    send({ type: 'progress', value: 1, stage: '音乐识别完成' });
    send({ type: 'done', analysis });
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : '音频分析失败，请重试。' }); }
};
