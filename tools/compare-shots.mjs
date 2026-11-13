#!/usr/bin/env node
/**
 * compare-shots.mjs — tools/shoot.mjs で撮った2組を比べる（docs/rendering-upgrade.md G.3）
 *
 *   node tools/compare-shots.mjs A_DIR B_DIR [--tol 4] [--frac 0.01] [--probe-only] [--png-only]
 *
 * ② 画像: 同名の PNG を画素ごとに比べ、差のある画素数・最大の差（1チャンネル、0〜255）・
 *    許容差（--tol）を超える画素数を出す。差のある画素は B_DIR/diff/ に赤で塗った画像を書く
 * ① 位置: 同名の *.probe.json を比べ、全点の最大の差（px）を出す。点の数が違えば失敗
 *
 * 終了コード: 位置の差が 0.001 px を超えた、または画像の差が許容を超えたら 1
 *   画像の許容: 既定は「差のある画素 0」（S1〜S3）。--tol T --frac F を付けると
 *   「T/255 を超える差の画素が全体の F 以下」で合格（S4 の初期値は 4 と 0.01）
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const [A, B] = argv.filter((x, i) => !x.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--tol')) && !(i > 0 && argv[i - 1].startsWith('--frac')));
if (!A || !B) { console.error('usage: compare-shots.mjs A_DIR B_DIR'); process.exit(2); }
const TOL = opt('--tol', null), FRAC = opt('--frac', 0);
const POS_TOL = 0.001;

export function comparePng(fa, fb, diffPath) {
  const a = PNG.sync.read(readFileSync(fa)), b = PNG.sync.read(readFileSync(fb));
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: true };
  const n = a.width * a.height, out = new PNG({ width: a.width, height: a.height });
  let diff = 0, over = 0, max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]));
    const g = (a.data[i * 4] + a.data[i * 4 + 1] + a.data[i * 4 + 2]) / 3 * 0.4;
    out.data[i * 4 + 3] = 255;
    if (m > 0) {
      diff++; if (m > max) max = m;
      if (TOL !== null && m > TOL) over++;
      out.data[i * 4] = 255; out.data[i * 4 + 1] = 0; out.data[i * 4 + 2] = 0;
    } else { out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = g; }
  }
  if (diff && diffPath) writeFileSync(diffPath, PNG.sync.write(out));
  return { pixels: n, diff, max, over };
}

function flatten(p) {
  const pts = [];
  const add = (key, arr) => { for (let i = 0; i < arr.length; i++) pts.push([key, arr[i]]); };
  for (const k of ['stars', 'constellations', 'ecliptic', 'horizon', 'real', 'astro']) {
    (p[k] || []).forEach((arr, j) => add(`${k}[${j}]`, arr));
  }
  for (const [k, v] of Object.entries(p.bodies || {})) add(`bodies.${k}`, v);
  return pts;
}

export function compareProbe(fa, fb) {
  const a = JSON.parse(readFileSync(fa, 'utf8')), b = JSON.parse(readFileSync(fb, 'utf8'));
  const pa = flatten(a), pb = flatten(b);
  const groups = {};
  for (const [k] of pa) groups[k.replace(/\[\d+\]$/, '')] = 0;
  if (pa.length !== pb.length) return { countMismatch: [pa.length, pb.length] };
  let max = 0, where = null;
  for (let i = 0; i < pa.length; i++) {
    if (pa[i][0] !== pb[i][0]) return { keyMismatch: [pa[i][0], pb[i][0]] };
    const d = Math.abs(pa[i][1] - pb[i][1]);
    if (!(d <= max)) { max = d; where = pa[i][0]; }
  }
  return { values: pa.length, max, where };
}

let fail = false;
const files = readdirSync(resolve(A));
const rows = [];
if (!flag('--probe-only')) {
  mkdirSync(join(resolve(B), 'diff'), { recursive: true });
  for (const f of files.filter(f => f.endsWith('.png'))) {
    const fb = join(resolve(B), f);
    if (!existsSync(fb)) continue;
    const r = comparePng(join(resolve(A), f), fb, join(resolve(B), 'diff', f));
    let ok;
    if (r.sizeMismatch) ok = false;
    else if (TOL === null) ok = r.diff === 0;
    else ok = r.over <= FRAC * r.pixels;
    if (!ok) fail = true;
    rows.push(`② ${f.padEnd(22)} 差のある画素 ${String(r.diff).padStart(7)} / ${r.pixels}` +
      `  最大差 ${String(r.max).padStart(3)}/255` +
      (TOL !== null ? `  ${TOL}/255 超 ${r.over} (${(100 * r.over / r.pixels).toFixed(4)}%)` : '') +
      `  ${ok ? 'OK' : 'NG'}${r.sizeMismatch ? ' (大きさが違う)' : ''}`);
  }
}
if (!flag('--png-only')) {
  for (const f of files.filter(f => f.endsWith('.probe.json'))) {
    const fb = join(resolve(B), f);
    if (!existsSync(fb)) continue;
    const r = compareProbe(join(resolve(A), f), fb);
    const ok = !r.countMismatch && !r.keyMismatch && r.max <= POS_TOL;
    if (!ok) fail = true;
    rows.push(`① ${f.padEnd(28)} ${r.countMismatch ? `点の数が違う ${r.countMismatch}` :
      r.keyMismatch ? `並びが違う ${r.keyMismatch}` :
      `値 ${r.values}  最大差 ${r.max.toFixed(4)} px${r.where ? ` (${r.where})` : ''}`}  ${ok ? 'OK' : 'NG'}`);
  }
}
console.log(rows.join('\n'));
process.exit(fail ? 1 : 0);
