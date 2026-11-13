/**
 * galactic.test.mjs — 銀河座標と天の川の球（docs/rendering-upgrade.md D.3〜D.5）
 * 期待値は設計書 D.5 の基準点の表。許容は 0.001°（UV は 0.00001）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAL_TO_THREE, galToThree, equatorialToGalactic, galacticUV, galacticSphere, REFERENCE_POINTS
} from '../src/galactic.mjs';
import { eclToThree } from '../src/precession.mjs';
import { equatorialToEcliptic } from '../tools/build-stars.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const dl = (a, b) => ((a - b + 540) % 360) - 180;   // 経度の差（−180〜180）

// [k, l, b, λ, β, u, v]（l が null の行は極で経度が定まらない）
const D5 = [
  ['gc', 0.0000, 0.0000, 266.840, -5.536, 0.50000, 0.50000],
  ['sgra', 359.9442, -0.0462, 266.852, -5.608, 0.50015, 0.49974],
  ['ngp', null, 90, 180.023, 29.811, null, 1.00000],
  ['sgp', null, -90, 0.023, -29.811, null, 0.00000],
  ['gac', 180, 0, 86.840, 5.536, null, 0.50000],
  ['lmc', 280.4652, -32.8885, 312.510, -85.351, 0.72093, 0.31729],
  ['m31', 121.1743, -21.5734, 27.849, 33.349, 0.16340, 0.38015],
  ['acrux', 300.1266, -0.3627, 221.870, -52.879, 0.66632, 0.49798],
  ['sirius', 227.2303, -8.8903, 104.082, -39.605, 0.86880, 0.45061],
  ['antares', 351.9471, 15.0643, 249.762, -4.570, 0.52237, 0.58369],
  ['deneb', 84.2847, 1.9975, 335.329, 59.906, 0.26588, 0.51110],
];

test('赤道 → 銀河座標が D.5 の表と 0.001° で一致する', () => {
  for (const [k, l, b] of D5) {
    const p = REFERENCE_POINTS.find(x => x.k === k);
    const g = equatorialToGalactic(p.ra, p.dec);
    close(g.b, b, 0.001, `${k} b`);
    if (l !== null) close(dl(g.l, l), 0, 0.001, `${k} l`);
  }
});

test('赤道 → 黄道（星のデータと同じ変換）が D.5 の表と一致する', () => {
  for (const [k, , , lam, bet] of D5) {
    const p = REFERENCE_POINTS.find(x => x.k === k);
    const e = equatorialToEcliptic(p.ra / 15, p.dec);
    close(dl(e.lon, lam), 0, 0.001, `${k} λ`);
    close(e.lat, bet, 0.001, `${k} β`);
  }
});

test('テクスチャ座標が D.5 の表と一致する（左右の反転の検査: 大マゼラン雲は u = 0.72）', () => {
  for (const [k, , , , , u, v] of D5) {
    const p = REFERENCE_POINTS.find(x => x.k === k);
    const g = equatorialToGalactic(p.ra, p.dec);
    const t = galacticUV(g.l, g.b);
    close(t.v, v, 0.00001, `${k} v`);
    if (u !== null) close(t.u, u, 0.00001, `${k} u`);
  }
  assert.ok(galacticUV(280.4652, -32.8885).u > 0.5, '大マゼラン雲が中央より右');
  close(galacticUV(180, 0).u, 0, 1e-12, '反銀河中心');
});

test('銀河 → three.js の回転行列の列が D.3 の値と一致し、正規直交である', () => {
  const M = GAL_TO_THREE, col = j => [M[j], M[3 + j], M[6 + j]];
  const want = [[-0.0549, -0.0965, 0.9938], [0.4941, 0.8623, 0.1110], [-0.8677, 0.4971, 0.0004]];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) close(col(j)[i], want[j][i], 0.0001, `列${j}[${i}]`);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const d = col(a).reduce((s, v, i) => s + v * col(b)[i], 0);
    close(d, a === b ? 1 : 0, 1e-12, `直交 ${a}${b}`);
  }
  // 行列式 +1（鏡像を含まない）
  const [a, b, c, d, e, f, g, h, i] = M;
  close(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g), 1, 1e-12, 'det');
});

test('銀河座標から求めた three.js の位置が、星と同じ経路（赤道 → 黄道 → eclToThree）と一致する', () => {
  for (const p of REFERENCE_POINTS) {
    const g = equatorialToGalactic(p.ra, p.dec), e = equatorialToEcliptic(p.ra / 15, p.dec);
    const a = galToThree(g.l, g.b, 1600), b = eclToThree(e.lon, e.lat, 1600);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // 半径 1600 で 1e-6 ＝ 角度で 3.6e-8°（極では asin の丸めで 1e-7 程度まで出る）
    assert.ok(d < 1e-6, `${p.k}: ${d}`);
  }
});

test('球のメッシュ: (0°, 0°) の頂点の位置と UV、継ぎ目の u、三角形の表が外向き', () => {
  const R = 1660, nLon = 180, nLat = 90, s = galacticSphere(R, nLon, nLat);
  assert.equal(s.positions.length, (nLon + 1) * (nLat + 1) * 3);
  assert.equal(s.indices.length, nLon * nLat * 6);
  const k = 45 * (nLon + 1) + 90;                       // b = 0, l = 0
  const p = galToThree(0, 0, R);
  for (let i = 0; i < 3; i++) close(s.positions[k * 3 + i], p[i], 1e-3, `pos[${i}]`);
  close(s.uvs[k * 2], 0.5, 1e-12, 'u'); close(s.uvs[k * 2 + 1], 0.5, 1e-12, 'v');
  const row = 45 * (nLon + 1);
  close(s.uvs[row * 2], 1, 1e-12, 'l = −180 は u = 1'); close(s.uvs[(row + nLon) * 2], 0, 1e-12, 'l = +180 は u = 0');
  // 継ぎ目の 2 つの頂点は同じ位置
  for (let i = 0; i < 3; i++) close(s.positions[row * 3 + i], s.positions[(row + nLon) * 3 + i], 1e-3, `継ぎ目[${i}]`);
  // 赤道付近の三角形はすべて外向き（法線と位置の内積が正）
  let bad = 0;
  for (let t = 0; t < s.indices.length; t += 3) {
    const [a, b, c] = [s.indices[t], s.indices[t + 1], s.indices[t + 2]].map(i => [0, 1, 2].map(j => s.positions[i * 3 + j]));
    const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n); if (len < 1e-6) continue;   // 極の縮退した三角形
    if (n[0] * a[0] + n[1] * a[1] + n[2] * a[2] <= 0) bad++;
  }
  assert.equal(bad, 0, '内向きの三角形');
});
