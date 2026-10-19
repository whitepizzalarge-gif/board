# 村越ボード（このリポジトリ）

スマホ・PC用のPWA。データはGoogleスプシ、読み書きはGAS（Apps Script）経由。画面は静的ファイルだけ。

## 構成
- `index.html`：骨組み／`app.css`：見た目／`app.js`：動き（`demoApi`はデモ用。設定のURLが`demo`のとき動く）
- `sw.js`：画面ファイルのキャッシュ。**画面を直したら`CACHE`の番号と`app.css?v=`・`app.js?v=`の番号を同じ数だけ上げる**（上げないと端末に古い画面が残る）
- GAS本体（`Code.gs`）とスプシの列・タブの定義は、このリポジトリにない。Googleドライブ「個人書類/app/_資料」の`設置と運用.md`と`Code.gs`が控え

## 守ること
- **このリポジトリはPublic。GASのURL・合言葉・個人情報・売上の実数を、コード・コメント・コミットメッセージに書かない。**
- GASのアクション名（data／status／keep／add／update／padd／pupdate／cand／recur／rupdate／events／sub／checks／check／time）と、スプシの見出し・タブ名は変えない。画面だけを直す場合は、これらに触れない
- 外部ライブラリは入れない（フォントのGoogle Fontsだけ）。ビルド工程は作らない
- 日本語UI。タップ領域は40px以上。ダークモード対応を崩さない

## 確認のしかた
- `node --check app.js`
- 直したら、スマホ幅（430px）のスクショを撮って、直す前と比べる。`app.js`のURLを`demo`にすればデータなしで表示できる

## 終わったら
- 変更内容を、Drive側の`設置と運用.md`に反映する（追加した機能・列・アクション）
- 反映しないと、Claudeが古い仕様で書く
