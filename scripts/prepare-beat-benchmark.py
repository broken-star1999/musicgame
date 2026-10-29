"""Prepare local GTZAN audio/manual annotations for the Node/WASM benchmark.
Requires FFmpeg on PATH. Does not download or redistribute copyrighted music.
"""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--audio', required=True, type=Path)
parser.add_argument('--annotations', required=True, type=Path)
parser.add_argument('--out', default=Path('.qa/beat-benchmark-input'), type=Path)
parser.add_argument('--indices', nargs='+', type=int, default=[0, 7, 19])
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
count = 0
for audio in sorted(args.audio.rglob('*.wav')):
    parts = audio.stem.split('.')
    if len(parts) != 2 or not parts[1].isdigit() or int(parts[1]) not in args.indices:
        continue
    annotation = args.annotations / ('gtzan_' + audio.stem.replace('.', '_') + '.beats')
    if not annotation.exists():
        raise RuntimeError(f'Missing manual annotation: {annotation.name}')
    reference = [float(line.split()[0]) for line in annotation.read_text().splitlines() if line.strip() and not line.startswith('#')]
    output = args.out / (audio.stem + '.audio.f32')
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(audio), '-f', 'f32le', '-ac', '1', '-ar', '22050', '-y', str(output)], check=True)
    (args.out / (audio.stem + '.reference.json')).write_text(json.dumps(reference))
    count += 1
print(json.dumps({'prepared': count, 'directory': str(args.out), 'sampleRate': 22050}))
