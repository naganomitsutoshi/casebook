# Casebook v2 仕様書（Phase 1）

> 依頼元: 3_新規事業部（企画書 §7.6、CEO承認 2026-07-04）
> 実装: index.html の全面改修（単一HTML・Vanilla JS 維持）。Codex 実装／CTO レビュー。

## 0. 背景と目的

v1 の「Problem List／ルーチンチェック／日々の経過」はカルテの写し（二重記録）になっており、病棟の実際の頭の使い方（タスク・疑問駆動）と合わない。v2 は患者カードを「今日のビュー」中心に作り直し、夜のワンタップ書き出しで学習ループ（Claude Code 側 `/casebook` スキル）へ接続する。

## 1. 不変の制約（違反したら差し戻し）

1. 単一 HTML ファイル（index.html）・外部ライブラリなし・外部送信なし（fetch/XHR 禁止）
2. PII 入力欄を作らない：氏名・患者ID・病院名の欄は設計上存在させない。ラベルは年代・性別・一言のみ
3. ユーザー入力を innerHTML に入れる際は必ず `esc()` を通す
4. テキスト入力は `oninput` ＋ debounce 保存（300–400ms）。**テキスト入力中に全画面 `render()` を呼ばない**（フォーカス喪失防止）。トグル・ボタン操作は保存＋再描画OK
5. モバイル優先：520px 以下で1カラム、タップターゲット 44px 以上
6. 保存は既存 `Store` アダプタ（window.storage → localStorage → in-memory の3段フォールバック）を維持。**ストレージキーは `casebook:v2` に変更**（v1 データ移行は不要：試験データのみ）
7. 純ロジック（日替わり繰越・書き出し生成・ゴミ箱期限purge）は DOM 非依存の関数として `<script id="logic">` ブロックに分離し、Node で単体テスト可能にする（`module.exports` ガード付き：`if (typeof module !== "undefined") module.exports = {...}`）

## 2. データモデル（casebook:v2）

```js
{
  version: 2,
  cases: [{
    id, createdAt,
    status: "active" | "discharged",
    deletedAt: null | "ISO",            // ゴミ箱。30日超で自動完全削除
    ageBand, sex, cc,                    // 匿名ラベル（v1と同じ選択肢でよい）
    admittedAt, dischargedAt,            // "YYYY-MM-DD"
    admission: {
      note: "",                          // 入院時記録（フリーテキスト、後から編集可）
      photoIds: [],                      // IndexedDB 内の写真ID
      routine: { vte, delirium, nutrition, pain, devices, meds, allergy, disposition, rehab, code }  // bool、v1の10項目
    },
    problems: [{ id, title, assessment, active }],   // 1行タイトル＋アセスメント欄（折りたたみ）
    meds:     [{ id, name, route, startDate, endDate, note }],  // route: "内服"|"注射"、endDate null=継続中
    events:   [{ id, date, type, title, note }],     // type: "検査"|"手術"|"処置"|"治療"|"その他"
    days: [{
      date: "YYYY-MM-DD",
      collect: { fever, meal, bowel, sleep, pain, note },  // fever〜pain: "" | "ok" | "warn"（3値トグル）、note: フリーテキスト
      todos: [{ id, text, done }],
      waits: [{ id, text, resolved }],
      hooks: [{ id, text }]              // 引っかかり（学習の種）
    }],
    summary: { course, outcome },        // 退院時サマリ（経過要約・転帰）。ポートフォリオ転用を想定し退院前でも編集可
    lastExportedAt: null | "ISO"
  }]
}
```

写真は localStorage に入れない。IndexedDB（DB名 `casebook-photos`、store `photos`、`{ id, caseId, blob, createdAt }`）。

## 3. 画面構成

### 3.1 一覧（ホーム）
- アクティブ症例カード：ラベル、病日（入院日から計算）、バッジ「今日やる残 n」「待ち n」、今日の収集の入力済みマーク
- 上部に **「今日の書き出し」ボタン**（全アクティブ症例を1回で Markdown 化→クリップボード。§5.1）
- 退院済みタブ（症例蓄積・後から閲覧/編集/退院書き出し可）
- ゴミ箱リンク、新規症例ボタン

