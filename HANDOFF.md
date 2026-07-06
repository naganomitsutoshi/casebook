# Casebook 引き継ぎ書

> Today-first の入院症例管理アプリ。`index.html` 単一ファイル、Vanilla JS、外部送信なし。

## 1. 目的

v2 は「Problem List の写経」ではなく、各症例をその日の判断と作業単位で扱う設計に切り替えた。

- 一覧は「今日やる残」「待ち」「収集の埋まり具合」を見るホーム
- 症例画面は「今日のビュー」が主役
- 夜に全アクティブ症例を Markdown で一括書き出し
- 退院時は全期間版を個別に書き出し

## 2. 不変条件

- **アプリ本体は `index.html` 単一ファイル**。PWA シェル（`manifest.webmanifest` / `sw.js` / `icons/`）のみ別ファイル（v8.1・設計書承認済みの軽微例外）。外部ライブラリ禁止。アプリ本体で `fetch` / `XHR` 禁止。`sw.js` は同一オリジン GET の中継のみで外部送信なし
- PII 入力欄を作らない。氏名・患者ID・病院名は扱わない。**部屋番号のみ可**（識別性の低い運用情報・書き出し非掲載、v8.0）
- ユーザー入力を `innerHTML` に入れる箇所は必ず `esc()` を通す
- テキスト入力は `oninput` + debounce 保存。入力中に全画面 `render()` を呼ばない
- モバイル優先。`520px` 以下は 1 カラム、主要ボタンは `44px` 以上
- ストレージキーは `casebook:v2`（本体・フィールドは追加のみ）。別キー: `casebook:theme` / `casebook:stats` / `casebook:settings`。IndexedDB: `casebook-photos` / `casebook-backups`（独立DB・写真DBの version bump 禁止）
- 純ロジックは `<script id="logic">` に分離し、DOM 非依存で Node から読める
- **インラインハンドラ（onclick 等）から呼ぶ関数名を DOM 内蔵APIと被せない**（`createEvent`・`close`・`open`・`focus`・`remove` 等）。インラインハンドラは要素→document→window の順で名前解決するため、内蔵APIが自作関数を隠して無反応になる（v9.1 で `createEvent`→`createEventItem` 事故対応。smoke にブロックリスト検査あり）

## 3. 現在の画面構成

- 一覧
  - アクティブ / 退院 / すべて フィルタ
  - 新規症例
  - 今日の書き出し
  - ゴミ箱
- 症例画面
  - タブ: `today` / `log` / `timeline`
  - 今日のビュー
    - 問題リスト
    - 今日やる
    - 待ち
    - 引っかかり
    - 入院時セクション
    - 薬剤
    - イベント
    - 退院時サマリ
  - 過去ログ
    - 各日の `collect/todos/waits/hooks` を後編集
  - 経過表
    - 収集5項目、薬剤帯、イベント点表示
- ゴミ箱
  - 復元
  - 完全削除

## 4. データモデル

```js
{
  version: 2,
  cases: [{
    id,
    createdAt,
    status: "active" | "discharged",
    deletedAt: null | "ISO",
    severity: "" | "stable" | "watcher" | "unstable",   // v2.1
    patientSummary: "",                                  // v2.2 I-PASS P（1〜2行の申し送りサマリ）
    ageBand,
    sex,
    cc,
    admittedAt,
    dischargedAt,
    admission: {
      note: "",
      photoIds: [],
      routine: { meds, allergy, sdm, code, outlook, bps, deepin, risk, rehab, acp }  // v2.2 テンプレ整合10項目
    },
    contingency: [{ id, text }],                         // v2.2 I-PASS S（もしもプラン。日次繰越なし）
    problems: [{ id, title, assessment, active }],
    meds: [{ id, name, route, startDate, endDate, note }],
    events: [{ id, date, type, title, note }],
    days: [{
      date,                                              // v3: collect は廃止（旧データの collect は読み込み時に除去）
      todos: [{ id, text, done }],
      waits: [{ id, text, resolved }],
      hooks: [{ id, text }]
    }],
    summary: { course, myPractice, outcome },
    lastExportedAt
  }]
}
```

