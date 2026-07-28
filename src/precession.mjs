/**
 * precession.mjs — 歳差と、黄道 ⇄ three.js の座標規約
 *
 * index.html とテストの両方がこのモジュールを参照する（実装はここ1箇所だけ）。
 *
 * P3 で「黄道極まわりの単純な Z 回転」から、黄道面そのものの移動を含む
 * 3回転（Meeus 21.3）へ差し替えた。理由は黄緯:
 *   J2000 黄道と当日黄道の傾き π_A は 47″/世紀 あり、1800年では 94″ ≒ 1.6′。
 *   Z 回転だけでは黄緯にこの分の誤差が丸ごと残り、P3 の目標 ±1′ を超える。
 *
 * 星野・星座線・IAU境界・天の川は J2000 で構築し、天球固定の親グループごと
 *   celestialGroup.matrix = precessionMatrixThree(T)
 * で回して当日の座標系に合わせる。惑星側は astro.mjs が計算時点で同じ変換を
 * かけて当日座標にするので、両者は常に同じフレームに乗る。
 *
 * 一次資料:
 *   p_A (一般歳差) IAU2006: Capitaine, Wallace & Chapront (2003) A&A 412, 567
 *     https://doi.org/10.1051/0004-6361:20031539
 *     ψ_A の式より p_A = 5028.796195″ T + 1.1054348″ T² (+ 高次項)
 *   π_A, Π_A (黄道の移動) IAU1976/Lieske: Meeus, Astronomical Algorithms 2nd ed. ch.21
 *     Lieske et al. (1977) A&A 58, 1  https://ui.adsabs.harvard.edu/abs/1977A%26A....58....1L
 *   両者の系の混在による差は 1800–2050 で 0.01″ 未満（p_A 側の IAU1976 → IAU2006 の
 *   改訂量が 0.3″/世紀 なのに対し、π_A/Π_A 側の改訂量はその 1/30 以下）。
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm = a => ((a % 360) + 360) % 360;
const AS2D = 1 / 3600;

/** 一般歳差 p_A（黄道上の分点の移動）の係数。単位は 秒角/世紀^n （IAU2006） */
export const P_A = [5028.796195, 1.1054348];

/** J2000 黄道に対する当日黄道の傾き π_A（秒角）。Meeus 21.5 / Lieske 1977 */
const PI_A = [47.0029, -0.03302, 0.000060];

/** 上の傾きの軸の向き Π_A（度 + 秒角項）。Meeus 21.5 */
const CAP_PI_A_DEG = 174.876384;
const CAP_PI_A = [-869.8089, 0.03536];

/**
 * J2000 からの経過ユリウス世紀 T → 一般歳差 p_A（度）。
 * 分点が黄道上を移動した量そのもので、黄経の一次的なずれに等しい。
 */
export function precessionDeg(T) {
  return (P_A[0] * T + P_A[1] * T * T) * AS2D;
}

/** 同上（ラジアン） */
export function precessionRad(T) {
  return precessionDeg(T) * D2R;
}

/* ============================================================
   黄道座標の歳差変換（Meeus, Astronomical Algorithms 2nd ed., 21.3）
   ============================================================ */

function eclipticAngles(T) {
  const eta = (PI_A[0] * T + PI_A[1] * T * T + PI_A[2] * T * T * T) * AS2D;
  const cap = CAP_PI_A_DEG + (CAP_PI_A[0] * T + CAP_PI_A[1] * T * T) * AS2D;
  return { eta, cap, p: precessionDeg(T) };
}

/**
 * J2000 の平均黄道・平均分点 → T における平均黄道・平均分点。
 * lon/lat は度。Meeus 21.3 をそのまま実装している。
 */
export function precessEcl(lonJ2000, latJ2000, T) {
  const { eta, cap, p } = eclipticAngles(T);
  const b = latJ2000 * D2R, e = eta * D2R;
  const d = (cap - lonJ2000) * D2R;                    // Π_A − λ0
  const A = Math.cos(e) * Math.cos(b) * Math.sin(d) - Math.sin(e) * Math.sin(b);
  const B = Math.cos(b) * Math.cos(d);
  const C = Math.cos(e) * Math.sin(b) + Math.sin(e) * Math.cos(b) * Math.sin(d);
  return {
    lon: norm(p + cap - Math.atan2(A, B) * R2D),
    lat: Math.asin(Math.max(-1, Math.min(1, C))) * R2D
  };
}

/**
 * T における平均黄道・平均分点 → J2000。precessEcl の逆変換（Meeus 21.4）。
 * IAU 星座境界のような J2000 固定のデータと突き合わせるのに使う。
 */
