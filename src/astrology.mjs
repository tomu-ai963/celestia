/**
 * astrology.mjs — 占星術レイヤー（ASC/MC・ハウス・アスペクト・解釈の接続点）
 *
 * ■ 依存の向きは一方向（P4 の設計上の制約）
 * このモジュールは天文コア（astro.mjs / nutation.mjs / precession.mjs / deltat.mjs）の
 * **出力を入力として受け取るだけ**で、コア側にはいっさい手を入れない。
 * 逆向きの依存（コアが占星術の概念を知る）を作らないこと。理由:
 *   - このアプリの出発点は「天体が実際にどこにいたか」であって、ハウスやアスペクトは
 *     その上に載る解釈の層。コアに混ぜると、天文的な正しさの検証（Horizons 比較・
 *     フレームの検査）に占星術の約束事が混入して、何を検証しているのか分からなくなる
 *   - 占星術レイヤーは既定オフのオプトイン層。オフのときに計算も読み込みも発生しない
 *     構造でないと「既定オフ」が名ばかりになる
 * tests/astrology.test.mjs の最後のテストがこの向きを回帰ガードとして押さえている。
 *
 * ■ 時系とフレーム（P3 / P3.5 の帰結をそのまま引き継ぐ）
 * ASC / MC の材料は2つだけ:
 *   RAMC（子午線の赤経）= 地方恒星時 … computeChart が UT から作った `chart._lst` を**再利用**する
 *   ε（黄道傾斜角）                  … `chart._T`（TT 基準）から of-date の平均値を取る
 * LST を自前で計算し直さないのは、二重実装を作ると P3.5 で分けた jdUT / jdTT の
 * 取り違えがこの層で再発しうるため（GMST に TT を渡すと地平線が 0.27° 回る）。
 * ε を of-date にするのは、P3 で全天体を分点 of-date に統一したから。J2000 の ε を
 * 使うと ASC/MC だけが別フレームに乗る。
 *
 * ■ 一次資料
 *   ASC / MC の式: Meeus, Astronomical Algorithms 2nd ed., ch.13（座標変換）
 *     および同 ch.25 の RAMC。式そのものは球面三角の直接の帰結。
 *   プラシーダス: 半弧（semi-arc）の3等分という定義から本ファイル内で導出している
 *     （下の placidusCusp のコメント参照）。閉形式がないので反復解。
 */
import { norm, deltaLon, D2R, R2D, sin, cos, BODIES, GLYPH } from './astro.mjs';
import { meanObliquity } from './nutation.mjs';

const tan = a => Math.tan(a * D2R);
const asin = v => Math.asin(Math.max(-1, Math.min(1, v))) * R2D;

/* ============================================================
   1. ASC / MC
   ============================================================ */

/**
 * 緯度の上限。±90° では tan φ が発散し、地平線が天の赤道と一致して
 * 「東の地平線」が定義できなくなる（極点では黄道は昇りも沈みもしない）。
 * 入力を弾くのではなく丸めるのは、緯度スライダーを端まで動かしただけで
 * 画面が壊れるのを避けるため。丸めた事実は latUsed で返す。
 */
export const MAX_LAT = 89.9;

/**
 * ASC / MC とその対向点（度・分点 of-date の黄経）。
 *
 *   MC : λ = atan2(sin RAMC, cos RAMC · cos ε)
 *        = 子午線（時角 0）と黄道の交点。RAMC と同じ象限に来るので atan2 で足りる
 *   ASC: λ = atan2(cos RAMC, −(sin RAMC · cos ε + tan φ · sin ε))
 *        = 地平線と黄道の交点のうち**東側**（昇っていく側）
 *
 * 象限を取り違えると ASC がそのまま DSC（下降点）になり、ホロスコープが
 * 180° 回る。atan2 の引数の順序と符号がその分かれ目なので、
 * tests/astrology.test.mjs では既存の天頂ベクトル経路で高度 0°・方位が東半分に
 * あることを実際に検算している（式の再実装で照合しても同じ間違いが再現するため）。
 */