- 写真本体は localStorage に入れない
- IndexedDB:
  - DB名: `casebook-photos`
  - store名: `photos`
  - record: `{ id, caseId, blob, createdAt }`

## 5. 実装の要点

- `Store`
  - `window.storage -> localStorage -> in-memory` の順で保存
  - `KEY = "casebook:v2"`
- 純ロジック
  - `logicFactory()` の返り値を `LOGIC` として使用
  - `module.exports = LOGIC` ガードあり
  - 主要関数:
    - `normalizeData`
    - `ensureCaseShape`
    - `rolloverCase`
    - `purgeTrash`
    - `buildDailyExport`
    - `buildDischargeExport`
- 画面状態
  - `DB`
  - `VIEW = { name, caseId, tab, filter }`
- 再描画方針
  - トグルや追加削除は `persist()` で再描画
  - テキスト入力は値更新 + `queueSave()` のみ
- 日替わり繰越
  - 起動時
  - `visibilitychange` で復帰時

## 6. 写真機能

- `<input type="file" accept="image/*" capture="environment" multiple>`
- 症例の `admission.photoIds` に写真IDだけ保持
- サムネイルは `URL.createObjectURL` で都度生成
- 各写真:
  - 表示
  - 共有 (`navigator.share({ files })` が使えれば共有)
  - ダウンロード fallback
  - 削除
- 症例完全削除時は IndexedDB の写真も削除

## 7. 書き出し

- 一覧の「今日の書き出し」
  - `LOGIC.buildDailyExport(DB, todayISO())`
  - すべてのアクティブ症例を連結
  - コピー成功後に `lastExportedAt` 更新
- 症例の「退院書き出し」
  - `LOGIC.buildDischargeExport(caseObj)`
  - frontmatter 付き全期間版

## 8. 注意点

- `renderLogTab()` 内では日別編集UIをそのまま描くので、DOM が大きくなりやすい
- `renderTimelineTab()` は簡易版。セル幅やイベント表現は今後の調整余地あり
- `buildDischargeExport()` のルーチン表示は v2.2 で `ROUTINE` のラベル（`t`）出力に変更済み
- `toggleSection()` は DOM トグル＋ `VIEW.open` に開閉状態を記録（v9〜）。再描画では `sectionOpen(id, 既定値)` が参照し「開いたまま追加しても閉じない」を担保。症例遷移（`go()`）でリセット。localStorage には保存しない

## 9. 変更時チェックリスト

- [ ] 新しい表示箇所で `esc()` を通したか
- [ ] 新しいテキスト入力で `render()` を直接呼んでいないか
- [ ] データモデル変更時に `ensureCaseShape()` / `normalizeData()` を更新したか
- [ ] PII を促す入力欄を追加していないか
- [ ] `casebook:v2` 以外へ勝手に保存していないか
- [ ] 純ロジック関数が DOM 参照を持っていないか
- [ ] モバイル幅で崩れていないか

## 10. 最初に読む場所

1. [index.html](/C:/Users/nagan/Documents/dev/casebook/index.html)
2. `<script id="logic">`
3. `Store`
4. `renderCase()` と各タブ描画関数

## 11. v2.1 差分

- `case.severity`（`"" | "stable" | "watcher" | "unstable"`）追加。一覧・症例画面に重症度チップ。※一覧の重症度順ソートは v2.1 時点では**未実装のまま記載されていた**（QA 2026-07-04 指摘）。実装は v5（`sortCasesForList`）
- `summary.myPractice`（私の実践）追加。退院時サマリ UI と退院書き出し「## 私の実践」に反映
- 日次書き出しの症例見出しに重症度を併記（例 `【要注意】`）
- 退院書き出しに「## 退院時未解消の待ち」（最終日の未解消 waits）追加
- 後方互換は `ensureCaseShape()` が担保（旧 `casebook:v2` データもそのまま読める）

