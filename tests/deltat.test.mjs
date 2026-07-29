/**
 * deltat.test.mjs — ΔT（TT − UT1）の値と、適用先の切り分け
 *
 * ここで押さえたいのは値そのものより **どこに適用してどこに適用しないか**。
 *   軌道理論の引数 T  → TT（月は 0.55″/秒 動くので 2050年に約 51″ 効く）
 *   GMST / 地方恒星時 → UT（TT を渡すと 0.27° 地平線が回る）
 * 3つ目のテストがその回帰ガードで、これが落ちたら地平線の向きが壊れている。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  deltaTAtYear, deltaTSeconds, espenakMeeus, jdToDecimalYear, utToTT, ttToUT
} from '../src/deltat.mjs';
import { julianDay, computeChart, gmstDeg, norm, toApparent, PLANETS } from '../src/astro.mjs';
import { moonPos } from '../src/moon.mjs';

const signed = a => ((a % 360) + 540) % 360 - 180;
const jdOf = (y, m, d) => julianDay(y, m, d, 12, 0, 0);

test('ΔT が既知の年で妥当な範囲に入る', () => {
  // 期待値は Espenak–Meeus の各区間の定数項（= その年の観測値のフィット）と
  // USNO deltat.data。許容は ±2秒（月にして 1.1″）で、桁や区間の取り違えは必ず落ちる
  const expect = [
    [1800, 13.7, 2], [1900, -2.8, 2], [1950, 29.1, 2],
    [2000, 63.8, 2], [2025, 69.1, 2], [2050, 93.0, 3]
  ];
  const lines = [];
  for (const [y, want, tol] of expect) {
    const got = deltaTAtYear(y);
    lines.push(`  ${y}: ${got.toFixed(2)}秒 (期待 ${want.toFixed(1)} ±${tol})`);
    assert.ok(Math.abs(got - want) < tol, `${y}年の ΔT = ${got.toFixed(3)}秒（期待 ${want}）`);
  }
  console.log('  ΔT の実測:\n' + lines.join('\n'));
});

test('多項式は 2005年以降の実測から乖離する（テーブルを持つ理由の記録）', () => {
  const rows = [2010, 2015, 2020, 2025].map(y =>
    ({ y, poly: espenakMeeus(y), obs: deltaTAtYear(y) }));
  console.log('  Espenak–Meeus 多項式 vs USNO 観測値:\n'
    + rows.map(r => `  ${r.y}: 多項式 ${r.poly.toFixed(2)}秒 / 観測 ${r.obs.toFixed(2)}秒`
      + ` / 差 ${(r.poly - r.obs).toFixed(2)}秒 (月 ${((r.poly - r.obs) * 0.55).toFixed(1)}″)`).join('\n'));
  const at2020 = rows.find(r => r.y === 2020);
  assert.ok(at2020.poly - at2020.obs > 1.5,
    `2020年で多項式と観測値が近い（${(at2020.poly - at2020.obs).toFixed(2)}秒）— テーブルの意義を再検討すること`);
  // 1973年より前は多項式が当時の観測にフィットされているので、そのまま使える
  assert.ok(Math.abs(espenakMeeus(1973) - deltaTAtYear(1973)) < 0.2,
    'テーブルの下端で多項式と 0.2秒以上ずれる');
});

test('ΔT は 1800–2060 で連続（スクラブ中に位置が飛ばない）', () => {
  // テーブルと多項式の継ぎ目に段差があると、時間軸を動かしたときに月が飛ぶ。
  // 1年あたりの変化率で見て、跳ねがないことを確認する
  let prev = deltaTAtYear(1800), worst = 0, at = 0;
  for (let y = 1800.01; y <= 2060; y += 0.01) {
    const v = deltaTAtYear(y);
    const rate = Math.abs(v - prev) / 0.01;          // 秒/年
    if (rate > worst) { worst = rate; at = y; }
    prev = v;
  }
  console.log(`  ΔT の最大変化率: ${worst.toFixed(2)} 秒/年 @ ${at.toFixed(1)}年`);
  // 実際の変化率は最大 2秒/年 程度。実測の 7.4秒/年 は 1900年にある Espenak–Meeus
  // 自体の 0.09秒 の段差（0.01年刻みで割るとこの数字になる）で、月にして 0.05″。
  // 埋め損ねたテーブルの継ぎ目なら 5.96秒 → 約 600秒/年 になるので、この閾値で捕まる
  assert.ok(worst < 20, `${at.toFixed(2)}年で ${worst.toFixed(1)} 秒/年 の跳ね（継ぎ目の段差）`);
});

test('UT ⇄ TT の往復が誤差なく戻る', () => {
  for (const y of [1800, 1900, 1970, 2000, 2026, 2050]) {
    const jdUT = jdOf(y, 6, 15);
    const back = ttToUT(utToTT(jdUT));
    assert.ok(Math.abs(back - jdUT) * 86400 < 1e-3,
      `${y}年: 往復で ${((back - jdUT) * 86400).toFixed(6)}秒ずれる`);
  }
  // jdToDecimalYear の妥当性（1日以内）
  assert.ok(Math.abs(jdToDecimalYear(jdOf(2000, 1, 1)) - 2000.0) < 0.01);
  assert.ok(Math.abs(jdToDecimalYear(jdOf(1850, 1, 1)) - 1850.0) < 0.01);
});

/* ------------------------------------------------------------------
   適用先の切り分け
   ------------------------------------------------------------------ */

