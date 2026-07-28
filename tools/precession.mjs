/**
 * precession.mjs — 歳差回転の参照実装
 *
 * index.html の celestialGroup（天球固定レイヤーの親グループ）は
 *   celestialGroup.rotation.y = precessionDeg(T) * π/180
 * で回す。このモジュールは three.js と同じ座標規約
 *   黄道直交 (x,y,z) → three.js (X,Y,Z) = (x, z, -y)、黄道極 = +Y
 * と同じ回転（rotation.y）を再現し、符号が正しいことをテストで保証する。
 */
export const PRECESSION_DEG_PER_CENTURY = 1.39697;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm = a => ((a % 360) + 360) % 360;

/** J2000 からの経過ユリウス世紀 T → 適用する歳差角（度） */
export function precessionDeg(T) {
  return PRECESSION_DEG_PER_CENTURY * T;
}

/** 黄道座標（度）→ three.js 単位ベクトル [X, Y, Z] = (x, z, -y) */
export function eclToThree(lonDeg, latDeg) {
  const lon = lonDeg * D2R, lat = latDeg * D2R;
  const x = Math.cos(lat) * Math.cos(lon);
  const y = Math.cos(lat) * Math.sin(lon);
  const z = Math.sin(lat);
  return [x, z, -y];
}

/** three.js の rotation.y と同一の回転（右手系 Y 軸まわり、角度は度） */
export function rotateYDeg([X, Y, Z], deg) {
  const t = deg * D2R, c = Math.cos(t), s = Math.sin(t);
  return [X * c + Z * s, Y, -X * s + Z * c];
}

/** three.js ベクトル → 黄道座標（度）へ逆変換 */
export function threeToEcl([X, Y, Z]) {
  const x = X, y = -Z, z = Y;
  return {
    lon: norm(Math.atan2(y, x) * R2D),
    lat: Math.asin(Math.max(-1, Math.min(1, z))) * R2D
  };
}