export function ascMc(chart, latDeg) {
  const ramc = chart._lst;                       // = 地方恒星時（UT 由来。再計算しない）
  const eps = meanObliquity(chart._T);           // of-date の平均黄道傾斜角
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, latDeg));
  const mc = norm(Math.atan2(sin(ramc), cos(ramc) * cos(eps)) * R2D);
  const asc = norm(Math.atan2(cos(ramc),
    -(sin(ramc) * cos(eps) + tan(phi) * sin(eps))) * R2D);
  return { asc, mc, dsc: norm(asc + 180), ic: norm(mc + 180), ramc, eps, latUsed: phi };
}

/* ============================================================
   2. ハウス分割
   ============================================================ */

export const HOUSE_METHODS = [
  { k: 'whole',    n: 'ホールサイン', d: 'ASC のあるサインの 0° を第1ハウスの始点にする' },
  { k: 'equal',    n: 'イコール',     d: 'ASC を第1ハウスの始点にして 30° ずつ区切る' },
  { k: 'placidus', n: 'プラシーダス', d: '半弧の3等分（高緯度では計算できない）' }
];

/** 黄道上の点の赤経 α → 黄経 λ。tan λ = tan α / cos ε（象限は α と同じ） */
function eclLonFromRA(ra, eps) {
  return norm(Math.atan2(sin(ra), cos(ra) * cos(eps)) * R2D);
}

/**
 * プラシーダスのカスプ1本を反復で解く。
 *
 * ■ 定義から式へ
 * 赤緯 δ の点の半昼弧は SD = 90° + AD（AD = 出没差 = asin(tan φ · tan δ)）。
 * プラシーダスは「MC → ASC の時間を3等分」「ASC → IC の時間を3等分」する分割なので、
 * 時角 H で書くと
 *   11室 H = −SD/3        12室 H = −2SD/3
 *   2室  H = −SD − ND/3   3室  H = −SD − 2ND/3   （ND = 半夜弧 = 90° − AD）
 * α = RAMC − H に入れて整理すると、どれも
 *   α = RAMC + offset + factor × AD      (11: 30°,1/3  12: 60°,2/3  2: 120°,2/3  3: 150°,1/3)
 * になる。AD は δ に、δ は λ に、λ は α に依存するので閉形式では解けない。
 * α の初期値を AD=0 として反復する（実測で 3〜6回で 1e-9° に収まる）。
 *
 * ■ 解けない場合
 * |tan φ · tan δ| ≥ 1 は「その赤緯の点がその緯度では昇らない（または沈まない）」こと。
 * 半弧が定義できないのでプラシーダスも定義できない。**例外は投げず ok:false を返す**。
 * 呼び出し側でホールサインへ落とし、UI にその旨を出す責任を持たせる。
 */
function placidusCusp(ramc, eps, phi, offset, factor, maxIter = 100, tol = 1e-9) {
  let lon = eclLonFromRA(norm(ramc + offset), eps);
  for (let i = 0; i < maxIter; i++) {
    const dec = asin(sin(eps) * sin(lon));
    const t = tan(phi) * tan(dec);
    if (Math.abs(t) >= 1) return { ok: false, reason: 'circumpolar', dec };
    const next = eclLonFromRA(norm(ramc + offset + factor * asin(t)), eps);
    const moved = Math.abs(deltaLon(lon, next));
    lon = next;
    if (moved < tol) return { ok: true, lon, iter: i + 1 };
  }
  return { ok: false, reason: 'noconverge' };
}

/** プラシーダスの4本（11・12・2・3室）。1本でも解けなければ全体を不成立とする */
function placidusCusps(ramc, eps, phi) {
  const spec = [[30, 1 / 3], [60, 2 / 3], [120, 2 / 3], [150, 1 / 3]];
  const got = [], detail = [];
  let iter = 0;
  for (const [offset, factor] of spec) {
    const r = placidusCusp(ramc, eps, phi, offset, factor);
    if (!r.ok) return { ok: false, reason: r.reason, dec: r.dec };
    got.push(r.lon); iter = Math.max(iter, r.iter); detail.push(r.iter);
  }
  return { ok: true, h11: got[0], h12: got[1], h2: got[2], h3: got[3], iter, detail };
}

