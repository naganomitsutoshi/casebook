# SPEC-v7 — ゲーミフィケーション Phase 1（入力ナッジ）

> CEO GO判断 2026-07-05。計画正本＝Vault `3_新規事業部/2_PoC中/Casebook/ゲーミフィケーション実装計画.md`。
> 参考理論＝Vault `0_CEOオフィス/生活/ゲーミフィケーション.md`（4つの適合質問・8モチベーション・損失回避2〜5%基準・ソロプレイヤー注意）。

## 原則

- ゲーム化対象は**記録・学習の行動のみ**。患者ケア・医療判断・重症度は対象外
- 道具ファーストUI（v5）を崩さない：小さな進捗表示と1行メッセージまで。バッジ・ポイント乱発なし
- 損失回避は「表示が途切れる」だけ（ペナルティなし）
- データモデル・書き出し形式・保存キー `casebook:v2` は無変更

## データ

- 新キー **`casebook:stats`**（テーマ `casebook:theme` と同方式の別キー）
- 形：`{ days: { "YYYY-MM-DD": { touched: [caseId...], exported: bool } }, totals: { recordDays: n } }`
- 患者情報ゼロ（日付・症例ID・真偽値のみ）。書き込み時に 90 日超を `LOGIC.pruneStatsDays` で剪定
- `totals.recordDays` は「活動があった日」の累積カウンタ（剪定の影響を受けない）

## 機能（6つ）

| # | 機能 | 実装 |
|---|---|---|
| 1 | Today 進捗バー | `renderTodayTabV21` 先頭に当日 To Do の done/total バー（total>0 のみ）。一覧にも全症例合算版（`.progress-row`） |
| 2 | 未タッチ症例ドット | `case-row` のラベル前に `.dot-untouched`（warn色8px）。当日 `touched` に入ると消える |
| 3 | Export ストリーク＋14日ドット表 | 一覧フッターに「Export 連続 n 日」＋ ●○ 14日表（`exportStreak`/`exportDotRow`、純ロジック `computeStreak` は今日未実施なら昨日から数える＝当日中は途切れ表示にしない） |
| 4 | 夜のアプリ内ナッジ | 一覧最上部：アクティブ症例あり ＆ 17時以降 ＆ 当日未 Export → `.nudge` バナー（Export ボタン付き） |
| 5 | 完了メッセージ | `copyDailyExport` 成功トーストを「コピーしました — <ランダム5種>（連続 n 日）」に。`exportText` に `doneMsg` 引数追加 |
| 6 | 累計カウンタ | 一覧フッターに「累計 n 症例 ・ 記録 n 日」（症例=非削除の全件、記録日=totals.recordDays） |

## タッチ記録の仕組み

- `noteTouch()`：`VIEW.name === "case"` のときだけ `VIEW.caseId` を当日 `touched` へ
- フック位置：`queueSave()`（テキスト入力系）と `persist()`（トグル・追加削除系）。`persist({ touch:false })` で抑止（visibilitychange の自動繰越はユーザー入力でないため抑止）
- `markExportedToday()`：`copyDailyExport` 成功時のみ（退院書き出しは対象外）

## 純ロジック追加（`<script id="logic">`・エクスポート済み）

- `prevDateISO(iso)` — 正午アンカーで前日（タイムゾーン安全）
- `computeStreak(exportedDates, today)` — 今日実施済なら今日から、未実施なら昨日から連続数を数える
- `pruneStatsDays(days, today, keepDays=90)` — 日付形式ガード＋期限切れ剪定

## できないこと（設計上の確定事項）

- アプリを閉じている時のプッシュ通知（Web Push はサーバー必須＝外部送信なしに抵触）。開くきっかけは OS リマインダーの本人設定を推奨

## テスト

- `verify-v2.js` §9：prevDateISO（年跨ぎ含む）／computeStreak 4ケース／pruneStatsDays（剪定・不正キー除去）
- `smoke-render.js`：一覧に streak・累計・progress-row・dot-untouched ／ Today に today-progress ／ markCaseTouched → stats 別キー保存・`casebook:v2` 非混入・ドット消灯 ／ markExportedToday → 「Export 連続 1 日」＋●表示
