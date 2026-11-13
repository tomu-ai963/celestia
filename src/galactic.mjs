/**
 * galactic.mjs — 銀河座標と、天の川のテクスチャを貼る球（docs/rendering-upgrade.md D.3〜D.5）
 *
 * 画像（NASA SVS Deep Star Maps 2020 の milkyway_2020_4k_gal）は銀河座標 (l, b) の正距円筒で、
 * 中心が (0°, 0°)、経度は左へ増える。テクスチャ座標は
 *   u = 0.5 − l′/360   （l′ は l を −180°〜+180° に直した値）
 *   v = 0.5 + b/180    （上が北。three.js の画像テクスチャは既定で上の行が v = 1）
 *
 * 銀河 → 赤道（J2000/ICRS）→ 黄道（J2000）→ three.js の変換は、星（src/precession.mjs の eclToThree）と
 * 同じ規約に乗せる。銀河北極と銀河中心の値は Hipparcos の定義（SVS の画像も同じ変換。2021-01-04 更新）。
 */
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const cos = d => Math.cos(d * D2R), sin = d => Math.sin(d * D2R);

export const OBLIQUITY = 23.4392911;               // 黄道傾斜角 ε（J2000）。build-stars.mjs と同じ
export const NGP = { ra: 192.85948, dec: 27.12825 }; // 銀河北極（J2000）
export const GC = { ra: 266.40500, dec: -28.93617 }; // 銀経 0°・銀緯 0°（J2000）

