/**
 * retrograde.test.mjs — 逆行判定の検証
 *
 * 基準値は公表されている 2025年の水星逆行の留（stations）。
 * 出典: Cafe Astrology / hermetikon の逆行カレンダー（度数まで一致する2ソースで確認）
 *   R 2025-03-15 06:46 UT (牡羊 9°35')  → D 2025-04-07 11:08 UT (魚 26°50')
 *   R 2025-07-18 04:34 UT (獅子 15°35') → D 2025-08-11 07:30 UT (獅子 4°15')
 *   R 2025-11-09 19:02 UT (射手 6°52')  → D 2025-11-29       (蠍 20°42')
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  julianDay, computeChart, lonRates, findStations, deltaLon, jdToUTC, BODIES
} from '../src/astro.mjs';

const JD_MIN = julianDay(1800, 1, 1, 0, 0, 0);
const JD_MAX = julianDay(2050, 12, 31, 23, 59, 0);

const fmt = jd => {
  const u = jdToUTC(jd);
  const p = n => String(n).padStart(2, '0');
  return `${u.y}-${p(u.m)}-${p(u.d)} ${p(u.h)}:${p(u.mi)} UT`;
};

test('水星逆行の留が公表値と ±1日以内で一致する（2025年の3サイクル）', () => {
  const expected = [
    { toRetro: true,  jd: julianDay(2025, 3, 15, 6, 46, 0) },
    { toRetro: false, jd: julianDay(2025, 4, 7, 11, 8, 0) },
    { toRetro: true,  jd: julianDay(2025, 7, 18, 4, 34, 0) },
    { toRetro: false, jd: julianDay(2025, 8, 11, 7, 30, 0) },
    { toRetro: true,  jd: julianDay(2025, 11, 9, 19, 2, 0) },
    { toRetro: false, jd: julianDay(2025, 11, 29, 12, 0, 0) }
  ];
  const got = findStations('mercury',
    julianDay(2025, 1, 1, 0, 0, 0), julianDay(2025, 12, 31, 0, 0, 0), 1);

  assert.equal(got.length, expected.length,
    `留の個数が違う: ${got.map(s => (s.toRetro ? 'R' : 'D') + fmt(s.jd)).join(', ')}`);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(got[i].toRetro, expected[i].toRetro, `${i}番目の留の向きが違う`);
    const diff = Math.abs(got[i].jd - expected[i].jd);
    assert.ok(diff < 1.0,
      `${i}番目の留: 計算 ${fmt(got[i].jd)} / 記録 ${fmt(expected[i].jd)} = ${diff.toFixed(3)}日差`);
  }
});

test('deltaLon が 0°/360° 境界で正しい符号を返す', () => {
  assert.ok(Math.abs(deltaLon(359.9, 0.1) - 0.2) < 1e-9, '境界を順行で越える → +0.2');
  assert.ok(Math.abs(deltaLon(0.1, 359.9) + 0.2) < 1e-9, '境界を逆行で戻る → -0.2');
  assert.ok(Math.abs(deltaLon(10, 20) - 10) < 1e-9);
  assert.ok(Math.abs(deltaLon(20, 10) + 10) < 1e-9);
});

test('0°/360° をまたぐ逆行区間で誤検出しない（2025年3-4月の水星）', () => {
  // 留の直後から直前まで、区間の内側だけを見る
  const start = julianDay(2025, 3, 15, 6, 46, 0) + 0.5;
  const end = julianDay(2025, 4, 7, 11, 8, 0) - 0.5;
  let minLon = 360, maxLon = 0, crossed = false, prevLon = null;

  for (let jd = start; jd <= end; jd += 0.25) {
    const lon = computeChart(jd, 0, 0).mercury.lon;
    const rate = lonRates(jd).mercury;
    assert.ok(rate < 0,
      `${fmt(jd)} で逆行のはずが rate=${rate.toFixed(4)}（境界またぎの誤検出）`);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    if (prevLon !== null && prevLon < 5 && lon > 355) crossed = true;
    prevLon = lon;
  }
  assert.ok(crossed && minLon < 1 && maxLon > 359,
    `この区間は 0°/360° をまたぐ想定: lon ${minLon.toFixed(2)}..${maxLon.toFixed(2)}`);
});

test('素朴な差分は境界で破綻する（deltaLon が必要な理由の回帰ガード）', () => {
  // 逆行中に 0° を通過する瞬間を探す（日付を決め打ちにしない）
  const dt = 0.5;
  let jd = null;
  for (let j = julianDay(2025, 3, 20, 0, 0, 0); j < julianDay(2025, 4, 7, 0, 0, 0); j += 0.05) {
    const lo = computeChart(j - dt, 0, 0).mercury.lon;
    const hi = computeChart(j + dt, 0, 0).mercury.lon;
    if (lo < 1 && hi > 359) { jd = j; break; }
  }
  assert.ok(jd !== null, '0°/360° をまたぐサンプル点が見つからない');
  const a = computeChart(jd - dt, 0, 0).mercury.lon;
  const b = computeChart(jd + dt, 0, 0).mercury.lon;
  assert.ok((b - a) > 300, '素朴な差分だと +350°/日 相当の順行に見えてしまう');
  assert.ok(deltaLon(a, b) < 0, 'deltaLon なら正しく逆行（負）になる');
});

test('太陽と月は常に順行（逆行しない）', () => {
  for (let jd = julianDay(2024, 1, 1, 0, 0, 0); jd < julianDay(2025, 1, 1, 0, 0, 0); jd += 3) {
    const r = lonRates(jd);
    assert.ok(r.sun > 0, `太陽が逆行: ${fmt(jd)}`);
    assert.ok(r.moon > 0, `月が逆行: ${fmt(jd)}`);
  }
});

test('1800–2050 を通しで計算しても破綻しない', () => {
  for (let jd = JD_MIN; jd <= JD_MAX; jd += 30) {
    const c = computeChart(jd, 35.68, 139.77);
    for (const b of BODIES) {
      const p = c[b.k];
      assert.ok(Number.isFinite(p.lon) && p.lon >= 0 && p.lon < 360,
        `${b.k} lon=${p.lon} @ ${fmt(jd)}`);
      assert.ok(Number.isFinite(p.lat) && Math.abs(p.lat) <= 90, `${b.k} lat=${p.lat} @ ${fmt(jd)}`);
      assert.ok(Number.isFinite(p.dist) && p.dist > 0, `${b.k} dist=${p.dist} @ ${fmt(jd)}`);
    }
    assert.ok(Number.isFinite(c._zenith.x + c._zenith.y + c._zenith.z));
  }
  // 速度計算も範囲全体で有限であること
  for (let jd = JD_MIN; jd <= JD_MAX; jd += 365) {
    const r = lonRates(jd);
    for (const b of BODIES) {
      assert.ok(Number.isFinite(r[b.k]), `${b.k} rate=${r[b.k]} @ ${fmt(jd)}`);
      assert.ok(Math.abs(r[b.k]) < 20, `${b.k} rate=${r[b.k]} が異常 @ ${fmt(jd)}`);
    }
  }
});

test('逆行判定が中心差分の刻み幅に依存しない（刻みを再生速度に連動させないための保険）', () => {
  // index.html の RATE_DT は固定値でなければならない。再生速度やフレーム間隔に
  // 連動させると一時停止中に h→0 となって 0/0 で壊れる。ここでは「妥当な刻みなら
  // どれでも同じ判定になる」ことを押さえ、刻みが判定の一部ではないことを示す。
  const dts = [0.1, 0.25, 0.5, 1.0];
  for (let jd = julianDay(2024, 1, 1, 0, 0, 0); jd < julianDay(2026, 1, 1, 0, 0, 0); jd += 6.3) {
    const ref = lonRates(jd, 0.5);
    for (const dt of dts) {
      const r = lonRates(jd, dt);
      for (const b of BODIES) {
        // 留の直近（速度がほぼ0）は刻みで符号が変わりうるので、そこは除く
        if (Math.abs(ref[b.k]) < 0.01) continue;
        assert.equal(r[b.k] < 0, ref[b.k] < 0,
          `${b.k} dt=${dt} で判定が変わる（${r[b.k].toFixed(5)} vs ${ref[b.k].toFixed(5)}）@ ${fmt(jd)}`);
      }
    }
  }
});

test('刻み幅 0 では速度が定義できない（連動させた場合に起きること）', () => {
  const jd = julianDay(2025, 6, 1, 0, 0, 0);
  const r = lonRates(jd, 0);
  assert.ok(Object.values(r).every(v => !Number.isFinite(v)),
    '刻み0で有限値が返っている — 0/0 が隠れている可能性');
});

test('ユリウス日の相互変換が往復する', () => {
  const cases = [[1800,1,1,0,0],[1990,7,14,9,30],[2000,1,1,12,0],[2025,3,15,6,46],[2050,12,31,23,59]];
  for (const [y,m,d,h,mi] of cases) {
    const u = jdToUTC(julianDay(y,m,d,h,mi,0));
    assert.deepEqual([u.y,u.m,u.d,u.h,u.mi], [y,m,d,h,mi], `${y}-${m}-${d} ${h}:${mi}`);
  }
});
