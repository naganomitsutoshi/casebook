# Casebook v2 引き継ぎ書

> Today-first の入院症例管理アプリ。`index.html` 単一ファイル、Vanilla JS、外部送信なし。

## 1. 目的

v2 は「Problem List の写経」ではなく、各症例をその日の判断と作業単位で扱う設計に切り替えた。

- 一覧は「今日やる残」「待ち」「収集の埋まり具合」を見るホーム
- 症例画面は「今日のビュー」が主役
- 夜に全アクティブ症例を Markdown で一括書き出し
- 退院時は全期間版を個別に書き出し

## 2. 不変条件

- `index.html` 単一ファイル。外部ライブラリ禁止。`fetch` / `XHR` 禁止
- PII 入力欄を作らない。氏名・患者ID・病院名は扱わない
- ユーザー入力を `innerHTML` に入れる箇所は必ず `esc()` を通す
- テキスト入力は `oninput` + debounce 保存。入力中に全画面 `render()` を呼ばない
- モバイル優先。`520px` 以下は 1 カラム、主要ボタンは `44px` 以上
- ストレージキーは `casebook:v2`
- 純ロジックは `<script id="logic">` に分離し、DOM 非依存で Node から読める

## 3. 現在の画面構成

- 一覧
  - アクティブ / 退院 / すべて フィルタ
  - 新規症例
  - 今日の書き出し
  - ゴミ箱
- 症例画面
  - タブ: `today` / `log` / `timeline`
  - 今日のビュー
    - 今朝の収集
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
      date,
      collect: { fever, meal, bowel, sleep, pain, note },
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
- `toggleSection()` は DOM トグルのみ。状態は保存しない

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

- `case.severity`（`"" | "stable" | "watcher" | "unstable"`）追加。一覧・症例画面に重症度チップ、一覧は不安定→要注意→安定→未設定の順にソート
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
