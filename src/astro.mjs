/**
 * astro.mjs — 天文計算エンジン（JPL近似軌道要素 + Meeus の月）
 *
 * ■ 基準フレーム（P3 で統一）
 *
 * 天体ごとに素の計算が返すフレームは揃っていない:
 *   - helio() の JPL 近似軌道要素   … J2000 の平均黄道・平均分点
 *   - moon.mjs の Meeus 級数        … 分点 of-date
 *   - 月の平均交点・平均リリス      … 分点 of-date（平均要素なので）
 *   - GMST から作る天頂ベクトル     … 分点 of-date
 * そのままだと太陽と惑星だけが一般歳差 p_A ぶん（1900年で 1.39°）ずれる。
 * computeChart() は helio() 由来のベクトルに precessVec() をかけ、
 * **出力を全天体 of-date に統一**している。星野側（celestialGroup）も同じ
 * 変換行列で回るので、画面上の全要素が同一フレームに乗る。
 * 各天体の素のフレームと出典は README の表を参照。
 *
 * ■ 位置の種別
 * 出力は astrometric（光行時間補正あり・年周光行差なし・章動なし）。
 * Horizons の VEC_CORR='LT' と同じ定義で、突き合わせはこの条件で行う。
 *
 * ■ 時系（P3.5 で導入）
 * このモジュールの **入口の JD はすべて UT**（暦日から作るのが UT なので）。
 * 軌道理論の引数 T は力学時なので computeChart が中で TT へ直す。
 * 逆に GMST は UT の関数として定義された量なので UT のまま渡す。
 * 混同すると地平線が 0.27° 回るため、変数名を jdUT / jdTT で必ず分けること。
 * 詳細と根拠は src/deltat.mjs の冒頭。
 */
import { toJ2000Lon, precessVec, precessVecInv } from './precession.mjs';
import { moonPos } from './moon.mjs';
import { nutation, meanObliquity } from './nutation.mjs';
import { utToTT } from './deltat.mjs';

export const D2R = Math.PI / 180, R2D = 180 / Math.PI, AU = 149597870.7;
/** 光が 1 AU を進むのに要する日数（IAU 2009 の光行時間 499.004784 s より） */
export const LIGHT_DAYS_PER_AU = 0.005775518331;
export const sin = a => Math.sin(a * D2R), cos = a => Math.cos(a * D2R);
export const norm = a => ((a % 360) + 360) % 360;

export function julianDay(y, m, d, h, mi, tzHours) {
  let hh = h + mi / 60 - tzHours;
  let dd = d + hh / 24;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dd + B - 1524.5;
}

/** ユリウス日 → 暦日（UT）。julianDay の逆変換（Meeus 7.a） */
export function jdToUTC(jd) {
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const al = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + al - Math.floor(al / 4);
  }
  const b = a + 1524, c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c), e = Math.floor((b - d) / 30.6001);
  const dayF = b - d - Math.floor(30.6001 * e) + f;
  const day = Math.floor(dayF);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  let hours = (dayF - day) * 24;
  let h = Math.floor(hours), mi = Math.round((hours - h) * 60);
  if (mi === 60) { mi = 0; h += 1; }
  return { y: year, m: month, d: day, h: h % 24, mi };
}

// a, e, I, L, longPeri, longNode  +  per-century rates
// 出典: JPL Solar System Dynamics "Approximate Positions of the Planets" Table 1
//   https://ssd.jpl.nasa.gov/planets/approx_pos.html
//   「with respect to the mean ecliptic and equinox of J2000」/ 適用範囲 1800–2050 AD
//   同ページの公称最大誤差（日心黄経・秒角）: 水星15 金星20 地球20 火星40
//   木星400 土星600 天王星50 海王星10（冥王星は記載なし）
export const ELEM = {
  mercury:[0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593,
           0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081],
  venus:  [0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255,
           0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418],
  earth:  [1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0.0,
           0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0.0],
  mars:   [1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891,
           0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343],
  jupiter:[5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909,
           -0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106],
  saturn: [9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448,
           -0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794],
  uranus: [19.18916464,0.04725744,0.77263783,313.23810451,170.95427630,74.01692503,
           -0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589],
  neptune:[30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574,
           0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664],
  pluto:  [39.48211675,0.24882730,17.14001206,238.92903833,224.06891629,110.30393684,
           -0.00031596,0.00005170,0.00004818,145.20780515,-0.04062942,-0.01183482]
};

