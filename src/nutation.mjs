/**
 * nutation.mjs — 章動と平均黄道傾斜角
 *
 * 表示にも惑星計算にも使っていない。使うのは「見かけの位置」を作るときだけで、
 * 用途は2つ:
 *   - 春分の瞬間の太陽黄経が 0 になることを確かめるテスト（平均分点のままだと
 *     章動 ±17″ と光行差 20″ が残り、±0.01° の判定が成立しない）
 *   - Horizons の apparent 出力と突き合わせるフレーム健全性チェック
 *
 * 一次資料: Meeus, Astronomical Algorithms 2nd ed., ch.22（簡略式）
 *   Δψ の精度 0.5″、Δε の精度 0.1″。目的から見て十分。
 */
const D2R = Math.PI / 180;
const sin = a => Math.sin(a * D2R), cos = a => Math.cos(a * D2R);

/** 章動（黄経・黄道傾斜、単位は度） */
export function nutation(T) {
  const Om = 125.04452 - 1934.136261 * T;      // 月の昇交点
  const L  = 280.4665 + 36000.7698 * T;        // 太陽の平均黄経
  const Lp = 218.3165 + 481267.8813 * T;       // 月の平均黄経
  const dpsi = (-17.20 * sin(Om) - 1.32 * sin(2 * L)
                - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * Om)) / 3600;
  const deps = (9.20 * cos(Om) + 0.57 * cos(2 * L)
                + 0.10 * cos(2 * Lp) - 0.09 * cos(2 * Om)) / 3600;
  return { dpsi, deps };
}

/** 平均黄道傾斜角 ε0（度）。Meeus 22.2（Laskar の多項式の低次項） */
export function meanObliquity(T) {
  const U = T / 100;
  return 23.43929111
    - U * (4680.93 + U * (1.55 - U * (1999.25 - U * (51.38 + U * 249.67)))) / 3600;
}
