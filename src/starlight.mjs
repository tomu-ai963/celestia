/**
 * starlight.mjs — 星の明るさ・大きさ・色と、HDR のトーンカーブ（docs/rendering-upgrade.md B.2〜B.4）
 *
 * 星のシェーダ（index.html）と同じ式を JS の純関数として持ち、npm test で値を固定する。
 * シェーダ側の関数名（starFlux / starShape / starProfile / toneCurve）と 1 対 1 で対応させてある
 * （将来 TSL へ移すとき、関数 1 つが Fn 1 つになる。F 節の方針 3）。
 *
 * 単位: 幅 σ と点の大きさは「実画素」（CSS 画素 × pixelRatio）。色は線形の Rec.709（sRGB の原色）。
 */

/**
 * 既定値（B.2・B.4・D.7。実機で調整する。H-2・H-3）。
 * index.html の ?tune=1 のパネルの「今の値をコピー」は、STAR_DEFAULTS・BINOCULAR・BLOOM_DEFAULTS の
 * 中身をこの形のまま出す。それぞれの {…} を貼り替えれば既定値が変わる
 */
export const STAR_DEFAULTS = Object.freeze({
  magWhite: 3.0,     // 最小サイズの星のピークが 1.0（表示上の白）になる等級。露出に当たる
  magLimit: 7.0,     // 表示限界。ここから 0.5 等明るい側までをなめらかに消す
  peakMax: 4.0,      // ピークの頭打ち。超えた分は幅で受ける（総光量は保存）
  gamma: 1.0,        // 1 が Pogson の式そのまま
  saturation: 0.85,  // 色の彩度（線形のまま白へ寄せる）
  knee: 0.75,        // トーンカーブの折れ点。ここまでは入力そのまま
  sigmaFloor: 0.8,   // 最小の幅 σ0 の下限（実画素）。σ0 = max(sigmaFloor, sigmaPerPx · pixelRatio)
  sigmaPerPx: 0.7,   // σ0 のうち pixelRatio に比例する分（CSS 画素あたり）
  halo: 0.25,        // Q1・Q0 でブルームの代わりに足す光芒の強さ（Q2 では使わない。E.3）
  mwGain: 0.03,      // 天の川の明るさ（銀河中心のふくらみの線形の値。D.7）
});
/** 双眼鏡モード（C.3）。ここにない値は STAR_DEFAULTS と同じ */
export const BINOCULAR = Object.freeze({ magWhite: 4.5, magLimit: 8.5, mwGain: 0.06 });
/** ブルーム（UnrealBloomPass。B.4.4） */
export const BLOOM_DEFAULTS = Object.freeze({ strength: 0.2, radius: 0.4, threshold: 1.0, smoothWidth: 0.5 });

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 最小の幅 σ0（実画素）。CSS 画素あたりの総光量を端末の解像度によらず一定にする */
export function sigmaMin(pixelRatio, floor = STAR_DEFAULTS.sigmaFloor, perPx = STAR_DEFAULTS.sigmaPerPx) {
  return Math.max(floor, perPx * pixelRatio);
}

/** 表示限界のフェード。m_limit − 0.5 から m_limit にかけて 1 → 0 */
export function limitFade(mag, magLimit) {
  return 1 - smoothstep(magLimit - 0.5, magLimit, mag);
}

/** 等級 → フラックス F（ピークの単位。最小サイズの星で 1 が表示上の白）。表示限界のフェードを含む */
export function starFlux(mag, { magWhite = STAR_DEFAULTS.magWhite, gamma = STAR_DEFAULTS.gamma,
  magLimit = Infinity } = {}) {
  const f = Math.pow(10, -0.4 * gamma * (mag - magWhite));
  return Number.isFinite(magLimit) ? f * limitFade(mag, magLimit) : f;
}

/**
 * フラックス → ピークと幅。暗い星は最小の幅で明るさだけを変え、明るい星はピークを頭打ちにして
 * 幅を広げる。どちらも総光量 2π σ² · peak は 2π σ0² · F に等しい
 */
export function starShape(flux, { sigma0, peakMax = STAR_DEFAULTS.peakMax }) {
  if (flux <= peakMax) return { peak: flux, sigma: sigma0 };
  return { peak: peakMax, sigma: sigma0 * Math.sqrt(flux / peakMax) };
}

/** 点の大きさ（実画素）。像の 3σ の外までを含める */
export function pointSize(sigma, maxSize = Infinity) {
  return Math.min(6 * sigma + 1, maxSize);
}

/** 中心から r（実画素）の像の値 */
export function starProfile(r, peak, sigma) {
  return peak * Math.exp(-(r * r) / (2 * sigma * sigma));
}

/** トーンカーブ（1 チャンネル）。knee までは恒等、そこから指数で 1 に寄る。傾きは knee で 1 のまま */
export function toneCurve(x, knee = STAR_DEFAULTS.knee) {
  if (x <= knee) return x;
  return knee + (1 - knee) * (1 - Math.exp(-(x - knee) / (1 - knee)));
}

/** 線形 → sRGB の値（IEC 61966-2-1） */
export function linearToSRGB(x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** 線形の値 → 画面の 8 ビットの値（トーンカーブ → sRGB → 丸め）。ディザは含めない */
export function displayValue(x, knee = STAR_DEFAULTS.knee) {
  return Math.round(255 * Math.min(1, Math.max(0, linearToSRGB(toneCurve(x, knee)))));
}

/** B−V → 有効温度 [K]（Ballesteros 2012）。1,667〜25,000 K に収める（Kang et al. の近似の範囲） */
export function bvToTemperature(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  return Math.min(25000, Math.max(1667, t));
}

/** 温度 → 黒体軌跡の色度 (x, y)（Kang et al. 2002 の 3 次スプライン近似） */
export function temperatureToXY(T) {
  const t = Math.min(25000, Math.max(1667, T));
  const i1 = 1 / t, i2 = i1 * i1, i3 = i2 * i1;
  const x = t <= 4000
    ? -0.2661239e9 * i3 - 0.2343589e6 * i2 + 0.8776956e3 * i1 + 0.179910
    : -3.0258469e9 * i3 + 2.1070379e6 * i2 + 0.2226347e3 * i1 + 0.240390;
  const x2 = x * x, x3 = x2 * x;
  let y;
  if (t <= 2222) y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
  else if (t <= 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  else y = 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  return { x, y };
}

/** 輝度（Rec.709 の係数。線形の値に対して） */
export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 色度 (x, y) と Y = 1 → 線形 sRGB（Rec.709、D65）。負のチャンネルが出たら（低温の赤）、
 * 白 (1, 1, 1) を混ぜて色域に収める
 */
export function xyToLinearSRGB(x, y) {
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const m = Math.min(r, g, b);
  if (m < 0) { r -= m; g -= m; b -= m; }
  return [r, g, b];
}

/**
 * B−V → 星の色（線形・輝度 1）。明るさは等級だけで決まるよう、色によらず輝度を 1 にそろえる。
 * 彩度 s は線形のまま白へ寄せる（c = 1 + (c − 1)·s）
 */
export function bvToLinearRGB(bv, saturation = STAR_DEFAULTS.saturation) {
  const { x, y } = temperatureToXY(bvToTemperature(bv));
  let [r, g, b] = xyToLinearSRGB(x, y);
  r = 1 + (r - 1) * saturation; g = 1 + (g - 1) * saturation; b = 1 + (b - 1) * saturation;
  const L = luminance(r, g, b);
  return [r / L, g / L, b / L];
}
