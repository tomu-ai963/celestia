/**
 * precession.test.mjs — 歳差変換の符号と量の検証
 *
 * index.html は
 *   celestialGroup.matrix = precessionMatrixThree(T)
 * とし、星野・星座線は eclToThree() で座標を作る。このテストは同じ関数を import して
 * 3D側の座標で往復させるので、index.html 側の符号や座標規約を変えると失敗する
 * （参照実装を別に持たない）。applyMatrixThree は three.js を読み込まずに
 * Matrix4 の適用を再現するためだけのもの。
 *
 * P3 で単純な Y 回転から Meeus 21.3 の3回転へ差し替えたが、P1.5 で確定した
 * 「2050年 150.53° / 1800年 147.04°」の数値と符号はそのまま通る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  precessionDeg, precessEcl, precessEclInv, precessVec, precessionMatrixThree,
  eclToThree, threeToEcl, applyMatrixThree, toDateLon, toJ2000Lon, P_A
} from '../src/precession.mjs';

// レグルス J2000 黄経・黄緯
const REGULUS = { lon: 149.83, lat: 0.47 };

/** J2000 の黄道座標を celestialGroup と同じ行列にかけ、見た目の黄経を逆算する */
const apparent = (lon, lat, T) =>
  threeToEcl(applyMatrixThree(eclToThree(lon, lat), precessionMatrixThree(T)));

test('レグルスの当日黄経: 2050年 (T=+0.5) で 150.53° ± 0.05°', () => {
  const { lon, lat } = apparent(REGULUS.lon, REGULUS.lat, 0.5);
  assert.ok(Math.abs(lon - 150.53) < 0.05, `lon=${lon.toFixed(4)}`);
  assert.ok(Math.abs(lat - REGULUS.lat) < 0.01, `lat=${lat.toFixed(4)}`);
});

test('レグルスの当日黄経: 1800年 (T=-2) で 147.04° ± 0.05°', () => {
  const { lon } = apparent(REGULUS.lon, REGULUS.lat, -2);
  assert.ok(Math.abs(lon - 147.04) < 0.05, `lon=${lon.toFixed(4)}`);
});

test('T=0（J2000）では無変換で往復が恒等', () => {
  const { lon, lat } = apparent(REGULUS.lon, REGULUS.lat, 0);
  assert.ok(Math.abs(lon - REGULUS.lon) < 1e-9);
  assert.ok(Math.abs(lat - REGULUS.lat) < 1e-9);
});

test('3D側の見た目の黄経と precessEcl が一致する（行列と数値変換の整合）', () => {
  for (const T of [-2.5, -2, -0.5, 0, 0.5]) {
    for (const [lon, lat] of [[0, 0], [89.9, 12], [179.5, -30], [270.2, 5], [359.7, 0]]) {
      const seen = apparent(lon, lat, T);
      const want = precessEcl(lon, lat, T);
      const dl = Math.abs(((seen.lon - want.lon + 540) % 360) - 180);
      assert.ok(dl < 1e-9, `T=${T} lon=${lon}: 3D=${seen.lon} / 数値=${want.lon}`);
      assert.ok(Math.abs(seen.lat - want.lat) < 1e-9, `T=${T} lat`);
    }
  }
});

test('ベクトル版と角度版が一致する（惑星側と星野側が同じ変換に乗る）', () => {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  for (const T of [-2, -1, 0.5]) {
    for (const [lon, lat] of [[149.83, 0.47], [23.4, -8.2], [300, -25]]) {
      const v = precessVec({
        x: Math.cos(lat * D2R) * Math.cos(lon * D2R),
        y: Math.cos(lat * D2R) * Math.sin(lon * D2R),
        z: Math.sin(lat * D2R)
      }, T);
      const want = precessEcl(lon, lat, T);
      const gotLon = ((Math.atan2(v.y, v.x) * R2D % 360) + 360) % 360;
      const gotLat = Math.asin(v.z / Math.hypot(v.x, v.y, v.z)) * R2D;
      assert.ok(Math.abs(((gotLon - want.lon + 540) % 360) - 180) < 1e-9);
      assert.ok(Math.abs(gotLat - want.lat) < 1e-9);
    }
  }
});

test('precessEclInv は precessEcl の逆変換（IAU星座判定で使う向き）', () => {
  for (const T of [-2.5, -2, 0.5]) {
    for (const [lon, lat] of [[0, 0], [120.5, 4], [359.9, -3]]) {
      const f = precessEcl(lon, lat, T);
      const b = precessEclInv(f.lon, f.lat, T);
      assert.ok(Math.abs(((b.lon - lon + 540) % 360) - 180) < 1e-9, `T=${T} lon=${lon} → ${b.lon}`);
      assert.ok(Math.abs(b.lat - lat) < 1e-9);
      // 黄経だけ版（toDateLon/toJ2000Lon）は行きで生じた黄緯を捨てるので厳密には
      // 恒等でない。実測の最大は 1750–2050 全域・全黄経で 0.034″。
      // iauConst() は黄道上の目盛りを引くのにしか使わないので、この程度で足りる
      const rt = Math.abs(((toJ2000Lon(toDateLon(lon, T), T) - lon + 540) % 360) - 180);
      assert.ok(rt < 0.1 / 3600, `黄経のみ往復 ${(rt * 3600).toFixed(4)}″`);
    }
  }
});

test('一般歳差 p_A は IAU2006 の 5028.796195″T + 1.1054348″T²', () => {
  assert.deepEqual(P_A, [5028.796195, 1.1054348]);
  // 1世紀で 1.39689°（P1.5 まで使っていた IAU1976 の 1.39697° との差は 0.3″/世紀）
  assert.ok(Math.abs(precessionDeg(1) - (5028.796195 + 1.1054348) / 3600) < 1e-12);
  // 二次項は 1800年（T=-2）で 4.4″ — ±1′ の目標には効かないが明示して持つ
  const quad = 1.1054348 * 4;
  assert.ok(Math.abs(quad - 4.42) < 0.01, `${quad}`);
});

test('黄道面の移動を無視した単純なZ回転では黄緯が最大1.6′ずれる', () => {
  // 「p_A だけの回転で足りるか」を測って残したもの。足りないのでMeeus 21.3 を使っている
  let worst = 0;
  for (const T of [-2.5, -2, 0.5]) {
    for (const lat of [-30, -5, 0, 5, 30]) {
      for (let lon = 0; lon < 360; lon += 30) {
        const full = precessEcl(lon, lat, T);
        worst = Math.max(worst, Math.abs(full.lat - lat));   // Z回転なら黄緯は不変
      }
    }
  }
  assert.ok(worst > 0.015, `Z回転との黄緯差の最大 = ${(worst * 60).toFixed(2)}′`);
});
