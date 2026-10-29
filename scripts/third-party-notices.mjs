import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const visited = new Set();
const sections = ['# Third-party notices', '', 'Licenses for production dependencies and locally bundled fonts. Generated from the installed, locked dependency tree.', ''];

function visit(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const directory = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const files = fs.readdirSync(directory).filter(file => /^(license|licence|ofl|copyright)(\.|$)/i.test(file));
  sections.push(`## ${pkg.name} ${pkg.version}`, '', `License: ${pkg.license || 'See package license'}`, '');
  for (const file of files) sections.push(`### ${file}`, '', '```text', fs.readFileSync(path.join(directory, file), 'utf8').trim(), '```', '');
  if (!files.length) sections.push('See the original package distribution for license details.', '');
  for (const dependency of Object.keys(pkg.dependencies || {})) visit(dependency);
}
for (const dependency of Object.keys(manifest.dependencies)) visit(dependency);
const model = JSON.parse(fs.readFileSync(path.join(root, 'src/core/beat-model-config.json'), 'utf8'));
sections.push('## Beat This! small0 model and adapted export', '',
  `Source: ${model.source} (commit ${model.commit}). Code and pretrained weights: MIT.`, '',
  `Shipped ONNX SHA-256: ${model.sha256}. The memory-bounded attention export preserves the upstream model operations; see scripts/export-beat-model.py.`, '',
  '```text', fs.readFileSync(path.join(root, 'public/models/BEAT_THIS_LICENSE.txt'), 'utf8').trim(), '```', '',
  'The beat-phase decoder is an independent TypeScript implementation of a standard phase/tempo state model; no madmom code or pretrained weights are bundled. Algorithm references are listed in ALGORITHM.md.', '');
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), sections.join('\n'));
console.log(`Recorded ${visited.size} production dependency notices.`);
