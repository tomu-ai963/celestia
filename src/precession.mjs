/**
 * precession.mjs — 歳差と、黄道 ⇄ three.js の座標規約
 *
 * index.html とテストの両方がこのモジュールを参照する（実装はここ1箇所だけ）。
 * 星野・星座線・IAU境界・天の川は J2000 で構築し、天球固定の親グループごと
 *   celestialGroup.rotation.y = precessionRad(T)
 * で回して当日の座標系に合わせる。惑星側は計算時点で当日座標なので回さない。
 */
export const PRECESSION_DEG_PER_CENTURY = 1.39697;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm = a => ((a % 360) + 360) % 360;

/** J2000 からの経過ユリウス世紀 T → 歳差角（度） */
export function precessionDeg(T) {
  return PRECESSION_DEG_PER_CENTURY * T;
}

/** 同上（ラジアン）。three.js の rotation.y にそのまま代入する値 */
export function precessionRad(T) {
  return precessionDeg(T) * D2R;
}

/** J2000 黄経 → 当日黄経 */
export function toDateLon(lonJ2000, T) {
  return norm(lonJ2000 + precessionDeg(T));
}

/** 当日黄経 → J2000 黄経（IAU星座の判定など、J2000固定のデータと突き合わせる用） */
export function toJ2000Lon(lonOfDate, T) {
  return norm(lonOfDate - precessionDeg(T));
}

/**
 * 黄道座標（度）→ three.js 座標 [X, Y, Z]。
 * 黄道直交 (x, y, z) を (x, z, -y) に写す規約で、黄道極が +Y を向く。
 * index.html の星野・星座線・天の川・天体配置がすべてこの関数を使う。
 */
export function eclToThree(lonDeg, latDeg, r = 1) {
  const lon = lonDeg * D2R, lat = latDeg * D2R;
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon) * r, Math.sin(lat) * r, -cl * Math.sin(lon) * r];
}

/** 黄道直交ベクトル → three.js 座標（正規化はしない） */
export function eclVecToThree(x, y, z, s = 1) {
  return [x * s, z * s, -y * s];
}

/** three.js 座標 → 黄道座標（度）。回転後の見た目の黄経を逆算する用 */
export function threeToEcl([X, Y, Z]) {
  const x = X, y = -Z, z = Y;
  const r = Math.hypot(x, y, z) || 1;
  return {
    lon: norm(Math.atan2(y, x) * R2D),
    lat: Math.asin(Math.max(-1, Math.min(1, z / r))) * R2D
  };
}

/**
 * Y軸まわりの回転。three.js r128 の Matrix4.makeRotationY（= Object3D.rotation.y）と
 * 同じ式で、テストが「実際に代入している precessionRad の符号」を検証するために使う。
 */
export function rotateY([X, Y, Z], rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [X * c + Z * s, Y, -X * s + Z * c];
}