export function precessEclInv(lonDate, latDate, T) {
  const { eta, cap, p } = eclipticAngles(T);
  const b = latDate * D2R, e = eta * D2R;
  const d = (cap + p - lonDate) * D2R;                 // Π_A + p_A − λ
  const A = Math.cos(e) * Math.cos(b) * Math.sin(d) + Math.sin(e) * Math.sin(b);
  const B = Math.cos(b) * Math.cos(d);
  const C = Math.cos(e) * Math.sin(b) - Math.sin(e) * Math.cos(b) * Math.sin(d);
  return {
    lon: norm(cap - Math.atan2(A, B) * R2D),
    lat: Math.asin(Math.max(-1, Math.min(1, C))) * R2D
  };
}

/** J2000 黄経 → 当日黄経（黄緯 0 として扱う。黄道上の目盛りの換算用） */
export function toDateLon(lonJ2000, T) {
  return precessEcl(lonJ2000, 0, T).lon;
}

/** 当日黄経 → J2000 黄経（IAU星座の判定など） */
export function toJ2000Lon(lonOfDate, T) {
  return precessEclInv(lonOfDate, 0, T).lon;
}

/* ============================================================
   直交ベクトル版 — 惑星計算と three.js のグループ回転が共有する
   ============================================================ */

/**
 * 黄道直交座標での歳差回転行列（J2000 → T の平均黄道・平均分点）。
 * 戻り値は行優先の 3x3。v_date = M · v_J2000。
 *
 * 3つの基本回転の積: Rz(−(Π_A + p_A)) · Rx(π_A) · Rz(Π_A)
 * 座標軸を回す向きに書いてあるので、ベクトルには逆向きにかかる。
 */
export function precessionMatrix(T) {
  const { eta, cap, p } = eclipticAngles(T);
  const c1 = Math.cos(cap * D2R), s1 = Math.sin(cap * D2R);
  const ce = Math.cos(eta * D2R), se = Math.sin(eta * D2R);
  const c2 = Math.cos((cap + p) * D2R), s2 = Math.sin((cap + p) * D2R);
  // Rz(θ) は座標系を +θ 回す = ベクトルを −θ 回す
  const rz = (c, s) => [[c, s, 0], [-s, c, 0], [0, 0, 1]];
  const rx = [[1, 0, 0], [0, ce, se], [0, -se, ce]];
  return mul(mul(rz(c2, -s2), rx), rz(c1, s1));
}

function mul(A, B) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
    R[i][j] = s;
  }
  return R;
}

/** 黄道直交ベクトル {x,y,z} を J2000 → 当日 に変換 */
export function precessVec(v, T) {
  const M = precessionMatrix(T);
  return {
    x: M[0][0] * v.x + M[0][1] * v.y + M[0][2] * v.z,
    y: M[1][0] * v.x + M[1][1] * v.y + M[1][2] * v.z,
    z: M[2][0] * v.x + M[2][1] * v.y + M[2][2] * v.z
  };
}

/** 同・逆変換（当日 → J2000）。回転行列なので転置でよい */
export function precessVecInv(v, T) {
  const M = precessionMatrix(T);
  return {
    x: M[0][0] * v.x + M[1][0] * v.y + M[2][0] * v.z,
    y: M[0][1] * v.x + M[1][1] * v.y + M[2][1] * v.z,
    z: M[0][2] * v.x + M[1][2] * v.y + M[2][2] * v.z
  };
}

/**
 * three.js 座標系（eclToThree の (x, z, −y) 規約）での同じ回転。
 * 戻り値は THREE.Matrix4.set() にそのまま渡せる行優先の 16 要素。
 *
 * P·M·P⁻¹ を手で展開せず、基底ベクトルを通して組み立てている
 * （規約を変えたときに片方だけ直し忘れる事故を避けるため）。
 */
export function precessionMatrixThree(T) {
  const M = precessionMatrix(T);
  const col = i => {
    const v = precessVecCol(M, i);
    return eclVecToThree(v.x, v.y, v.z);
  };
  // three.js 基底 X,Y,Z に対応する黄道基底は X→(1,0,0), Y→(0,0,1), Z→(0,−1,0)
  const cx = col([1, 0, 0]), cy = col([0, 0, 1]), cz = col([0, -1, 0]);
  return [
    cx[0], cy[0], cz[0], 0,
    cx[1], cy[1], cz[1], 0,
    cx[2], cy[2], cz[2], 0,
    0, 0, 0, 1
  ];
}

function precessVecCol(M, [x, y, z]) {
  return {
    x: M[0][0] * x + M[0][1] * y + M[0][2] * z,
    y: M[1][0] * x + M[1][1] * y + M[1][2] * z,
    z: M[2][0] * x + M[2][1] * y + M[2][2] * z
  };
}

/* ============================================================
   黄道 ⇄ three.js の座標規約
   ============================================================ */

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

/** 行優先 16 要素の行列をベクトルに適用（three.js を import せずにテストする用） */
export function applyMatrixThree([X, Y, Z], m) {
  return [
    m[0] * X + m[1] * Y + m[2] * Z,
    m[4] * X + m[5] * Y + m[6] * Z,
    m[8] * X + m[9] * Y + m[10] * Z
  ];
}
