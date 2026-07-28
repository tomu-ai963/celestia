/**
 * frame.test.mjs — 全天体が「分点 of-date」に乗っていることの検証
 *
 * ■ なぜ春分の太陽で検査できるのか
 * 春分点は黄経の原点そのものなので、**春分の瞬間の太陽の視黄経が 0 になるのは
 * 分点 of-date のときだけ**。J2000 フレームのままだと一般歳差 p_A ぶん
 * （1900年で +1.394°、2050年で −0.699°）ずれる。P2 まではこの状態だった。
 *
 * ■ 春分の日時の出所
 * JPL Horizons の OBSERVER 表（quantity 31 = ObsEcLon, 視位置・of-date 黄経）を
 * 1800–2050 の各年3月について 10分刻みで取り、0° を跨ぐ点を線形補間した。
 * 取得コマンドは tools/fetch-horizons.mjs の `equinox` サブコマンドに残してある。
 * 2000年 03-20 07:35 UT / 2025年 03-20 09:01 UT など、公表値と一致する。
 *
 * ■ 比較する量
 * computeChart が返すのは平均分点の astrometric なので、そのままでは
 * 章動 Δψ（±17″）と年周光行差（20.5″）ぶん 0 からずれる。合計 37″ = 0.0104° で、
 * 目標の ±0.01° をぎりぎり超える。astro.apparentSunLon() でこの2つを足して
 * 視黄経に直してから比較している。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { julianDay, computeChart, apparentSunLon } from '../src/astro.mjs';
import { precessionDeg } from '../src/precession.mjs';

/** [年, 月, 日, 時, 分, 秒]（UT）— 上記の手順で得た春分の瞬間 */
const EQUINOX = [
  [1800, 3, 20, 20, 11, 33],
  [1850, 3, 20, 23,  1, 51],
  [1900, 3, 21,  1, 39,  5],
  [1950, 3, 21,  4, 35,  9],
  [2000, 3, 20,  7, 35, 16],
  [2025, 3, 20,  9,  1, 30],
  [2050, 3, 20, 10, 19, 45]
];

const jdOf = ([y, m, d, h, mi, s]) => julianDay(y, m, d, h, mi + s / 60, 0);
const signed = a => ((a % 360) + 540) % 360 - 180;

test('春分の瞬間の太陽の視黄経が 0° ± 0.01°（of-date であることの検査）', () => {
  const rows = [];
  for (const e of EQUINOX) {
    const err = signed(apparentSunLon(jdOf(e)));
    rows.push(`  ${e[0]}: ${(err * 3600).toFixed(1).padStart(7)}″  (${err.toFixed(5)}°)`);
    assert.ok(Math.abs(err) < 0.01,
      `${e[0]}年の春分で太陽視黄経 = ${err.toFixed(5)}°（${(err * 3600).toFixed(1)}″）`);
  }
  console.log('  春分の太陽視黄経の残差:\n' + rows.join('\n'));
});

test('J2000 のままなら同じ検査が 1900年で 1.39° 落ちる（統一前への回帰ガード）', () => {
  // computeChart から歳差を引き戻すと P2 の状態が再現できる。
  // この差が p_A と一致することで「ずれの正体が歳差である」ことも同時に確かめる
  for (const e of [EQUINOX[2], EQUINOX[6]]) {
    const jd = jdOf(e);
    const T = (jd - 2451545.0) / 36525;
    const ofDate = computeChart(jd, 0, 0).sun.lon;
    const asJ2000 = signed(ofDate - precessionDeg(T));
    assert.ok(Math.abs(asJ2000) > 0.5,
      `${e[0]}年: J2000 フレームなら ${asJ2000.toFixed(4)}° ずれるはず`);
    assert.ok(Math.abs(Math.abs(asJ2000) - Math.abs(precessionDeg(T))) < 0.02,
      `${e[0]}年: ずれ ${asJ2000.toFixed(4)}° が p_A ${precessionDeg(T).toFixed(4)}° と一致しない`);
  }
});

test('月・交点・リリスは変換せずそのまま of-date（二重に歳差をかけていない）', () => {
  // 平均交点は 1934.136261°/世紀 で逆行する。of-date の平均要素そのままなら
  // 18.6年周期がきれいに出る。歳差を余計にかけていれば周期がずれる
  const jd0 = julianDay(2000, 1, 1, 12, 0, 0);
  const per = 360 / 1934.136261 * 36525;              // 6798.4日
  const a = computeChart(jd0, 0, 0).node.lon;
  const b = computeChart(jd0 + per, 0, 0).node.lon;
  assert.ok(Math.abs(signed(b - a)) < 0.01, `交点の周期ずれ ${signed(b - a).toFixed(4)}°`);
});
