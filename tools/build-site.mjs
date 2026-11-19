// 公開するファイルだけを dist/ に集める（wrangler.jsonc の build.command から呼ばれる）。
// 一覧に書いたものだけが公開される。新しいファイルやフォルダを公開するときはここに足す。
//
// index.html にはインラインのスクリプト（importmap・file:// の案内・本体のモジュール）があるので、
// その SHA-256 を計算して _headers の {{INLINE_SCRIPT_HASHES}} に差し込む。
// index.html を編集してもビルドのたびに計算し直すので、ハッシュを手で直す必要はない。
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PUBLIC_FILES = ['index.html', 'manifest.json', 'assets', 'data', 'src', 'vendor'];
const PLACEHOLDER = '{{INLINE_SCRIPT_HASHES}}';

/**
 * src 属性のない <script> の中身から CSP の 'sha256-…' を作る。
 * ブラウザは HTML を読むときに改行を LF に揃えてから照合するので、ここでも揃える
 * （core.autocrlf=true の checkout では作業ツリーの index.html が CRLF になるため）。
 */
export function inlineScriptHashes(html) {
  const normalized = html.replace(/\r\n?/g, '\n');
  const hashes = [];
  for (const m of normalized.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const digest = createHash('sha256').update(m[2], 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

async function build() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  for (const file of PUBLIC_FILES) {
    await cp(join(ROOT, file), join(DIST, file), { recursive: true });
  }

  const hashes = inlineScriptHashes(await readFile(join(ROOT, 'index.html'), 'utf8'));
  const template = await readFile(join(ROOT, '_headers'), 'utf8');
  const occurrences = template.split(PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    throw new Error(`_headers の ${PLACEHOLDER} は 1 か所だけにする（いま ${occurrences} か所）`);
  }
  const headers = template.replace(PLACEHOLDER, hashes.join(' '));
  await writeFile(join(DIST, '_headers'), headers);

  console.log(`dist/ に ${PUBLIC_FILES.length} 件（フォルダを含む）と _headers を配置しました（インラインスクリプト ${hashes.length} 件のハッシュ）`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
}