/** 日心黄道直交座標（AU）。フレームは **J2000** で、of-date への変換はしない */
export function helio(name, T) {
  const E = ELEM[name];
  const a=E[0]+E[6]*T, e=E[1]+E[7]*T, I=E[2]+E[8]*T,
        L=E[3]+E[9]*T, wb=E[4]+E[10]*T, om=E[5]+E[11]*T;
  const w = wb - om;
  let M = norm(L - wb); if(M>180) M-=360;
  const es = e*R2D;
  let Ea = M + es*sin(M);
  for(let i=0;i<8;i++){
    const dM = M - (Ea - es*sin(Ea));
    Ea += dM/(1 - e*cos(Ea));
  }
  const xp = a*(cos(Ea)-e), yp = a*Math.sqrt(1-e*e)*sin(Ea);
  const cw=cos(w),sw=sin(w),co=cos(om),so=sin(om),ci=cos(I),si=sin(I);
  return {
    x: (cw*co - sw*so*ci)*xp + (-sw*co - cw*so*ci)*yp,
    y: (cw*so + sw*co*ci)*xp + (-sw*so + cw*co*ci)*yp,
    z: (sw*si)*xp + (cw*si)*yp
  };
}

export { moonPos, moonPosShort } from './moon.mjs';

export const SIGNS=['牡羊','牡牛','双子','蟹','獅子','乙女','天秤','蠍','射手','山羊','水瓶','魚'];
export const GLYPH=['ARIES','TAURUS','GEMINI','CANCER','LEO','VIRGO','LIBRA','SCORPIO','SAGITTARIUS','CAPRICORN','AQUARIUS','PISCES'];
// IAU公式境界（黄道上の J2000 黄経、蛇遣座を含む実サイズ）
export const IAU=[[29.1,'牡羊座'],[53.5,'牡牛座'],[90.4,'双子座'],[118.3,'蟹座'],[138.1,'獅子座'],
  [174.0,'乙女座'],[217.8,'天秤座'],[241.1,'蠍座'],[248.0,'蛇遣座'],[266.6,'射手座'],
  [299.7,'山羊座'],[327.6,'水瓶座'],[351.6,'魚座'],[360,'牡羊座']];

export function iauConst(lonOfDate, T) {
  const l = toJ2000Lon(lonOfDate, T); // J2000 に戻す（歳差）
  for(const [b,n] of IAU) if(l < b) return n;
  return '牡羊座';
}

export const BODIES=[
  {k:'sun',    n:'太陽',  lt:'SOL',     c:0xffd27a, s:2.6, mo:0.986},
  {k:'moon',   n:'月',    lt:'LUNA',    c:0xdfe6f0, s:2.0, mo:13.18},
  {k:'mercury',n:'水星',  lt:'MERCURY', c:0xb9c4cf, s:1.1, mo:1.6},
  {k:'venus',  n:'金星',  lt:'VENUS',   c:0xf5d7a3, s:1.4, mo:1.2},
  {k:'mars',   n:'火星',  lt:'MARS',    c:0xe07a5f, s:1.2, mo:0.52},
  {k:'jupiter',n:'木星',  lt:'JUPITER', c:0xd9b08c, s:2.0, mo:0.083},
  {k:'saturn', n:'土星',  lt:'SATURN',  c:0xe6cf9b, s:1.8, mo:0.033},
  {k:'uranus', n:'天王星',lt:'URANUS',  c:0x8fd3d8, s:1.4, mo:0.012},
  {k:'neptune',n:'海王星',lt:'NEPTUNE', c:0x7ea6e0, s:1.4, mo:0.006},
  {k:'pluto',  n:'冥王星',lt:'PLUTO',   c:0xb09a8a, s:0.9, mo:0.004},
  {k:'node',   n:'月の交点',lt:'N.NODE',c:0xc9a0ff, s:0.8, mo:0.053},
  {k:'lilith', n:'リリス',lt:'LILITH',  c:0x9a86c9, s:0.8, mo:0.111}
];

export const PLANETS = ['mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto'];

/** 月の質量比 M_moon / (M_earth + M_moon)（IAU 2009 の 1/81.30057 より） */
export const MOON_MASS_FRACTION = 0.012150585;

/**
 * 地球中心の日心ベクトル（J2000）。
 *
 * ELEM の 'earth' は JPL の表では **EM Bary = 地球・月の重心** で、地球そのものではない。
 * 地球は重心から月と反対側に 4,671 km（3.1e-5 AU）ずれている。
 * 影響は距離に反比例するので、太陽で最大 6.4″、火星で 2″ 前後、
 * 外惑星ではほぼゼロ。月の位置は of-date なので J2000 に戻してから引く。
 */
export function earthPos(T, moon = moonPos(T)) {
  const B = helio('earth', T);
  const mJ = precessVecInv({ x: moon.x, y: moon.y, z: moon.z }, T);
  return {
    x: B.x - MOON_MASS_FRACTION * mJ.x,
    y: B.y - MOON_MASS_FRACTION * mJ.y,
    z: B.z - MOON_MASS_FRACTION * mJ.z
  };
}

