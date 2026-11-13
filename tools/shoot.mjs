#!/usr/bin/env node
/**
 * shoot.mjs — 固定条件のスクリーンショットと位置データ（probe）を撮る検証用スクリプト
 *
 * docs/rendering-upgrade.md G.2〜G.4 の手順。本番のページには組み込まない（index.html の
 * ?verify=1 を外から叩くだけ）。npm test には入れず、`npm run verify:shoot` で走らせる。
 *
 *   node tools/shoot.mjs --out tests/visual/out/s0
 *   node tools/shoot.mjs --out tests/visual/out/r151 --three tools/.cache/three/0.151.0/package/build
 *   node tools/shoot.mjs --out tests/visual/out/s5-overlay --extra layers=overlay --cond V1,V3
 *
 * - ブラウザは Playwright の Chromium（headless）。WebGL は SwiftShader に固定する
 *   （GPU やドライバで線の塗りが1画素単位で変わるのを避ける。G.3）
 * - 外部への通信はすべて遮断する。Google Fonts も遮断する（ラベルのキャンバスが
 *   フォントの到着の前後で字形を変えるため。G.2）。移行前の three.js（cdnjs の r128）だけは、
 *   バイト単位で同一の npm 配布物（tools/.cache/three/0.128.0）で応答する
 * - --three DIR を付けると /vendor/three/ への要求を DIR から返す（途中の版の検証用）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, extname, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 固定条件（G.4）。cam は θ,φ,R。ほかは検証の補助（銀河面の比較など） */
export const CONDITIONS = {
  V1: 'd=1990-07-14&t=09:30&lat=35.68&lon=139.77&tz=Asia/Tokyo&cam=0.9,1.25,430',
  V2: 'd=2000-01-01&t=12:00&lat=0&lon=0&tz=UTC&cam=-1.5156,1.4742,60',
  V3: 'd=1800-07-01&t=00:00&lat=64.15&lon=-21.94&tz=UTC&cam=1.3735,0.8791,1350&tog=real,astro',
  // 銀河面の比較（双眼鏡の空）。いて座（銀河中心のそば）とはくちょう座（デネブのそば）を中央に置く
  GSGR: 'd=2000-01-01&t=12:00&lat=0&lon=0&tz=UTC&cam=-1.5156,1.4742,300',
  GCYG: 'd=2000-01-01&t=12:00&lat=0&lon=0&tz=UTC&cam=-2.7110,2.6164,300',
};
export const SIZES = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
};

function args() {
  const a = process.argv.slice(2), o = { cond: 'V1,V2,V3', size: 'desktop,mobile', extra: '' };
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, '');
    o[k] = a[i + 1]; i++;
  }
  if (!o.out) throw new Error('--out DIR が要ります');
  return o;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.md': 'text/plain',
};

function startServer(threeDir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    let file;
    if (threeDir && p.startsWith('/vendor/three/')) file = join(resolve(threeDir), p.slice('/vendor/three/'.length));
    else file = join(ROOT, normalize(p === '/' ? '/index.html' : p));
    if (!threeDir || !p.startsWith('/vendor/three/')) {
      if (!resolve(file).startsWith(resolve(ROOT) + sep) && resolve(file) !== resolve(ROOT)) {
        res.writeHead(403); res.end(); return;
      }
    }
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const CDN_R128 = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const NPM_R128 = join(ROOT, 'tools', '.cache', 'three', '0.128.0', 'package', 'build', 'three.min.js');

async function main() {
  const o = args();
  const out = resolve(ROOT, o.out);
  mkdirSync(out, { recursive: true });
  const server = await startServer(o.three);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const log = { three: o.three || null, extra: o.extra, shots: {} };
  try {
    for (const sizeKey of o.size.split(',')) {
      for (const condKey of o.cond.split(',')) {
        const ctx = await browser.newContext({ viewport: { width: SIZES[sizeKey].width, height: SIZES[sizeKey].height },
          deviceScaleFactor: SIZES[sizeKey].deviceScaleFactor, reducedMotion: 'no-preference' });
        const page = await ctx.newPage();
        const entry = { console: [], blocked: [], errors: [] };
        page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') entry.console.push(`[${m.type()}] ${m.text()}`); });
        page.on('pageerror', e => entry.errors.push(String(e)));
        await page.route('**/*', route => {
          const u = route.request().url();
          if (u.startsWith(base)) return route.continue();
          if (u === CDN_R128 && existsSync(NPM_R128)) {
            return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(NPM_R128) });
          }
          entry.blocked.push(u);
          return route.abort();
        });
        const q = `verify=1&seed=1&${CONDITIONS[condKey]}${o.extra ? '&' + o.extra : ''}`;
        await page.goto(`${base}index.html?${q}`);
        const ok = await page.evaluate(() => window.__celestia.ready);
        if (!ok) throw new Error(`${condKey}/${sizeKey}: 星のデータを読めなかった`);
        if (o.wait) await page.evaluate(ms => new Promise(r => setTimeout(r, ms)), Number(o.wait));
        // 位置データは描いた直後の行列で取る（probe は matrixWorld をそのまま使う）
        const probe = await page.evaluate(() => window.__celestia.probe());
        const info = await page.evaluate(() => window.__celestia.info());
        const name = `${condKey}-${sizeKey}`;
        await page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
        writeFileSync(join(out, `${name}.probe.json`), JSON.stringify(probe));
        entry.query = q; entry.info = info;
        // 中央の確認（V2: 銀経0°、V3: その日のシリウス）。星は明るい順なので先頭がシリウス
        const s0 = probe.stars[0];
        entry.sirius = s0 ? [s0[0], s0[1]] : null;
        entry.center = [probe.W / 2, probe.H / 2];
        log.shots[name] = entry;
        console.log(`${name}: calls=${info.calls} console=${entry.console.length} errors=${entry.errors.length} blocked=${entry.blocked.length}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(out, 'log.json'), JSON.stringify(log, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
