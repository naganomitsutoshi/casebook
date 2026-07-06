# SPEC-v8 — 日常業務の道具化（退院管理・週間予定・オーダー確認・PWA＋バックアップ）

> 発端: CEO指示 2026-07-06「病棟管理試作アプリ（ward-management-app.vercel.app）を参考に、Casebook を日常業務の道具としてアップデート」。
> 正本設計書: Vault `3_新規事業部/2_PoC中/Casebook/設計書.md` §7 v8 差分（CEO決裁済み）。
> 実装体制: v3 以降と同じく Claude Code（Fable 5）直接実装。

## 0. スコープ（CEO決裁 2026-07-06）

**採用**

1. 退院管理セット（退院チェックリスト／退院予定日→当日自動退院／退院後未完了タスクの消し込み）
2. 週間予定ビュー（全患者横断・7日）
3. オーダー・定期処方の確認（曜日リマインド＝グローバル設定／検査オーダー2段階トラッキング。検査値そのものは記録しない）
4. 基盤強化（PWA化＋JSONバックアップ手動/自動7日分）
5. 患者カードに部屋番号のみ追加（書き出し非掲載）

**不採用（CEO指示）**: 申し送りテキスト生成・主治医欄。
**不採用（原則既決）**: 検査値・判定ヘルパー（二重記録禁止）・勉強リスト（Hooks重複）・優先順位（重症度ソート済）。

**不変条件**: 保存キー `casebook:v2` 不変・全フィールド追加のみ（後方互換）。PII境界は「匿名ラベル＋識別性の低い運用情報（部屋番号）のみ」。R1「単一HTML」は、アプリ本体=index.html 単一のまま、PWAシェル（manifest/sw/icons）のみ別ファイルという軽微例外を設計書で承認済み。

## 1. リリース構成

- **v8.0（安全網・退院管理）**: 既存バグ2件修正 → バックアップ → 部屋番号 → 退院予定日・自動退院 → 退院チェックリスト → 退院後未完了
- **v8.1（予定・自動化・PWA）**: 週間予定 → 定期処方曜日リマインド → オーダー2段階 → PWA（**最後・単独コミット**。SW事故時に切り分け可能にするため）

## 2. 既存バグ修正（v8 の前提）

### 2.1 `todayISO()` の UTC 問題

`new Date().toISOString().slice(0,10)` は UTC のため JST では 09:00 に日付が変わる。ローカル日付組み立て（getFullYear/getMonth/getDate）に修正。退院予定日の当日判定・曜日リマインド・週間予定はすべて日付境界が仕様のため v8 の最初に修正する。
既知の副作用: 修正当日は日付が最大1日ぶん一度に進む遷移が起きるが、rollover は冪等のため実害なし（ストリーク表示に1日欠けが出る可能性は許容）。

### 2.2 退院済み症例の days 汚染

`currentDay()`→`ensureTodayDay` が一覧描画（caseStats 経由）だけで退院済み症例に空の当日 day を追記（mutate）し、`syncTodayView()` も discharged に rollover を実行していた。退院翌日以降にアプリを開いてから退院書き出しすると `## Unresolved Waiting` が空の当日 day を参照して「なし」になる。

- `currentDay()`: active のみ `ensureTodayDay`。discharged は**内容のある最終日**（`getLastMeaningfulDay`、無ければ最終日、無ければ空 day を返すだけで days に追加しない）
- `syncTodayView()` と boot/visibilitychange の rollover: active のみ
- 既に汚染されたデータ（末尾に空 day が積まれた退院症例）も `getLastMeaningfulDay` により書き出しが正しくなる

## 3. データモデル差分（`ensureCaseShape` で補完・すべて追加のみ）

```js
// case 直下
room: "",                 // 部屋番号（任意・識別性低・書き出し非掲載）
plannedDischargeAt: "",   // 退院予定日 YYYY-MM-DD（発火時にクリア）
dischargeChecklist: {},   // DC_ROUTINE キーの bool マップ（admission.routine と対称）

// days[] の各 day
rxInjected: false,        // 定期処方 To Do を当日注入済みか（削除後の再注入防止）

// todos[]/waits[] の各 item（省略可）
src: "",                  // "" | "rx"（定期処方自動） | "order"（検査オーダー）
promoted: false           // order の done→Waiting 自動生成を1回に限定（todos のみ）
```

