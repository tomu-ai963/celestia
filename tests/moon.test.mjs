/**
 * moon.test.mjs — 月の級数の精度
 *
 * P2 までは短縮ELP級数（黄経19項 / 黄緯9項 / 距離5項）を使い、README には
 * 「精度は黄経で概ね ±0.01°」と**推測で**書いていた。ここで実測する。
 *
 * 本体は Meeus 完全版（黄経・距離 60項 + 黄緯 60項）に差し替え済みで、
 * moonPosShort は比較のためだけに残してある。Horizons との突き合わせは
 * tests/horizons.test.mjs 側（月も含めている）。
 *
 * 光行時間について: 月までの光行時間は約1.28秒、月の運動は 13.18°/日 なので
 * 見かけの遅れは 0.7″。惑星（金星で 42″）と違って無視できるので、
 * moon.mjs でも astro.mjs でも月には光行時間補正をかけていない。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moonPos, moonPosShort } from '../src/moon.mjs';
import { julianDay } from '../src/astro.mjs';

const signed = a => ((a % 360) + 540) % 360 - 180;

/** 1800–2050 を 3.7日刻みで走査（朔望月・近点月と共通因数を持たない刻み） */
function scan(fn) {
  const jd0 = julianDay(1800, 1, 1, 12, 0, 0), jd1 = julianDay(2050, 12, 31, 12, 0, 0);
  let maxLon = 0, maxLat = 0, maxDist = 0, sumLon = 0, n = 0, atLon = 0;
  for (let jd = jd0; jd <= jd1; jd += 3.7) {
    const T = (jd - 2451545.0) / 36525;
    const a = moonPos(T), b = moonPosShort(T);
    const dl = Math.abs(signed(b.lon - a.lon));
    if (dl > maxLon) { maxLon = dl; atLon = jd; }
    maxLat = Math.max(maxLat, Math.abs(b.lat - a.lat));
    maxDist = Math.max(maxDist, Math.abs(b.dist - a.dist) * 149597870.7);
    sumLon += dl; n++;
    if (fn) fn(a, b, T);
  }
  return { maxLon, maxLat, maxDist, meanLon: sumLon / n, n, atLon };
}

test('短縮級数と Meeus 完全版の差を実測する（READMEの精度記述の根拠）', () => {
  const r = scan();
  console.log(`  1800–2050 を ${r.n} 点で走査（短縮19項 − 完全60項）:\n`
    + `    黄経  最大 ${r.maxLon.toFixed(4)}° (${(r.maxLon * 60).toFixed(1)}′) / 平均 ${r.meanLon.toFixed(4)}°\n`
    + `    黄緯  最大 ${r.maxLat.toFixed(4)}° (${(r.maxLat * 60).toFixed(1)}′)\n`
    + `    距離  最大 ${r.maxDist.toFixed(0)} km`);
  // 「±0.01°程度」という当初の想定に対する実測。想定を大きく超えるので
  // 本体を完全版へ差し替えた。この数値が README に書いてある値
  assert.ok(r.maxLon > 0.01,
    `短縮級数の黄経差が想定内(±0.01°)に収まってしまった: ${r.maxLon}° — READMEの記述を見直すこと`);
  assert.ok(r.maxLon < 0.30, `想定より大きすぎる: ${r.maxLon}°`);
});

test('完全版の主要項が短縮版と一致する（転記ミスの検出）', () => {
  // 短縮版は完全版の上位19項なので、加算項の効かない条件で差は小さいはず。
  // 桁を間違えて転記していれば度のオーダーでずれる
  const r = scan();
  assert.ok(r.meanLon < 0.05, `平均差 ${r.meanLon.toFixed(4)}° が大きすぎる（転記ミスの疑い）`);
  assert.ok(r.maxLat < 0.05, `黄緯の最大差 ${r.maxLat.toFixed(4)}°`);
});

test('月の黄経は単調増加（逆行しない）', () => {
  const jd0 = julianDay(2000, 1, 1, 0, 0, 0);
  for (let i = 0; i < 400; i++) {
    const T0 = (jd0 + i * 0.5 - 2451545.0) / 36525;
    const T1 = (jd0 + i * 0.5 + 0.5 - 2451545.0) / 36525;
    assert.ok(signed(moonPos(T1).lon - moonPos(T0).lon) > 0, `i=${i}`);
  }
});

test('距離と黄緯が物理的な範囲に収まる', () => {
  const AU = 149597870.7;
  for (let jd = julianDay(1800, 1, 1, 12, 0, 0); jd < julianDay(2050, 1, 1, 12, 0, 0); jd += 11.3) {
    const m = moonPos((jd - 2451545.0) / 36525);
    const km = m.dist * AU;
    assert.ok(km > 356000 && km < 407000, `距離 ${km.toFixed(0)} km @ JD${jd}`);
    assert.ok(Math.abs(m.lat) < 5.4, `黄緯 ${m.lat}° @ JD${jd}`);
  }
});
