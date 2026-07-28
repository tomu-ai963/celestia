/**
 * timezone.test.mjs — IANA タイムゾーン変換の検証
 *
 * P2 まではプリセットの固定オフセットだったので、夏時間期間の出生時刻が
 * 最大1時間ずれていた。ここでは「固定オフセットなら落ちる」ケースを軸に据える。
 *
 * 参照する tz データは処理系（Node なら ICU）同梱のもので、
 * ブラウザ側も同じ IANA データベースを引く。歴史的な変更の収録範囲は
 * 処理系依存なので、README の制約にその旨を書いてある。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  offsetSecondsAt, offsetHoursAt, zonedToJd, jdToZoned, zonedTimeToUtcMs,
  formatOffset, zoneList, isValidZone, jdToUnixMs, unixMsToJd
} from '../src/timezone.mjs';
import { julianDay, jdToUTC } from '../src/astro.mjs';

const utc = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);

test('日本の 1948–1951 夏時間 (JDT, UTC+10) を拾う', () => {
  // 固定オフセット +9 のままだと、この期間の出生時刻が1時間ずれる
  assert.equal(offsetHoursAt('Asia/Tokyo', utc(1948, 5, 15, 3)), 10);
  assert.equal(offsetHoursAt('Asia/Tokyo', utc(1949, 7, 1, 3)), 10);
  assert.equal(offsetHoursAt('Asia/Tokyo', utc(1951, 7, 1, 3)), 10);
  // 期間外は +9
  assert.equal(offsetHoursAt('Asia/Tokyo', utc(1948, 12, 15, 3)), 9);
  assert.equal(offsetHoursAt('Asia/Tokyo', utc(1952, 7, 15, 3)), 9);
  assert.equal(offsetHoursAt('Asia/Tokyo', utc(1990, 7, 14, 0)), 9);
});

test('米国の戦時 DST（1918 / 1945）を拾う', () => {
  assert.equal(offsetHoursAt('America/New_York', utc(1918, 7, 15, 12)), -4);
  assert.equal(offsetHoursAt('America/New_York', utc(1945, 7, 15, 12)), -4);
  assert.equal(offsetHoursAt('America/New_York', utc(1975, 2, 15, 12)), -5);
});

test('標準時制定前は地方平均時（秒の端数まで）', () => {
  // 東京は 1888年の標準時制定前まで LMT = +9:18:59
  assert.equal(offsetSecondsAt('Asia/Tokyo', utc(1800, 6, 15, 12)), 9 * 3600 + 18 * 60 + 59);
  assert.equal(offsetSecondsAt('America/New_York', utc(1800, 6, 15, 12)), -(4 * 3600 + 56 * 60 + 2));
  // 分単位に丸めていたら 59秒が落ちる
  assert.notEqual(offsetSecondsAt('Asia/Tokyo', utc(1800, 6, 15, 12)) % 60, 0);
});

test('固定オフセットとの差が実際に1時間出る（P2の不具合の再現）', () => {
  // 1949-07-01 12:00 東京生まれ。固定 +9 と IANA で JD がどれだけ違うか
  const fixed = julianDay(1949, 7, 1, 12, 0, 9);
  const iana = zonedToJd('Asia/Tokyo', 1949, 7, 1, 12, 0).jd;
  const diffMin = (fixed - iana) * 1440;
  assert.ok(Math.abs(diffMin - 60) < 1e-6, `差 ${diffMin} 分（60分のはず）`);
});

test('壁時計 → JD → 壁時計 が往復する（1800–2050 の各年・各月）', () => {
  for (const tz of ['Asia/Tokyo', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'UTC']) {
    for (let y = 1800; y <= 2050; y += 7) {
      for (const m of [1, 4, 7, 10]) {
        const r = zonedToJd(tz, y, m, 15, 12, 30);
        const back = jdToZoned(tz, r.jd);
        assert.equal(back.y, y, `${tz} ${y}-${m}`);
        assert.equal(back.m, m, `${tz} ${y}-${m}`);
        assert.equal(back.d, 15, `${tz} ${y}-${m}`);
        assert.equal(back.h, 12, `${tz} ${y}-${m}`);
        assert.equal(back.mi, 30, `${tz} ${y}-${m}`);
        assert.equal(r.status, 'ok', `${tz} ${y}-${m} status=${r.status}`);
      }
    }
  }
});

test('夏時間の切り替わりで存在しない時刻・重複する時刻を報告する', () => {
  // 米国 2025-03-09 02:30 は繰り上げで存在しない
  const gap = zonedTimeToUtcMs('America/New_York', 2025, 3, 9, 2, 30);
  assert.equal(gap.status, 'nonexistent');
  // 2025-11-02 01:30 は2回来る。先に来る夏時間側 (-4) を採る
  const amb = zonedTimeToUtcMs('America/New_York', 2025, 11, 2, 1, 30);
  assert.equal(amb.status, 'ambiguous');
  assert.equal(amb.offsetSeconds, -4 * 3600);
  // 普通の日は ok
  assert.equal(zonedTimeToUtcMs('America/New_York', 2025, 6, 1, 12, 0).status, 'ok');
});

test('UTC ゾーンでは既存の julianDay(tz=0) と一致する', () => {
  // 既存テストの期待値はすべて tz=0 の UT 基準。ここが崩れていないことを押さえる
  for (const [y, m, d, h, mi] of
    [[1800, 1, 1, 0, 0], [1990, 7, 14, 9, 30], [2000, 1, 1, 12, 0], [2050, 12, 31, 23, 59]]) {
    const a = julianDay(y, m, d, h, mi, 0);
    const b = zonedToJd('UTC', y, m, d, h, mi).jd;
    assert.ok(Math.abs(a - b) < 1e-9, `${y}-${m}-${d}: ${a} vs ${b}`);
    const u = jdToUTC(a);
    assert.deepEqual([u.y, u.m, u.d, u.h, u.mi], [y, m, d, h, mi]);
  }
});

test('JD ⇄ Unix ミリ秒の変換が正しい', () => {
  assert.equal(jdToUnixMs(2440587.5), 0);              // 1970-01-01T00:00:00Z
  assert.equal(unixMsToJd(0), 2440587.5);
  assert.equal(jdToUnixMs(2451545.0), Date.UTC(2000, 0, 1, 12));
});

test('オフセットの表示は端数のある地方平均時も出せる', () => {
  assert.equal(formatOffset(9 * 3600), '+09:00');
  assert.equal(formatOffset(-(5 * 3600)), '−05:00');
  assert.equal(formatOffset(9 * 3600 + 18 * 60 + 59), '+09:18:59');
  assert.equal(formatOffset(5 * 3600 + 30 * 60), '+05:30');
});

test('ゾーン一覧が取れて、主要ゾーンが含まれる', () => {
  const z = zoneList();
  assert.ok(z.length > 20, `${z.length}件`);
  for (const t of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London']) {
    assert.ok(z.includes(t), `${t} が一覧にない`);
  }
  assert.ok(isValidZone('Asia/Tokyo'));
  assert.ok(!isValidZone('Not/AZone'));
});
