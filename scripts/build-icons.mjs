#!/usr/bin/env node
// assets/icons/*.svg から PNG / ICO を生成する。
//   npm run build:icons
// 依存: @resvg/resvg-js（SVG ラスタライズ）。ICO は本ファイル内で組み立てる。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'assets', 'icons');

// og-image のみテキストを含む。フォントが無い環境でも落ちないよう、
// 一般的な serif を順に候補として渡す。
const FONT = {
  loadSystemFonts: true,
  defaultFontFamily: 'Georgia',
  serifFamily: 'Georgia',
};

/** SVG を指定幅でラスタライズして PNG バッファを返す。 */
async function render(svgPath, width) {
  const svg = await readFile(svgPath);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: FONT,
    shapeRendering: 2, // geometricPrecision
    imageRendering: 0, // optimizeQuality
  });
  return resvg.render().asPng();
}

/** 文字列として渡した SVG を指定幅でラスタライズする。 */
function renderString(svg, width) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: FONT,
    shapeRendering: 2,
  })
    .render()
    .asPng();
}

// OG 画像は icon.svg を入れ子 <svg> として取り込み、ロゴタイプを添えて組む。
// （幾何を二重管理しないための合成。編集は icon.svg 側で行う）
const OG = { w: 1200, h: 630 };
function composeOg(iconSvg) {
  const icon = iconSvg.replace(
    /<svg[^>]*>/,
    '<svg x="440" y="96" width="320" height="320" viewBox="0 0 512 512">',
  );
  // letter-spacing は末尾の 1 字分も送るため、中央寄せの基準を半分だけ右へ戻す。
  const tracking = 104 * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OG.w} ${OG.h}" width="${OG.w}" height="${OG.h}">
  <path d="M0 0H${OG.w}V${OG.h}H0Z" fill="#ffffff"/>
  ${icon}
  <text x="${(OG.w + tracking) / 2}" y="520" text-anchor="middle" fill="#C9A227"
        font-family="Cormorant Garamond, Georgia, Times New Roman, serif"
        font-size="104" font-weight="300" letter-spacing="${tracking}">celestia</text>
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

const PNG_TARGETS = [
  { src: 'icon.svg', out: 'apple-touch-icon.png', width: 180 },
  { src: 'icon.svg', out: 'icon-192.png', width: 192 },
  { src: 'icon.svg', out: 'icon-512.png', width: 512 },
];

const ICO_SIZES = [16, 32, 48];

async function main() {
  await mkdir(iconDir, { recursive: true });

  for (const { src, out, width } of PNG_TARGETS) {
    const png = await render(path.join(iconDir, src), width);
    await writeFile(path.join(iconDir, out), png);
    console.log(`  ${out.padEnd(22)} ${width}px  ${(png.length / 1024).toFixed(1)} KB`);
  }

  const og = renderString(composeOg(await readFile(path.join(iconDir, 'icon.svg'), 'utf8')), OG.w);
  await writeFile(path.join(iconDir, 'og-image.png'), og);
  console.log(`  ${'og-image.png'.padEnd(22)} ${OG.w}x${OG.h}  ${(og.length / 1024).toFixed(1)} KB`);

  const simple = path.join(iconDir, 'icon-simple.svg');
  const pngs = [];
  for (const size of ICO_SIZES) {
    pngs.push({ size, data: await render(simple, size) });
  }
  const ico = buildIco(pngs);
  await writeFile(path.join(iconDir, 'favicon.ico'), ico);
  console.log(`  ${'favicon.ico'.padEnd(22)} ${ICO_SIZES.join('/')}px  ${(ico.length / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