export const FALLBACK_TEXT = {
  circumpolar: 'この緯度・時刻ではプラシーダスを計算できません（黄道の一部が地平線を昇らないため）',
  noconverge: 'この緯度・時刻ではプラシーダスの反復が収束しません'
};

/**
 * ハウスカスプ12本（度）。cusps[0] が第1ハウスの始点。
 *
 * 返り値の method は**実際に使った方式**、requested は要求された方式。
 * プラシーダスが解けなかった場合は fallback に理由が入り、method は 'whole' になる。
 * 黙って別方式に変わるのが最悪なので、UI はここを見て必ず表示すること。
 */
export function computeHouses(chart, latDeg, requested = 'whole') {
  const a = ascMc(chart, latDeg);
  const equal = () => Array.from({ length: 12 }, (_, i) => norm(a.asc + 30 * i));
  const whole = () => {
    const start = Math.floor(a.asc / 30) * 30;
    return Array.from({ length: 12 }, (_, i) => norm(start + 30 * i));
  };
  if (requested === 'equal') return { ...a, method: 'equal', requested, cusps: equal(), fallback: null };
  if (requested === 'placidus') {
    const p = placidusCusps(a.ramc, a.eps, a.latUsed);
    if (p.ok) {
      // 10室 = MC / 1室 = ASC。残り6本は対向点（プラシーダスは対向するカスプが
      // 必ず 180° 対称になる分割なので、反復は4本だけで足りる）
      const c = new Array(12);
      c[0] = a.asc;            c[1] = p.h2;             c[2] = p.h3;
      c[3] = norm(a.mc + 180); c[4] = norm(p.h11 + 180); c[5] = norm(p.h12 + 180);
      c[6] = norm(a.asc + 180); c[7] = norm(p.h2 + 180); c[8] = norm(p.h3 + 180);
      c[9] = a.mc;             c[10] = p.h11;           c[11] = p.h12;
      return { ...a, method: 'placidus', requested, cusps: c, fallback: null, iter: p.iter };
    }
    return {
      ...a, method: 'whole', requested, cusps: whole(),
      fallback: { reason: p.reason, text: FALLBACK_TEXT[p.reason] }
    };
  }
  return { ...a, method: 'whole', requested: 'whole', cusps: whole(), fallback: null };
}

/** 黄経 lon が入るハウス番号（1..12） */
export function houseOf(lon, cusps) {
  for (let i = 0; i < 12; i++) {
    const span = norm(cusps[(i + 1) % 12] - cusps[i]) || 360;
    if (norm(lon - cusps[i]) < span) return i + 1;
  }
  return 12;
}

/* ============================================================
   3. アスペクト
   ============================================================ */

export const ASPECTS = [
  { k: 'conjunction', n: 'コンジャンクション', sym: '☌', deg: 0,   c: 0xd9b45f, w: 1.0 },
  { k: 'opposition',  n: 'オポジション',       sym: '☍', deg: 180, c: 0xc4708f, w: 1.0 },
  { k: 'trine',       n: 'トライン',           sym: '△', deg: 120, c: 0x7d9fd0, w: 0.85 },
  { k: 'square',      n: 'スクエア',           sym: '□', deg: 90,  c: 0xe07a5f, w: 0.85 },
  { k: 'sextile',     n: 'セクスタイル',       sym: '⚹', deg: 60,  c: 0x7fb09c, w: 0.55 }
];

/**
 * 天体ごとの基準オーブ（度）。
 *
 * 根拠: 伝統的な「モイエティ（moiety = 各天体の持つオーブの半分）を足し合わせる」
 * 方式（Lilly, Christian Astrology, 1647）の並びを、現代の一般的な設定に寄せたもの。
 * 序列の理由は明快で **見かけの明るさと動きの速さ**:
 *   太陽・月   … 視直径が 0.5° あり、光度も桁違い。伝統的にも最大のオーブ
 *   水星〜火星 … 個人天体。動きが速く、合致の瞬間が短い
 *   木星〜冥王星… 動きが遅く、同じ配置が長く続くので広げると常時どれかが成立してしまう
 *   交点・リリス… 実体のある天体ではなく平均要素上の点。狭くしないと数が増えるだけ
 * 2天体のオーブは (orbA + orbB) / 2 × アスペクト係数（ASPECTS の w）で合成する。
 * 係数はメジャー（合・衝）を 1.0、四分位・三分位を 0.85、六分位を 0.55 とした。
 * **UI から倍率で調整できる**ので、ここは既定値であって主張ではない。
 */
