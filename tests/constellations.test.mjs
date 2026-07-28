/**
 * constellations.test.mjs — data/constellations.json の検証
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZODIAC } from '../tools/build-constellations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = () => JSON.parse(readFileSync(join(ROOT, 'data', 'constellations.json'), 'utf8'));

test('88星座すべてが含まれ、黄道12星座がフラグされている', () => {
  const data = load();
  assert.equal(data.count, 88);
  assert.equal(data.constellations.length, 88);
  const zodiac = data.constellations.filter(c => c.zodiac);
  assert.equal(zodiac.length, 12);
  for (const c of zodiac) assert.ok(ZODIAC.has(c.iau), `unexpected zodiac: ${c.iau}`);
});

test('星座線の端点が実データ星に一致する（レグルス・アンタレス）', () => {
  const data = load();
  const onLines = (iau, lon, lat) => {
    const con = data.constellations.find(c => c.iau === iau);
    const pts = con.lines.flat();
    for (let i = 0; i < pts.length; i += 2) {
      if (Math.abs(pts[i] / 100 - lon) < 0.1 && Math.abs(pts[i + 1] / 100 - lat) < 0.1) return true;
    }
    return false;
  };
  assert.ok(onLines('Leo', 149.83, 0.47), 'Regulus not found on Leo lines');
  assert.ok(onLines('Sco', 249.77, -4.57), 'Antares not found on Sco lines');
});

test('constellations.json の形式とサイズ', () => {
  const data = load();
  assert.ok(statSync(join(ROOT, 'data', 'constellations.json')).size < 50 * 1024);
  for (const c of data.constellations) {
    assert.ok(c.lines.length >= 1, `${c.iau} has no lines`);
    for (const line of c.lines) {
      assert.ok(line.length >= 4 && line.length % 2 === 0, `${c.iau}: bad polyline`);
      for (let i = 0; i < line.length; i += 2) {
        assert.ok(line[i] >= 0 && line[i] < 36000, `${c.iau}: lon out of range`);
        assert.ok(line[i + 1] >= -9000 && line[i + 1] <= 9000, `${c.iau}: lat out of range`);
      }
    }
  }
});