### 3.2 症例画面 = 「今日のビュー」（デフォルトタブ）
上から：
1. ラベル行（年代・性別・一言）＋病日＋手動保存ボタン
2. **今朝の収集**：熱・食・便・眠・痛 の5項目。タップで「−」→「✓」→「⚠」を循環（3値）。＋フリー欄1つ
3. **問題リスト**：1行タイトル×n。タップで展開してアセスメント編集。active off で下部にグレー表示
4. **今日やる**：チェックリスト（追加・完了・削除）。未完は翌日へ自動繰越
5. **待ち**：解消チェック付きリスト（例「培養結果待ち」）。未解消は翌日へ繰越
6. **引っかかり**：フリー1行×n（学習の種。書き出しで `/casebook` が深掘り抽出）
7. **入院時セクション**（折りたたみ、入院日にだけ自動展開）：入院時記録テキスト、**カルテ写真の挿入**（§4.3）、ルーチン10項目の簡素チェック
8. **薬剤・イベント**（§3.4 経過表タブと同データの入力口）：内服/注射の追加（開始日・終了日）、検査/手術/処置/治療イベントの追加（日付・種別・タイトル）
9. **退院時サマリ**（折りたたみ）：経過要約・転帰＋「退院にする」ボタン（dischargedAt セット）＋「退院書き出し」ボタン（§5.2）

### 3.3 過去ログタブ（症例画面内）
- 日付リスト（新しい順）。タップで当日の collect/todos/waits/hooks を**後から編集可**（修正点4）

### 3.4 経過表タブ（症例画面内・カレンダー表示、修正点5）
- 横軸＝入院日→今日（横スクロール、1列=1日、今日列を強調）。先頭列（行ラベル）は sticky
- 行：①収集5項目のマーク（✓/⚠）②薬剤：各薬1行、投与期間を帯で表示（内服とは色分け、継続中は今日まで）③イベント：該当日に ● ＋略称、タップで詳細
- スマホで判読できる最小限のセル幅（目安 28–36px）

### 3.5 ゴミ箱画面
- 削除済み症例の一覧（削除日表示）。「復元」「完全に削除（確認ダイアログ）」
- 30日超は読み込み時に自動 purge（純ロジック関数）

## 4. 挙動

### 4.1 日替わり繰越（純ロジック）
`rolloverCase(caseObj, today)`：days 末尾の date < today なら today のエントリを作成し、直近日の `todos`（done=false）と `waits`（resolved=false）を**コピーして**繰越（元の日のデータは変更しない）。collect は空で開始。アプリ起動時と `visibilitychange`（復帰時）に全アクティブ症例へ適用。

### 4.2 保存
- 自動保存：現行どおり debounce
- **手動保存ボタン**：ヘッダに常設。押下で即 `Store.save` ＋「保存しました HH:MM」トースト（自動保存と重複してよい）

### 4.3 カルテ写真（修正点2）
- `<input type="file" accept="image/*" capture="environment">` で撮影/選択 → IndexedDB に blob 保存、入院時セクションにサムネイル表示、タップで全画面表示、削除は確認ダイアログ
- 撮影ボタンの近くに注意書きを常時表示：「⚠ 氏名・患者IDが写らない画角で。写ったら削除して撮り直す」
- 各写真に「共有」ボタン：`navigator.share({ files })` が使えれば共有シート（→Obsidianへ）、不可なら blob ダウンロード
- **写真は書き出しテキストに含めない**（枚数と「Obsidianへ共有→/casebook がOCR」の案内行のみ）

### 4.4 削除・ゴミ箱（修正点4）
- 症例削除 → `deletedAt` セット（ゴミ箱へ）。復元で null に戻す
- 問題・薬剤・イベント・todo等の項目削除は確認ダイアログのみ（項目単位のゴミ箱は作らない＝過剰実装禁止）
- 症例の完全削除時は紐づく IndexedDB 写真も削除

## 5. 書き出し（Markdown → クリップボード）

