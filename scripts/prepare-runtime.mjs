import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.accessSync(path.join(root, 'node_modules/onnxruntime-web/dist', name));
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'src/core/beat-model-config.json'), 'utf8'));
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'src/core/beat-runtime-config.json'), 'utf8'));
const wasm = fs.readFileSync(path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'));
if (wasm.length !== runtime.bytes || crypto.createHash('sha256').update(wasm).digest('hex') !== runtime.sha256) throw new Error('ONNX runtime does not match its download manifest');
const model = fs.readFileSync(path.join(root, 'public/models', config.file));
if (crypto.createHash('sha256').update(model).digest('hex') !== config.sha256) throw new Error('Beat model does not match its manifest');
console.log('Verified the local ONNX runtime and beat model.');
