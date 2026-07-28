/**
 * precession.test.mjs — 歳差回転の符号と量の検証
 *
 * index.html は
 *   celestialGroup.rotation.y = precessionRad(T)
 * とし、星野・星座線は eclToThree() で座標を作る。このテストは同じ関数を import して
 * 3D側の座標で往復させるので、index.html 側の符号や座標規約を変えると失敗する
 * （参照実装を別に持たない）。rotateY だけは three.js の Object3D.rotation.y に
 * 相当する回転で、r128 の Matrix4.makeRotationY と同じ式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  precessionRad, precessionDeg, eclToThree, rotateY, threeToEcl,
  toDateLon, toJ2000Lon, PRECESSION_DEG_PER_CENTURY
} from '../src/precession.mjs';

// レグルス J2000 黄経・黄緯
const REGULUS = { lon: 149.83, lat: 0.47 };

/** J2000 の黄道座標を celestialGroup と同じ回転にかけ、見た目の黄経を逆算する */
const apparent = (lon, lat, T) => threeToEcl(rotateY(eclToThree(lon, lat), precessionRad(T)));

test('レグルスの当日黄経: 2050年 (T=+0.5) で 150.53° ± 0.05°', () => {
  const { lon, lat } = apparent(REGULUS.lon, REGULUS.lat, 0.5);
  assert.ok(Math.abs(lon - 150.53) < 0.05, `lon=${lon.toFixed(4)}`);
  assert.ok(Math.abs(lat - REGULUS.lat) < 0.01, `lat=${lat.toFixed(4)} (黄緯は不変のはず)`);
});

test('レグルスの当日黄経: 1800年 (T=-2) で 147.04° ± 0.05°', () => {
  const { lon } = apparent(REGULUS.lon, REGULUS.lat, -2);
  assert.ok(Math.abs(lon - 147.04) < 0.05, `lon=${lon.toFixed(4)}`);
});

test('T=0（J2000）では無回転で往復変換が恒等', () => {
  const { lon, lat } = apparent(REGULUS.lon, REGULUS.lat, 0);
  assert.ok(Math.abs(lon - REGULUS.lon) < 1e-9);
  assert.ok(Math.abs(lat - REGULUS.lat) < 1e-9);
});

test('3D側の見た目の黄経と toDateLon が一致する（回転と数値変換の整合）', () => {
  for (const T of [-2, -0.5, 0, 0.5]) {
    for (const lon of [0, 89.9, 179.5, 270.2, 359.7]) {
      const seen = apparent(lon, 0, T).lon;
      const want = toDateLon(lon, T);
      const d = Math.abs(((seen - want + 540) % 360) - 180);
      assert.ok(d < 1e-9, `T=${T} lon=${lon}: 3D=${seen.toFixed(6)} / 数値=${want.toFixed(6)}`);
    }
  }
});

test('toJ2000Lon は toDateLon の逆変換（IAU星座判定で使う向き）', () => {
  for (const T of [-2, 0.5]) {
    for (const lon of [0, 120.5, 359.9]) {
      const back = toJ2000Lon(toDateLon(lon, T), T);
      const d = Math.abs(((back - lon + 540) % 360) - 180);
      assert.ok(d < 1e-9, `T=${T} lon=${lon} → ${back}`);
    }
  }
});

test('歳差量は 1.39697°/世紀', () => {
  assert.equal(PRECESSION_DEG_PER_CENTURY, 1.39697);
  assert.ok(Math.abs(precessionDeg(1) - 1.39697) < 1e-12);
  assert.ok(Math.abs(precessionRad(1) - 1.39697 * Math.PI / 180) < 1e-15);
});
