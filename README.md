# Medical DOC PR Scraper

Medical DOCのおすすめ記事一覧から **PR表記の医院のみを自動抽出** するChrome拡張機能。

---

## インストール手順

### 1. ZIPを解凍

ダウンロードしたZIPを任意のフォルダに解凍します。

### 2. Chrome に読み込む

1. Chrome を開き、アドレスバーに `chrome://extensions/` を入力
2. 右上の **「デベロッパーモード」** をオン
3. **「パッケージ化されていない拡張機能を読み込む」** をクリック
4. 解凍したフォルダ（`medical-doc-scraper/`）を選択
5. 拡張機能が一覧に表示されれば完了

---

## 使い方

### 基本操作

| ボタン | 説明 |
|--------|------|
| ▶ 開始 | 最初からスクレイピング開始 |
| ↩ 再開 | 途中停止した箇所から再開 |
| ⏹ 停止 | スクレイピングを停止（データは保持） |
| ⬇ CSV | 取得済みデータをCSVでダウンロード |
| ⬇ JSON | 取得済みデータをJSONでダウンロード |
| 🗑 クリア | すべてのデータを消去 |

### スクレイピングの流れ

```
[フェーズ1] 一覧ページ巡回
  medicaldoc.jp/m/recommend-m/
  medicaldoc.jp/m/recommend-m/page/2/
  medicaldoc.jp/m/recommend-m/page/3/ ...
    ↓
  各ページの .archiveList-box__item を検査
  CSS疑似要素 ::after で pr_mark.png を検出
    ↓
  PR医院の URL をキューに追加

[フェーズ2] 詳細ページ巡回
  各PR医院の記事URLを訪問
  医院名・住所・電話番号・診療時間・アクセスなど取得
```

---

## 出力データ（CSVカラム）

| カラム | 内容 |
|--------|------|
| 医院名 | クリニック名 |
| URL | 記事URL |
| アイキャッチ画像 | 画像URL |
| 住所 | 所在地 |
| 電話番号 | TEL |
| 診療時間 | 受付時間 |
| アクセス | 最寄り駅など |
| GoogleMap | マップURL |
| 医師名 | 院長・担当医 |
| 診療科 | 科目 |
| 特徴説明 | 記事冒頭の説明 |
| PR | TRUE固定 |

---

## 注意事項

- **CSS疑似要素（`::after`）** でPRマークを判定しているため、`getComputedStyle` が必須です
- スクレイピング中は専用タブが自動で開き、ページ間は **1.5秒** 以上の間隔を設けています
- 約232ページ × 一覧 + 詳細巡回のため、**完了まで数時間かかる場合があります**
- 途中停止しても「再開」ボタンでデータを保持したまま再スタートできます
- データは `chrome.storage.local` に自動保存されます

---

## ファイル構成

```
medical-doc-scraper/
├── manifest.json   # 拡張機能設定（Manifest V3）
├── background.js   # ページ巡回・タブ制御
├── content.js      # DOM解析・PR判定・詳細取得
├── popup.html      # UI
├── popup.js        # UI制御・CSV/JSONエクスポート
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```
