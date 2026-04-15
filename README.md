# KU Student PDF to Notion

学内サイトで人間がログインとOTP認証を済ませた後、その認証済みブラウザセッションを使ってPDFを取得し、Notionページへ追加する半自動Chrome拡張機能です。

## できること

- 課題ページ内のPDFリンク候補を検出
- 認証済みセッションでPDF本体を取得
- Notion APIへPDFをアップロード
- 指定したNotionページに file ブロックとして追加

## 前提

- Chrome / Chromium 系ブラウザ
- 学内サイトへのログインとOTPは手動で完了しておく
- Notion integration token を自分で発行する
- 対象ページをその integration に共有しておく

## セットアップ

1. Notionで integration を作成し、token を控える。
2. PDFを追加したいページを integration に共有する。
3. Chromeで `chrome://extensions` を開く。
4. 「デベロッパーモード」をオンにする。
5. 「パッケージ化されていない拡張機能を読み込む」からこのフォルダを選ぶ。
6. 拡張機能ポップアップで Notion token / Page ID / 許可ホストを設定する。

## 使い方

1. 学内サイトでログインとOTP入力を済ませる。
2. 課題ページを開く。
3. 拡張機能ポップアップで「このページを検出」を押す。
4. 検出されたPDFが正しければ「検出PDFを送信」を押す。
5. Notionページに段落 + file ブロックとして追加される。

## Page ID の取り方

NotionページURLの末尾にある32文字前後のIDを使います。ハイフンがあってもなくても大丈夫です。

## 安全策

- `allowedHosts` に学内ドメインだけを入れると誤送信を減らせます。
- token は `chrome.storage.sync` に保存されます。より厳密にやるならローカル保存へ変更してください。
- OTPそのものやパスワードの入力自動化はしていません。

## 注意

- Notionの file upload API は仕様変更が起きる可能性があります。`background.js` の `uploadFileToNotion()` はその差分を吸収しやすいようにまとめています。
- 学内サイトが anti-bot / Referer / CSRF を強く要求する場合、単純な `fetch(..., credentials: 'include')` だけでは足りないことがあります。その場合は対象サイト専用のヘッダや遷移手順に合わせる必要があります。
- DOM構造が特殊でPDFリンクが拾えない場合は `content.js` の検出条件をそのページ向けに足してください。

## よくある修正ポイント

- 課題一覧APIがJSONなら、そのAPIを叩くように `content.js` と `background.js` を変える。
- 複数PDFをまとめて送るなら `allDetected` を順に処理する。
- ページではなくデータベース行へ追加したいなら、Notion block append 部分をページ作成APIへ置き換える。
