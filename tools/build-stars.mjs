#!/usr/bin/env node
/**
 * build-stars.mjs — HYG database から data/stars.json を生成するビルドスクリプト
 *
 * ソース: astronexus/HYG-Database v4.1 (CC BY-SA 4.0)
 * 実行:   node tools/build-stars.mjs
 *
 * 出力フォーマット（フラット整数配列・4要素で1星）:
 *   [lon*1000, lat*1000, mag*100, ci*100, ...]
 *   lon/lat = J2000 黄道座標（度）小数3桁、mag = 視等級 小数2桁、ci = B-V 色指数 小数2桁
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const HYG_URL =
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
export const MAG_LIMIT = 6.5;
export const CI_FALLBACK = 0.63; // ci 欠損星の代替値（等級6.5以下 8,880星の平均 B-V）
export const OBLIQUITY = 23.4392911; // 黄道傾斜角 ε (J2000)

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * J2000 赤道座標 → J2000 黄道座標
 * @param {number} raHours 赤経（時間単位, HYG の ra 列そのまま）
 * @param {number} decDeg  赤緯（度）
 * @returns {{lon:number, lat:number}} 黄経・黄緯（度, lon は 0–360）
 */
export function equatorialToEcliptic(raHours, decDeg) {
  const a = raHours * 15 * D2R;
  const d = decDeg * D2R;
  const e = OBLIQUITY * D2R;
  const sinA = Math.sin(a), cosA = Math.cos(a);
  const sinD = Math.sin(d), cosD = Math.cos(d);
  const sinE = Math.sin(e), cosE = Math.cos(e);
  const lon = Math.atan2(sinA * cosE + Math.tan(d) * sinE, cosA) * R2D;
  const lat = Math.asin(sinD * cosE - cosD * sinE * sinA) * R2D;
  return { lon: ((lon % 360) + 360) % 360, lat };
}

/** 引用符対応の最小CSVパーサ（HYG は改行を含むフィールドを持たない） */
export function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function loadCsv() {
  const cacheDir = join(ROOT, 'tools', '.cache');
  const cachePath = join(cacheDir, 'hygdata_v41.csv');
  if (existsSync(cachePath)) {
    console.log(`cache hit: ${cachePath}`);
    return readFileSync(cachePath, 'utf8');
  }
  console.log(`downloading ${HYG_URL} ...`);
  const res = await fetch(HYG_URL);
  if (!res.ok) throw new Error(`HYG download failed: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, text);
  return text;
}

async function build() {
  const csv = await loadCsv();
  const lines = csv.split('\n');
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h.replace(/"/g, ''), i]));

  const stars = [];
  let missingCi = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = parseCsvLine(lines[i]);
    const id = Number(f[col.id]);
    if (id === 0) continue; // Sol（太陽）は天体計算側で扱うので除外
    const mag = Number(f[col.mag]);
    if (!(mag <= MAG_LIMIT)) continue;
    const ra = Number(f[col.ra]);
    const dec = Number(f[col.dec]);
    let ci = f[col.ci] === '' ? NaN : Number(f[col.ci]);
    if (Number.isNaN(ci)) { ci = CI_FALLBACK; missingCi++; }
    const { lon, lat } = equatorialToEcliptic(ra, dec);
    stars.push([Math.round(lon * 1000), Math.round(lat * 1000),
                Math.round(mag * 100), Math.round(ci * 100)]);
  }
  stars.sort((a, b) => a[2] - b[2]); // 明るい順

  const out = {
    source: 'HYG v4.1 (astronexus/HYG-Database)',
    license: 'CC BY-SA 4.0',
    frame: 'J2000 ecliptic',
    magLimit: MAG_LIMIT,
    ciFallback: CI_FALLBACK,
    fields: ['lon_mdeg(x1000)', 'lat_mdeg(x1000)', 'mag(x100)', 'ci(x100)'],
    count: stars.length,
    stars: stars.flat()
  };

  const outDir = join(ROOT, 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'stars.json');
  writeFileSync(outPath, JSON.stringify(out));
  const kb = (statSync(outPath).size / 1024).toFixed(1);
  console.log(`wrote ${outPath}: ${out.count} stars (mag<=${MAG_LIMIT}), ` +
              `${missingCi} missing ci -> ${CI_FALLBACK}, ${kb} KB`);
  if (statSync(outPath).size > 200 * 1024) {
    throw new Error(`stars.json exceeds 200KB target: ${kb} KB`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch(e => { console.error(e); process.exit(1); });
}
