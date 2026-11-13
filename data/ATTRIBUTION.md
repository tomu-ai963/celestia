# データの帰属表示（Attribution）

`data/` 配下のファイルと `assets/sky/` の天の川の画像は、以下の外部データソースを変換して生成した**派生物**であり、
それぞれ元データの条件に従う（星と星座線は CC BY-SA 系を継承する。天の川の画像は NASA の指針に従う。各節を参照）。
リポジトリのソースコード（MIT ライセンス）とはライセンスが異なることに注意。

再生成の手順はリポジトリの `tools/build-stars.mjs` / `tools/build-constellations.mjs` /
`tools/build-milkyway.mjs` を参照。

---

## data/stars.json・data/stars-deep.json

- **出典**: HYG Database v4.1（hygdata_v41.csv）
- **原著者**: David Nash (The Astronomy Nexus)。原典は Hipparcos / Yale Bright Star /
  Gliese の各カタログの編纂
- **取得元**: https://github.com/astronexus/HYG-Database （`hyg/CURRENT/hygdata_v41.csv`）
- **ライセンス**: [Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)

### 加えた変更（原データそのままではない）

1. 視等級 6.5 以下の恒星のみに絞り込み（119,626星 → 8,920星。太陽は除外）
2. J2000 赤道座標（ra/dec）を J2000 黄道座標（黄経・黄緯）へ変換
   （黄道傾斜角 ε = 23.4392911°）
3. 使用列を位置・視等級・B-V 色指数の4値のみに削減
4. 整数スケール化と丸め: 黄経・黄緯 ×1000（小数3桁相当）、等級・色指数 ×100（小数2桁相当）
5. B-V 色指数が欠損している40星に、収録範囲の平均値 0.63 を代入
6. 明るい順にソートし、フラットな数値配列の JSON として再エンコード

`data/stars-deep.json`（「双眼鏡の空」で後から読む段）も同じ手順で作る。違いは次の 2 点だけ。

- 視等級 6.5 より暗く 8.0 以下の恒星（丸める前の等級で切る。stars.json とは重ならない）。32,567星
- B-V 色指数が欠損している72星に、同じ 0.63 を代入

**これらのファイルは上記変更を加えた派生物として CC BY-SA 4.0 を継承する。**

---

## data/constellations.json

