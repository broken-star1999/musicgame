"""Reproduce the browser-local Beat This! small0 ONNX model.

Model/code: MIT, JKU Institute of Computational Perception, 2024.
Upstream: CPJKU/beat_this b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c.
The time-attention batching below preserves the original operations while
bounding peak memory. No weights are trained or altered by this export.
"""
import argparse
import hashlib
import json
from pathlib import Path
import types
import urllib.request

import numpy as np
import onnx
import onnxruntime as ort
import torch
from einops import rearrange
from beat_this.inference import load_model
from beat_this.model.beat_tracker import PartialFTTransformer
from beat_this.preprocessing import LogMelSpect
from rotary_embedding_torch import RotaryEmbedding

CHECKPOINT_SHA = '6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b'
FRAMES = 1500

def bounded_time_attention(self, x):
    x = self.norm(x)
    q, k, v = rearrange(self.to_qkv(x), 'b n (qkv h d) -> qkv b h n d', qkv=3, h=self.heads)
    q = self.rotary_embed.rotate_queries_or_keys(q)
    k = self.rotary_embed.rotate_queries_or_keys(k)
    # Only the quadratic attention matrix is split; projections and rotary
    # positions are shared, preserving efficient GEMMs and a small ONNX graph.
    output = torch.cat([self.attend(q_part, k_part, v_part) for q_part, k_part, v_part in zip(q.split(1), k.split(1), v.split(1))], dim=0)
    if self.to_gates is not None:
        output = output * rearrange(self.to_gates(x), 'b n h -> b h n 1').sigmoid()
    return self.to_out(rearrange(output, 'b h n d -> b n (h d)'))

class BrowserModel(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model
    def forward(self, spectrogram):
        output = self.model(spectrogram)
        return torch.stack([output['beat'], output['downbeat']], dim=-1)

def deduplicate_constants(model):
    seen, aliases, nodes = {}, {}, []
    for node in model.graph.node:
        if node.op_type == 'Constant' and len(node.attribute) == 1 and node.attribute[0].type == 4:
            tensor = onnx.TensorProto()
            tensor.CopyFrom(node.attribute[0].t)
            tensor.ClearField('name')
            tensor.ClearField('doc_string')
            key = tensor.SerializeToString(deterministic=True)
            if key in seen:
                aliases[node.output[0]] = seen[key]
                continue
            seen[key] = node.output[0]
        nodes.append(node)
    for node in nodes:
        for index, name in enumerate(node.input):
            while name in aliases:
                name = aliases[name]
            node.input[index] = name
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    onnx.checker.check_model(model)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', default='.qa/beat-this-small0.ckpt')
    args = parser.parse_args()
    checkpoint = Path(args.checkpoint)
    if not checkpoint.exists():
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve('https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt', checkpoint)
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != CHECKPOINT_SHA:
        raise RuntimeError('Checkpoint digest does not match the verified small0 release')
    torch.set_num_threads(4)
    torch.manual_seed(0)
    model = load_model(str(checkpoint)).eval()
    inputs = torch.randn(1, FRAMES, 128)
    with torch.inference_mode():
        reference = BrowserModel(model).eval()(inputs).numpy()
        for block in model.modules():
            if isinstance(block, PartialFTTransformer):
                block.attnT.forward = types.MethodType(bounded_time_attention, block.attnT)
            if isinstance(block, RotaryEmbedding):
                block.cache_if_possible = False
        wrapped = BrowserModel(model).eval()
        actual = wrapped(inputs).numpy()
        if np.max(np.abs(reference - actual)) > 1e-4:
            raise RuntimeError('Memory-bounded attention differs from the original model')
        temporary = Path('.qa/exported-beat-this.onnx')
        torch.onnx.export(wrapped, inputs, temporary, input_names=['spectrogram'], output_names=['logits'], dynamic_axes={'spectrogram': {1: 'frames'}, 'logits': {1: 'frames'}}, opset_version=17, dynamo=False, do_constant_folding=True)
    graph = onnx.load(temporary)
    deduplicate_constants(graph)
    data = graph.SerializeToString()
    digest = hashlib.sha256(data).hexdigest()
    folder = Path('public/models')
    folder.mkdir(parents=True, exist_ok=True)
    name = f'beat-this-small0-{digest[:12]}.onnx'
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(data, sess_options=options, providers=['CPUExecutionProvider'])
    predicted = session.run(None, {'spectrogram': inputs.numpy()})[0]
    error = float(np.max(np.abs(predicted - reference)))
    if error > 1e-4:
        raise RuntimeError(f'ONNX parity failed: {error}')
    for frames in [112, 512, 1494]:
        short = inputs[:, :frames]
        with torch.inference_mode():
            short_reference = wrapped(short).numpy()
        short_predicted = session.run(None, {'spectrogram': short.numpy()})[0]
        short_error = float(np.max(np.abs(short_predicted - short_reference)))
        if short_error > 1e-4:
            raise RuntimeError(f'Dynamic length {frames} failed parity: {short_error}')
    (folder / name).write_bytes(data)
    filters = LogMelSpect().spect_class.mel_scale.fb.numpy()
    sparse = []
    for band in range(128):
        active = np.nonzero(filters[:, band])[0]
        first, last = int(active[0]), int(active[-1])
        sparse.append([first, filters[first:last + 1, band].tolist()])
    metadata = {
        'model': 'Beat This! small0', 'source': 'https://github.com/CPJKU/beat_this',
        'commit': 'b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c', 'license': 'MIT',
        'file': name, 'sha256': digest, 'bytes': len(data), 'checkpointSha256': CHECKPOINT_SHA,
        'frames': FRAMES, 'border': 6, 'fps': 50, 'sampleRate': 22050,
        'fftSize': 1024, 'hop': 441, 'melBins': 128, 'filters': sparse,
    }
    Path('src/core/beat-model-config.json').write_text(json.dumps(metadata, separators=(',', ':')), encoding='utf8')
    print(json.dumps({'file': name, 'bytes': len(data), 'maxLogitError': error}))

if __name__ == '__main__':
    main()