### 5.1 今日の書き出し（一覧画面・ワンタップ）
全アクティブ症例分を連結して `navigator.clipboard.writeText`（失敗時は textarea フォールバック）。書き出し後 `lastExportedAt` 更新＋トースト。フォーマット（純ロジック `buildDailyExport(data, today)`）：

```markdown
# Casebook 書き出し 2026-07-04
## 症例: 80代・男性・誤嚥性肺炎（病日5）
### 問題リスト
- #1 誤嚥性肺炎 — A: （アセスメント全文）
### 今日の収集
熱✓ 食⚠ 便− 眠✓ 痛✓ ／ メモ: （フリー欄）
### 今日やる
- [x] 嚥下評価依頼
- [ ] 家族へ病状説明
### 待ち
- [ ] 喀痰培養
### 引っかかり
- 嚥下評価のタイミングの根拠は？
### 薬剤・イベント（本日変更分）
- 開始: ABPC/SBT 注射（7/4〜）
- イベント: 7/4 検査 嚥下造影
### 写真
- 入院時写真 2枚 → Obsidian へ共有済みのものを /casebook が OCR
```

### 5.2 退院書き出し（症例画面）
全期間版（純ロジック `buildDischargeExport(caseObj)`）：ラベル・入院期間・入院時記録全文・ルーチン・問題リスト（アセスメント込み）・日々のログ全日分・薬剤一覧（期間付き）・イベント一覧・退院時サマリ（経過要約・転帰）。ポートフォリオ・症例蓄積への転用を想定し、frontmatter（`type: casebook-discharge`, `date`, `label`）を先頭に付ける。

## 6. v1 からの削除

- 学習キュー画面・needsStudy/studyNote・reflection・旧 toObsidian()・フェーズレール
- 旧 dailyLog（check/a/p）→ days 構造に置換

## 8. v2.1 差分（設計書 CEO決裁 2026-07-04。§1 の不変制約はすべて適用）

1. **重症度ワンタップ（I-PASS Illness severity）**
   - データ: `case.severity: "" | "stable" | "watcher" | "unstable"`（既存データは "" 扱い・load時デフォルト補完）
   - UI: 一覧の症例カードと症例画面ラベル行に重症度チップ。タップで「−」→「安定」→「要注意」→「不安定」を循環。色分け（安定=done系/要注意=warn系/不安定=danger系）
   - 一覧ソート: アクティブ症例を 不安定→要注意→安定→未設定 の順に（同順位内は従来順）。退院済み・ゴミ箱には適用しない
2. **「私の実践」欄（ポートフォリオの「実践の核」対応）**
   - データ: `summary.myPractice: string`（デフォルト ""）
   - UI: 退院時サマリに textarea「私の実践（自分が主導した言動）」を経過要約と転帰の間に追加
3. **書き出しの拡張（純ロジック）**
   - `buildDischargeExport`: 「## 私の実践」セクション追加＋「## 退院時未解消の待ち」セクション追加（最終日の waits の resolved=false を列挙、なければ「- なし」。退院時pending検査の見落とし防止）
   - `buildDailyExport`: 症例見出しに重症度を併記（例 `## 症例: 【要注意】80代・男性・…（病日5）`。未設定なら表記なし）
4. **後方互換**: 既存 `casebook:v2` 保存データ（severity / myPractice 無し）を読み込んでもエラーなく動作すること
5. HANDOFF.md に v2.1 差分（データモデル・UI・書き出し）を追記

## 9. v2.2 差分（入院時テンプレ整合＋I-PASS完全化。CEO指示 2026-07-04。§1 の不変制約はすべて適用）

背景：CEO の入院時記録テンプレ（Vault `2_診療部/99_テンプレート/_テンプレート_入院時記録.md`）に沿ってカルテを書く前提。アプリは二重記録禁止のため、入院時セクションのチェックリストを「テンプレの各節を書いたか」の確認リストへ変更し、テンプレの節構成と 1:1 対応させる。あわせて I-PASS の未実装要素（P: Patient summary／S: Contingency planning）をアプリに追加する（I: severity は v2.1 済、A: Action list は「今日やる」が該当、S: Synthesis by receiver は `/casebook` スキル側で対応するためアプリ変更なし）。

