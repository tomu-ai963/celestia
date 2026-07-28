#!/usr/bin/env node
/**
 * build-constellations.mjs — Stellarium skycultures「western」から data/constellations.json を生成
 *
 * ソース: Stellarium/stellarium-skycultures modern/western (CC BY-SA)
 *   星座線は HIP 番号のポリラインで表現されるため、HYG v4.1 の hip 列と照合して
 *   ビルド時に J2000 黄道座標へ解決する（線の端点が stars.json の星と正確に一致する）。
 * 実行: node tools/build-constellations.mjs
 *
 * 出力: 星座ごとに { iau, zodiac, lines: [[lon*100, lat*100, ...], ...] }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { equatorialToEcliptic, parseCsvLine, HYG_URL } from './build-stars.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SKYCULTURE_URL =
  'https://raw.githubusercontent.com/Stellarium/stellarium-skycultures/master/western/index.json';
export const ZODIAC = new Set(['Ari','Tau','Gem','Cnc','Leo','Vir','Lib','Sco','Sgr','Cap','Aqr','Psc']);

async function cached(url, filename) {
  const cacheDir = join(ROOT, 'tools', '.cache');
  const path = join(cacheDir, filename);
  if (existsSync(path)) {
    console.log(`cache hit: ${path}`);
    return readFileSync(path, 'utf8');
  }
  console.log(`downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} (${url})`);
  const text = await res.text();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, text);
  return text;
}

/** HYG から hip → 黄道座標 の索引を作る（重複 hip は最も明るい星を採用） */
function hipIndex(csv) {
  const lines = csv.split('\n');
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h.replace(/"/g, ''), i]));
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = parseCsvLine(lines[i]);
    const hip = f[col.hip];
    if (!hip) continue;
    const mag = Number(f[col.mag]);
    const prev = map.get(hip);
    if (prev && prev.mag <= mag) continue;
    const { lon, lat } = equatorialToEcliptic(Number(f[col.ra]), Number(f[col.dec]));
    map.set(hip, { lon, lat, mag });
  }
  return map;
}

async function build() {
  const sky = JSON.parse(await cached(SKYCULTURE_URL, 'western_index.json'));
  const hyg = hipIndex(await cached(HYG_URL, 'hygdata_v41.csv'));

  let unresolved = 0, segments = 0;
  const constellations = [];
  for (const con of sky.constellations) {
    const iau = con.iau;
    if (!iau || !con.lines) continue;
    const outLines = [];
    for (const poly of con.lines) {
      // 未解決 HIP でポリラインを分割しつつ座標列へ
      let cur = [];
      for (const hip of poly) {
        const star = hyg.get(String(hip));
        if (!star) {
          unresolved++;
          if (cur.length >= 4) outLines.push(cur);
          cur = [];
          continue;
        }
        cur.push(Math.round(star.lon * 100), Math.round(star.lat * 100));
      }
      if (cur.length >= 4) outLines.push(cur);
    }
    if (!outLines.length) continue;
    segments += outLines.reduce((n, l) => n + l.length / 2 - 1, 0);
    constellations.push({ iau, zodiac: ZODIAC.has(iau), lines: outLines });
  }

  const out = {
    source: 'Stellarium skycultures: western (via HYG v4.1 positions)',
    license: 'CC BY-SA',
    frame: 'J2000 ecliptic',
    fields: 'lines: [lon*100, lat*100, ...] polylines (deg)',
    count: constellations.length,
    constellations
  };
  const outPath = join(ROOT, 'data', 'constellations.json');
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  const kb = (statSync(outPath).size / 1024).toFixed(1);
  console.log(`wrote ${outPath}: ${out.count} constellations, ${segments} segments, ` +
              `${unresolved} unresolved HIP, ${kb} KB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch(e => { console.error(e); process.exit(1); });
}