export const ORBS = {
  sun: 9, moon: 9,
  mercury: 7, venus: 7, mars: 7,
  jupiter: 6, saturn: 6,
  uranus: 5, neptune: 5, pluto: 5,
  node: 3, lilith: 3
};

/** 段階表示用の天体セット。既定は主要7天体（12天体すべてだと最大66本になる） */
export const BODY_SETS = [
  { k: 'core',  n: '主要7天体', keys: ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'] },
  { k: 'outer', n: '＋外惑星',  keys: ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] },
  { k: 'all',   n: '全12天体',  keys: BODIES.map(b => b.k) }
];

/**
 * アスペクトの抽出。
 *
 * ■ **黄経のみで判定する。3D 空間の角距離ではない。**
 * 占星術のアスペクトは黄道への投影角として定義されている量なので、`p.lon` だけを見る。
 * 黄緯を入れると（＝実際の離角で測ると）判定が変わる天体がある:
 *   月     … 黄緯 ±5.1°   オーブ 9° の合が 10.4° の離角になり得る
 *   冥王星 … 黄緯 ±17°    オーブ 5° の合が 17.7° の離角になり得る
 * どちらを採るかは定義の問題であって精度の問題ではない。ここは定義に従う。
 * tests/astrology.test.mjs が「黄緯を変えても結果が1件も変わらないこと」で固定している。
 *
 * ■ 接近 / 分離
 * P2 の中心差分（astro.mjs の lonRates）で各天体の黄経速度が取れているので、
 * 相対速度の符号で判定できる。オーブの符号と相対速度の符号が逆なら接近。
 * rates を渡さなければ applying は null（判定しない）。
 *
 * ■ 1ペアにつき1本（onePerPair）
 * 既定のオーブでは2種類のアスペクトが同時に成立することはないが、UI の倍率を
 * 上げると起こりうる（例: 離角 72° は倍率3倍でセクスタイルにもスクエアにも入る）。
 * 2天体の関係は1つとして扱いたいので、既定では最も正確なほうだけを残す。
 * 重なりの様子そのものを見たい場合は onePerPair:false。
 */
export function findAspects(chart, opts = {}) {
  const {
    rates = null, orbScale = 1, orbs = ORBS, onePerPair = true,
    bodies = BODY_SETS[0].keys,
    aspects = ASPECTS.map(a => a.k)
  } = opts;
  const use = ASPECTS.filter(a => aspects.includes(a.k));
  const out = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const ka = bodies[i], kb = bodies[j];
      const pa = chart[ka], pb = chart[kb];
      if (!pa || !pb) continue;
      const sep = deltaLon(pa.lon, pb.lon);            // 符号つき離角（黄経のみ）
      const hits = [];
      for (const asp of use) {
        // 0° と 180° は符号を持たない。それ以外は近いほうの符号に合わせる
        const target = asp.deg === 0 ? 0 : (sep < 0 ? -asp.deg : asp.deg);
        const orb = sep - target;                       // 正確な角度からのずれ（符号つき）
        const maxOrb = ((orbs[ka] ?? 5) + (orbs[kb] ?? 5)) / 2 * asp.w * orbScale;
        if (Math.abs(orb) > maxOrb) continue;
        // 相対速度。orb が縮む向きなら接近（applying）
        let applying = null;
        if (rates && rates[ka] != null && rates[kb] != null) {
          const d = rates[kb] - rates[ka];              // orb の時間変化率
          applying = orb === 0 ? true : (d * Math.sign(orb) < 0);
        }
        hits.push({
          a: ka, b: kb, aspect: asp.k, deg: asp.deg, sym: asp.sym, color: asp.c,
          sep, orb, orbAbs: Math.abs(orb), maxOrb,
          tightness: 1 - Math.abs(orb) / maxOrb,        // 1 = 正確 / 0 = オーブの端
          applying
        });
      }
      hits.sort((x, y) => x.orbAbs - y.orbAbs);
      out.push(...(onePerPair ? hits.slice(0, 1) : hits));
    }
  }
  return out.sort((x, y) => x.orbAbs - y.orbAbs);
}

