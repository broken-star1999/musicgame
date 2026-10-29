import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ref = '4878ef958cbdd837e6697284e34fa67fb5bc9506';
const output = '.qa/baseline';
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'src'], { encoding: 'utf8', windowsHide: true }).trim().split('\n')
  .filter(file => file === 'src/types.ts' || (file.startsWith('src/core/') && file.endsWith('.ts') && !file.endsWith('.test.ts')));
for (const file of files) {
  const target = path.join(output, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, execFileSync('git', ['show', `${ref}:${file}`], { windowsHide: true }));
}
console.log(`Prepared exact v6 source ${ref} under ${output}. No checkout or branch changes.`);
