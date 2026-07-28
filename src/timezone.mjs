/**
 * timezone.mjs — IANA タイムゾーン（外部ライブラリなし）
 *
 * P2 までは出生地プリセットに固定オフセットを持たせていたので、夏時間期間の
 * 出生時刻が最大1時間ずれていた。ここをブラウザ組み込みの Intl に移す。
 *
 * ■ なぜ Intl だけで足りるか
 * Intl.DateTimeFormat の timeZone は処理系同梱の IANA tz データベースを引く。
 * 実測（tests/timezone.test.mjs）で以下が正しく出ることを確認している:
 *   日本の 1948–1951 夏時間 (JDT, UTC+10)
 *   米国の戦時 DST (1918 / 1945)
 *   標準時制定前の地方平均時（1800年の東京 = UTC+9:18:59）
 * 追加バイトもライセンス上の依存も増えない。
 *
 * ■ オフセットの取り方
 * timeZoneName:'longOffset' は Safari 15.4 / Firefox 91 より前で使えないので、
 * 「その瞬間を現地の壁時計で書き出して UTC との差を取る」方式にしている。
 * 秒まで出るので地方平均時の 18分59秒のような端数も落ちない。
 */

const MS_PER_DAY = 86400000;
/** JD 2440587.5 = 1970-01-01T00:00:00Z */
const JD_UNIX_EPOCH = 2440587.5;

/**
 * ユリウス日 → Unix ミリ秒。**ミリ秒に丸めること。**
 * JD は 244万台の浮動小数なので往復で 0.01ms ほど欠ける。Intl の formatToParts は
 * 切り捨てなので、丸めないと 12:30:00 が 12:29:59 になって往復しなくなる。
 */
export const jdToUnixMs = jd => Math.round((jd - JD_UNIX_EPOCH) * MS_PER_DAY);
export const unixMsToJd = ms => ms / MS_PER_DAY + JD_UNIX_EPOCH;

/** DateTimeFormat の生成は重いのでゾーンごとに使い回す */
const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** ゾーン名が処理系で使えるか */
export function isValidZone(tz) {
  try { formatter(tz); return true; } catch { return false; }
}

/** UTC のミリ秒 → その瞬間の現地の暦要素 */
export function zoneParts(tz, utcMs) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(utcMs)) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** 年 0–99 を西暦そのままで扱う Date.UTC（1948 が 48 に潰れるのを防ぐ） */
function utcOf(y, m, d, h, mi, s) {
  const ms = Date.UTC(y, m - 1, d, h, mi, s);
  if (y >= 0 && y < 100) {
    const dt = new Date(ms);
    dt.setUTCFullYear(y);
    return dt.getTime();
  }
  return ms;
}

/**
 * その瞬間のゾーンの UTC オフセット（秒）。夏時間も地方平均時も含む実効値。
 * 「UTC の瞬間を現地表記に直し、それを UTC として読み直した差」で求める。
 */
export function offsetSecondsAt(tz, utcMs) {
  const p = zoneParts(tz, utcMs);
  return Math.round((utcOf(p.y, p.m, p.d, p.h, p.mi, p.s) - utcMs) / 1000);
}

/** 同上を時間単位で（表示・デバッグ用） */
export const offsetHoursAt = (tz, utcMs) => offsetSecondsAt(tz, utcMs) / 3600;

/**
 * 現地の壁時計時刻 → UTC のミリ秒。
 *
 * オフセットは求めたい瞬間そのものに依存するので、素朴には解けない
 * （壁時計 12:00 が夏時間かどうかは、UTC が決まらないと分からない）。
 * 壁時計を一旦 UTC とみなして得た暫定オフセットで引き戻し、その瞬間で
 * オフセットを取り直す2段階で収束する。移行の前後 1時間以外は1回で合う。
 *
 * 戻り値の status:
 *   'ok'         そのまま存在する時刻
 *   'nonexistent' 春の繰り上げで飛ばされた時刻（02:30 など）。移行後の
 *                 オフセットを当てるので、実際の瞬間は壁時計より後ろにずれる
 *   'ambiguous'  秋の繰り下げで2回来る時刻。**先に来るほう（夏時間側）**を採る。
 *                出生時刻としてどちらか決められない以上、どちらかに倒すしかない
 */
export function zonedTimeToUtcMs(tz, y, m, d, h, mi, s = 0) {
  const naive = utcOf(y, m, d, h, mi, s);
  // 切り替わりを挟んでいても両側を必ず見るよう、前後1日のオフセットで2つ候補を作る
  const offBefore = offsetSecondsAt(tz, naive - MS_PER_DAY);
  const offAfter = offsetSecondsAt(tz, naive + MS_PER_DAY);
  const c1 = naive - offBefore * 1000;
  const c2 = naive - offAfter * 1000;
  // 「その候補の瞬間で実際にそのオフセットになる」なら候補は成立している
  const ok1 = offsetSecondsAt(tz, c1) === offBefore;
  const ok2 = offsetSecondsAt(tz, c2) === offAfter;

  let utc, status;
  if (ok1 && ok2 && c1 !== c2) {
    utc = Math.min(c1, c2);          // 先に来るほう = 夏時間側
    status = 'ambiguous';
  } else if (ok1) {
    utc = c1; status = 'ok';
  } else if (ok2) {
    utc = c2; status = 'ok';
  } else {
    // どちらの読み方でも成立しない = 繰り上げで飛ばされた時刻。
    // 切り替わり前のオフセットを当てるので、実際の瞬間は壁時計より後ろへずれる
    utc = c1; status = 'nonexistent';
  }
  return { utcMs: utc, offsetSeconds: offsetSecondsAt(tz, utc), status };
}

/** 現地の壁時計時刻 → ユリウス日（本体の入口） */
export function zonedToJd(tz, y, m, d, h, mi, s = 0) {
  const r = zonedTimeToUtcMs(tz, y, m, d, h, mi, s);
  return { jd: unixMsToJd(r.utcMs), offsetSeconds: r.offsetSeconds, status: r.status };
}

/** ユリウス日 → その時点の現地の暦要素（時間軸の表示用） */
export function jdToZoned(tz, jd) {
  const ms = jdToUnixMs(jd);
  return { ...zoneParts(tz, ms), offsetSeconds: offsetSecondsAt(tz, ms) };
}

/** '+09:00' / '+09:18:59' 形式の表示文字列 */
export function formatOffset(seconds) {
  const sign = seconds < 0 ? '−' : '+';
  const a = Math.abs(seconds);
  const p = n => String(n).padStart(2, '0');
  const h = Math.floor(a / 3600), mi = Math.floor(a / 60) % 60, s = a % 60;
  return `${sign}${p(h)}:${p(mi)}` + (s ? `:${p(s)}` : '');
}

/**
 * 選択肢に出す IANA ゾーンの一覧。
 * Intl.supportedValuesOf は Chrome 99 / Firefox 93 / Safari 15.4 以降。
 * 無い環境では主要ゾーンだけの控えを返す（アプリは動き続ける）。
 */
const FALLBACK_ZONES = [
  'UTC', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Singapore',
  'Asia/Kolkata', 'Asia/Dubai', 'Australia/Sydney', 'Pacific/Auckland',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Atlantic/Reykjavik', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Sao_Paulo', 'Africa/Cairo', 'Africa/Johannesburg'
];

export function zoneList() {
  try {
    const v = Intl.supportedValuesOf?.('timeZone');
    if (v?.length) return v.includes('UTC') ? v : ['UTC', ...v];
  } catch { /* 下の控えへ */ }
  return FALLBACK_ZONES.slice();
}