**保全**: `ensureCaseShape` の todos/waits マップと `rolloverCase` の繰越コピーは `{id,text,done}` 固定だったため、`src`/`promoted`/`rxInjected` を明示的に保全する（verify で回帰テスト）。

**新 localStorage キー**: `casebook:settings` = `{ rxWeekdays: [0-6の配列] }`（既定 `[]`＝オフ）。定期処方曜日は病棟一律のグローバル設定（症例ごと設定は「入力は秒」原則に反するため見送り。必要になれば case に `rxDays` を足す拡張余地のみ残す）。

**新 IndexedDB**: DB `casebook-backups` / store `snapshots` / record `{ date:"YYYY-MM-DD", payload:string, createdAt }`。既存 `casebook-photos` の version bump は行わない（独立DB）。7件超は日付昇順に削除。

## 4. 機能仕様

### 4.1 バックアップ（v8.0）

- **手動**: 一覧下部 Data 行。`{ app:"casebook", exportedAt, data, stats, theme, settings }` を JSON ファイルでダウンロード（`sharePhoto` と同じ share-first・a.download フォールバック）。**写真は対象外と UI に明記**
- **復元**: ファイル選択 → `parseBackup`（純ロジック・app/data 検査）→ 上書き確認モーダル → 復元直前に現行データを当日スナップショットとして自動退避 → 全キー復元 → 再描画
- **自動**: boot 時、当日分が無ければスナップショット保存（1日1回・日初回起動時点の状態）。7世代保持。一覧 Data 行の「自動バックアップ」モーダルから日付を選んで復元

### 4.2 部屋番号（v8.0）

- 編集折りたたみに input（placeholder・ラベルで「部屋番号のみ・氏名不可」を明記）。`oninput`＋debounce 保存（再描画しない）
- 表示: 症例カードの病日横に `Rm 402`（mono）、症例ヘッダ meta にも表示
- **日次・退院書き出しには出さない**（ネガティブテストで担保）

### 4.3 退院予定日・自動退院（v8.0）

- 編集折りたたみに date input（active のみ表示・クリア可）
- `applyPlannedDischarge(caseObj, today)`: active かつ `plannedDischargeAt <= today` で `status="discharged"`・`dischargedAt=予定日`・`plannedDischargeAt` クリア（再退院ループ防止）。boot と visibilitychange で発火（＝アプリを開いた時に退院扱いになる仕様。バックグラウンド発火は不可能）
- `setCaseStatus('active')`（入院中へ戻す）でも過去日の予定日を掃除
- 一覧: 退院書き出し未実施の discharged が居れば nudge バナー「退院書き出し未実施 n件」（タップで退院フィルタへ）。判定 `!lastExportedAt || lastExportedAt.slice(0,10) < dischargedAt`
- カードフラグ: active＋予定あり→`退院予定 M/D`、discharged＋書き出し未→`書き出し未`
- 日次書き出し: P: 行の後に `- 退院予定: YYYY-MM-DD`（設定時のみ・見出し追加なし）

### 4.4 退院チェックリスト（v8.0）

- `DC_ROUTINE` 7項目（キー/ラベル/補足。**項目は CEO 微調整前提**）:
  summary 退院サマリ／rx 退院時処方／careplan 退院療養計画書／referral 診療情報提供書／followup 外来フォロー予約／explain 本人・家族への説明／resources 介護・社会資源調整
- UI: Discharge Summary 折りたたみの冒頭に routine-grid（`toggleRoutine` と同型の `toggleDcChecklist`）
- 退院書き出し: `## Routine` の後に `## Discharge Checklist`（`- [x] ラベル` 形式・全項目チェック状態付き）

### 4.5 退院後未完了タスク（v8.0）

