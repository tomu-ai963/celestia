/**
 * astrology.test.mjs — ASC/MC・ハウス・アスペクト・解釈の接続点（P4）
 *
 * ■ 何を検証していて、何を検証していないか
 * ASC/MC は外部の占星術ソフトと突き合わせていない。突き合わせても
 * 「同じ式を実装した2つのプログラムが同じ答えを出した」以上のことは分からず、
 * 象限の取り違え（ASC が DSC になる類）は両方で同じように出うる。
 * 代わりに **既存の天頂ベクトル・地平線の計算経路**（computeChart の `_zenith`）を
 * 使って、ASC が本当に地平線上（高度 0°）にあり、本当に昇っていく側にあることを
 * 確かめる。ASC/MC の定義そのものから出る性質なので、
 * 「三角関数の式」と「3D の地平線」という独立な2実装が互いを検証する形になる。
 *
 * ここで使う地平座標系の基底（北・東）だけはこのファイルで組む:
 *   up    = chart._zenith（アプリ本体が地平線を描くのに使っているベクトルそのもの）
 *   north = 天の北極を地平面へ射影して正規化
 *   east  = north × up
 * 天の北極の黄道直交座標は (0, sin ε, cos ε)。これは computeChart が
 * 赤道 → 黄道 に回すときの行列の第3列と同じもの。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { julianDay, computeChart, lonRates, norm, deltaLon, R2D, sin, cos, BODIES } from '../src/astro.mjs';
import { meanObliquity } from '../src/nutation.mjs';
import {
  ascMc, computeHouses, houseOf, findAspects, interpretationKeys, interpret,
  setInterpreter, hasInterpreter, NO_INTERPRETATION, ASPECTS, ORBS, BODY_SETS, MAX_LAT
} from '../src/astrology.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
/** 黄道傾斜角から決まる極圏（|φ| がこれを超えると黄道の一部が昇らない） */
const POLAR = 90 - 23.44;

