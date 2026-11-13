/**
 * vendor.test.mjs — vendor/three/ のファイルが three@0.187.0 の公式配布物と同じであること
 * 期待値は vendor/three/SHA256SUMS（npm の tarball から取り出したときに記録）。
 * node_modules/three（開発用依存）が同じ版で入っていれば、そのファイルとも照合する
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor', 'three');
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const sums = readFileSync(join(VENDOR, 'SHA256SUMS'), 'utf8').split('\n')
  .filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/));

test('vendor/three のファイルが記録したハッシュと一致する（改行の変換などで変わっていない）', () => {
  assert.ok(sums.length >= 7, `SHA256SUMS の行数 ${sums.length}`);
  for (const [h, f] of sums) assert.equal(sha(join(VENDOR, f)), h, f);
});

test('node_modules/three（0.187.0）があれば、そのファイルとも一致する', (t) => {
  const pkg = join(ROOT, 'node_modules', 'three', 'package.json');
  if (!existsSync(pkg) || JSON.parse(readFileSync(pkg, 'utf8')).version !== '0.187.0') {
    t.skip('node_modules/three@0.187.0 がない'); return;
  }
  const src = f => f === 'LICENSE' ? f : f.startsWith('addons/') ? 'examples/jsm/' + f.slice(7) : 'build/' + f;
  for (const [h, f] of sums) assert.equal(sha(join(ROOT, 'node_modules', 'three', src(f))), h, f);
});
