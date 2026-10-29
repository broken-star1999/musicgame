import { analyzeAudio } from './analysis';
import type { Analysis, WorkerRequest, WorkerResponse } from '../types';
import { applyBeatRecognition } from './recognition';
import { basicAnalysis } from './analysis-fallback';
import { makeAnalysisPatch } from './analysis-result';

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const send = (data: WorkerResponse) => self.postMessage(data);
  try {
    const analysis = analyzeAudio(event.data.samples, event.data.sampleRate, (value, stage) => send({ type: 'progress', value: value * 0.3, stage }));
    let completion: Extract<WorkerResponse, { type: 'done' | 'patch' }>;
    if (event.data.recognitionMode === 'basic') completion = { type: 'done', analysis: basicAnalysis(analysis) };
    else {
      send({ type: 'baseline', analysis });
      let result: Analysis;
      try {
        send({ type: 'progress', value: 0.3, stage: '正在加载增强识别组件' });
        const { inferBeatLogits } = await import('./beat-inference');
        const logits = await inferBeatLogits(event.data.samples, event.data.assetBase, (value, stage) => send({ type: 'progress', value: 0.3 + value * 0.66, stage }));
        result = applyBeatRecognition(analysis, logits);
      } catch (error) {
        const reason = error instanceof Error && error.name === 'BeatResourceError' ? error.message : '增强节拍模型未能启动或完成识别';
        result = basicAnalysis(analysis, reason);
      }
      completion = { type: 'patch', patch: makeAnalysisPatch(analysis, result) };
    }
    send({ type: 'progress', value: 1, stage: '音乐识别完成' });
    send(completion);
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : '音频分析失败，请重试。' }); }
};