test('月の黄経が ΔT の導入で 2050年に約 50″ 動く', () => {
  const rows = [];
  for (const y of [1900, 2000, 2050]) {
    const jdUT = jdOf(y, 1, 1);
    const withDT = computeChart(jdUT, 0, 0).moon.lon;
    // ΔT 導入前の挙動 = UT の JD をそのまま力学時として使う
    const withoutDT = moonPos((jdUT - 2451545.0) / 36525).lon;
    const d = Math.abs(signed(withDT - withoutDT)) * 3600;
    const dt = deltaTSeconds(jdUT);
    rows.push(`  ${y}: ΔT ${dt.toFixed(1)}秒 → 月の黄経 ${d.toFixed(1)}″`
      + `（0.55″/秒 換算で ${(Math.abs(dt) * 0.55).toFixed(1)}″）`);
    // 月の平均運動 13.176°/日 = 0.5490″/秒。実際の速度は近点で ±11% ぶれる
    assert.ok(Math.abs(d - Math.abs(dt) * 0.549) < Math.abs(dt) * 0.549 * 0.15 + 1,
      `${y}年: 変化 ${d.toFixed(1)}″ が ΔT ${dt.toFixed(1)}秒 から予想される量と合わない`);
  }
  console.log('  ΔT 導入による月の黄経の変化:\n' + rows.join('\n'));

  const jd2050 = jdOf(2050, 1, 1);
  const d2050 = Math.abs(signed(computeChart(jd2050, 0, 0).moon.lon
    - moonPos((jd2050 - 2451545.0) / 36525).lon)) * 3600;
  assert.ok(d2050 > 40 && d2050 < 65, `2050年の変化 ${d2050.toFixed(1)}″（想定 約50″）`);
});

test('GMST は ΔT を入れても変わらない（UT のまま渡っているかの回帰ガード）', () => {
  // computeChart の _lst は gmstDeg(jdUT) + 経度。TT を渡していれば 0.27° ずれる
  const lonDeg = 139.69;
  for (const y of [1900, 2000, 2050]) {
    const jdUT = jdOf(y, 6, 15);
    const lst = computeChart(jdUT, 35.69, lonDeg)._lst;
    const wantUT = norm(gmstDeg(jdUT) + lonDeg);
    assert.ok(Math.abs(signed(lst - wantUT)) * 3600 < 0.01,
      `${y}年: 地方恒星時が UT 基準の GMST と ${(signed(lst - wantUT) * 3600).toFixed(2)}″ 違う`);

    // 取り違えたときの大きさも記録しておく（ガードが効いている証拠）
    const wrong = norm(gmstDeg(utToTT(jdUT)) + lonDeg);
    const bug = Math.abs(signed(wrong - wantUT)) * 3600;
    const dt = Math.abs(deltaTSeconds(jdUT));
    assert.ok(Math.abs(bug - dt * 15.041) < dt * 0.5 + 1,
      `${y}年: TT を渡したときのずれ ${bug.toFixed(0)}″ が ΔT×15.041″/秒 と合わない`);
    if (y === 2000) {
      console.log(`  2000年に GMST へ TT を渡した場合のずれ: ${bug.toFixed(0)}″`
        + ` = ${(bug / 3600).toFixed(3)}°`);
      assert.ok(bug > 900, `想定 963″ に対して ${bug.toFixed(0)}″`);
    }
  }
});