const vec = (lon, lat = 0) => ({ x: cos(lat) * cos(lon), y: cos(lat) * sin(lon), z: sin(lat) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = v => { const r = Math.hypot(v.x, v.y, v.z); return { x: v.x / r, y: v.y / r, z: v.z / r }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** 黄経（黄緯 0）の点の地平座標。up は本体が地平線描画に使う _zenith をそのまま使う */
function altAz(lonDeg, chart) {
  const eps = meanObliquity(chart._T);
  const up = unit(chart._zenith);
  const ncp = { x: 0, y: sin(eps), z: cos(eps) };
  const d0 = dot(ncp, up);
  const north = unit({ x: ncp.x - up.x * d0, y: ncp.y - up.y * d0, z: ncp.z - up.z * d0 });
  const east = cross(north, up);
  const d = vec(lonDeg);
  return {
    alt: Math.asin(Math.max(-1, Math.min(1, dot(d, up)))) * R2D,
    az: norm(Math.atan2(dot(d, east), dot(d, north)) * R2D)
  };
}
/** 黄経の点の赤経・赤緯と時角（時角は −180..180、負が東側 = まだ南中していない） */
function equatorial(lonDeg, chart) {
  const eps = meanObliquity(chart._T), v = vec(lonDeg);
  const yeq = v.y * cos(eps) - v.z * sin(eps), zeq = v.y * sin(eps) + v.z * cos(eps);
  const ra = norm(Math.atan2(yeq, v.x) * R2D);
  return { ra, dec: Math.asin(Math.max(-1, Math.min(1, zeq))) * R2D, H: deltaLon(ra, chart._lst) };
}

/** 緯度・時刻を広く振ったケース表（南半球・赤道・高緯度・1800/2050 の端を含む） */
const LATS = [0, 35.68, -33.87, 51.51, 64.15, -64.15, 70, -78];
const EPOCHS = [[1800, 1, 15], [1900, 6, 3], [1990, 7, 14], [2026, 3, 21], [2050, 12, 31]];
const CASES = [];
for (const [y, m, d] of EPOCHS) for (const lat of LATS) for (let h = 0; h < 24; h += 3)
  CASES.push({ y, m, d, h, lat, jd: julianDay(y, m, d, h, 0, 0) });

test('ASC は地平線上にある（既存の天頂ベクトル経路で高度 0° ± 0.01°）', () => {
  let worst = 0, at = null;
  for (const c of CASES) {
    const chart = computeChart(c.jd, c.lat, 139.77);
    const { asc } = ascMc(chart, c.lat);
    const alt = altAz(asc, chart).alt;
    if (Math.abs(alt) > worst) { worst = Math.abs(alt); at = c; }
    assert.ok(Math.abs(alt) < 0.01,
      `${c.y}年 ${c.h}時 緯度${c.lat}: ASC ${asc.toFixed(3)}° の高度が ${alt.toFixed(4)}°`);
  }
  console.log(`  ${CASES.length}ケースの最大高度誤差: ${worst.toExponential(2)}° @ `
    + `${at.y}年 緯度${at.lat}`);
  // 180° 取り違え（ASC が DSC）なら高度は 0 のままなので、この検査だけでは足りない。
  // 向きの検査は次の2つ
});

test('ASC は昇っていく側の交点（1分後に地平線より上にある）', () => {
  // 式ではなく実際の時間発展で確かめる。同じ黄経の点を1分後の地平座標系で見て、
  // 高度が正になっていれば昇っている側。DSC を返していれば必ず負になる
  let polarWest = 0;
  for (const c of CASES) {
    const chart = computeChart(c.jd, c.lat, 139.77);
    const { asc } = ascMc(chart, c.lat);
    const after = altAz(asc, computeChart(c.jd + 1 / 1440, c.lat, 139.77)).alt;
    if (Math.abs(c.lat) < POLAR) {
      assert.ok(after > 0,
        `${c.y}年 ${c.h}時 緯度${c.lat}: ASC が1分後に高度 ${after.toFixed(4)}°（沈む側を返している）`);
      // 極圏より低い緯度では方位も必ず東半分（北を0°として東回り）
      const az = altAz(asc, chart).az;
      assert.ok(az > 0 && az < 180,
        `${c.y}年 ${c.h}時 緯度${c.lat}: ASC の方位が ${az.toFixed(1)}°（東半分でない）`);
    } else if (after <= 0) polarWest++;
  }
  // 極圏を超えると「東の地平線」という言い方自体が成り立たなくなる。黄道が大きく傾き、
  // 昇る交点が西側に来る時間帯がある。式は象限を反転させず連続な値を返し続ける
  //（反転させると時間軸のスクラブ中に ASC が 180° 跳ぶ）。この件数が 0 になったら
  // 挙動が変わった合図なので、記録として固定しておく
  console.log(`  極圏（|φ|>${POLAR.toFixed(1)}°）で ASC が昇る側でないケース: ${polarWest} / `
    + `${CASES.filter(c => Math.abs(c.lat) >= POLAR).length}`);
  assert.ok(polarWest > 0, '極圏の例外が消えている（ASC の象限処理が変わった可能性）');
});

test('MC は子午線上にある（時角 0° ± 0.01°、高度は子午線通過高度）', () => {
  let worstH = 0, worstAlt = 0;
  for (const c of CASES) {
    const chart = computeChart(c.jd, c.lat, 139.77);
    const { mc } = ascMc(chart, c.lat);
    const e = equatorial(mc, chart);
    worstH = Math.max(worstH, Math.abs(e.H));
    assert.ok(Math.abs(e.H) < 0.01,
      `${c.y}年 ${c.h}時 緯度${c.lat}: MC の時角が ${e.H.toFixed(4)}°`);
    // 上方の子午線通過高度 = 90° − |φ − δ|。IC を返していればこれとずれる
    const want = 90 - Math.abs(c.lat - e.dec);
    const got = altAz(mc, chart).alt;
    worstAlt = Math.max(worstAlt, Math.abs(got - want));
    assert.ok(Math.abs(got - want) < 0.01,
      `${c.y}年 緯度${c.lat}: MC の高度 ${got.toFixed(3)}° ≠ 子午線通過高度 ${want.toFixed(3)}°`);
  }
  console.log(`  MC の最大時角 ${worstH.toExponential(2)}° / 子午線通過高度との最大差 ${worstAlt.toExponential(2)}°`);
});

test('ASC–DSC と MC–IC が 180° 対向', () => {
  for (const c of CASES) {
    const a = ascMc(computeChart(c.jd, c.lat, 139.77), c.lat);
    assert.ok(Math.abs(Math.abs(deltaLon(a.asc, a.dsc)) - 180) < 1e-9);
    assert.ok(Math.abs(Math.abs(deltaLon(a.mc, a.ic)) - 180) < 1e-9);
  }
});

test('高緯度の丸め — |φ| > 89.9° は 89.9° として扱う（tan φ の発散を避ける）', () => {
  const chart = computeChart(julianDay(2000, 6, 15, 12, 0, 0), 90, 0);
  const a = ascMc(chart, 90);
  assert.equal(a.latUsed, MAX_LAT);
  assert.ok(Number.isFinite(a.asc) && Number.isFinite(a.mc));
});

/* ============================================================
   ハウス分割
   ============================================================ */

test('ホールサインとイコールのカスプ', () => {
  const chart = computeChart(julianDay(1990, 7, 14, 0, 30, 0), 35.68, 139.77);
  const w = computeHouses(chart, 35.68, 'whole');
  const e = computeHouses(chart, 35.68, 'equal');
  assert.equal(w.cusps[0], Math.floor(w.asc / 30) * 30);       // ASC のサインの 0°
  assert.ok(w.cusps[0] <= w.asc && w.asc < w.cusps[0] + 30);
  for (let i = 0; i < 12; i++) {
    assert.ok(Math.abs(deltaLon(norm(w.cusps[0] + 30 * i), w.cusps[i])) < 1e-9);
    assert.ok(Math.abs(deltaLon(norm(e.asc + 30 * i), e.cusps[i])) < 1e-9);
  }
  // ホールサインは ASC がサインのどこにあっても第1ハウスに入る
  assert.equal(houseOf(w.asc, w.cusps), 1);
  assert.equal(houseOf(e.asc, e.cusps), 1);
  assert.equal(houseOf(norm(e.asc + 179), e.cusps), 6);
  assert.equal(houseOf(norm(e.asc + 181), e.cusps), 7);
});

test('プラシーダスは 1室=ASC・10室=MC で、対向カスプが 180° 離れる', () => {
  for (const lat of [35.68, -33.87, 0, 51.51, 64.15]) {
    for (let h = 0; h < 24; h += 2) {
      const chart = computeChart(julianDay(2000, 6, 15, h, 0, 0), lat, 0);
      const H = computeHouses(chart, lat, 'placidus');
      assert.equal(H.method, 'placidus', `緯度${lat} ${h}時で解けない`);
      assert.ok(Math.abs(deltaLon(H.cusps[0], H.asc)) < 1e-9, '1室が ASC でない');
      assert.ok(Math.abs(deltaLon(H.cusps[9], H.mc)) < 1e-9, '10室が MC でない');
      for (let i = 0; i < 6; i++)
        assert.ok(Math.abs(Math.abs(deltaLon(H.cusps[i], H.cusps[i + 6])) - 180) < 1e-9,
          `${i + 1}室と${i + 7}室が対向していない`);
      // ハウスは必ず正の幅を持ち、合計 360° になる（順序が崩れると和が合わない）
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        const span = norm(H.cusps[(i + 1) % 12] - H.cusps[i]);
        assert.ok(span > 0.5 && span < 180, `${i + 1}室の幅が ${span.toFixed(2)}°`);
        sum += span;
      }
      assert.ok(Math.abs(sum - 360) < 1e-6, `幅の合計が ${sum.toFixed(6)}°`);
    }
  }
});

test('プラシーダスのカスプが定義（半弧の3等分）を満たす', () => {
  // カスプの黄経から赤経・赤緯を独立に出し直し、時角が半弧の 1/3・2/3 に
  // 当たっているかを見る。反復が収束していることと符号の向きの検査になる
  //（定義式そのものを別経路で解き直しているわけではない）
  const want = { 10: 0, 11: -1 / 3, 12: -2 / 3, 1: -1, 2: null, 3: null };
  let worst = 0;
  for (const lat of [35.68, -33.87, 51.51, 64.15]) {
    for (let h = 0; h < 24; h += 3) {
      const chart = computeChart(julianDay(2000, 6, 15, h, 0, 0), lat, 0);
      const H = computeHouses(chart, lat, 'placidus');
      for (const [houseNo, frac] of Object.entries(want)) {
        if (frac === null) continue;
        const e = equatorial(H.cusps[(+houseNo) - 1], chart);
        const ad = Math.asin(Math.tan(lat / R2D) * Math.tan(e.dec / R2D)) * R2D;
        const sd = 90 + ad;                       // 半昼弧
        const err = Math.abs(e.H - frac * sd);
        worst = Math.max(worst, err);
        assert.ok(err < 0.01,
          `緯度${lat} ${h}時 ${houseNo}室: 時角 ${e.H.toFixed(4)}° ≠ ${(frac * sd).toFixed(4)}°`);
      }
      // 2室・3室は半夜弧（180° − 半昼弧）側の3等分
      for (const [houseNo, f] of [[2, 1 / 3], [3, 2 / 3]]) {
        const e = equatorial(H.cusps[houseNo - 1], chart);
        const ad = Math.asin(Math.tan(lat / R2D) * Math.tan(e.dec / R2D)) * R2D;
        const sd = 90 + ad, nd = 180 - sd;
        const err = Math.abs(e.H - (-sd - f * nd));
        worst = Math.max(worst, err);
        assert.ok(err < 0.01, `緯度${lat} ${h}時 ${houseNo}室: 時角 ${e.H.toFixed(4)}°`);
      }
    }
  }
  console.log(`  半弧の3等分からの最大ずれ: ${worst.toExponential(2)}°`);
});

test('赤道上ではプラシーダスが赤経の等分になる（出没差 0 の極限）', () => {
  // φ=0 では AD=0 なので、カスプの赤経は RAMC + 30°×n ちょうどになるはず
  const lat = 0, chart = computeChart(julianDay(2000, 6, 15, 7, 0, 0), lat, 0);
  const H = computeHouses(chart, lat, 'placidus');
  for (const [houseNo, off] of [[11, 30], [12, 60], [2, 120], [3, 150]]) {
    const e = equatorial(H.cusps[houseNo - 1], chart);
    assert.ok(Math.abs(deltaLon(norm(H.ramc + off), e.ra)) < 1e-6,
      `${houseNo}室の赤経が RAMC+${off}° からずれる`);
  }
});

test('極圏を超えるとプラシーダスは計算不能を返し、ホールサインへ落ちる', () => {
  const log = [];
  for (const lat of [64.15, -64.15, 70, 78, -78]) {
    let ok = 0; const reasons = {};
    for (let h = 0; h < 24; h++) {
      const chart = computeChart(julianDay(2000, 6, 15, h, 0, 0), lat, 0);
      let H;
      assert.doesNotThrow(() => { H = computeHouses(chart, lat, 'placidus'); },
        `緯度${lat} ${h}時で例外が飛んだ（計算不能は戻り値で表すこと）`);
      if (H.method === 'placidus') { ok++; assert.equal(H.fallback, null); }
      else {
        // 黙って別方式になっていないこと。理由と説明文が必ず付く
        assert.equal(H.method, 'whole');
        assert.equal(H.requested, 'placidus');
        assert.ok(H.fallback && H.fallback.text.length > 0);
        reasons[H.fallback.reason] = (reasons[H.fallback.reason] || 0) + 1;
        assert.equal(H.cusps[0], Math.floor(H.asc / 30) * 30);   // 実体はホールサイン
      }
    }
    log.push(`  緯度${String(lat).padStart(6)}: 成立 ${ok}/24 ${JSON.stringify(reasons)}`);
    if (Math.abs(lat) <= 64.15) assert.equal(ok, 24, `レイキャビク級の緯度で解けない（${lat}）`);
    if (Math.abs(lat) >= 70) assert.ok(ok < 24, `極圏超（${lat}）でも全時刻で解けている`);
  }
  console.log('  プラシーダスの成立状況:\n' + log.join('\n'));
});

/* ============================================================
   アスペクト
   ============================================================ */

/** 黄経だけを指定した最小のチャート（アスペクトは lon しか見ないことの検査に使う） */
const fakeChart = lons => Object.fromEntries(
  Object.entries(lons).map(([k, lon]) => [k, { lon, lat: 0 }]));

test('アスペクトは黄経のみで判定する（黄緯を変えても結果が変わらない）', () => {
  const chart = computeChart(julianDay(1990, 7, 14, 0, 30, 0), 35.68, 139.77);
  const base = findAspects(chart, { bodies: BODY_SETS[2].keys });
  // 月 ±5.1°・冥王星 ±17° という実際に起こりうる黄緯を入れても、1件も変わらないこと。
  // 3D の離角で判定していれば、この操作で必ず件数か orb が動く
  const tilted = {};
  for (const b of BODIES) tilted[b.k] = { ...chart[b.k], lat: b.k === 'pluto' ? 17 : (b.k === 'moon' ? 5.1 : -4) };
  const after = findAspects(tilted, { bodies: BODY_SETS[2].keys });
  assert.equal(after.length, base.length);
  for (let i = 0; i < base.length; i++) {
    assert.equal(after[i].aspect, base[i].aspect);
    assert.equal(after[i].a + after[i].b, base[i].a + base[i].b);
    assert.equal(after[i].orb, base[i].orb);
  }
  assert.ok(base.length > 0, '検査対象のアスペクトが0件（テストが空回りしている）');
  console.log(`  1990-07-14 の全12天体: ${base.length}件`
    + `（最も正確: ${base[0].a}–${base[0].b} ${base[0].sym} orb ${base[0].orbAbs.toFixed(2)}°）`);
});

test('0°/360° をまたぐ合を拾う（deltaLon の再利用）', () => {
  const c = fakeChart({ sun: 359.5, moon: 1.2, mercury: 180.3, venus: 90.0 });
  const got = findAspects(c, { bodies: ['sun', 'moon', 'mercury', 'venus'] });
  const conj = got.find(a => a.a === 'sun' && a.b === 'moon');
  assert.ok(conj && conj.aspect === 'conjunction', '境界をまたぐ合を拾えていない');
  assert.ok(Math.abs(conj.orbAbs - 1.7) < 1e-9, `orb が ${conj.orbAbs}（1.7 のはず）`);
  const opp = got.find(a => a.a === 'sun' && a.b === 'mercury');
  assert.ok(opp && opp.aspect === 'opposition');
  assert.ok(Math.abs(opp.orbAbs - 0.8) < 1e-9);
});

test('接近と分離を相対速度で区別する', () => {
  // 太陽 100° / 月 8° → 差 −92°。スクエア（−90°）に対して orb は −2°。
  // 月のほうが速いので差は 0 に向かって縮む = orb は +方向へ動き、正確な角度へ**接近**する
  const c = fakeChart({ sun: 100, moon: 8 });
  const applying = findAspects(c, { bodies: ['sun', 'moon'], rates: { sun: 0.99, moon: 13.2 } });
  assert.equal(applying[0].aspect, 'square');
  assert.equal(applying[0].applying, true);
  // 月を逆に遅くすれば同じ配置でも分離になる（速度の符号だけで決まることの確認）
  const separating = findAspects(c, { bodies: ['sun', 'moon'], rates: { sun: 0.99, moon: -13.2 } });
  assert.equal(separating[0].applying, false);
  // rates を渡さなければ判定しない（null であって false ではない）
  assert.equal(findAspects(c, { bodies: ['sun', 'moon'] })[0].applying, null);
});

test('オーブの合成と倍率 — 天体セットを広げると件数が増える', () => {
  const chart = computeChart(julianDay(1990, 7, 14, 0, 30, 0), 35.68, 139.77);
  const n = k => findAspects(chart, { bodies: BODY_SETS.find(s => s.k === k).keys }).length;
  assert.ok(n('core') <= n('outer') && n('outer') <= n('all'), '段階的に増えていない');
  const narrow = findAspects(chart, { bodies: BODY_SETS[2].keys, orbScale: 0.5 });
  const wide = findAspects(chart, { bodies: BODY_SETS[2].keys, orbScale: 2 });
  assert.ok(narrow.length < wide.length, 'オーブ倍率が効いていない');
  // 合成は (orbA + orbB)/2 × アスペクト係数 × 倍率
  const c = fakeChart({ sun: 0, saturn: 7.4 });
  const got = findAspects(c, { bodies: ['sun', 'saturn'] });
  assert.equal(got.length, 1);
  assert.ok(Math.abs(got[0].maxOrb - (ORBS.sun + ORBS.saturn) / 2 * 1.0) < 1e-12);
  // 係数の小さいセクスタイルは同じ天体でも狭い
  const sx = ASPECTS.find(a => a.k === 'sextile');
  const c2 = fakeChart({ sun: 0, saturn: 60 + (ORBS.sun + ORBS.saturn) / 2 * sx.w + 0.1 });
  assert.equal(findAspects(c2, { bodies: ['sun', 'saturn'] }).length, 0);
});

test('1ペアにつき1本 — 描画本数は 12天体で 66本を超えない', () => {
  const keys = BODY_SETS[2].keys;
  assert.equal(keys.length * (keys.length - 1) / 2, 66);
  const chart = computeChart(julianDay(2000, 3, 20, 12, 0, 0), 35.68, 139.77);
  // オーブを極端に広げると2種類のアスペクトが同時に成立しうる（例: 離角 72° は
  // セクスタイルにもスクエアにも入る）。既定では正確なほうだけを残す
  const one = findAspects(chart, { bodies: keys, orbScale: 3 });
  assert.equal(new Set(one.map(a => a.a + '|' + a.b)).size, one.length,
    '同じペアで複数のアスペクトが残っている');
  assert.ok(one.length <= 66);
  const raw = findAspects(chart, { bodies: keys, orbScale: 3, onePerPair: false });
  assert.ok(raw.length > one.length, '重なりが起きない条件でテストしている（無意味）');
  // 既定のオーブなら重なりは起きない
  const normal = findAspects(chart, { bodies: keys, onePerPair: false });
  assert.equal(new Set(normal.map(a => a.a + '|' + a.b)).size, normal.length);
});

/* ============================================================
   解釈テキストの接続点
   ============================================================ */

test('解釈は既定で空を返し、外から差し替えられる', async () => {
  const chart = computeChart(julianDay(1990, 7, 14, 0, 30, 0), 35.68, 139.77);
  const houses = computeHouses(chart, 35.68, 'placidus');
  const aspects = findAspects(chart);
  const keys = interpretationKeys({ chart, houses, aspects });
  assert.ok(keys.length > 0);
  assert.ok(keys.some(k => /^body\/sun\/sign\/[a-z]+$/.test(k)), 'サインのキーがない');
  assert.ok(keys.some(k => /^body\/sun\/house\/\d+$/.test(k)), 'ハウスのキーがない');
  assert.ok(keys.some(k => /^angle\/(asc|mc)\/sign\//.test(k)), 'ASC/MC のキーがない');
  assert.equal(new Set(keys).size, keys.length, 'キーが重複している');

  // 既定はスタブ。テキストはこのリポジトリに持たない（README の判断の記録）
  assert.equal(hasInterpreter(), false);
  assert.deepEqual(await interpret(keys), {});

  try {
    setInterpreter(async ks => ({ [ks[0]]: 'テキスト', 'body/none/sign/aries': '無関係' }));
    assert.equal(hasInterpreter(), true);
    const got = await interpret(keys);
    assert.deepEqual(got, { [keys[0]]: 'テキスト' });   // 要求していないキーは落とす

    // プロバイダが落ちても占星術レイヤーは描画を続けられること
    setInterpreter(async () => { throw new Error('network'); });
    assert.deepEqual(await interpret(keys), {});
    // 文字列以外を返してきた場合も無視する
    setInterpreter(async () => ({ [keys[0]]: 42 }));
    assert.deepEqual(await interpret(keys), {});
  } finally {
    setInterpreter(null);
  }
  assert.equal(hasInterpreter(), false);
  assert.equal(NO_INTERPRETATION.constructor.name, 'AsyncFunction');
});

/* ============================================================
   依存の向き
   ============================================================ */

test('天文コアは占星術レイヤーを知らない（依存は一方向）', () => {
  // 逆向きの依存ができると、Horizons 比較やフレームの検査に占星術の約束事が
  // 混入して「何を検証しているのか」が曖昧になる。構造の回帰ガード
  const core = ['astro.mjs', 'precession.mjs', 'deltat.mjs', 'moon.mjs', 'nutation.mjs'];
  const forbidden = /astrology|placidus|プラシーダス|ハウス|アスペクト|ascendant|オーブ/i;
  for (const f of core) {
    const src = readFileSync(join(SRC, f), 'utf8');
    assert.ok(!/from\s+['"]\.\/astrology\.mjs['"]/.test(src), `${f} が astrology.mjs を import している`);
    const hit = src.match(forbidden);
    assert.equal(hit, null, `${f} に占星術の概念が入っている: ${hit && hit[0]}`);
  }
  // 逆に astrology.mjs 側はコアを参照してよい（一方向）
  const astro = readFileSync(join(SRC, 'astrology.mjs'), 'utf8');
  assert.ok(/from\s+'\.\/astro\.mjs'/.test(astro));
});

test('lonRates の速度がそのまま接近判定に渡せる（P2 との接続）', () => {
  const jd = julianDay(2000, 6, 15, 12, 0, 0);
  const chart = computeChart(jd, 35.68, 139.77);
  const rates = lonRates(jd, 0.5, 35.68, 139.77);
  const got = findAspects(chart, { rates, bodies: BODY_SETS[2].keys });
  for (const a of got) assert.equal(typeof a.applying, 'boolean');
  // 逆行中の天体があっても判定は成立する（符号は速度から来るので破綻しない）
  assert.ok(Object.values(rates).some(r => r < 0), 'このテストの日付に逆行天体がいない');
});
