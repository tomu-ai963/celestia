// 公開用ビルド（tools/build-site.mjs）の CSP ハッシュ計算の確認
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inlineScriptHashes } from '../tools/build-site.mjs';

test('src 属性のある script は数えず、インラインだけハッシュを作る', () => {
  const html = '<script src="a.js"></script><script type="importmap">{"imports":{}}</script><script>x()</script>';
  assert.equal(inlineScriptHashes(html).length, 2);
});

test('CRLF と LF で同じハッシュになる（ブラウザは改行を LF に揃えてから照合する）', () => {
  const lf = '<script>\nconst a = 1;\nconst b = 2;\n</script>';
  assert.deepEqual(inlineScriptHashes(lf.replace(/\n/g, '\r\n')), inlineScriptHashes(lf));
});

test('既知の中身のハッシュが CSP の形式どおりになる', () => {
  // printf 'alert(1)' | openssl dgst -sha256 -binary | base64
  assert.deepEqual(inlineScriptHashes('<script>alert(1)</script>'), ["'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='"]);
});

test('index.html のインラインスクリプト（importmap・file:// 案内・本体）を全部拾う', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(inlineScriptHashes(html).length, 3);
});