/**
 * 惑星の地心ベクトル（J2000 黄道直交）を光行時間補正つきで返す。
 *
 * 見えているのは τ = 距離/光速 だけ前の惑星なので、地球は時刻 T のまま、
 * 惑星だけ T − τ の位置を使う。τ は距離に依存し距離は τ に依存するので反復するが、
 * τ の変化ぶんの位置変化は 2桁ずつ小さくなるため 2回で 0.001″ 未満に収束する。
 *
 * 効き幅は内惑星で大きい（金星は τ≈14分 × 1.2°/日 ≒ 42″）。
 * 太陽は日心フレームで静止していて τ の間に動かないので補正はゼロ（アプリでは
 * 適用しない）。月は τ≈1.3秒 × 13.18°/日 ≒ 0.7″ で無視できるため、
 * moon.mjs 側でも補正していない。
 */
export function geoVecLT(name, T, E, iters = 2) {
  let p = helio(name, T), tau = 0;
  for (let i = 0; i < iters; i++) {
    const d = Math.hypot(p.x - E.x, p.y - E.y, p.z - E.z);
    tau = d * LIGHT_DAYS_PER_AU;
    p = helio(name, T - tau / 36525);
  }
  return { x: p.x - E.x, y: p.y - E.y, z: p.z - E.z, tau };
}

/**
 * グリニッジ平均恒星時（度）。**引数は必ず UT のユリウス日**。
 *
 * GMST は「UT1 の関数」として定義された量そのもの（IAU 1982 の式）で、
 * 地球が実際にどれだけ回ったかを表す。ここに TT を渡すと ΔT 秒ぶん未来の
 * 自転角になり、2000年なら 64秒 × 15.041″/秒 ≒ 963″ = 0.27° 地平線が回る。
 * 軌道理論側（TT）と取り違えないよう関数として切り出してある。
 */
export function gmstDeg(jdUT) {
  const Tu = (jdUT - 2451545.0) / 36525;
  return norm(280.46061837 + 360.98564736629 * (jdUT - 2451545.0) + 0.000387933 * Tu * Tu);
}

/**
 * 出生図の全天体位置。**jdUT は UT のユリウス日**（`julianDay` / `zonedToJd` の出力）。
 *
 * 中で TT へ直したものだけを軌道理論と歳差に渡し、GMST には UT をそのまま渡す。
 * 返り値の `_T` は TT 基準のユリウス世紀（歳差行列・章動の引数として使う）。
 */
export function computeChart(jdUT, latDeg, lonDeg) {
  const jdTT = utToTT(jdUT);
  const T=(jdTT-2451545.0)/36525;      // 力学時のユリウス世紀（軌道理論・歳差の引数）
  const out={};
  // 月は of-date で出てくるので歳差をかけない
  const m=moonPos(T); out.moon={lon:m.lon,lat:m.lat,dist:m.dist,x:m.x,y:m.y,z:m.z};
  const E=earthPos(T, m);
  // 太陽 = 地球ヘリオの反転（日心フレームで静止しているので光行時間補正は不要）
  out.sun = geo(-E.x,-E.y,-E.z);
  PLANETS.forEach(k=>{
    const v=geoVecLT(k,T,E); out[k]=geo(v.x,v.y,v.z);
  });
  const nodeLon=norm(125.04452-1934.136261*T);
  const lilLon =norm(83.3532465+4069.0137287*T);
  out.node  =fromLon(nodeLon, 0.0026);
  out.lilith=fromLon(lilLon , 0.0026);
  // 地方恒星時 → 天頂ベクトル。**ここだけ UT**（gmstDeg の注記を参照）
  const lst=norm(gmstDeg(jdUT)+lonDeg);
  const eps=meanObliquity(T);
  const cx=cos(latDeg)*cos(lst), cy=cos(latDeg)*sin(lst), cz=sin(latDeg);
  out._zenith={x:cx, y:cy*cos(eps)+cz*sin(eps), z:-cy*sin(eps)+cz*cos(eps)};
  out._T=T; out._lst=lst;
  return out;

  /** J2000 の地心ベクトル → of-date に歳差回転してから黄経・黄緯に直す */
  function geo(x,y,z){
    const v=precessVec({x,y,z},T);
    const r=Math.hypot(v.x,v.y,v.z);
    return {x:v.x,y:v.y,z:v.z,dist:r,
      lon:norm(Math.atan2(v.y,v.x)*R2D),lat:Math.asin(v.z/r)*R2D};
  }
  function fromLon(L,r){return {lon:L,lat:0,dist:r,x:r*cos(L),y:r*sin(L),z:0};}
}

/** 光速（AU/日）。1 / LIGHT_DAYS_PER_AU */
export const C_AU_PER_DAY = 1 / LIGHT_DAYS_PER_AU;

