#!/usr/bin/env node
// assets/icons/*.svg から PNG / ICO を生成する。
//   npm run build:icons
// 依存: @resvg/resvg-js（SVG ラスタライズ）。ICO は本ファイル内で組み立てる。
//
// og-image のロゴタイプは logotype.svg（scripts/gen-logotype.mjs が生成する
// アウトライン済み path）を参照するため、本スクリプトはフォント環境に依存しない
// （loadSystemFonts も無効）。ロゴタイプの字形を変えたいときだけ gen-logotype.mjs を再実行する。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'assets', 'icons');

// すべての描画は path 化済み。フォント解決を完全に無効化して環境非依存にする。
const FONT = { loadSystemFonts: false };

/** SVG 文字列を指定幅でラスタライズして PNG バッファを返す。 */
function render(svg, width) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: FONT,
    shapeRendering: 2, // geometricPrecision
    imageRendering: 0, // optimizeQuality
  });
  return resvg.render();
}

const renderPng = (svg, width) => render(svg, width).asPng();

// OG 画像は icon.svg と logotype.svg を入れ子 <svg> として取り込んで組む。
// （幾何・字形を二重管理しないための合成。編集は各ソース側で行う）
const OG = { w: 1200, h: 630 };
function composeOg(iconSvg, logotypeSvg) {
  const icon = iconSvg.replace(
    /<svg[^>]*>/,
    '<svg x="440" y="96" width="320" height="320" viewBox="0 0 512 512">',
  );
  const logotype = logotypeSvg.replace(
    /<svg[^>]*>/,
    `<svg x="0" y="0" width="${OG.w}" height="${OG.h}" viewBox="0 0 ${OG.w} ${OG.h}">`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OG.w} ${OG.h}" width="${OG.w}" height="${OG.h}">
  <path d="M0 0H${OG.w}V${OG.h}H0Z" fill="#ffffff"/>
  ${icon}
  ${logotype}
</svg>`;
}

// maskable 用: 全面白ベタの上に icon.svg の中身を中心基準で縮小して置く。
// icon.svg のインク最遠点は右上の星の上端 (349,69) で中心から 208.9px。
// セーフゾーン（直径 80% = 半径 204.8px/512）に収めるには scale <= 0.980 だが、
// 余白を見て 0.96（→ 実測は build 時に検証スクリプトで確認）。
const MASKABLE_SCALE = 0.96;
function composeMaskable(iconSvg) {
  const inner = iconSvg.replace(/<svg[^>]*>/, '').replace('</svg>', '');
  const c = 256 * (1 - MASKABLE_SCALE);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path d="M0 0H512V512H0Z" fill="#ffffff"/>
  <g transform="translate(${c} ${c}) scale(${MASKABLE_SCALE})">${inner}</g>
</svg>`;
}

/** PNG 群を ICO（PNG 埋め込み形式）にまとめる。 */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = header.length + entries.length;
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, e + 0); // width
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // color planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(data.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });

  return Buffer.concat([header, entries, ...pngs.map((p) => p.data)]);
}

const ICO_SIZES = [16, 32, 48];

async function main() {
  await mkdir(iconDir, { recursive: true });
  const iconSvg = await readFile(path.join(iconDir, 'icon.svg'), 'utf8');
  const simpleSvg = await readFile(path.join(iconDir, 'icon-simple.svg'), 'utf8');
  const logotypeSvg = await readFile(path.join(iconDir, 'logotype.svg'), 'utf8');

  const emit = async (name, png, note) => {
    await writeFile(path.join(iconDir, name), png);
    console.log(`  ${name.padEnd(24)} ${note}  ${(png.length / 1024).toFixed(1)} KB`);
  };

  await emit('apple-touch-icon.png', renderPng(iconSvg, 180), '180px');
  await emit('icon-192.png', renderPng(iconSvg, 192), '192px');
  await emit('icon-512.png', renderPng(iconSvg, 512), '512px');

  const maskableSvg = composeMaskable(iconSvg);
  await emit('icon-192-maskable.png', renderPng(maskableSvg, 192), '192px');
  await emit('icon-512-maskable.png', renderPng(maskableSvg, 512), '512px');

  await emit('og-image.png', renderPng(composeOg(iconSvg, logotypeSvg), OG.w), `${OG.w}x${OG.h}`);

  const pngs = ICO_SIZES.map((size) => ({ size, data: renderPng(simpleSvg, size) }));
  await emit('favicon.ico', buildIco(pngs), `${ICO_SIZES.join('/')}px`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
