// Copies the country flags (flag-icons, MIT) into flags/, optimised with SVGO.
// Run: node tools/build-flags.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { optimize } from 'svgo';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'node_modules/flag-icons/flags/4x3');
const OUT = path.join(ROOT, 'flags');
const countries = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/countries.json'), 'utf8'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let before = 0, after = 0;
for (const c of countries) {
  const f = path.join(SRC, c.c.toLowerCase() + '.svg');
  if (!fs.existsSync(f)) { console.warn('no flag for', c.c); continue; }
  const src = fs.readFileSync(f, 'utf8');
  const res = optimize(src, {
    multipass: true,
    floatPrecision: 1,
    plugins: ['preset-default', 'removeDimensions']
  });
  // fixed size so the flag can also be drawn on a canvas (PDF report) in every browser
  const svg = res.data.replace('<svg ', '<svg width="640" height="480" ');
  before += src.length; after += svg.length;
  fs.writeFileSync(path.join(OUT, c.c.toLowerCase() + '.svg'), svg);
}
fs.copyFileSync(require.resolve('flag-icons/LICENSE'), path.join(OUT, 'LICENSE'));
console.log(`flags: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
