# Casebook SPEC v6 — 実機QAフィードバック対応（2026-07-05）

v5 実機QAで CEO から受けた8件のフィードバックへの対応仕様。
データモデル・ロジック・保存キー（`casebook:v2`）は v3 以降不変。実装は Claude（Fable 5）直接。

## 0. フィードバックと対応の対応表

| # | フィードバック | 対応 |
|---|---|---|
| 1 | イベントの追加が反映されない | §1（経過表の列生成バグが原因） |
| 2 | 症例名も含めて全項目を後から編集可能に | §2 |
| 3 | ダークモードを設定で選択制に | §3 |
| 4 | ダークはグレースケール（強調色のみ色可） | §3 |
| 5 | 項目名を全て英語に | §4 |
| 6 | Problem List を最上位に | §5 |
| 7 | 追加欄を各パネルの一番下に | §5 |
| 8 | 経過表は未来も表示可能に | §1 |

## 1. 経過表の日付範囲ベース化（#1・#8）

**診断**：旧実装は経過表の列を `caseObj.days`（今日ビューを開いた日にだけ生成される日次レコード）から作っていた。このため**未来日付のイベント（明日のCT等）は days が存在せず、経過表に一切表示されなかった**。「イベントの追加が反映されない」の正体。

**対応**：
- `timelineDates(caseObj)` を新設。列＝**入院日 〜 max(今日, 全イベント日, 全薬剤開始/終了日, 退院日)** のカレンダー連続日付。days レコードに依存しない
- 未来列は `.future` クラスで薄く表示（opacity 0.62）。今日列の強調は従来どおり
- 安全上限370列（日付の誤入力による暴走防止）。日付形式は `YYYY-MM-DD` の正規表現でガード
- 入院日より前のイベントは経過表対象外（Events リストには表示される）

## 2. 全項目の後から編集（#2）

- **症例ヘッダの「編集」内に追加**：年代・性別・主訴/病名（＝症例ラベル）、入院日、退院日（退院済みのみ表示）
  - 主訴/病名はテキスト入力（oninput + queueSave、タイトル表示は DOM 直接更新でフォーカス非破壊）
  - 年代・性別・日付は select / date（onchange + persist）
- **薬剤・イベントに「編集」ボタン追加**：モーダルで全フィールド（薬剤＝名称/経路/開始/終了/メモ、イベント＝日付/種別/タイトル/メモ）を編集
- 既から編集可能：問題リスト・日次項目・患者サマリ・重症度・入院時記録・退院サマリ → 変更なし

## 3. テーマ選択制＋グレースケールダーク（#3・#4）

- 設定キー **`casebook:theme`**（`auto` / `light` / `dark`）。保存キー `casebook:v2` とは別（不変則維持）
- 適用は `<html data-theme="light|dark">`。`auto` は `matchMedia(prefers-color-scheme)` で解決し、OS切替に追従
- 切替UIは一覧画面下部「テーマ Auto / Light / Dark」（chip 流用）
- **ダークパレットは無彩色**：面 #151515〜#262626、文字 #e9e9e9〜#8e8e8e、線 #2d2d2d〜#3a3a3a。**強調色（accent 緑・warn・danger・done・info）のみ色を残す**
- meta theme-color は JS で連動更新

## 4. 項目名の英語化（#5）

| 旧 | 新 |
|---|---|
| 問題リスト / 今日やる / 待ち / もしもプラン / 引っかかり | Problem List / To Do / Waiting / Contingency Plan / Hooks |
| 入院時記録 / 薬剤 / イベント / 退院サマリ | Admission Note / Medications / Events / Discharge Summary |
| タブ：今日・過去ログ・経過表 | Today / Log / Timeline |
| 下部ナビ：一覧・新規・書き出し | List / New / Export |
| ゴミ箱 | Trash |

- 各パネルの panel-sub に日本語補足を残す（例：Hooks「引っかかり・学びや違和感のメモ」）
- **操作ボタン（追加・保存・編集・削除等）・状態（入院中・退院・安定/要注意/不安定）・モーダル文言は日本語のまま**（項目名のみ英語化の指示に準拠）
- **書き出しMarkdownの見出しは日本語のまま**：`/casebook` スキル（Vault側）が見出しを解釈する取り決めのため。変更する場合はスキルと同時改訂が必要

## 5. 配置変更（#6・#7）

- Today タブの並び：**Problem List → To Do → Waiting → Contingency Plan → Hooks**（右列：Admission Note → Medications → Events → Discharge Summary は不変）
- 追加入力欄（add-row）を**各パネルの一番下**へ移動（To Do / Waiting / Contingency / Hooks / 過去ログ内も同様）。Problem List の「追加」ボタンもリスト下部へ

## 6. テスト

- `tests/verify-v2.js`：無変更で全pass（ロジック非破壊の証明）
- `tests/smoke-render.js` v6 更新：英語パネル名・新パネル順・追加欄最下部・**未来日付イベントの経過表反映（回帰テスト）**・テーマ切替（`casebook:theme` 保存・auto解決）

## 7. 不変条件（変更なし）

単一 index.html／外部ライブラリ・CDN・Webフォント・fetch/XHR なし／PII入力欄なし／esc() 必須／保存キー `casebook:v2` 不変／44px タップターゲット／`<script id="logic">` の純ロジック分離。
