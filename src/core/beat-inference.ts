import * as ort from 'onnxruntime-web/wasm';
import config from './beat-model-config.json';
import { beatChunks, beatSpectrogram } from './beat-features';
import wasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import runtime from './beat-runtime-config.json';
import { loadBeatAsset } from './beat-cache';

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
  const started = performance.now();
  const download = (url: string | URL, asset: { bytes: number; sha256: string }, slot: 'model' | 'runtime', label: string, from: number, span: number) => {
    progress?.(from, `正在检查本机${label}缓存`);
    return loadBeatAsset(url, {
      ...asset, label, scope: assetBase, slot, totalTimeoutMs: Math.max(1, 90000 - (performance.now() - started)),
      onCached: () => progress?.(from + span, `已从本机缓存读取${label}`),
      progress: (received, total) => progress?.(from + received / total * span, `下载${label} ${received < 1e6 ? `${(received / 1e3).toFixed(0)} KB` : `${(received / 1e6).toFixed(1)} MB`} / ${(total / 1e6).toFixed(1)} MB`),
    });
  };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.initTimeout = 45000;
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmBinaryUrl, import.meta.url).href, mjs: new URL(wasmLoaderUrl, import.meta.url).href };
  const model = await download(new URL(`models/${config.file}`, assetBase), config, 'model', '节拍模型', 0, 0.28);
  const binary = await download(new URL(wasmBinaryUrl, import.meta.url), runtime, 'runtime', '运行组件', 0.28, 0.30);
  ort.env.wasm.wasmBinary = binary;
  progress?.(0.60, '正在启动识别引擎（首次需要编译）');
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  try {
    const features = beatSpectrogram(samples, value => progress?.(0.68 + value * 0.10, '正在提取音乐特征'));
    progress?.(0.78, '正在识别第一段音乐拍点');
    return await runBeatModel(session, features, (done, total) => progress?.(0.78 + done / total * 0.22, `正在识别整曲拍点 ${done}/${total}`));
  } finally { await session.release(); }
}