/**
 * 地球の公転速度ベクトル（J2000 黄道, AU/日）。earthPos の中心差分。
 * 刻み 0.5日 で打ち切り誤差は 1e-7 AU/日（年周光行差にして 0.02″）。
 */
export function earthVel(T, h = 0.5 / 36525) {
  const a = earthPos(T - h), b = earthPos(T + h);
  const k = 1 / (2 * h * 36525);
  return { x: (b.x - a.x) * k, y: (b.y - a.y) * k, z: (b.z - a.z) * k };
}

/**
 * astrometric → apparent。地心の of-date ベクトルに年周光行差と章動を入れる。
 *
 * 年周光行差は「観測者の速度の向きへ v/c だけ倒す」一次の式で、大きさは最大 20.5″。
 * 二次項は 0.001″ なので落としている。Horizons の apparent（VEC_CORR='LT+S'
 * 相当、quantity 31）と突き合わせるためだけに使い、表示には使っていない。
 */
export function toApparent(vecOfDate, T) {
  const v = precessVec(earthVel(T), T);            // 速度も of-date に揃える
  const r = Math.hypot(vecOfDate.x, vecOfDate.y, vecOfDate.z);
  const ax = vecOfDate.x / r + v.x / C_AU_PER_DAY;
  const ay = vecOfDate.y / r + v.y / C_AU_PER_DAY;
  const az = vecOfDate.z / r + v.z / C_AU_PER_DAY;
  const n = Math.hypot(ax, ay, az);
  return {
    lon: norm(Math.atan2(ay, ax) * R2D + nutation(T).dpsi),
    lat: Math.asin(az / n) * R2D
  };
}

/**
 * 太陽の**視**黄経（真分点 of-date）。
 *
 * computeChart が返すのは平均分点の astrometric なので、春分の定義
 * 「視黄経 = 0」と直接は比べられない。差は2つだけ:
 *   年周光行差  −20.4898″/R  … 地球の公転で見かけが進行方向へずれる
 *   章動 Δψ     ±17″        … 平均分点 → 真分点
 * この2つを足したものが Horizons の apparent 黄経に対応する。
 * 逆に言えば、フレームを取り違えていれば 1.4° 級のずれが出るので、
 * この関数が 0 を返すことは of-date であることの十分に鋭い検査になる。
 */
export function apparentSunLon(jdUT) {
  const T = (utToTT(jdUT) - 2451545.0) / 36525;   // 章動の引数も力学時
  const c = computeChart(jdUT, 0, 0);
  const aberr = -20.4898 / c.sun.dist / 3600;
  return norm(c.sun.lon + nutation(T).dpsi + aberr);
}

/* ============================================================
   逆行判定
   ============================================================ */

/**
 * 黄経の符号付き最短差 a → b（度, -180..180）。
 * 黄経は 0°/360° で不連続なので、単純な b-a では境界をまたぐ瞬間に
 * ±360° の誤差が出る（順行が逆行に誤検出される）。必ずこれを使うこと。
 */
export function deltaLon(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/** 各天体の黄経速度（度/日）。中心差分なので computeChart は2回で済む（jdUT は UT） */
export function lonRates(jdUT, dt = 0.5, latDeg = 0, lonDeg = 0) {
  const a = computeChart(jdUT - dt, latDeg, lonDeg);
  const b = computeChart(jdUT + dt, latDeg, lonDeg);
  const out = {};
  for (const bd of BODIES) out[bd.k] = deltaLon(a[bd.k].lon, b[bd.k].lon) / (2 * dt);
  return out;
}

/** 指定天体が jdUT 時点で逆行しているか */
export function isRetrograde(key, jdUT, dt = 0.5) {
  return lonRates(jdUT, dt)[key] < 0;
}

/**
 * [jd0, jd1] の区間（UT）で key の留（順行⇄逆行の切り替わり）を列挙する。
 * 粗いスキャンで符号反転を見つけ、二分法で細分する。
 * 戻り値: [{ jd, toRetro }]（jd は UT）  toRetro=true なら逆行入り（留→逆行）
 */
export function findStations(key, jd0, jd1, coarse = 1) {
  const rate = j => lonRates(j)[key];
  const out = [];
  let prev = rate(jd0), pj = jd0;
  for (let j = jd0 + coarse; j <= jd1; j += coarse) {
    const r = rate(j);
    if ((prev < 0) !== (r < 0)) {
      let lo = pj, hi = j;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if ((rate(mid) < 0) === (prev < 0)) lo = mid; else hi = mid;
      }
      out.push({ jd: (lo + hi) / 2, toRetro: r < 0 });
    }
    prev = r; pj = j;
  }
  return out;
}