- discharged 症例の Today タブ: 進捗バー非表示、最上部に「Pending after discharge（退院後未完了）」パネル＝内容のある最終日の To Do / Waiting を `renderTodoLike` で消し込み可能に
- カードフラグ: discharged で未完了があれば `残 n`
- 退院書き出し: `## Unresolved Waiting` の後に `## Unresolved To Do`（最終有内容日の未完了 To Do）

### 4.6 週間予定ビュー（v8.1）

- 下部ナビ `List / Week / New / Export` の4項目化＋デスクトップはトップバーに Week ボタン
- `buildWeekItems(data, today, span=7)`（純ロジック）: 今日から7日、日付ごとに①アクティブ症例の当該日イベント（全種別）②退院予定 ③discharged 症例の `followup` イベント。行タップで症例へ
- イベント種別に `followup`（外来F/U）を追加（Events の select・編集モーダル・経過表凡例はそのまま頭文字表示）

### 4.7 定期処方曜日リマインド（v8.1）

- 一覧下部に曜日チップ（日〜土トグル→`casebook:settings` 保存。設定変更時は当日分を即時注入判定）
- `injectRxTodo(caseObj, today, weekdays)`: 当日が設定曜日なら当日 day に `src:"rx"` の To Do「定期処方の確認」を注入し `day.rxInjected=true`。冪等（rxInjected 済み・未完了 rx todo が既にある場合はスキップ＝ユーザー削除を尊重、ただし同日の再注入のみ防止）
- boot / visibilitychange の rollover 直後に実行。`persist({touch:false})` でゲーミフィケーションを汚さない

### 4.8 検査オーダー2段階（v8.1）

- Today タブの To Do 追加行に「Order」トグルチップ（**新パネルは作らない**。既存 To Do→Waiting の意味論に構造化属性を足す方式）。チップは再描画せずクラス切替（入力中テキストを消さない）
- Order 付き To Do を done にした瞬間、`promoted` 未済なら Waiting に `結果確認: <text>` を自動追加（`orderWaitText`）し `promoted=true`（1回限り・un-done でも取り消さない）。トーストで通知
- 行に `Ord` 小タグ表示。書き出しは通常の `- [ ]` 行のまま（形式変更なし）

### 4.9 PWA（v8.1・最終コミット）

- `manifest.webmanifest`（`start_url:"./"`・`scope:"./"`＝GitHub Pages `/casebook/` サブパス対応）、`icons/`（192/512 maskable＋apple-touch-icon 180）
- `sw.js`: 同一オリジン GET のみ。navigate は **network-first**（成功時 cache.put・失敗時 `caches.match("./")`）、静的アセットは cache-first。キャッシュ名はバージョン付き・activate で旧削除＋`clients.claim()`
- 登録は `if("serviceWorker" in navigator)` ガード付き
- **キルスイッチ**: 更新が届かない事故時は「`self.registration.unregister()`＋全キャッシュ削除だけの sw.js」を同名で配備（手順は HANDOFF §20）
- 留意: GitHub Pages は sw.js 自体に ~10分の HTTP キャッシュ。デプロイ反映は最大10分＋リロード2回

## 5. 書き出しフォーマット差分（英語見出し体系維持）

- 日次: `- 退院予定: YYYY-MM-DD` 行のみ追加（P: の後）
- 退院: `## Discharge Checklist` と `## Unresolved To Do` を追加。frontmatter 不変
- room / rx / order 属性は書き出しに**出さない**（テキストとして自明）
- Vault 側 `/casebook` スキルを同時改訂（新見出し2件対応・旧形式も受理。v6.1 前例）

## 6. テスト

- verify-v2.js: §10 退院管理（applyPlannedDischarge 発火・冪等・クリア／getLastMeaningfulDay／Discharge Checklist・Unresolved To Do 出力）／§11 週間・自動化（buildWeekItems・injectRxTodo 冪等・orderWaitText・src/promoted/rxInjected 保全）／§12 後方互換（v7 形状データが無改修で全通過・room 等のネガティブアサート）／sw.js 構文・manifest 相対パス検査
- smoke-render.js: 新UI要素・discharged render で days が増えない回帰・Week ビュー・Order チップ・SW 登録ガード
