# データの帰属表示（Attribution）

`data/` 配下のファイルは、以下の外部データソースを変換して生成した**派生物**であり、
それぞれ元データのライセンス（CC BY-SA 系）を継承する。
リポジトリのソースコード（MIT ライセンス）とはライセンスが異なることに注意。

再生成の手順はリポジトリの `tools/build-stars.mjs` / `tools/build-constellations.mjs` を参照。

---

## data/stars.json

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

**このファイルは上記変更を加えた派生物として CC BY-SA 4.0 を継承する。**

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

## 該当しないもの

- `index.html` 内の天の川レイヤーは銀河座標系の向きのみ正確な**手続き生成の装飾**であり、
  外部データの派生物ではない（コードとして MIT）
- 惑星・月の位置計算（JPL 近似軌道要素・短縮 ELP 級数）は係数を論文・公開資料から
  実装したコードであり、`data/` のデータライセンスとは無関係
