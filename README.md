# KU Student PDF to Notion

学内サイトで人間がログインとOTP認証を済ませた後、その認証済みブラウザセッションを使ってPDFを取得し、Notionの選択したページへPDFブロックとして埋め込む半自動Chrome拡張機能です。

## できること

- 課題ページ内のPDFリンク候補を検出
- 認証済みセッションでPDF本体を取得
- Notion Database ID から Data Source を取得
- Data Source 内のページ一覧とページIDを取得
- プルダウンで埋め込み先ページを選択
- Notion APIへPDFをアップロードして PDF ブロックとして追加

## 前提

- Chrome / Chromium 系ブラウザ
- 学内サイトへのログインとOTPは手動で完了しておく
- Notion integration token を自分で発行する
- 対象の database と埋め込み先ページを integration に共有しておく

## セットアップ

1. Notionで integration を作成し、token を控える。
2. 対象の database と、埋め込みたいページを integration に共有する。
3. Chromeで `chrome://extensions` を開く。
4. 「デベロッパーモード」をオンにする。
5. 「パッケージ化されていない拡張機能を読み込む」からこのフォルダを選ぶ。
6. ポップアップで Notion token と Database ID を入力する。
7. 「DBからページ取得」を押し、Data Source と埋め込み先ページを選ぶ。

## 使い方

1. 学内サイトでログインとOTP入力を済ませる。
2. 課題ページを開く。
3. 必要なら拡張機能で Notion の埋め込み先ページを選ぶ。
4. 「このページを検出」を押す。
5. 検出されたPDFが正しければ「検出PDFを送信」を押す。
6. 選択したNotionページに PDF ブロックとして追加される。

## 注意

- Database ID は database URL でも 32文字ID でも入力できます。
- API バージョンは `2026-03-11` を使用しています。
- 学内サイトが anti-bot / Referer / CSRF を強く要求する場合、追加のサイト専用対応が必要になることがあります。
- HTMLページの奥にPDF本体がある場合に備えて、HTML内の PDF 候補URL を追跡するロジックを入れています。
