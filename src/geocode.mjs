/**
 * geocode.mjs — 地名 → 緯度経度 + IANA タイムゾーン
 *
 * Open-Meteo Geocoding API を使う。選定理由:
 *   - APIキー不要。このアプリは静的ホスティングで鍵を安全に置く場所がない
 *   - CORS が `Access-Control-Allow-Origin: *` でブラウザから直接叩ける
 *   - **IANA タイムゾーンを一緒に返す**ので、緯度経度→ゾーンの逆引きが要らない
 *     （Nominatim / Photon は返さないので、別途ゾーン判定の仕組みが必要になる）
 *   - Nominatim は利用規約でクライアント側の入力補完を明確に禁止しているのに対し、
 *     こちらにはその条項がない
 *
 * 規約と制限（https://open-meteo.com/en/terms）:
 *   非商用に限り無料 / 10,000 req 日・5,000 req 時・600 req 分
 *   データは GeoNames 由来で CC BY 4.0。帰属は data/ATTRIBUTION.md と画面に表示する
 *
 * 粒度は市区町村レベルで、番地までは引けない。出生図の用途では十分
 * （経度 0.1° ≒ 24秒の時差で、天体位置への影響は地平線の向きだけ）。
 *
 * ネットワークが使えないときは reason つきで失敗を返すだけで、例外を投げない。
 * 呼び出し側はプリセットと緯度経度の直接入力へ倒す（オフラインでもアプリは動く）。
 */

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

/** 表示用の地名を組み立てる（「金沢市, 石川県, 日本」） */
function label(r) {
  return [r.name, r.admin1, r.country].filter(Boolean).join(', ');
}

/**
 * @returns {Promise<{ok:true, results:Array}|{ok:false, reason:string}>}
 *   results の各要素: { label, name, lat, lon, timezone, country, admin1 }
 */
export async function searchPlace(query, { count = 8, language = 'ja', signal, timeoutMs = 8000 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { ok: false, reason: 'empty' };

  const url = `${ENDPOINT}?name=${encodeURIComponent(q)}`
    + `&count=${count}&language=${language}&format=json`;

  // AbortSignal.timeout は Safari 16 以降。無い環境では手で組む
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const json = await res.json();
    const results = (json.results ?? [])
      .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
      .map(r => ({
        label: label(r),
        name: r.name,
        lat: r.latitude,
        lon: r.longitude,
        // ごく稀に timezone が欠ける。呼び出し側で選び直せるよう null を通す
        timezone: r.timezone ?? null,
        country: r.country ?? '',
        admin1: r.admin1 ?? ''
      }));
    return results.length ? { ok: true, results } : { ok: false, reason: 'not-found' };
  } catch (e) {
    return { ok: false, reason: ctrl.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** 失敗理由 → 画面に出す日本語 */
export function reasonText(reason) {
  return {
    empty: '地名を入力してください',
    'not-found': '見つかりませんでした。プリセットか緯度経度の直接入力をお使いください',
    timeout: '応答がありません。プリセットか緯度経度の直接入力をお使いください',
    offline: 'ネットワークに接続できません。プリセットか緯度経度の直接入力をお使いください'
  }[reason] ?? `検索に失敗しました（${reason}）。プリセットか直接入力をお使いください`;
}
