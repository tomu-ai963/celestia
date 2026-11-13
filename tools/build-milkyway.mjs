#!/usr/bin/env node
/**
 * build-milkyway.mjs — 天の川のテクスチャを作る（docs/rendering-upgrade.md D.6）
 *
 * 元データ: NASA SVS「Deep Star Maps 2020」（https://svs.gsfc.nasa.gov/4851）の
 *   milkyway_2020_4k_gal.exr（4096×2048、銀河座標の正距円筒。明るい星＝Hipparcos と Tycho を除いた層）
 * 元の EXR（約 33 MB）はリポジトリに入れない。tools/.cache/svs/ に置き（無ければ取得する）、
 * SHA-256 を照合してから使う。生成物（WebP と JSON）だけをコミットする。
 *
 *   node tools/build-milkyway.mjs            # assets/sky/ に書き出す
 *
 * 手順（D.6 を実データに合わせて変えたもの。とむの判断 2026-11-14。docs/rendering-upgrade.md D.6 の追記を参照）:
 *   1. EXR を three.js の EXRLoader で読む（線形・半精度。行は下から上なので上下を反転する）
 *   2. 線形の浮動小数のまま、ガウスぼかし（4096 px で σ 1.2 画素 ≈ 0.1°）。
 *      Gaia の暗い星が細かい粒として全面に残っていて、そのままでは容量の上限に収まらないため
 *   3. 背景の底上げ分を引く（輝度の 1 パーセンタイルを全チャンネルから引き、0 で切る）
 *   4. 明るさの基準: 画素ごとの最も明るいチャンネルの最大値を 1.0 にする（99.5 パーセンタイルでは
 *      銀河中心のふくらみが白飛びする）。
 *      ただし最大値が 99.99 パーセンタイルの OUTLIER_RATIO 倍を超えていたら、孤立した外れ値とみなして
 *      99.99 パーセンタイルを基準にし、超えた分は切る
 *   5. sRGB に変換し、三角分布のディザ（±1 段）をかけて 8 ビットに（暗い所の段差を防ぐ）。
 *      4096×2048 と 2048×1024（線形のまま 2×2 の平均で縮小）を WebP（品質 85）で書き出す
 *   6. 銀河中心のふくらみの明るさ（1° 角の平均の最大）を assets/sky/milkyway.json に書く。
 *      表示側はこれで割って「ふくらみが線形 0.03（双眼鏡 0.06）」になる倍率を決める（D.7）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k_gal.exr';
export const SOURCE_SHA256 = 'fad63b36aa632c691d521cd9d8b828de9d29b4c2784276eec44e54c6cb159a49';
const CACHE = join(ROOT, 'tools', '.cache', 'svs', 'milkyway_2020_4k_gal.exr');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const FLOOR_PCT = 0.01, QUALITY = Number(arg('--quality', 85));
const OUTLIER_PCT = 0.9999, OUTLIER_RATIO = 2;   // 最大値がこの百分位の 2 倍を超えたら外れ値とみなす
const BLUR = Number(arg('--blur', 1.2));         // 4096 px の画素でのガウスぼかしの σ（0 でなし）
const FORMAT = arg('--format', 'webp');          // webp | jpeg
const OUT_DIR = arg('--out', null);              // 試し書きの出力先（既定は assets/sky）
const OUT = OUT_DIR ? OUT_DIR : join(ROOT, 'assets', 'sky');
const LIMIT = { 2048: 300 * 1024, 4096: 1200 * 1024 };   // D.6 のファイルの上限（見積もり。H-5）

async function loadExr() {
  if (!existsSync(CACHE)) {
    console.log(`downloading ${SOURCE_URL} ...`);
    const r = await fetch(SOURCE_URL);
    if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, Buffer.from(await r.arrayBuffer()));
  }
  const buf = readFileSync(CACHE);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE_SHA256) throw new Error(`EXR の SHA-256 が違う: ${sha}`);
  const loader = new EXRLoader(); loader.setDataType(THREE.FloatType);
  const r = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (r.width !== 4096 || r.height !== 2048) throw new Error(`大きさが違う: ${r.width}x${r.height}`);
  return r;   // data は RGBA の Float32Array。行は下から上（GL の向き）
}

/** 線形の RGB に分離型のガウスぼかし（経度方向は周期的、緯度方向は端で止める） */
function blurInPlace(a, w, h, sigma) {
  const r = Math.ceil(3 * sigma), k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * a[(y * w + ((x + i + w) % w)) * 3 + c];
    tmp[(y * w + x) * 3 + c] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * 3 + c];
    a[(y * w + x) * 3 + c] = v;
  }
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/** 線形の RGB（Float32、3 チャンネル、行は上から下）→ sRGB 8 ビット。三角分布のディザ（±1 段）をかける */
function encode(lin, w, h, seed) {
  const out = Buffer.alloc(w * h * 3), r = rng(seed);
  for (let i = 0; i < w * h * 3; i++) {
    const x = lin[i], c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    out[i] = Math.max(0, Math.min(255, Math.round(c * 255 + r() + r() - 1)));
  }
  return out;
}

