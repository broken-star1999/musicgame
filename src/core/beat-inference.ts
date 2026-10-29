import * as ort from 'onnxruntime-web/wasm';
import config from './beat-model-config.json';
import { beatChunks, beatSpectrogram } from './beat-features';
import wasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

type Progress = (value: number, stage: string) => void;

export async function runBeatModel(session: ort.InferenceSession, features: ReturnType<typeof beatSpectrogram>, progress?: (done: number, total: number) => void): Promise<Float32Array> {
  const chunks = beatChunks(features.frames), output = new Float32Array(features.frames * 2).fill(-1000);
  const written = new Uint8Array(features.frames);
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index], input = new Float32Array(chunk.length * config.melBins);
    const from = Math.max(0, chunk.start), to = Math.min(features.frames, chunk.start + chunk.length);
    input.set(features.data.subarray(from * config.melBins, to * config.melBins), Math.max(0, -chunk.start) * config.melBins);
    const prediction = await session.run({ spectrogram: new ort.Tensor('float32', input, [1, chunk.length, config.melBins]) });
    const logits = prediction.logits.data as Float32Array;
    for (let frame = config.border; frame < chunk.length - config.border; frame++) {
      const target = chunk.start + frame;
      if (target < 0 || target >= features.frames || written[target]) continue;
      output[target * 2] = logits[frame * 2]; output[target * 2 + 1] = logits[frame * 2 + 1]; written[target] = 1;
    }
    progress?.(index + 1, chunks.length);
  }
  return output;
}

/** All URLs refer to static assets on this application's own origin.
 * Audio and features never enter a network request. */
export async function inferBeatLogits(samples: Float32Array, assetBase: string, progress?: Progress): Promise<Float32Array> {
  progress?.(0, `正在准备本地节拍模型（首次约 ${Math.ceil(config.bytes / 1048576)} MB）`);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmBinaryUrl, import.meta.url).href, mjs: new URL(wasmLoaderUrl, import.meta.url).href };
  const response = await fetch(new URL(`models/${config.file}`, assetBase));
  if (!response.ok) throw new Error(`节拍模型加载失败（${response.status}）`);
  const model = new Uint8Array(await response.arrayBuffer());
  if (model.byteLength !== config.bytes) throw new Error('节拍模型文件不完整，请重新加载');
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', model);
    if (Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('') !== config.sha256) throw new Error('节拍模型校验失败，请重新加载');
  }
  progress?.(0.06, '正在启动本地节拍识别');
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  try {
    const features = beatSpectrogram(samples, value => progress?.(0.1 + value * 0.12, '正在提取模型所需的声音特征'));
    return await runBeatModel(session, features, (done, total) => progress?.(0.22 + done / total * 0.78, `正在识别整曲拍点 ${done}/${total}`));
  } finally { await session.release(); }
}
