/**
 * stars.test.mjs — 座標変換と stars.json の検証
 * 実行: npm test  (node --test tests/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { equatorialToEcliptic } from '../tools/build-stars.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D2R = Math.PI / 180;

// ra/dec は HYG v4.1 のカタログ値（J2000）、lon/lat は既知の黄道座標
const CASES = [
  { name: 'Aldebaran', ra: 4.598677,  dec: 16.509301,  lon: 69.79,  lat: -5.47, mag: 0.87 },
  { name: 'Regulus',   ra: 10.139532, dec: 11.967207,  lon: 149.83, lat: 0.47,  mag: 1.36 },
  { name: 'Spica',     ra: 13.419883, dec: -11.161322, lon: 203.84, lat: -2.05, mag: 0.98 },
  { name: 'Antares',   ra: 16.490128, dec: -26.432002, lon: 249.77, lat: -4.57, mag: 1.06 },
];

test('赤道→黄道変換が既知の恒星と ±0.1° で一致する', () => {
  for (const c of CASES) {
    const { lon, lat } = equatorialToEcliptic(c.ra, c.dec);
    assert.ok(Math.abs(lon - c.lon) < 0.1,
      `${c.name} lon: got ${lon.toFixed(3)}, expected ${c.lon}`);
    assert.ok(Math.abs(lat - c.lat) < 0.1,
      `${c.name} lat: got ${lat.toFixed(3)}, expected ${c.lat}`);
  }
});

function loadStars() {
  return JSON.parse(readFileSync(join(ROOT, 'data', 'stars.json'), 'utf8'));
}

// 角距離（度）
function angSep(lon1, lat1, lon2, lat2) {
  const s = Math.sin(lat1 * D2R) * Math.sin(lat2 * D2R) +
            Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon1 - lon2) * D2R);
  return Math.acos(Math.min(1, Math.max(-1, s))) / D2R;
}

test('stars.json に4恒星が正しい位置・等級で含まれる', () => {
  const data = loadStars();
  const s = data.stars;
  for (const c of CASES) {
    let best = Infinity, bestMag = NaN;
    for (let i = 0; i < data.count; i++) {
      const d = angSep(s[i * 4] / 1000, s[i * 4 + 1] / 1000, c.lon, c.lat);
      if (d < best) { best = d; bestMag = s[i * 4 + 2] / 100; }
    }
    assert.ok(best < 0.1, `${c.name}: nearest star is ${best.toFixed(3)}° away`);
    assert.ok(Math.abs(bestMag - c.mag) < 0.05,
      `${c.name}: mag ${bestMag}, expected ${c.mag}`);
  }
});

test('stars.json の形式とサイズ制約', () => {
  const data = loadStars();
  assert.equal(data.stars.length, data.count * 4, 'フラット配列は 4 x count');
  assert.ok(data.count > 8000 && data.count < 10000, `count=${data.count}`);
  const size = statSync(join(ROOT, 'data', 'stars.json')).size;
  assert.ok(size <= 200 * 1024, `stars.json is ${(size / 1024).toFixed(1)} KB > 200 KB`);
  for (let i = 0; i < data.count; i++) {
    const lon = data.stars[i * 4], lat = data.stars[i * 4 + 1],
          mag = data.stars[i * 4 + 2];
    assert.ok(Number.isInteger(lon) && lon >= 0 && lon < 360000, `lon[${i}]=${lon}`);
    assert.ok(Number.isInteger(lat) && lat >= -90000 && lat <= 90000, `lat[${i}]=${lat}`);
    assert.ok(mag <= 650, `mag[${i}]=${mag} exceeds 6.5 limit`);
  }
});

/* ---- 双眼鏡の段（data/stars-deep.json。docs/rendering-upgrade.md C.1・G.1） ---- */
function loadDeep() {
  return JSON.parse(readFileSync(join(ROOT, 'data', 'stars-deep.json'), 'utf8'));
}

test('stars-deep.json の形式・範囲・並び・サイズ', () => {
  const data = loadDeep();
  assert.equal(data.stars.length, data.count * 4, 'フラット配列は 4 x count');
  assert.equal(data.magFloor, 6.5);
  assert.equal(data.magLimit, 8.0);
  // HYG v4.1 で 6.5 < 等級 ≤ 8.0 は 32,567 個（設計書 C.1）。生成し直して数が動いたら気づけるように幅を狭く取る
  assert.ok(data.count > 32000 && data.count < 33000, `count=${data.count}`);
  const size = statSync(join(ROOT, 'data', 'stars-deep.json')).size;
  assert.ok(size <= 700 * 1024, `stars-deep.json is ${(size / 1024).toFixed(1)} KB > 700 KB`);
  let prev = -Infinity;
  for (let i = 0; i < data.count; i++) {
    const lon = data.stars[i * 4], lat = data.stars[i * 4 + 1], mag = data.stars[i * 4 + 2];
    assert.ok(Number.isInteger(lon) && lon >= 0 && lon < 360000, `lon[${i}]=${lon}`);
    assert.ok(Number.isInteger(lat) && lat >= -90000 && lat <= 90000, `lat[${i}]=${lat}`);
    assert.ok(mag > 650 && mag <= 800, `mag[${i}]=${mag} は 6.5 < 等級 ≤ 8.0 の外`);
    assert.ok(mag >= prev, `明るい順になっていない: [${i}] ${mag} < ${prev}`);
    prev = mag;
  }
});

test('肉眼の段と双眼鏡の段は重ならない（等級の範囲も、同じ位置の星も）', () => {
  const naked = loadStars(), deep = loadDeep();
  let nakedMax = -Infinity;
  const pos = new Set();
  for (let i = 0; i < naked.count; i++) {
    nakedMax = Math.max(nakedMax, naked.stars[i * 4 + 2]);
    pos.add(`${naked.stars[i * 4]},${naked.stars[i * 4 + 1]}`);
  }
  assert.ok(nakedMax <= 650, `肉眼の段の最大 ${nakedMax}`);
  let dup = 0;
  for (let i = 0; i < deep.count; i++) if (pos.has(`${deep.stars[i * 4]},${deep.stars[i * 4 + 1]}`)) dup++;
  assert.equal(dup, 0, '同じ位置の星が両方の段にある');
});

test('stars.json は 2 段化の前とバイト単位で同じ（SHA-256）', async () => {
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256').update(readFileSync(join(ROOT, 'data', 'stars.json'))).digest('hex');
  assert.equal(h, '180cc81aac22371c6f5740070f1909b9c6006f84d0e161b95ae681cb4f710185');
});