## 12. v2.2 差分（入院時テンプレ整合＋I-PASS完全化）

- **ROUTINE 10項目を置換**：CEO の入院時記録テンプレ（Vault `2_診療部/99_テンプレート/_テンプレート_入院時記録.md`）の節構成と 1:1 対応。定義は `<script id="logic">` 内へ移動し `module.exports` に含む（メイン側は `LOGIC.ROUTINE` 参照）
- 新旧キー対応：`meds`/`allergy`/`code`/`rehab` 維持、`vte→risk`・`delirium→risk`・`disposition→rehab`（true を OR で引き継ぎ）、`nutrition`/`pain`/`devices` 破棄。移行は `ensureCaseShape()` 内

| 新キー | ラベル | テンプレ対応節 |
|---|---|---|
| meds | 休薬・内服調整 | 【薬剤歴】【休薬・内服調整】 |
| allergy | アレルギー・予防接種 | 【アレルギー】【予防接種】 |
| sdm | 意思決定支援 | 【意思決定支援】 |
| code | Code status | 入院管理情報（急変時方針） |
| outlook | 入院後の見通し | アセスメント末尾（在院日数・退院方向） |
| bps | BPSモデル | ■ BPSモデルによる患者理解 |
| deepin | DEEP-IN＋CFS | ■ 高齢者機能評価（DEEP-IN） |
| risk | リスクスクリーニング | ■ 入院時リスクスクリーニング |
| rehab | リハGoal | ■ リハビリ Goal |
| acp | 退院支援・ACP | ■ 退院支援・多職種連携・ACP |

- **`case.patientSummary`**（I-PASS P）：今日のビューのラベル行直下に textarea。日次書き出しでは症例見出し直後に `P: …` 行（未記入なら省略）、退院書き出しに「## 患者サマリ」
- **`case.contingency`**（I-PASS S: contingency planning）：「待ち」と「引っかかり」の間の「もしもプラン」リスト（追加・削除のみ、繰越なし）。日次書き出しに「### もしもプラン」、退院書き出しには含めない
- I-PASS の対応表：I=severity（v2.1）／P=patientSummary／A=今日やる／S=contingency／S=Synthesis は `/casebook` スキル側（アプリ外）
- 入院時セクションに注記「テンプレ準拠のカルテ記載は写真で残す。チェックは各節を書いたかの確認」＝二重記録禁止の位置づけを明文化

## 13. v3 差分（今日の収集の廃止＋実装体制の変更）

- **実装体制**：v3 から Claude Code（Fable 5）が直接実装。Codex 委譲は使っていない（CEO 指示 2026-07-04、仕様は `SPEC-v3.md`）
- **「今日の収集」（collect）を全面削除**：データモデル（`days[].collect`）・今日のビューのパネル・過去ログの編集 UI・経過表の5項目行・一覧の収集バッジ/メトリクス・書き出しの「### 今日の収集」「- 収集:」行・関連 CSS
- **後方互換**：旧データの `days[].collect` は `ensureCaseShape()` が読み込み時に黙って除去（他フィールドは保全）。ストレージキーは `casebook:v2` のまま
- **Codex 時代の残骸を掃除**：logic 内に二重定義されていた `buildDailyExport` / `buildDischargeExport`（先勝ちの死んだ方）と、未使用の旧描画関数群（`renderList` / `renderCaseCard` / `renderCase` / `renderTodayTab`、262行）を削除。現役の描画関数は `～V21` 系のみ
- **書き出しを仕様書の形式に統一**：日次見出しは `## 症例: 【要注意】ラベル（病日n）` 形式（別行の「重症度:」をやめ見出しに統合）、`### 引っかかり`・`### 薬剤・イベント（本日変更分）` の表記に統一。退院書き出しは `## 入院期間`・`### 私の実践`・`## 退院時未解消の待ち`（**最終日の未解消のみ**。全日集計だと繰越コピーで同じ待ちが重複するバグがあった）に修正

