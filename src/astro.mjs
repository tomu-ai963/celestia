/**
 * astro.mjs — 天文計算エンジン（JPL近似軌道要素 + 月の短縮ELP級数）
 *
 * P1 までは index.html にインラインで置いていたものを、そのままモジュールへ切り出した。
 * 計算式・係数は変更していない。Node からも import できるようにしたのは、
 * 逆行判定を既知の事象と突き合わせるテストのため。
 */
import { toJ2000Lon } from './precession.mjs';

export const D2R = Math.PI / 180, R2D = 180 / Math.PI, AU = 149597870.7;
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

export function moonPos(T) {
  const Lp=norm(218.3164477+481267.88123421*T-0.0015786*T*T);
  const D =norm(297.8501921+445267.1114034*T-0.0018819*T*T);
  const M =norm(357.5291092+35999.0502909*T-0.0001536*T*T);
  const Mp=norm(134.9633964+477198.8675055*T+0.0087414*T*T);
  const F =norm(93.2720950+483202.0175233*T-0.0036539*T*T);
  const l = Lp
   +6.288774*sin(Mp)      +1.274027*sin(2*D-Mp)   +0.658314*sin(2*D)
   +0.213618*sin(2*Mp)    -0.185116*sin(M)        -0.114332*sin(2*F)
   +0.058793*sin(2*D-2*Mp)+0.057066*sin(2*D-M-Mp) +0.053322*sin(2*D+Mp)
   +0.045758*sin(2*D-M)   -0.040923*sin(M-Mp)     -0.034720*sin(D)
   -0.030383*sin(M+Mp)    +0.015327*sin(2*D-2*F)  -0.012528*sin(Mp+2*F)
   +0.010980*sin(Mp-2*F)  +0.010675*sin(4*D-Mp)   +0.010034*sin(3*Mp);
  const b =
    5.128122*sin(F)       +0.280602*sin(Mp+F)     +0.277693*sin(Mp-F)
   +0.173237*sin(2*D-F)   +0.055413*sin(2*D-Mp+F) +0.046271*sin(2*D-Mp-F)
   +0.032573*sin(2*D+F)   +0.017198*sin(2*Mp+F)   +0.009266*sin(2*D+Mp-F);
  const dist = 385000.56 - 20905.355*cos(Mp) - 3699.111*cos(2*D-Mp)
             - 2955.968*cos(2*D) - 569.925*cos(2*Mp);
  const lam=norm(l), bet=b, r=dist/AU;
  return {lon:lam, lat:bet, dist:r,
    x:r*cos(bet)*cos(lam), y:r*cos(bet)*sin(lam), z:r*sin(bet)};
}

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

export function computeChart(jd, latDeg, lonDeg) {
  const T=(jd-2451545.0)/36525;
  const E=helio('earth',T);
  const out={};
  // 太陽 = 地球ヘリオの反転
  out.sun = geo(-E.x,-E.y,-E.z);
  const m=moonPos(T); out.moon={lon:m.lon,lat:m.lat,dist:m.dist,x:m.x,y:m.y,z:m.z};
  ['mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto'].forEach(k=>{
    const p=helio(k,T); out[k]=geo(p.x-E.x,p.y-E.y,p.z-E.z);
  });
  const nodeLon=norm(125.04452-1934.136261*T);
  const lilLon =norm(83.3532465+4069.0137287*T);
  out.node  =fromLon(nodeLon, 0.0026);
  out.lilith=fromLon(lilLon , 0.0026);
  // 地方恒星時 → 天頂ベクトル
  const gmst=norm(280.46061837+360.98564736629*(jd-2451545.0)+0.000387933*T*T);
  const lst=norm(gmst+lonDeg);
  const eps=23.439291-0.0130042*T;
  const cx=cos(latDeg)*cos(lst), cy=cos(latDeg)*sin(lst), cz=sin(latDeg);
  out._zenith={x:cx, y:cy*cos(eps)+cz*sin(eps), z:-cy*sin(eps)+cz*cos(eps)};
  out._T=T; out._lst=lst;
  return out;

  function geo(x,y,z){
    const r=Math.hypot(x,y,z);
    return {x,y,z,dist:r,lon:norm(Math.atan2(y,x)*R2D),lat:Math.asin(z/r)*R2D};
  }
  function fromLon(L,r){return {lon:L,lat:0,dist:r,x:r*cos(L),y:r*sin(L),z:0};}
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

/** 各天体の黄経速度（度/日）。中心差分なので computeChart は2回で済む */
export function lonRates(jd, dt = 0.5, latDeg = 0, lonDeg = 0) {
  const a = computeChart(jd - dt, latDeg, lonDeg);
  const b = computeChart(jd + dt, latDeg, lonDeg);
  const out = {};
  for (const bd of BODIES) out[bd.k] = deltaLon(a[bd.k].lon, b[bd.k].lon) / (2 * dt);
  return out;
}

/** 指定天体が jd 時点で逆行しているか */
export function isRetrograde(key, jd, dt = 0.5) {
  return lonRates(jd, dt)[key] < 0;
}

/**
 * [jd0, jd1] の区間で key の留（順行⇄逆行の切り替わり）を列挙する。
 * 粗いスキャンで符号反転を見つけ、二分法で細分する。
 * 戻り値: [{ jd, toRetro }]  toRetro=true なら逆行入り（留→逆行）
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
