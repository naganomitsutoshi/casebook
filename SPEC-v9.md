# SPEC-v9 — 「開かずに片づく」カード型一覧

> CEO GO 2026-07-06。提案正本: Vault `3_新規事業部/2_PoC中/Casebook/v9_カード型UI提案.md`（モックアップ準拠）。
> **表示層のみの変更**。データモデル・保存キー `casebook:v2`・書き出し形式・学習ループは不変。

## 1. 一覧カード（renderCaseCardV21 全面改修）

- ヘッダ行: 重症度ピル（安定=緑/要注意=黄/不安定=赤・未設定は非表示）＋ラベル＋未タッチドット。右に `Rm ・病日`（mono）
- 患者サマリ1行（既存）
- **タスクプレビュー**: 未完了 To Do → 未解消 Waiting の順に最大3件、本文をチェックボックス付きで表示。Waiting は黄枠ボックス＋`Waiting` 小チップ。4件以上は「ほか n 件…」
- 未処理ゼロ（active）は「✓ 未処理なし」1行に縮む
- 足元チップ: 直近イベント `📅 M/D 種別 タイトル`（今日以降で最も近い1件）／`退院予定 M/D`／`書き出し未`／discharged は `残 n`
- **クイック追加**: カード最下部に点線1行 input（active のみ）。Enter で当日 To Do に追加
- カードタップ＝症例へ（従来どおり）。カード内の操作要素（チェック・input）は `event.stopPropagation()` で遷移させない

## 2. 重症度＝カードの地色

- Light: unstable `#fbf0f0/#eccfcf`・watcher `#faf4e6/#e8d8b4`・stable `#eef4ee/#cfdccf`（背景/枠）。未設定は従来の card 色
- Dark: 彩度を落とした暗色（`#2a2020`/`#2a2620`/`#202a22` 系）。左端4px色帯は廃止（地色に置換）

## 3. カード単位の部分再描画

- `cardCheck(caseId, date, kind, itemId)`: 項目を done/resolved にし、**全画面 render() を呼ばず**該当カード（`[data-case-card]`）だけ差し替え＋サマリ行（To Do 残・進捗バー）を更新。保存は debounce（queueSaveInner）＋ markCaseTouched
- `quickAddTodo(caseId, input)`: 当日 day に To Do 追加→カード差し替え→クイック追加 input に再フォーカス
- DOM が取れない環境（テストスタブ等）は全画面 render() にフォールバック

## 4. 症例画面の再整理（読む場所へ）

- Medications / Events を件数付き折りたたみ（`.collapse`）に変換。既定は閉（Admission Note / Discharge Summary と同型）
- Today の作業パネル（Problem List / To Do / Waiting / Contingency / Hooks）は不変

## 5. テスト

- smoke: カードにタスク本文が出る／クイック追加 input／cardCheck で done＋保存される／severity 地色クラス／Meds・Events が折りたたみで件数表示
- 既存 verify は無改修で全通過すること（純ロジック不変の裏取り）
