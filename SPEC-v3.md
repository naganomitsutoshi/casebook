# Casebook v3 仕様書 — Fable 5 直接実装＋「今日の収集」削除

> 依頼元: CEO（2026-07-04 指示）
> 実装体制: **Claude Code（Fable 5）が index.html を直接編集する。Codex 委譲は使わない**（v2.2 までは Codex 実装＋CTO レビュー体制。今回はその比較実験を兼ねる）
> 基点コード: v2.2（コミット `82c65e1`）の index.html。ゼロからの書き直しはしない（退行リスク回避）

## 0. 背景

- Casebook は病棟管理研修（2026年7〜9月）向けの入院症例管理＆学習ツール。単一 HTML・Vanilla JS・スマホブラウザで使う個人用 PoC
- 「今日の収集」（熱・食・便・眠・痛の5項目3値トグル＋フリーメモ）は CEO 判断で不要となったため全面削除する
- 全体設計の正本は Vault `3_新規事業部/2_PoC中/Casebook/設計書.md`、現行実装の解説は同フォルダの `HANDOFF.md`、v2 系の仕様は `SPEC-v2.md`（いずれも本ファイルと同リポジトリ／Vault）

## 1. 不変の制約（違反したら差し戻し。SPEC-v2 §1 と同一）

1. 単一 HTML ファイル（index.html）・外部ライブラリなし・外部送信なし（fetch/XHR/CDN/Webフォント禁止）
2. PII 入力欄を作らない：氏名・患者ID・病院名の欄は設計上存在させない
3. ユーザー入力を innerHTML に入れる際は必ず `esc()` を通す
4. テキスト入力は `oninput` ＋ debounce 保存（300–400ms）。テキスト入力中に全画面 `render()` を呼ばない
5. モバイル優先：520px 以下で1カラム、タップターゲット 44px 以上
6. 保存は既存 `Store` アダプタ（window.storage → localStorage → in-memory）を維持。**ストレージキーは `casebook:v2` のまま変更しない**（実機に既存データあり）
7. 純ロジックは DOM 非依存の関数として `<script id="logic">` ブロックに分離（`module.exports` ガード付き）。Node から `tests/verify-v2.js` でテスト可能な状態を維持

## 2. v3 の変更内容 = 「今日の収集」の全面削除

### 2.1 データモデル

- `days[].collect` を廃止。日エントリは `{ date, todos, waits, hooks }` になる
- **後方互換**：既存保存データの `days[].collect` は `ensureCaseShape()`（logic 内）で読み込み時に**黙って捨てる**（エラーにしない。他フィールドは保全）
- `makeEmptyCollect()` と `COLLECT_CYCLE` など collect 専用のヘルパ・定数は削除
- `rolloverCase()`：新しい日のエントリ生成から collect を外す。繰越仕様（未完 todos・未解消 waits をコピー、hooks は繰越さない、前日データは変更しない、冪等）は変更しない

### 2.2 UI（削除箇所）

- 今日のビュー：「今朝の収集」パネルを削除（5項目トグル＋メモ欄ごと）
- 過去ログタブ：各日の編集 UI から collect 部分を削除（todos/waits/hooks の後編集は維持）
- 経過表タブ：収集5項目のマーク行を削除。**残る行＝薬剤帯（期間表示）＋イベント（●＋略称）**。sticky 先頭列・横スクロール・今日列の強調は維持
- 一覧（ホーム）：症例カードの「今日の収集の入力済みマーク」を削除。「今日やる残 n」「待ち n」バッジは維持
- collect 専用の CSS（`.collect-grid` 等）と、それを参照するメディアクエリ内の記述も掃除する

### 2.3 書き出し（純ロジック）

- `buildDailyExport()`：「### 今日の収集」セクションと `collectSummary()` を削除。その他の並びは維持：

```markdown
# Casebook 書き出し YYYY-MM-DD
## 症例: 【要注意】80代・男性・誤嚥性肺炎（病日5）
P: （患者サマリ。未記入なら行ごと省略）
### 問題リスト
### 今日やる
### 待ち
### もしもプラン
### 引っかかり
### 薬剤・イベント（本日変更分）
### 写真
```

- `buildDischargeExport()`：日々のログ全日分から collect 表記を削除（todos/waits/hooks は維持）。その他のセクション（患者サマリ・入院時記録・ルーチン・問題リスト・薬剤・イベント・私の実践・退院時未解消の待ち・退院時サマリ）は変更しない

### 2.4 変更してはいけないもの（v2.1／v2.2 の成果）

- 重症度チップ＋一覧ソート（severity）
- 患者サマリ（patientSummary、日次書き出しの P: 行）
- もしもプラン（contingency）
- 入院時チェック10項目（テンプレ整合版 ROUTINE：休薬・内服調整／アレルギー・予防接種／意思決定支援／Code status／入院後の見通し／BPS／DEEP-IN＋CFS／リスクスクリーニング／リハGoal／退院支援・ACP）と旧キー自動移行
- カルテ写真（IndexedDB・端末ローカル限定・共有ボタン・PII 注意書き）
- 手動保存ボタン・ゴミ箱（30日 purge）・「私の実践」欄

## 3. テスト（tests/verify-v2.js の改修も v3 実装に含む）

1. collect 前提のフィクスチャ・アサーションを撤去（`mkCase()` の collect、収集済みマーク検証など）
2. 追加アサーション：
   - 旧データ（`days[].collect` あり）を読み込んでも `rolloverCase` / `buildDailyExport` / `buildDischargeExport` がエラーなく動く
   - 日次書き出しに「今日の収集」という文字列が**含まれない**
   - 新しい日のエントリに `collect` キーが**生成されない**
3. 既存の v2.1／v2.2 系テスト（severity・myPractice・pending-waits・ROUTINE 整合・旧キー移行・patientSummary・contingency・後方互換）はすべて維持して通すこと

## 4. 完了条件

1. `node tests/verify-v2.js` 全通過
2. `grep -E "fetch\(|XMLHttpRequest|https?://" index.html` がゼロ件（外部送信なしの再確認）
3. index.html 内に「収集」「collect」参照の取り残しがない（コメント・CSS 含む）
4. index.html ヘッダコメントを v3 に更新
5. HANDOFF.md に「## 13. v3 差分」を**日本語で追記**（全面書き換え禁止）：collect 削除・後方互換・実装体制の変更（Fable 5 直接実装）を記載
6. コミットメッセージに「なぜ」（CEO 判断で収集欄不要・Fable 5 直接実装の実験）を含める

## 5. 実装手順の目安（Fable 5 向け）

1. `index.html` の logic ブロックから着手（makeEmptyCollect / COLLECT_CYCLE / collectSummary / ensureCaseShape / rolloverCase / buildDailyExport / buildDischargeExport）
2. 次に UI（今日のビュー→過去ログ→経過表→一覧カード→CSS）
3. 最後にテスト改修 → 実行 → HANDOFF 追記 → コミット・push → GitHub Pages 反映確認（`.nojekyll` 済みのため通常30秒前後）