test('天頂ベクトルが UT に追従している（時刻を TT にすると 0.27° 傾く）', () => {
  // _lst だけでなく、そこから作る天頂ベクトルまで含めて押さえる。
  // 同じ UT を渡したときと、うっかり TT を渡したときで天頂がどれだけ動くかを測り、
  // それが ΔT × 15″/秒 と一致することを確かめる（＝天頂は UT の関数になっている）
  const sepArcsec = (a, b) => Math.acos(Math.max(-1, Math.min(1,
    a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI * 3600;
  for (const y of [1900, 2000, 2050]) {
    const jdUT = jdOf(y, 6, 15);
    const dt = Math.abs(deltaTSeconds(jdUT));
    const ok = computeChart(jdUT, 35.69, 139.69)._zenith;
    const bug = computeChart(utToTT(jdUT), 35.69, 139.69)._zenith;
    const sep = sepArcsec(ok, bug);
    // 天頂は自転軸まわりに回るので、緯度 35.69° では 15.041″/秒 × cos(lat) より
    // 小さくならない範囲でずれる。桁が合っていれば十分
    assert.ok(sep > dt * 15.041 * 0.5 && sep < dt * 15.041 * 1.2,
      `${y}年: TT を渡したときの天頂のずれ ${sep.toFixed(0)}″（ΔT ${dt.toFixed(0)}秒）`);
    if (y === 2000) console.log(`  2000年に天頂へ TT を渡した場合のずれ: ${sep.toFixed(0)}″`);
  }
});

test('太陽・惑星の黄経の変化は地心の日運動どおり（外惑星は 1″ 未満）', () => {
  /*
   * 当初は「惑星は一律 1″ 未満」と見込んでいたが、実測すると内惑星はもっと動く。
   * ΔT が効く量は **地心での日運動 × ΔT** そのもので、地心の日運動は
   * 水星 1.6°/日・金星 1.2°/日・太陽 0.99°/日 と速い（BODIES の mo）。
   * 2050年の ΔT 93秒 なら水星で 6″ 前後になる。
   * 1″ 未満で収まるのは木星（0.083°/日）から外側だけ。
   * いずれも月の 51″ に比べれば小さく、Horizons 残差（水星 6.1″ / 金星 29.2″）と
   * 同程度なので、この量が新たな精度の支配要因になることはない。
   */
  const RATE = { sun: 0.986, mercury: 1.6, venus: 1.2, mars: 0.52, jupiter: 0.083,
    saturn: 0.033, uranus: 0.012, neptune: 0.006, pluto: 0.004 };
  const OUTER = ['jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  const lines = ['    年   ΔT      ' + Object.keys(RATE).map(k => k.slice(0, 4).padStart(7)).join('')];

  for (const y of [1900, 2000, 2050]) {
    const jdUT = jdOf(y, 1, 1);
    const dt = (utToTT(jdUT) - jdUT) * 86400;
    const withDT = computeChart(jdUT, 0, 0);
    // ΔT なしの挙動 = UT の JD をそのまま力学時として使う
    const withoutDT = computeChart(ttToUT(jdUT), 0, 0);
    const d = {};
    for (const k of ['sun', ...PLANETS]) {
      d[k] = Math.abs(signed(withDT[k].lon - withoutDT[k].lon)) * 3600;
    }
    lines.push(`  ${y} ${dt.toFixed(0).padStart(4)}秒 `
      + Object.keys(RATE).map(k => `${d[k].toFixed(2)}″`.padStart(7)).join(''));

    for (const [k, rate] of Object.entries(RATE)) {
      // 期待値 = 平均の地心日運動 × ΔT。実際の速度は逆行や離心率で振れるので許容は広め
      const want = Math.abs(dt) / 86400 * rate * 3600;
      assert.ok(d[k] < want * 2.5 + 0.2,
        `${y}年 ${k}: ${d[k].toFixed(2)}″ が日運動 ${rate}°/日 からの予想 ${want.toFixed(2)}″ に対して大きすぎる`);
    }
    for (const k of OUTER) {
      assert.ok(d[k] < 1.0, `${y}年 ${k}: ${d[k].toFixed(2)}″（外惑星は 1″ 未満のはず）`);
    }
    // どの惑星も月（約 51″ @2050）よりはるかに小さいこと
    const worst = Math.max(...Object.values(d));
    assert.ok(worst < 10, `${y}年: 惑星の最大変化 ${worst.toFixed(1)}″`);
  }
  console.log('  ΔT 導入による太陽・惑星の黄経の変化:\n' + lines.join('\n'));
});

/* ------------------------------------------------------------------
   ΔT の適用そのものの検査（唯一 UT 基準で外部と突き合わせる経路）
   ------------------------------------------------------------------ */

test('UT で指定した時刻の Horizons apparent と一致する（ΔT の向きの検査）', () => {
  /*
   * vectors.csv / apparent.csv は時刻を TDB・TT で持っているので、こちらが
   * ΔT を足そうが引こうが ttToUT() で戻す段で打ち消え、**符号の取り違えを検出できない**。
   * ut.csv だけは Horizons 側の時刻を暦日の UT で指定してあるので、
   * 「UT を入れて位置を得る」というアプリと同じ経路をそのまま検査できる。
   *
   * 判定に使えるのは **月だけ**。ΔT が効く量は「日運動 × ΔT」なので、
   * 太陽 2.7″ / 水星 4.1″（2000年）はどちらもモデル自身の残差（太陽 7.4″ /
   * 水星 6.1″）に埋もれてしまい、向きの判定に使えない。
   * 月は 32″ 対 21.7″ で信号のほうが大きく、符号を逆にすれば 2倍の 64″ が乗る。
   * この2天体は「悪化していないこと」の確認だけに使う。
   */
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'horizons');
  const rows = readFileSync(join(dir, 'ut.csv'), 'utf8').split('\n')
    .filter(l => l.trim() && !l.startsWith('#')).slice(1).map(l => l.split(','));

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const sepArcsec = (a, b) => Math.acos(Math.max(-1, Math.min(1,
    Math.sin(a.lat * D2R) * Math.sin(b.lat * D2R)
    + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((a.lon - b.lon) * D2R)
  ))) * R2D * 3600;

  // ut.csv は apparent（年周光行差・章動込み）なので toApparent() を通してから比べる
  const at = (jdUT, body) =>
    toApparent(computeChart(jdUT, 0, 0)[body], (utToTT(jdUT) - 2451545.0) / 36525);

  const acc = {};   // body -> { ok:[], no:[], flip:[] }
  const lines = ['    天体     年   ΔT      現行  ΔTなし  符号逆'];
  for (const [body, yS, , lonS, latS] of rows) {
    const y = +yS;
    const jdUT = julianDay(y, 1, 15, 12, 0, 0);
    const ref = { lon: +lonS, lat: +latS };
    const a = acc[body] ??= { ok: [], no: [], flip: [] };
    a.ok.push(sepArcsec(at(jdUT, body), ref));
    // ΔT なし（P3 までの挙動）= UT をそのまま力学時として使う
    a.no.push(sepArcsec(at(ttToUT(jdUT), body), ref));
    // 符号を逆に適用した場合（−ΔT）。向きの検査はこれと割れるかで決まる
    a.flip.push(sepArcsec(at(ttToUT(ttToUT(jdUT)), body), ref));
    const n = a.ok.length - 1;
    if (body === 'moon') {
      lines.push(`  ${body.padEnd(8)} ${y} ${deltaTSeconds(jdUT).toFixed(0).padStart(3)}秒`
        + `${a.ok[n].toFixed(1)}″`.padStart(9) + `${a.no[n].toFixed(1)}″`.padStart(8)
        + `${a.flip[n].toFixed(1)}″`.padStart(8));
    }
  }
  const rms = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
  for (const [b, a] of Object.entries(acc)) {
    lines.push(`  ${b.padEnd(8)} RMS      ` + `${rms(a.ok).toFixed(1)}″`.padStart(9)
      + `${rms(a.no).toFixed(1)}″`.padStart(8) + `${rms(a.flip).toFixed(1)}″`.padStart(8));
  }
  console.log('  UT 指定の Horizons apparent との離角（7エポック）:\n' + lines.join('\n'));

  const m = acc.moon;
  // 月の残差はモデル自身の限界（Horizons 比較で 21.7″）まで落ちる
  assert.ok(Math.max(...m.ok) < 25,
    `月の最大残差 ${Math.max(...m.ok).toFixed(1)}″ — ΔT の適用が壊れている疑い`);
  // 三者がはっきり順序づくこと。ΔT なし・符号逆はどちらも RMS で明確に悪い
  assert.ok(rms(m.ok) < rms(m.no) * 0.8,
    `月 RMS: 現行 ${rms(m.ok).toFixed(1)}″ が ΔT なし ${rms(m.no).toFixed(1)}″ より十分小さくない`);
  assert.ok(rms(m.flip) > rms(m.ok) * 2.5,
    `月 RMS: 符号逆 ${rms(m.flip).toFixed(1)}″ が現行 ${rms(m.ok).toFixed(1)}″ と割れていない`);
  // ΔT が最大になる 2050年で、符号を逆にすると 60″ を超える（許容 ±1′ を割る）
  const i2050 = 6;
  assert.ok(m.flip[i2050] > 60 && m.ok[i2050] < 25,
    `2050年: 現行 ${m.ok[i2050].toFixed(1)}″ / 符号逆 ${m.flip[i2050].toFixed(1)}″`);

  // 太陽・水星は ΔT がモデル残差に埋もれる。悪化していないことだけ見る
  for (const b of ['sun', 'mercury']) {
    assert.ok(Math.max(...acc[b].ok) < 15, `${b}: ${Math.max(...acc[b].ok).toFixed(1)}″`);
  }
});
