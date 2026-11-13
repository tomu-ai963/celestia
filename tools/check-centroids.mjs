#!/usr/bin/env node
/**
 * check-centroids.mjs — 星の重心の検査（docs/rendering-upgrade.md G.3 ③）
 *
 *   node tools/check-centroids.mjs DIR [--n 200] [--tol 0.5] [--deep]
 *
 * DIR は tools/shoot.mjs を layers=sky（と bloom=0）で撮った出力。各画像について、
 * 明るい順に N 個の星の像の重心を求め、probe の位置（＝計算上の位置）と比べる。
 *
 * - 対象: カメラの手前にあり（probe.starsFront）、窓が画面に収まる星。
 *   窓に別の星の像（その星の 3σ + 1 の範囲）がかかる場合は、重心が引っ張られるので除く（件数は出す）
 * - 窓: 像の全体（3σ + 1 実画素）を含む正方形。最低でも ±4 実画素。
 *   窓の外側の枠に平面を当てはめて背景（天の川の傾き）を引き、ピークの 10% 以上の画素で
 *   RGB の和の重みを付けて重心を取る
 * - 判定: 差の最大が --tol 以下（実画素。DPR 2 では CSS 画素の 2 倍の細かさで見ている）
 * - --deep を付けると双眼鏡の段（probe.stars[1]）も含める
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { STAR_DEFAULTS, BINOCULAR, sigmaMin, starFlux, starShape } from '../src/starlight.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const DIR = resolve(argv[0]);
const N = opt('--n', 200), TOL = opt('--tol', 0.5);
const DEEP = argv.includes('--deep');

/** 星の番号 i の等級。probe には等級がないので data/ から読む（並び順は同じ） */
const stars = JSON.parse(readFileSync(new URL('../data/stars.json', import.meta.url), 'utf8'));
let deep = null;
try { deep = JSON.parse(readFileSync(new URL('../data/stars-deep.json', import.meta.url), 'utf8')); } catch {}
const magOf = (layer, i) => (layer === 0 ? stars : deep).stars[i * 4 + 2] / 100;

let fail = false;
for (const f of readdirSync(DIR).filter(f => f.endsWith('.probe.json'))) {
  const name = f.replace('.probe.json', '');
  const probe = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const png = PNG.sync.read(readFileSync(join(DIR, `${name}.png`)));
  const dpr = png.width / probe.W;
  const binocular = DEEP;
  const magWhite = binocular ? BINOCULAR.magWhite : STAR_DEFAULTS.magWhite;
  const layers = DEEP ? [0, 1] : [0];
  // 手前にある星の位置（実画素）を全部集める（近くの星の判定に使う）
  const all = [];
  for (const L of layers) {
    const pts = probe.stars[L], front = probe.starsFront[L];
    if (!pts) continue;
    for (const i of front) all.push({ L, i, x: pts[i * 2] * dpr, y: pts[i * 2 + 1] * dpr, mag: magOf(L, i) });
  }
  const sigma0 = sigmaMin(dpr);
  // 像の半径（3σ + 1 実画素、最低 4）
  for (const s of all) {
    const sh = starShape(starFlux(s.mag, { magWhite }), { sigma0 });
    s.sigma = sh.sigma; s.r = Math.max(4, Math.ceil(3 * sh.sigma + 1));
  }
  all.sort((a, b) => a.mag - b.mag);
  const grid = new Map(), key = (x, y) => `${Math.floor(x / 32)},${Math.floor(y / 32)}`;
  for (const s of all) { const k = key(s.x, s.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
  const near = (s, r) => {
    const out = [];
    for (let gx = Math.floor((s.x - r) / 32); gx <= Math.floor((s.x + r) / 32); gx++)
      for (let gy = Math.floor((s.y - r) / 32); gy <= Math.floor((s.y + r) / 32); gy++)
        for (const t of grid.get(`${gx},${gy}`) || []) if (t !== s && Math.abs(t.x - s.x) <= r && Math.abs(t.y - s.y) <= r) out.push(t);
    return out;
  };
  const RMAX = Math.max(...all.map(s => s.r));
  let used = 0, skippedNeighbor = 0, skippedEdge = 0, max = 0, sum = 0, worst = null;
  const val = (x, y) => { const k = (y * png.width + x) * 4; return png.data[k] + png.data[k + 1] + png.data[k + 2]; };
  for (const s of all) {
    if (used >= N) break;
    const r = s.r;
    const cx = Math.round(s.x - 0.5), cy = Math.round(s.y - 0.5);
    if (cx - r - 1 < 0 || cy - r - 1 < 0 || cx + r + 1 >= png.width || cy + r + 1 >= png.height) { skippedEdge++; continue; }
    // 自分の窓と、相手の像（半径 t.r）が重なる星があれば除く
    if (near(s, r + RMAX + 1).some(t => Math.abs(t.x - s.x) <= r + t.r + 1 && Math.abs(t.y - s.y) <= r + t.r + 1)) {
      skippedNeighbor++; continue;
    }
    // まわりの明るさ: 窓のすぐ外の 1 画素幅の枠に平面 a + b·dx + c·dy を当てはめる
    // （背景の天の川の傾きで重心が引っ張られないように）。枠は左右・上下に対称なので正規方程式は対角
    let n = 0, s0 = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
    const addRing = (dx, dy) => { const v = val(cx + dx, cy + dy); n++; s0 += v; sx += v * dx; sy += v * dy; sxx += dx * dx; syy += dy * dy; };
    for (let d = -r - 1; d <= r + 1; d++) { addRing(d, -r - 1); addRing(d, r + 1); }
    for (let d = -r; d <= r; d++) { addRing(-r - 1, d); addRing(r + 1, d); }
    const A = s0 / n, Bx = sx / sxx, By = sy / syy;
    // 背景を引いた値のうち、ピークの 10% 以上の画素だけで重心を取る（縁の雑音とディザを入れない）
    const sub = [];
    let peak = 0;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      const v = val(x, y) - (A + Bx * (x - cx) + By * (y - cy));
      sub.push([x, y, v]); if (v > peak) peak = v;
    }
    let w = 0, mx = 0, my = 0;
    for (const [x, y, v] of sub) {
      if (v < 0.1 * peak) continue;
      w += v; mx += v * (x + 0.5); my += v * (y + 0.5);
    }
    if (w <= 0) { fail = true; console.log(`${name}: 星 ${s.L}:${s.i}（${s.mag} 等）の像が見つからない`); continue; }
    const err = Math.hypot(mx / w - s.x, my / w - s.y);
    used++; sum += err;
    if (err > max) { max = err; worst = `${s.L}:${s.i} (${s.mag} 等, ${(mx / w).toFixed(2)},${(my / w).toFixed(2)} vs ${s.x.toFixed(2)},${s.y.toFixed(2)})`; }
  }
  const ok = used > 0 && max <= TOL;
  if (!ok) fail = true;
  console.log(`③ ${name.padEnd(14)} 星 ${String(used).padStart(3)} 個  最大差 ${max.toFixed(3)} 実px  平均 ${(sum / Math.max(1, used)).toFixed(3)}` +
    `  除外: 近くに星 ${skippedNeighbor}・画面の外と端 ${skippedEdge}  ${ok ? 'OK' : 'NG'}  最大の星 ${worst}`);
}
process.exit(fail ? 1 : 0);