const eqVec = (ra, dec) => [cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 銀河座標の基底を赤道直交座標で表したもの。x_g は z_g に直交化する（カタログ値の丸めの補正） */
export const GAL_BASIS_EQ = (() => {
  const zg = eqVec(NGP.ra, NGP.dec);
  let xg = eqVec(GC.ra, GC.dec);
  const d0 = dot(xg, zg);
  xg = xg.map((v, i) => v - zg[i] * d0);
  const xl = Math.hypot(...xg); xg = xg.map(v => v / xl);
  const yg = [zg[1] * xg[2] - zg[2] * xg[1], zg[2] * xg[0] - zg[0] * xg[2], zg[0] * xg[1] - zg[1] * xg[0]];
  return { xg, yg, zg };
})();

/** 赤道直交 → 黄道直交（J2000） */
function eqToEcl(q) {
  return [q[0], q[1] * cos(OBLIQUITY) + q[2] * sin(OBLIQUITY), -q[1] * sin(OBLIQUITY) + q[2] * cos(OBLIQUITY)];
}
/** 黄道直交 → three.js（src/precession.mjs の eclVecToThree と同じ (x, z, −y)） */
const eclToThreeVec = e => [e[0], e[2], -e[1]];

/** 銀河座標 (l, b)[度] → 赤道直交の単位ベクトル */
export function galToEqVec(l, b) {
  const { xg, yg, zg } = GAL_BASIS_EQ, cb = cos(b);
  return [0, 1, 2].map(i => xg[i] * cb * cos(l) + yg[i] * cb * sin(l) + zg[i] * sin(b));
}

/**
 * 銀河座標 → three.js の座標を 1 つの回転行列にまとめたもの（列ごとに銀河の基底の行き先）。
 * 要素は行優先の [m00, m01, m02, m10, …]
 */
export const GAL_TO_THREE = (() => {
  const { xg, yg, zg } = GAL_BASIS_EQ;
  const cx = eclToThreeVec(eqToEcl(xg)), cy = eclToThreeVec(eqToEcl(yg)), cz = eclToThreeVec(eqToEcl(zg));
  return [cx[0], cy[0], cz[0], cx[1], cy[1], cz[1], cx[2], cy[2], cz[2]];
})();

/** 銀河座標 (l, b)[度] → three.js の座標（半径 r） */
export function galToThree(l, b, r = 1) {
  const g = [cos(b) * cos(l), cos(b) * sin(l), sin(b)], M = GAL_TO_THREE;
  return [0, 1, 2].map(i => r * (M[i * 3] * g[0] + M[i * 3 + 1] * g[1] + M[i * 3 + 2] * g[2]));
}

/** 赤道座標 (α, δ)[度, J2000] → 銀河座標 (l, b)[度]。l は 0〜360 */
export function equatorialToGalactic(ra, dec) {
  const q = eqVec(ra, dec), { xg, yg, zg } = GAL_BASIS_EQ;
  const x = dot(q, xg), y = dot(q, yg), z = dot(q, zg);
  const l = Math.atan2(y, x) * R2D;
  return { l: ((l % 360) + 360) % 360, b: Math.asin(Math.max(-1, Math.min(1, z))) * R2D };
}

/** 銀河座標 → テクスチャ座標。l′ = l を −180〜+180 に直した値。l = ±180° は u = 0 と 1 の両方に当たる */
export function galacticUV(l, b) {
  let lp = ((l % 360) + 360) % 360; if (lp > 180) lp -= 360;
  return { u: 0.5 - lp / 360, v: 0.5 + b / 180 };
}

/**
 * 天の川を貼る球のメッシュ（銀河座標の格子）。頂点に (u, v) を直接持たせるので、画素ごとの
 * 逆変換も、SphereGeometry の UV の向きへの依存もない（左右が反転していれば式で分かる）。
 * 経度 +180° と −180° の列は頂点を重ねて持つ（u = 0 と u = 1）。
 * 三角形は外から見て反時計回り（表が外向き）。内側から見るので BackSide で描く。
 * @returns {{positions: Float32Array, uvs: Float32Array, indices: Uint32Array}}
 */
export function galacticSphere(radius, nLon = 180, nLat = 90) {
  const nv = (nLon + 1) * (nLat + 1);
  const positions = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
  for (let j = 0; j <= nLat; j++) {
    const b = -90 + 180 * j / nLat;
    for (let i = 0; i <= nLon; i++) {
      const l = -180 + 360 * i / nLon;                  // −180 → +180（u は 1 → 0）
      const k = j * (nLon + 1) + i;
      const p = galToThree(l, b, radius);
      positions.set(p, k * 3);
      uvs[k * 2] = 0.5 - l / 360; uvs[k * 2 + 1] = 0.5 + b / 180;
    }
  }
  const indices = new Uint32Array(nLon * nLat * 6);
  let n = 0;
  for (let j = 0; j < nLat; j++) for (let i = 0; i < nLon; i++) {
    const a = j * (nLon + 1) + i, c = a + 1, d = a + nLon + 1, e = d + 1;  // a:(l,b) c:(l+,b) d:(l,b+) e:(l+,b+)
    indices[n++] = a; indices[n++] = c; indices[n++] = e;
    indices[n++] = a; indices[n++] = e; indices[n++] = d;
  }
  return { positions, uvs, indices };
}

/** 確かめるための基準点（D.5）。赤道座標は J2000 */
export const REFERENCE_POINTS = [
  { k: 'gc', n: '銀経0°・銀緯0°', ra: 266.4050, dec: -28.9362 },
  { k: 'sgra', n: 'いて座A*', ra: 266.4168, dec: -29.0078 },
  { k: 'ngp', n: '銀河北極', ra: 192.8595, dec: 27.1283 },
  { k: 'sgp', n: '銀河南極', ra: 12.8595, dec: -27.1283 },
  { k: 'gac', n: '反銀河中心', ra: 86.4050, dec: 28.9362 },
  { k: 'lmc', n: '大マゼラン雲', ra: 80.894, dec: -69.756 },
  { k: 'm31', n: 'アンドロメダ銀河', ra: 10.685, dec: 41.269 },
  { k: 'acrux', n: 'アクルックス（石炭袋のそば）', ra: 186.650, dec: -63.099 },
  { k: 'sirius', n: 'シリウス', ra: 101.287, dec: -16.716 },
  { k: 'antares', n: 'アンタレス', ra: 247.352, dec: -26.432 },
  { k: 'deneb', n: 'デネブ', ra: 310.358, dec: 45.280 },
];