- **出典**: Stellarium sky cultures「Western」（星座線の HIP 番号ポリライン定義）
- **原著者**: Stellarium プロジェクトの貢献者
- **取得元**: https://github.com/Stellarium/stellarium-skycultures （`western/index.json`）
- **ライセンス**: CC BY-SA（出典リポジトリの Western スカイカルチャー
  description.md に記載。[CC BY-SA 4.0 全文](https://creativecommons.org/licenses/by-sa/4.0/)）
- **座標解決に使用**: 上記 HYG Database v4.1（CC BY-SA 4.0）

### 加えた変更（原データそのままではない）

1. 88星座の `lines`（HIP 番号のポリライン）のみを抽出（星座絵・名称・po 翻訳等は不使用）
2. 各 HIP 番号を HYG v4.1 と照合し、J2000 黄道座標（黄経・黄緯）へ解決
   （HYG に見つからない6点はポリラインを分割して除外）
3. 黄道12星座に `zodiac` フラグを付与
4. 整数スケール化と丸め: 黄経・黄緯 ×100（小数2桁相当）
5. フラットな数値配列の JSON として再エンコード

**このファイルは Stellarium sky culture データと HYG データ双方に由来する派生物として
CC BY-SA を継承する。**

---

## tests/fixtures/horizons/*.csv

- **出典**: NASA/JPL Horizons システム（https://ssd.jpl.nasa.gov/horizons/）
- **取得元**: Horizons API（https://ssd-api.jpl.nasa.gov/doc/horizons.html）。
  再取得は `node tools/fetch-horizons.mjs`
- **ライセンス**: 米国政府（NASA/JPL-Caltech）の作成物でパブリックドメイン。
  JPL の利用条件は https://www.jpl.nasa.gov/jpl-image-use-policy/ に準ずる
- **用途**: テスト時に API を叩かずに済ませるための参照値。加工は
  「必要な列だけを CSV に落とす」のみで、数値そのものは変更していない

---

## assets/sky/milkyway-2048.webp・milkyway-4096.webp・milkyway.json（天の川の背景）

- **出典**: NASA Scientific Visualization Studio「Deep Star Maps 2020」（ID 4851）の
  `milkyway_2020_4k_gal.exr`（4096×2048、OpenEXR 半精度・線形）。
  ページの説明: “The Milky Way background in galactic coordinates. This is a version of the star map
  that omits the bright (Hipparcos and Tycho) stars.”（銀河座標の正距円筒。中心が銀経 0°、経度は左へ増える。
  銀河座標の画像は 2021-01-04 に変換の誤りを直したものへ差し替え済み）
- **取得元**: https://svs.gsfc.nasa.gov/4851
  （ファイル: https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k_gal.exr 、
  SHA-256 `fad63b36aa632c691d521cd9d8b828de9d29b4c2784276eec44e54c6cb159a49`。元の EXR はリポジトリに含めない）
- **クレジット**（ページの Credits 欄の表記をそのまま。画面上の「出典」にも同じ文言を載せている）:

  > Please give credit for this item to:
  > NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.
  > Constellation figures based on those developed for the IAU by Alan MacRobert of Sky and Telescope
  > magazine (Roger Sinnott and Rick Fienberg).

  ※ 最後の一文は同じページの星座線の画像についての表記で、celestia は SVS の星座線の画像を使っていない
  （星座線は下の Stellarium 由来）。Credits 欄の表記をそのまま載せる方針（とむ決定）のため残している
- **元になったカタログ**（ページの「Datasets used」の記載）: Hipparcos Catalogue、
  Tycho Catalogue (Tycho 2 Catalogue)、UCAC3、Gaia DR2 (Data Release 2) — “Credit: Gaia team/ESA”
- **利用条件**: ページにライセンスの記載はない。NASA の画像の一般指針（米国では原則として著作権の対象外。
  出所として NASA を示すこと、NASA による推奨・後援と受け取られる使い方をしないこと）に従う。
  元データの Gaia DR2 に対する ESA 側の条件がこの派生画像にどう及ぶかは読み取れていない
  （docs/rendering-upgrade.md H-4）。採用はとむの判断（2026-11-13）

### 加えた変更（原データそのままではない）

再生成は `node tools/build-milkyway.mjs`（処理の値は `assets/sky/milkyway.json` の `processing` に記録）。

1. 線形の浮動小数のまま、ガウスぼかし（4096 px で σ 1.2 画素 ≈ 0.1°）。Gaia の暗い星の細かい粒を
   ならし、配信の容量に収めるため
2. 背景の底上げ分を引く（輝度の 1 パーセンタイル 0.0017 を全チャンネルから引き、0 で切る）
3. 画素ごとの最も明るいチャンネルの最大値が 1.0 になるよう倍率を掛ける（最大値は 99.99 パーセンタイルの
   1.045 倍で、孤立した外れ値ではないことを確認。1 を超えた画素は 0）
4. sRGB に変換し、三角分布のディザ（±1 段、種つきの乱数）をかけて 8 ビットに
5. 4096×2048 と、線形のまま 2×2 の平均で縮小した 2048×1024 を WebP（品質 85）で書き出す
6. 表示では、銀河中心のふくらみ（1° 角の平均の最大、テクスチャの値で 0.810）が線形 0.03
   （双眼鏡の空で 0.06）になる倍率を掛けて、星の後ろに描く

---

## 実行時に問い合わせる外部サービス

`data/` には含まれないが、アプリが実行時に利用するもの。

### Open-Meteo Geocoding API（出生地の検索）

- **エンドポイント**: `https://geocoding-api.open-meteo.com/v1/search`（APIキー不要）
- **原データ**: GeoNames — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **利用条件**: [Open-Meteo Terms](https://open-meteo.com/en/terms) — 非商用に限り無料。
  10,000 req/日・5,000 req/時・600 req/分
- **アプリ側の扱い**: 検索ボタンを押したときだけ 1 回問い合わせる（入力に合わせた
  逐次補完はしない）。応答は緯度経度とタイムゾーンを入力欄へ埋めるだけで保存しない。
  不通時はプリセットと直接入力へ倒し、オフラインでも全機能が使える

### タイムゾーンデータ

- ブラウザ組み込みの `Intl.DateTimeFormat` 経由で処理系同梱の
  [IANA Time Zone Database](https://www.iana.org/time-zones) を参照する
  （Public Domain）。アプリはデータを同梱しない

---

## 該当しないもの

- 惑星・月の位置計算（JPL 近似軌道要素・Meeus の月の級数）は係数を論文・公開資料から
  実装したコードであり、`data/` のデータライセンスとは無関係