## 14. v4 差分（デザイン・配置・操作性のブラッシュアップ）

- **実装体制**：v3 に続き Claude Code（Fable 5）直接実装（仕様は `SPEC-v4.md`）。**データモデル・`<script id="logic">`・保存キーは無変更**（書き出し形式も v3 と同一）
- **モバイル**：下部ナビ（一覧/新規/書き出し/ゴミ箱、safe-area 対応）を追加し、モバイルではトップバーの操作ボタンを非表示＋トップバー非スティッキー化。症例タブ（今日・過去ログ・経過表）は `.tabs-bar` としてスティッキー化
- **ダークモード**：`prefers-color-scheme: dark` 自動追従。全色を CSS 変数化（`--card`/`--sheet`/`--field`/`--info` 等を新設）し、ハードコード色を撤去。`color-scheme: light dark`・`theme-color` メタ2種
- **配置**：今日のビューは「今日やる→待ち→もしもプラン→ひっかかり→問題リスト」の順（書き出しの節順は不変）。症例カードに患者サマリ2行プレビュー、メトリクス3カラム化
- **入力**：追加欄は Enter で追加＋フォーカス維持（`addTextItem`/`addContingency`）。行アイテムは「チェック44px＋borderless input＋×削除44px」の1行構成（`.row-item` 全面変更、`.row-main`/`.row-content` 廃止）。写真追加は `.file-btn` ラベル化
- **経過表**：薬剤はセル背景の帯（`td.band-oral`/`td.band-inj`）＋開始/終了タグ、イベント点は種別頭文字、凡例 `.tl-legend` 追加
- **バグ修正**：①過去ログの入力 ID 重複（`${kind}Input` → `${kind}Input-${date}`。過去日への追加が別の日の入力値を拾っていた）②フィルタチップの選択状態 CSS（`.chip.on`）欠落 ③カウントバッジは `id` から `data-count` 属性の複数要素更新へ（`refreshCounts`）
- **テスト**：`tests/smoke-render.js` 新設（DOM スタブで描画関数の実行時エラー・パネル並び・帯表示を検証）。`tests/verify-v2.js` は無改修で全通過＝ロジック非破壊の裏取り
- **掃除**：未使用 CSS（`.mini-grid`/`.mark`/`.med-band`/`.icon-btn`/`.btn-warn` 等）を削除

## 15. v5 差分（道具ファーストUIへの転換）

- **経緯**：CEO「UIがイメージと違う」→ リサーチ係（外部ベストプラクティス調査）＋QA部（独立UI/UXレビュー）の両報告を反映（仕様は `SPEC-v5.md`、根拠資料の所在も同ファイル冒頭に記載）。データモデル・logic・保存キーは v3 から一貫して無変更
- **装飾全廃**：ヒーロー／メトリクスカード／常設PIIバナー（新規モーダルへ一本化）／英語飾り（tagline・eyebrow・Active/Open Todos/Waiting・active/inactive→継続中/解決）／グラデ・glow・backdrop-blur・大影（影はモーダル/トーストのみ）／Inter・負のletter-spacing。角丸はトークン3段（--r-s/m/l = 8/12/16px）
- **一覧**：`renderListV21` を「ツールバー→1行サマリ→症例リスト→フッター（ゴミ箱リンク＋保存表示）」に再構成。**`sortCasesForList` で重症度順ソートを新規実装**（§11の記載齟齬を解消）。カードは `.case-row`（左に重症度色バー・フラグは非ゼロのみ）
- **症例ヘッダ**：タイトル18px＋重症度チップ＋病日/入院日に圧縮。患者サマリ・重症度変更・症例削除・書き出し時刻は「編集」折りたたみ（`VIEW.caseEdit` で開閉状態を保持、`go()` で症例遷移時にリセット）。保存ボタンはヘッダ常設
- **入力**：追加入力欄を各パネル先頭へ移動、`enterkeyhint="next"`
- **QA P2反映**：--ink-faint コントラスト是正／✓色を var(--on-accent)／下部ナビ3タブ化（ゴミ箱除去・書き出しアイコン⧉）／row-del 44px／event-dot 36px／「引っかかり」表記統一／「一言」→「主訴・病名」
- **不採用**：経過表の直近5日絞り込み（全期間表示が現実的・状態管理増のため。実機QAで重ければ再検討）
- **テスト**：smoke-render.js に重症度ソート検証＋撤去要素（hero/eyebrow等）の残存ゼロ検証を追加