1. **ROUTINE 10項目の置き換え（テンプレ節と1:1対応）**

   `<script id="logic">` ブロック内に `ROUTINE` 定義を移動し `module.exports` に含める（書き出しでラベルを使うため）。メイン script は `LOGIC.ROUTINE` を参照：

   ```js
   const ROUTINE = [
     {k:"meds",    t:"休薬・内服調整", h:"抗血栓薬・DM薬・サプリ"},
     {k:"allergy", t:"アレルギー・予防接種", h:"FA/DA・肺炎球菌等"},
     {k:"sdm",     t:"意思決定支援", h:"家族・代理決定者・ゴール"},
     {k:"code",    t:"Code status", h:"急変時方針（暫定）"},
     {k:"outlook", t:"入院後の見通し", h:"推定在院日数・退院方向"},
     {k:"bps",     t:"BPSモデル", h:"心理・社会・Matters Most"},
     {k:"deepin",  t:"DEEP-IN＋CFS", h:"高齢者機能評価"},
     {k:"risk",    t:"リスクスクリーニング", h:"嚥下・転倒・褥瘡・VTE・抑制"},
     {k:"rehab",   t:"リハGoal", h:"病前ADL・退院先・退院基準"},
     {k:"acp",     t:"退院支援・ACP", h:"多職種・介護保険・IC"}
   ];
   ```

   - 旧キーの移行（`ensureCaseShape` 内・純ロジック）：`meds`/`allergy`/`code`/`rehab` は同キー維持。`vte→risk`、`delirium→risk`、`disposition→rehab`（true なら新キーへ OR で引き継ぎ）。`nutrition`/`pain`/`devices` は破棄。移行後、ROUTINE に無いキーは routine オブジェクトから除去
   - 入院時セクションの見出し下に注記1行：「テンプレ準拠のカルテ記載は写真で残す。チェックは各節を書いたかの確認」

2. **患者サマリ（I-PASS P）**
   - データ: `case.patientSummary: string`（デフォルト ""）
   - UI: 症例画面のラベル行直下に textarea（rows=2、ラベル「患者サマリ（1〜2行・申し送り用）」、placeholder 例「80代男性、誤嚥性肺炎で入院。抗菌薬治療中、嚥下評価待ち」）。oninput debounce・全画面 render 禁止（§1-4）
   - 書き出し: `buildDailyExport` の症例見出し直後に `P: （サマリ）` を1行（未記入なら行ごと省略）。`buildDischargeExport` に「## 患者サマリ」セクション追加（入院期間の後・入院時記録の前。未記入なら「- なし」）

3. **もしもプラン（I-PASS S: Contingency planning）**
   - データ: `case.contingency: [{ id, text }]`（症例レベル。日次繰越の対象外＝days に入れない）
   - UI: 今日のビューの「待ち」と「引っかかり」の間に「もしもプラン（もし◯◯なら→◯◯する）」リスト。追加・削除のみ（チェックなし）。placeholder 例「夜間38.5℃以上→血培2セット」
   - 書き出し: `buildDailyExport` の「待ち」の後に「### もしもプラン」（なければ「- なし」）。`buildDischargeExport` には含めない（運用時情報のため）

4. **退院書き出しのルーチン表記修正**：現状 raw キー（`vte` 等）を列挙している箇所を、`ROUTINE` のラベル（`t`）で出力するよう修正

5. **後方互換**: 既存 `casebook:v2` データ（patientSummary / contingency 無し・旧 routine キー）を読み込んでもエラーなく動作し、旧キーのチェック状態が上記マップ通り引き継がれること

6. HANDOFF.md に v2.2 差分（データモデル・ROUTINE 対応表・書き出し変更）を追記

## 7. 完了条件（Codex が自己確認してから終了）

1. `node --check` 相当で構文エラーなし（script を抽出して確認）
2. `<script id="logic">` の関数（rolloverCase / buildDailyExport / buildDischargeExport / purgeTrash）が DOM 参照ゼロで、Node から require/eval で呼べる
3. HANDOFF.md のデータモデル・画面構成・変更時チェックリスト（§該当節）を v2 に合わせて更新
4. index.html 冒頭のヘッダコメント（バージョン・概要）を v2 に更新
