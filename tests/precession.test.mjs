/**
 * precession.test.mjs — 歳差回転の符号と量の検証
 *
 * celestialGroup.rotation.y = precessionDeg(T)*π/180 が「J2000 の星野を
 * 当日の黄経へ回す」ことを、three.js 側の座標系（rotation.y と同一の回転）で
 * 逆算して確認する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  precessionDeg, eclToThree, rotateYDeg, threeToEcl
} from '../tools/precession.mjs';

// レグルス J2000 黄経・黄緯
const REGULUS = { lon: 149.83, lat: 0.47 };

test('レグルスの当日黄経: 2050年 (T=+0.5) で 150.53° ± 0.05°', () => {
  const v = rotateYDeg(eclToThree(REGULUS.lon, REGULUS.lat), precessionDeg(0.5));
  const { lon, lat } = threeToEcl(v);
  assert.ok(Math.abs(lon - 150.53) < 0.05, `lon=${lon.toFixed(4)}`);
  assert.ok(Math.abs(lat - REGULUS.lat) < 0.01, `lat=${lat.toFixed(4)} (黄緯は不変のはず)`);
});

test('レグルスの当日黄経: 1800年 (T=-2) で 147.04° ± 0.05°', () => {
  const v = rotateYDeg(eclToThree(REGULUS.lon, REGULUS.lat), precessionDeg(-2));
  const { lon } = threeToEcl(v);
  assert.ok(Math.abs(lon - 147.04) < 0.05, `lon=${lon.toFixed(4)}`);
});

test('T=0（J2000）では無回転で往復変換が恒等', () => {
  const v = rotateYDeg(eclToThree(REGULUS.lon, REGULUS.lat), precessionDeg(0));
  const { lon, lat } = threeToEcl(v);
  assert.ok(Math.abs(lon - REGULUS.lon) < 1e-9);
  assert.ok(Math.abs(lat - REGULUS.lat) < 1e-9);
});