## 16. v6 差分（実機QAフィードバック8件対応）

正本仕様は `SPEC-v6.md`。データ・ロジック・保存キー無変更。

- **経過表を日付範囲ベース化（バグ修正兼）**：列を `days` レコードでなく `timelineDates()`（入院日〜max(今日, イベント日, 薬剤開始/終了, 退院日)のカレンダー連続日付）で生成。**未来日付イベントが経過表に出なかったバグの根治**。未来列は `.future`（opacity .62）。上限370列・日付形式ガードあり
- **全項目の後から編集**：症例ヘッダ「編集」内に年代/性別/主訴・病名/入院日/退院日を追加（`updateCaseLabel`／`updateCaseDate`。主訴入力はタイトルをDOM直接更新しフォーカス非破壊）。薬剤・イベントは「編集」ボタン→モーダル（`editMedModal`/`saveMedEdit`/`editEventModal`/`saveEventEdit`）
- **テーマ選択制**：`casebook:theme`（auto/light/dark・保存キーとは別キー）＋ `<html data-theme>`。auto は matchMedia 追従。切替UIは一覧下部。**ダークは無彩色グレースケール**（強調色のみ色残し）。meta theme-color はJS連動
- **項目名英語化**：Problem List / To Do / Waiting / Contingency Plan / Hooks / Admission Note / Medications / Events / Discharge Summary / Today / Log / Timeline / List / New / Export / Trash。panel-sub に日本語補足。**書き出しMarkdown見出しは日本語のまま**（`/casebook` スキルとの取り決め。変える場合はスキル同時改訂）→ **v6.1 で英語化済み（§17）**
- **配置**：Problem List を Today タブ最上位へ。追加入力欄（add-row）を各パネル最下部へ（v5 の「先頭へ」を反転。CEO実機フィードバックによる確定）
- **テスト**：smoke-render.js に未来イベントの経過表反映（回帰）・追加欄最下部・テーマ切替・新パネル順を追加

## 17. v6.1 差分（書き出し見出しの英語化）

CEO指示（2026-07-05）。データ・ロジック・保存キー無変更、見出し文字列のみ。

- **日次書き出し**：`# Casebook Export YYYY-MM-DD` ／ `## Case:` ／ `### Problem List` / `### To Do` / `### Waiting` / `### Contingency Plan` / `### Hooks` / `### Medications & Events（本日変更分）` / `### Photos`
- **退院書き出し**：`## Admission Period` / `## Patient Summary` / `## Admission Note` / `## Routine` / `## Problem List` / `## Daily Log` / `## Medications` / `## Events` / `## Discharge Summary`（`### Course` / `### My Practice` / `### Outcome`）/ `## Unresolved Waiting`。frontmatter `type: casebook-discharge` は不変
- **行内の日本語は維持**（「- 入院日:」「- なし」重症度ラベル等）＝UIの「英語見出し＋日本語補足」方針と同一
- **`/casebook` スキル同時改訂済み**（Vault側 `.claude/skills/casebook/SKILL.md`）：英語見出しを正、旧日本語見出しの貼り付けも同義として受理（過去分の再処理互換）
- **テスト**：verify-v2.js の書き出し断言を英語見出しに更新＋新見出しの存在チェックを追加

## 18. v7 差分（ゲーミフィケーション Phase 1・入力ナッジ）

