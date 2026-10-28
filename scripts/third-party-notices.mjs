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
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), sections.join('\n'));
console.log(`Recorded ${visited.size} production dependency notices.`);