/* ============================================================
   4. 解釈テキストの接続点（インターフェースのみ）
   ============================================================ */

/**
 * 解釈データの差し替え点。
 *
 * ■ テキストをこのリポジトリに入れない理由
 * 接続先に想定しているのは **とむMYSTIC の解釈テキストで、別プロダクトの資産**。
 * このリポジトリのコードは MIT、`data/` は CC BY-SA の派生物という切り分けで
 * 帰属を整理してあり、そこへ第三のライセンスの本文を混ぜると、
 * リポジトリを clone した人が「どれをどの条件で使えるのか」を判断できなくなる。
 * したがってここに置くのは**キーの形と受け渡しの型だけ**で、本文は実行時に外から渡す。
 *
 * ■ キーの形（すべて小文字・'/' 区切り）
 *   body/<天体>/sign/<サイン>     例: body/sun/sign/leo
 *   body/<天体>/house/<1..12>     例: body/moon/house/7
 *   angle/asc/sign/<サイン>       ASC・MC のサイン（angle/mc/sign/...）
 *   aspect/<種別>/<天体A>/<天体B> 例: aspect/trine/sun/moon（A,B は BODIES の並び順）
 *
 * ■ 差し替え方
 *   import { setInterpreter } from './src/astrology.mjs';
 *   setInterpreter(async keys => (await fetch('/my/texts.json').then(r => r.json())));
 * 戻り値は「キー → 文字列」のオブジェクト。持っていないキーは省略してよい。
 */
export const NO_INTERPRETATION = async () => ({});

let interpreter = NO_INTERPRETATION;

/** 解釈プロバイダを差し替える（null で既定のスタブへ戻す） */
export function setInterpreter(fn) { interpreter = typeof fn === 'function' ? fn : NO_INTERPRETATION; }
export function getInterpreter() { return interpreter; }
/** 既定のスタブのままか（UI の「解釈データ未接続」表示の判定に使う） */
export function hasInterpreter() { return interpreter !== NO_INTERPRETATION; }

const SIGN_KEYS = GLYPH.map(g => g.toLowerCase());
export const signKey = lon => SIGN_KEYS[Math.floor(norm(lon) / 30)];

/** チャートから解釈キーを組み立てる（重複は除く） */
export function interpretationKeys({ chart, houses = null, aspects = [], bodies = BODIES.map(b => b.k) }) {
  const keys = [];
  for (const k of bodies) {
    const p = chart[k]; if (!p) continue;
    keys.push(`body/${k}/sign/${signKey(p.lon)}`);
    if (houses) keys.push(`body/${k}/house/${houseOf(p.lon, houses.cusps)}`);
  }
  if (houses) {
    keys.push(`angle/asc/sign/${signKey(houses.asc)}`);
    keys.push(`angle/mc/sign/${signKey(houses.mc)}`);
  }
  for (const a of aspects) keys.push(`aspect/${a.aspect}/${a.a}/${a.b}`);
  return [...new Set(keys)];
}

/**
 * 解釈テキストの取得。**既定のスタブは常に空を返す**（テキストを同梱しないため）。
 * プロバイダが落ちても占星術レイヤーの描画は続くべきなので、例外は握って空を返す。
 */
export async function interpret(keys) {
  try {
    const r = await interpreter(keys);
    if (!r || typeof r !== 'object') return {};
    const out = {};
    for (const k of keys) if (typeof r[k] === 'string' && r[k]) out[k] = r[k];
    return out;
  } catch {
    return {};
  }
}