正本仕様は `SPEC-v7.md`（設計判断の経緯は Vault `3_新規事業部/2_PoC中/Casebook/ゲーミフィケーション実装計画.md`）。データモデル・書き出し形式・`casebook:v2` 無変更。

- **新キー `casebook:stats`**：`{ days: { date: { touched:[caseId], exported:bool } }, totals: { recordDays } }`。患者情報ゼロ。書き込み時に90日剪定（累計 recordDays は剪定非依存）。撤退基準KPI（記録完遂率・書き出し実行率）の計測装置を兼ねる
- **6機能**：Today進捗バー（一覧=全症例合算/症例=当日To Do）／未タッチ症例ドット（`.dot-untouched`）／Exportストリーク＋14日●○表／17時以降の未Exportナッジバナー（`.nudge`）／Export完了トーストのランダムねぎらい＋連続日数／累計カウンタ（症例数・記録日数）
- **タッチ記録**：`noteTouch()` を `queueSave()`（旧 queueSave は `queueSaveInner` に改名）と `persist()` にフック。`persist({touch:false})` で抑止（visibilitychange の自動繰越に使用）。症例画面表示中の変更のみ記録される仕様
- **`exportText(text, after, doneMsg)`**：第3引数で成功トースト文言を差し替え可能に
- **原則**：ゲーム化は記録・学習行動のみ（患者ケアは対象外）。損失回避は表示が途切れるだけ。プッシュ通知は外部送信禁止のため非搭載（OSリマインダー推奨）
- **撤去可能性**：ゲーミフィケーションは独立実装（stats ブロック＋6箇所のUI差し込み）。効果がなければ1コミットで撤去可能

## 19. v8.0 差分（安全網・退院管理）

正本仕様は `SPEC-v8.md`（CEO決裁 2026-07-06。病棟管理試作アプリ参考の「日常業務の道具」化）。

- **バグ修正2件（v8の前提）**：①`todayISO()` をローカル日付化（旧実装は UTC で JST 09:00 に日付が変わっていた）②退院済み症例の days 汚染（一覧描画の `caseStats`→`currentDay`→`ensureTodayDay` と `syncTodayView` が discharged にも空の当日 day を追記）。`currentDay` は active のみ確保、discharged は `getLastMeaningfulDay`（内容のある最終日。汚染済み既存データの救済を兼ねる）
- **バックアップ**：手動 = 一覧 Data 行から `{app,exportedAt,data,stats,theme,settings}` を JSON DL（share-first・`a.download` フォールバック）／復元（`LOGIC.parseBackup` で検証→確認モーダル→復元直前に現行データを当日スナップショットへ退避）。自動 = boot 時に1日1回 IndexedDB `casebook-backups` へ（7世代・古い順に削除）。**写真は対象外**
- **部屋番号 `case.room`**：編集折りたたみで入力（oninput+debounce）。カード・ヘッダに `Rm` 表示。**書き出しには出さない**（verify §12 でネガティブアサート）
- **退院予定日 `case.plannedDischargeAt`**：`applyPlannedDischarge`（logic）が boot / visibilitychange で発火（=アプリを開いた時に退院扱い）。発火時に `dischargedAt=予定日`・予定日クリア（再退院ループ防止。`setCaseStatus('active')` でも過去日を掃除）。一覧に「退院書き出し未実施 n件」ナッジ（`dischargeExportPending`）
- **退院チェックリスト `case.dischargeChecklist`**：`DC_ROUTINE` 7項目（summary/rx/careplan/referral/followup/explain/resources）。Discharge Summary 折りたたみ冒頭に routine-grid。退院書き出しに `## Discharge Checklist`（`- [x]` 形式）
- **退院後未完了**：discharged の Today タブ最上部に「Pending after discharge」パネル（最終有内容日の未完了 To Do／未解消 Waiting をチェックで消し込み）。カードに `残 n` フラグ。退院書き出しに `## Unresolved To Do`
- **書き出し差分**：日次に `- 退院予定: YYYY-MM-DD`（P: の後・設定時のみ）。退院に `## Discharge Checklist`・`## Unresolved To Do`。`/casebook` スキル側も同時改訂済み

