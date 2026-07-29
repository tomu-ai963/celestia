/**
 * horizons.test.mjs — JPL Horizons との突き合わせ
 *
 * フィクスチャ（tests/fixtures/horizons/*.csv）を読むだけで、テスト中に API は叩かない。
 * 再取得は `node tools/fetch-horizons.mjs`。取得条件の詳細はそのファイルの先頭に書いてある。
 *
 * ■ 何と何を比べているか
 * vectors.csv は VEC_CORR='LT' の astrometric（光行時間補正のみ・年周光行差なし）を
 * **J2000 の平均黄道**で持っている。Horizons のベクトル出力に of-date 黄道の選択肢が
 * ないためで、こちらで src/precession.mjs を通して of-date に移してから比べる。
 * computeChart の出力も同じ定義（光行時間あり・光行差なし・章動なし）に揃えてある。
 *
 * ただしこの経路は歳差を自前実装で往復するので、フレームの取り違えは検出できない。
 * それは apparent.csv（quantity 31 = **of-date** の視位置）との比較と、
 * tests/frame.test.mjs の春分テストが受け持つ。
 *
 * ■ 残差の内訳（結論）
 * 光行時間は実装済み、年周光行差は定義上こちらに入らない条件で取っているので、
 * 残差はほぼ全部 JPL 近似軌道要素そのものの誤差。実際、同じ天体の**日心**黄経を
 * Horizons と比べても同じ大きさの残差が出る（地心化の過程は寄与していない）。
 * JPL 自身が公表する 1800–2050 の日心黄経の公称誤差
 * （水星15″ 金星20″ 地球20″ 火星40″ 木星400″ 土星600″ 天王星50″ 海王星10″
 *   https://ssd.jpl.nasa.gov/planets/approx_pos.html ）とも整合する。
 * したがって木星・土星・天王星は ±1′ に入らない。これはモデルの上限であって
 * バグではないので、閾値を天体ごとに分けて実測値で固定してある。
 *
 * ■ 時系（P3.5）
 * フィクスチャの JD は **TDB**（apparent.csv は TT。両者の差は 2ms）。
 * 一方 computeChart の入口は **UT** なので、比較の前に ttToUT() で戻す。
 * ここを省くと ΔT ぶん（2000年で 64秒）ずれた瞬間と比べることになり、
 * 月に 35″ の見かけの残差が乗って P3 で測った値と変わってしまう。
 * 歳差変換に使う T はフィクスチャの JD（力学時）からそのまま作る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeChart, toApparent } from '../src/astro.mjs';
import { precessEcl } from '../src/precession.mjs';
import { ttToUT } from '../src/deltat.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'horizons');
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const norm = a => ((a % 360) + 360) % 360;
const signed = a => ((a % 360) + 540) % 360 - 180;

function readCsv(name) {
  return readFileSync(join(DIR, name), 'utf8').split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .slice(1)
    .map(l => l.split(','));
}

/** 単位球上の2点の離角（秒角） */
function sepArcsec(a, b) {
  const c = Math.sin(a.lat * D2R) * Math.sin(b.lat * D2R)
    + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((a.lon - b.lon) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R2D * 3600;
}

const yearOf = jd => Math.round(1800 + (jd - 2378511) / 365.25);

/**
 * 天体ごとの許容（秒角）。目標は ±1′ = 60″ で、7天体はそれを満たす。
 * 木星・土星・天王星だけ JPL 近似要素の限界で超えるため、実測の最大に
 * 余裕を少し足した値で固定している（悪化したら気づけるように緩めすぎない）。
 */
const TOLERANCE = {
  sun: 60, moon: 60, mercury: 60, venus: 60, mars: 60,
  neptune: 60, pluto: 60,
  uranus: 100,     // 実測 83″（JPL 公称 50″）
  jupiter: 400,    // 実測 323″（JPL 公称 400″）
  saturn: 700      // 実測 609″（JPL 公称 600″）
};

test('Horizons astrometric との離角（許容 ±1′、外惑星3天体は近似要素の限界）', () => {
  const rows = readCsv('vectors.csv');
  const per = {};
  for (const [body, jdS, xS, yS, zS] of rows) {
    const jd = +jdS, x = +xS, y = +yS, z = +zS;   // jd は TDB
    const T = (jd - 2451545.0) / 36525;
    // Horizons の J2000 黄道ベクトル → 角度 → of-date
    const ref = precessEcl(
      norm(Math.atan2(y, x) * R2D),
      Math.asin(z / Math.hypot(x, y, z)) * R2D, T);
    const got = computeChart(ttToUT(jd), 0, 0)[body];
    (per[body] ??= []).push({
      year: yearOf(jd),
      sep: sepArcsec(got, ref),
      dlon: signed(got.lon - ref.lon) * 3600,
      dlat: (got.lat - ref.lat) * 3600
    });
  }

  const lines = ['  天体      最大離角  平均離角   最大Δ黄経  最大Δ黄緯   最悪の年  許容'];
  for (const [body, a] of Object.entries(per)) {
    const worst = a.reduce((p, c) => (c.sep > p.sep ? c : p));
    const mean = a.reduce((s, c) => s + c.sep, 0) / a.length;
    lines.push('  ' + body.padEnd(9)
      + `${worst.sep.toFixed(1)}″`.padStart(9)
      + `${mean.toFixed(1)}″`.padStart(9)
      + `${Math.max(...a.map(c => Math.abs(c.dlon))).toFixed(1)}″`.padStart(11)
      + `${Math.max(...a.map(c => Math.abs(c.dlat))).toFixed(1)}″`.padStart(10)
      + String(worst.year).padStart(10)
      + `${TOLERANCE[body]}″`.padStart(7));
  }
  console.log('  JPL Horizons astrometric との残差（' + rows.length / 10 + 'エポック × 10天体）\n'
    + lines.join('\n'));

  for (const [body, a] of Object.entries(per)) {
    const worst = a.reduce((p, c) => (c.sep > p.sep ? c : p));
    assert.ok(worst.sep < TOLERANCE[body],
      `${body}: ${worst.year}年で ${worst.sep.toFixed(1)}″（許容 ${TOLERANCE[body]}″）`);
  }
  assert.equal(Object.keys(per).length, 10);
});

test('±1′ を満たす天体と満たさない天体の内訳が変わっていない', () => {
  const rows = readCsv('vectors.csv');
  const worst = {};
  for (const [body, jdS, xS, yS, zS] of rows) {
    const jd = +jdS, x = +xS, y = +yS, z = +zS;
    const T = (jd - 2451545.0) / 36525;
    const ref = precessEcl(norm(Math.atan2(y, x) * R2D),
      Math.asin(z / Math.hypot(x, y, z)) * R2D, T);
    const s = sepArcsec(computeChart(ttToUT(jd), 0, 0)[body], ref);
    worst[body] = Math.max(worst[body] ?? 0, s);
  }
  const over = Object.entries(worst).filter(([, s]) => s > 60).map(([b]) => b).sort();
  assert.deepEqual(over, ['jupiter', 'saturn', 'uranus'],
    `±1′ を超える天体: ${over.join(',')}`);
});

test('of-date フレームの健全性 — Horizons apparent と 60″ 以内', () => {
  // apparent.csv は quantity 31（of-date の視位置）。こちらは astrometric なので
  // 年周光行差（最大20.5″）と章動（±17″）を足してから比べる。
  // フレームを取り違えていれば 1.4° = 5000″ 級のずれになるので、この検査は
  // 「歳差を自前で往復させない」経路でフレームを押さえる役目を持つ。
  // 許容は上の astrometric 比較と同じ理由で天体ごとに分ける。
  const rows = readCsv('apparent.csv');
  let worstBody = null, worstSep = 0;
  for (const [body, jdS, lonS, latS] of rows) {
    const jd = +jdS, T = (jd - 2451545.0) / 36525;   // jd は TT
    const got = toApparent(computeChart(ttToUT(jd), 0, 0)[body], T);
    const sep = sepArcsec(got, { lon: +lonS, lat: +latS });
    assert.ok(sep < TOLERANCE[body] + 5,
      `${body} ${yearOf(jd)}年: apparent との離角 ${sep.toFixed(1)}″`);
    if (sep > worstSep && TOLERANCE[body] === 60) { worstSep = sep; worstBody = `${body}`; }
  }
  console.log(`  ±1′ 群での apparent 比較の最大離角: ${worstBody} ${worstSep.toFixed(1)}″`);
});
