/**
 * starlight.test.mjs — 星の明るさ・大きさ・色とトーンカーブ（docs/rendering-upgrade.md B.2〜B.4）
 * 期待値は設計書の表の値。シェーダは同じ式を写しているので、ここで式を固定する
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAR_DEFAULTS, BINOCULAR, sigmaMin, limitFade, starFlux, starShape, pointSize, starProfile,
  toneCurve, displayValue, bvToTemperature, temperatureToXY, bvToLinearRGB, luminance
} from '../src/starlight.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('等級 → フラックス・ピーク・幅・画面の値が B.2 の表と一致する（肉眼モード）', () => {
  // [等級, F, ピーク, σ, 画面の値]
  const rows = [
    [-1.44, 59.70, 4.00, 3.09, 255], [0, 15.85, 4.00, 1.59, 255], [1, 6.31, 4.00, 1.00, 255],
    [2, 2.51, 2.51, 0.80, 255], [3, 1.00, 1.00, 0.80, 244], [4, 0.398, 0.398, 0.80, 169],
    [5, 0.158, 0.158, 0.80, 111], [6, 0.063, 0.063, 0.80, 71], [6.5, 0.040, 0.040, 0.80, 56],
  ];
  for (const [m, F, peak, sigma, v] of rows) {
    const f = starFlux(m);
    const s = starShape(f, { sigma0: 0.8 });
    close(f, F, F * 0.002 + 0.0005, `F(${m})`);
    close(s.peak, peak, peak * 0.002 + 0.0005, `peak(${m})`);
    close(s.sigma, sigma, 0.005, `sigma(${m})`);
    assert.equal(displayValue(s.peak), v, `画面の値(${m})`);
  }
});

test('双眼鏡モード（m_white 4.5）: 8.0 等が 56、6.5 等が 111、シリウスの σ が 6.17 px', () => {
  assert.equal(displayValue(starFlux(8.0, { magWhite: BINOCULAR.magWhite })), 56);
  assert.equal(displayValue(starFlux(6.5, { magWhite: BINOCULAR.magWhite })), 111);
  close(starShape(starFlux(-1.44, { magWhite: 4.5 }), { sigma0: 0.8 }).sigma, 6.17, 0.005, 'σ');
});

test('ピークの頭打ちでも総光量 2πσ²·peak は 2πσ0²·F のまま（Pogson の式が保たれる）', () => {
  for (const m of [-1.44, 0, 1, 2.5, 4, 6.5]) {
    for (const sigma0 of [0.8, 1.4]) {
      const F = starFlux(m), s = starShape(F, { sigma0 });
      close(s.sigma ** 2 * s.peak, sigma0 ** 2 * F, 1e-9 * F, `総光量(${m}, σ0=${sigma0})`);
    }
  }
  // 0.5 等ごとに総光量の比は 10^0.2
  const tot = m => { const s = starShape(starFlux(m), { sigma0: 0.8 }); return s.sigma ** 2 * s.peak; };
  close(tot(1.0) / tot(1.5), 10 ** 0.2, 1e-9, '比');
});

test('最小の幅と点の大きさ', () => {
  assert.equal(sigmaMin(1), 0.8);
  close(sigmaMin(2), 1.4, 1e-12, 'pixelRatio 2');
  close(pointSize(0.8), 5.8, 1e-12, '最小の点');
  assert.equal(pointSize(6.17, 32), 32);
  close(starProfile(0, 2, 0.8), 2, 1e-12, '中心');
  close(starProfile(0.8, 1, 0.8), Math.exp(-0.5), 1e-12, '1σ');
});

test('表示限界のフェードは m_limit − 0.5 から m_limit で 1 → 0', () => {
  assert.equal(limitFade(6.5, 7.0), 1);
  assert.equal(limitFade(7.0, 7.0), 0);
  close(limitFade(6.75, 7.0), 0.5, 1e-12, '中点');
  // 肉眼の段の上限 6.5 等は既定の限界 7.0 で欠けない
  assert.equal(starFlux(6.5, { magLimit: STAR_DEFAULTS.magLimit }), starFlux(6.5));
});

test('トーンカーブ: B.4.3 の「自前」の列と一致し、knee まで恒等・knee で傾き 1', () => {
  const rows = [[0.0063, 19], [0.0158, 34], [0.040, 56], [0.18, 118], [0.75, 225], [1.0, 244], [4.0, 255]];
  for (const [x, v] of rows) assert.equal(displayValue(x), v, `x=${x}`);
  assert.equal(toneCurve(0.5), 0.5);
  const h = 1e-6;
  close((toneCurve(0.75 + h) - toneCurve(0.75)) / h, 1, 1e-5, '傾き');
  assert.ok(toneCurve(2) < 1 && toneCurve(100) <= 1 && toneCurve(100) > 0.999);
});

test('B−V → 温度 → 色が B.3 の表と一致する（s = 1）', () => {
  // [B−V, T, r, g, b]
  const rows = [
    [-0.3, 16602, 0.77, 0.99, 1.76], [0.0, 10125, 0.87, 0.99, 1.44], [0.65, 5778, 1.11, 0.98, 0.91],
    [1.5, 3794, 1.47, 0.91, 0.48], [2.0, 3169, 1.69, 0.86, 0.32],
  ];
  for (const [bv, T, r, g, b] of rows) {
    close(bvToTemperature(bv), T, 0.5, `T(${bv})`);
    const c = bvToLinearRGB(bv, 1);
    close(c[0], r, 0.006, `r(${bv})`); close(c[1], g, 0.006, `g(${bv})`); close(c[2], b, 0.006, `b(${bv})`);
  }
  const w = temperatureToXY(6500);
  close(w.x, 0.3135, 0.0001, 'x(6500K)'); close(w.y, 0.3237, 0.0001, 'y(6500K)');
});

test('色は輝度 1 にそろい、明るさは等級だけで決まる。色域の外は白を混ぜて収める', () => {
  for (let bv = -0.4; bv <= 2.5; bv += 0.1) {
    for (const s of [1, 0.85]) {
      const c = bvToLinearRGB(bv, s);
      close(luminance(...c), 1, 1e-12, `輝度(${bv.toFixed(1)}, s=${s})`);
      assert.ok(c.every(v => v >= 0), `負のチャンネル(${bv.toFixed(1)})`);
    }
  }
  // 色指数の欠けた星の代用値 0.63 も扱える
  assert.ok(bvToLinearRGB(0.63).every(Number.isFinite));
});