/** 種つきの乱数（mulberry32）。ディザを毎回同じにして、生成し直しても同じ画像にする */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function build() {
  const exr = await loadExr();
  const W = exr.width, H = exr.height, n = W * H, d = exr.data;
  // 1: RGB の 3 チャンネルにし、行を上から下に並べ直す
  const lin = new Float32Array(n * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (H - 1 - y) * W + x, o = (y * W + x) * 3;
    lin[o] = d[i * 4]; lin[o + 1] = d[i * 4 + 1]; lin[o + 2] = d[i * 4 + 2];
  }
  // 2: 線形のままぼかす
  if (BLUR > 0) blurInPlace(lin, W, H, BLUR);
  // 3・4: 底上げと明るさの基準
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.2126 * lin[i * 3] + 0.7152 * lin[i * 3 + 1] + 0.0722 * lin[i * 3 + 2];
  const sorted = Float32Array.from(lum).sort();
  const floor = percentile(sorted, FLOOR_PCT);
  // 明るさの基準は画素ごとの最も明るいチャンネルで見る（輝度で見ると赤い所のチャンネルが 1 を超える）
  const peak = new Float32Array(n);
  for (let i = 0; i < n; i++) peak[i] = Math.max(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2]);
  peak.sort();
  const max = peak[n - 1], p9999 = percentile(peak, OUTLIER_PCT);
  const outlier = (max - floor) > OUTLIER_RATIO * (p9999 - floor);
  const white = (outlier ? p9999 : max) - floor;
  const scale = 1 / white;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    let over = false;
    for (let c = 0; c < 3; c++) {
      let v = (lin[i * 3 + c] - floor) * scale;
      if (v > 1) { v = 1; over = true; }
      lin[i * 3 + c] = v < 0 ? 0 : v;
    }
    if (over) clipped++;
  }

  // 6: ふくらみの明るさ。|l| < 20°, |b| < 10° の範囲で、1° 角（11×11 画素）の輝度の平均の最大
  const ppd = W / 360, k = Math.round(ppd) | 1, hk = k >> 1;
  let bulge = 0, bulgeAt = null;
  const x0 = Math.round(W / 2 - 20 * ppd), x1 = Math.round(W / 2 + 20 * ppd);
  const y0 = Math.round(H / 2 - 10 * ppd), y1 = Math.round(H / 2 + 10 * ppd);
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    let s = 0;
    for (let dy = -hk; dy <= hk; dy++) for (let dx = -hk; dx <= hk; dx++) {
      const o = ((y + dy) * W + (x + dx)) * 3;
      s += 0.2126 * lin[o] + 0.7152 * lin[o + 1] + 0.0722 * lin[o + 2];
    }
    s /= k * k;
    if (s > bulge) { bulge = s; bulgeAt = { l: +((W / 2 - x) / ppd).toFixed(2), b: +((H / 2 - y) / ppd).toFixed(2) }; }
  }

  // 5: 4096 はそのまま、2048 は線形のまま 2×2 の平均
  const half = new Float32Array((W / 2) * (H / 2) * 3);
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) for (let c = 0; c < 3; c++) {
    const a = (yy, xx) => lin[(yy * W + xx) * 3 + c];
    half[(y * (W / 2) + x) * 3 + c] = (a(2 * y, 2 * x) + a(2 * y, 2 * x + 1) + a(2 * y + 1, 2 * x) + a(2 * y + 1, 2 * x + 1)) / 4;
  }
  mkdirSync(OUT, { recursive: true });
  const files = {};
  for (const [size, data, w, h] of [[4096, lin, W, H], [2048, half, W / 2, H / 2]]) {
    const path = join(OUT, `milkyway-${size}.${FORMAT === 'jpeg' ? 'jpg' : 'webp'}`);
    const img = sharp(encode(data, w, h, size), { raw: { width: w, height: h, channels: 3 } });
    await (FORMAT === 'jpeg' ? img.jpeg({ quality: QUALITY, mozjpeg: true }) :
      img.webp({ quality: QUALITY, effort: 6, smartSubsample: true })).toFile(path);
    const bytes = statSync(path).size;
    files[size] = { file: `assets/sky/milkyway-${size}.webp`, width: w, height: h, bytes };
    console.log(`wrote ${path}: ${w}x${h}, ${(bytes / 1024).toFixed(1)} KB (上限 ${LIMIT[size] / 1024} KB)`);
    if (bytes > LIMIT[size]) console.warn(`  上限を超えた: ${size}`);
  }

  const meta = {
    source: 'NASA SVS Deep Star Maps 2020 (ID 4851), milkyway_2020_4k_gal.exr',
    sourceUrl: SOURCE_URL,
    sourceSha256: SOURCE_SHA256,
    projection: 'galactic plate carrée; center l=0 b=0; l increases to the left; top row b=+90',
    processing: {
      blurSigmaPx4096: BLUR,
      floorPercentile: FLOOR_PCT, floor: +floor.toPrecision(6),
      max: +max.toPrecision(6), p9999: +p9999.toPrecision(6),
      maxOverP9999: +((max - floor) / (p9999 - floor)).toPrecision(4), outlierRatio: OUTLIER_RATIO,
      white: outlier ? 'p99.99' : 'max', whiteValue: +(white + floor).toPrecision(6), scale: +scale.toPrecision(6),
      clippedFraction: +(clipped / n).toPrecision(4),
      encoding: 'sRGB 8-bit, triangular dither ±1 LSB (seeded)', webpQuality: QUALITY,
    },
    // テクスチャの値（線形、0〜1）での銀河中心のふくらみの明るさ。表示の倍率はこれで割って決める
    bulgePeak: +bulge.toPrecision(6), bulgeAt,
    files,
  };
  if (!OUT_DIR) writeFileSync(join(OUT, 'milkyway.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(JSON.stringify(meta.processing), 'bulgePeak', meta.bulgePeak, bulgeAt);
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  build().catch(e => { console.error(e); process.exit(1); });
}