## 20. v8.1 差分（週間予定・自動化・PWA）

- **Week ビュー**：下部ナビ `List / Week / New / Export` の4項目化＋デスクトップはトップバーに Week。`buildWeekItems(data, today, 7)`（logic）＝アクティブ症例のイベント全種別＋退院予定＋退院済みの `followup`。イベント種別に `followup`（外来F/U）追加
- **定期処方リマインド**：`casebook:settings` の `rxWeekdays`（一覧下部の曜日チップ・病棟一律）。`injectRxTodo`（logic）が boot / visibilitychange の rollover 直後に当日 day へ `src:"rx"` の To Do を注入。`day.rxInjected` で冪等（ユーザー削除後の同日再注入なし）。`persist({touch:false})` でゲーミフィケーションを汚さない
- **Order 2段階**：To Do 追加行の Order チップ（`toggleOrderMode` は classList 直接切替＝入力中テキストを消さない）。`src:"order"` の To Do を done にすると `promoted` 1回限りで Waiting に `結果確認: <text>` を自動生成（`orderWaitText`）。**検査値そのものは記録しない**（二重記録禁止維持）
- **フィールド保全（重要）**：`ensureCaseShape` の todos/waits マップと `rolloverCase` の繰越コピーは v8.1 から `src`/`promoted`/`rxInjected` を明示保全する。**新フィールド追加時はこの2箇所の保全漏れに注意**（漏れると保存のたび静かに消える。verify §17 が回帰テスト）
- **PWA**：`manifest.webmanifest`（`start_url:"./"`・`scope:"./"`＝GitHub Pages `/casebook/` サブパス対応）＋ `sw.js`＋`icons/`（192/512 maskable・apple-touch-icon 180）。SW は navigate を **network-first**（成功時 cache.put・失敗時のみキャッシュ）、静的アセットは cache-first。キャッシュ名はバージョン付き（`casebook-v8.1.x`）・activate で旧削除＋`clients.claim()`。登録は `if("serviceWorker" in navigator)` ガード付き
- **SW キルスイッチ手順**（更新が届かない事故時）：`sw.js` を以下だけの内容に差し替えて push →ユーザーは2回リロード
  ```js
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll()).then((cs) => cs.forEach((c) => c.navigate(c.url))));
  });
  ```
- **留意**：GitHub Pages は `sw.js` に ~10分の HTTP キャッシュ。デプロイ反映は最大10分＋リロード2回。`sw.js` を変更したら `CACHE` 名も上げること

## 21. v9 / v9.1 差分（カード型一覧・イベント追加バグ修正・全項目件数折りたたみ）

- **v9.0**：一覧を Keep 型カードに全面改修（カードに未完了タスク本文 最大3件＋カード上チェック・重症度地色・📅直近イベント/退院予定チップ・クイック追加・カード単位部分再描画）。Meds/Events を件数付き折りたたみ化。表示層のみ（SPEC-v9）
- **v9.1 バグ修正**：`createEvent` → `createEventItem` リネーム。旧名はインラインハンドラの名前解決（要素→document→window）で `document.createEvent` に奪われ、イベント追加ボタン・Enter 追加が実機で一切動かなかった（§2 不変条件に命名ルール追記・smoke にブロックリスト回帰検査）
- **v9.1 退院予定日の導線**：Discharge Summary（active のみ）にも退院予定日 date input（`updatePlannedDischarge` 共用・未来日付OKをラベル明記）。編集折りたたみ内の欄も残置
- **v9.1 件数折りたたみ統一**：Today タブの Problem List（継続中n）/ To Do（done/全）/ Waiting（未解決n）/ Contingency Plan（n）/ Hooks（n）を `.collapse` 化。Admission Note・Discharge Summary の見出しにチェック済み n/全 を追加。既定開＝Problem List・To Do（Admission Note は入院当日のみ、従来どおり）。開閉は `VIEW.open` 保持
