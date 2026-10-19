import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
for (const folder of ['bin', 'src', 'web', 'scripts']) for (const name of fs.readdirSync(folder)) {
  if (/\.(?:mjs|js)$/u.test(name)) execFileSync(process.execPath, ['--check', path.join(folder, name)], { stdio: 'inherit' });
}
console.log('JavaScript syntax checks passed.');
