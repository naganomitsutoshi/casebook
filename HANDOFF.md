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
    ageBand,
    sex,
    cc,
    admittedAt,
    dischargedAt,
    admission: {
      note: "",
      photoIds: [],
      routine: { vte, delirium, nutrition, pain, devices, meds, allergy, disposition, rehab, code }
    },
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
    summary: { course, outcome },
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
- `buildDischargeExport()` のルーチン表示は現在 `key` 名そのまま。必要なら表示名へ変換する
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
