# Casebook 引き継ぎ書

> 入院管理を学びに変える、単一HTMLのスタンドアロンWebアプリ。
> このドキュメントは Claude Code で開発を引き継ぐための起点です。まずこれを読んでから `casebook.html` を触ってください。

---

## 1. プロジェクトの目的

総合診療科専攻医（医師3年目）の**ホスピタリスト研修**（2026年7〜9月・岡崎）向けに開発した、入院症例の管理＋学習ツール。

コンセプトは **「入院 → 病棟管理 → 退院・振り返り」を一本の流れにし、日々の臨床がそのまま学習の蓄積になるループを作る**こと。既存の臨床用 Obsidian vault（YAML frontmatter / callout / wikilink / Mermaid / Dataviewタグの慣習）と連携させる前提。

**ユーザーは開発者本人**（技術リテラシー高。WSL2 / Claude Code / React 経験あり）。過度な説明より、意図の通った実装と拡張性を優先する。

---

## 2. 現状（v1 完成済み）

- ファイル：`casebook.html` （単一ファイル・外部依存は Google Fonts のみ）
- 実装済み：
  - ケース一覧（入院中 / 退院 / すべて でフィルタ、要学習件数バッジ）
  - 新規入院作成（匿名ラベル：年代・性別・主訴のみ）
  - Problem List（問題ごとに Assessment / Plan / 退院基準 / 要学習フラグ＋メモ、解決トグル）
  - 入院時ルーチン10項目チェック（VTE予防・せん妄・栄養・疼痛・デバイス・常用薬・アレルギー・退院先・リハ・急変時方針）
  - 日々の経過ログ（日付＋「今日確認すること」＋ A / P）
  - フェーズレール（入院→管理→退院の進捗表示。ログ有無・退院ステータスで自動判定）
  - 学習キュー（全ケースの要学習フラグを横断集約 → 日々の勉強リスト化）
  - 退院時の振り返り（学んだこと / 次はこうする / 復習トピック）
  - Obsidian書き出し（frontmatter + Mermaid problem-map + callout + wikilink でクリップボードコピー）

---

## 3. 技術構成

- **単一 HTML + Vanilla JS**（フレームワークなし）。ビルド不要。
- 状態：グローバル 2 オブジェクト
  - `DB = { cases:[...] }` … 全データ
  - `VIEW = { name, caseId, filter }` … 画面状態（`name`: `"list" | "case" | "queue"`）
- 描画：`render()` が `VIEW.name` を見て `renderList / renderCase / renderQueue` を全置換。イベントは `onclick` / `oninput` の inline ハンドラ（グローバル関数）。
- 永続化：`Store` アダプタ経由（**§6 の制約を必ず読むこと**）。保存はデバウンス（`persist()` → 300ms / テキスト入力は 400ms）。
- ストレージキー：`"casebook:v1"`

### 設計上の意図（壊さないように）
- **テキスト入力（title / A / P / 退院基準 / studyNote / reflection）は `oninput` で値を更新するが `render()` を呼ばない**。全再描画するとフォーカスとカーソル位置が飛ぶため。保存だけデバウンスで走る。
- **トグル系（needsStudy / active / routine / discharge）は `persist()` で全再描画してよい**（フォーカス不要なため）。
- `esc()` で表示前エスケープ。ユーザー入力を innerHTML に差すため必須。新しい表示箇所を足すときも必ず通す。

---

## 4. データモデル

```js
Case = {
  id: string,
  createdAt: number,          // Date.now()
  status: "active" | "discharged",
  ageBand: string,            // "70代" など。個人特定情報は入れない
  sex: "M" | "F" | "",
  cc: string,                 // 主訴 / 入院理由
  admittedAt: string,         // "YYYY-MM-DD"
  dischargedAt: string|null,
  problems: Problem[],
  routine: { [key]: boolean },// keyは ROUTINE[].k
  dailyLog: LogEntry[],        // 新しい順に unshift
  reflection: { learned:string, differently:string, topics:string }
}

Problem = {
  id, title, assessment, plan,
  dischargeCriteria: string,
  needsStudy: boolean,         // 学習キューに集約されるフラグ
  studyNote: string,
  active: boolean              // false = 解決済み
}

LogEntry = { id, date:"YYYY-MM-DD", check:string, a:string, p:string }

// ROUTINE 定義（配列。表示順 = この順）
ROUTINE = [
  vte, delirium, nutrition, pain, devices,
  meds, allergy, disposition, rehab, code
] // 各 {k, t(表示名), h(補足)}
```

**スキーマ変更時**：`Store.load()` に簡単なマイグレーション（欠損フィールドの補完）を入れると安全。現状は `if(!DB.cases) DB.cases=[]` のみ。キーを `casebook:v1` → `v2` に上げる場合は移行処理を検討。

---

## 5. デザインシステム（CSS 変数）

白基調のクリニカルな見た目。**signature = 問題リストを背骨にしたフェーズレール**。ボールドさはここ一点に集約し、他は静かに保つ。

| トークン | 値 | 用途 |
|---|---|---|
| `--paper` | `#F5F8F9` | 背景 |
| `--surface` | `#FFFFFF` | カード |
| `--ink` | `#16242E` | 主要テキスト |
| `--ink-soft` | `#5B6D78` | 副次テキスト |
| `--ink-faint` | `#8A9AA4` | 補足 |
| `--line` / `--line-soft` | `#E1E8EC` / `#EDF2F4` | 罫線 |
| `--accent` / `--accent-deep` / `--accent-soft` | `#0E7A82` / `#0A5D63` / `#E4F2F2` | クリニカルティール（主色） |
| `--study` / `--study-soft` | `#B26A0A` / `#FBEFDC` | 要学習（アンバー） |
| `--done` / `--done-soft` | `#2E7D5B` / `#E6F2EC` | 解決 |
| `--danger` | `#B23A3A` | 削除等 |

- フォント：`Inter` + `Noto Sans JP`（本文）、`IBM Plex Mono`（日付・数値・コード）
- レスポンシブ済み（〜520px で1カラム、モーダルはボトムシート化）。新規UIも mobile-first を維持。

---

## 6. ⚠️ 重要な制約（最優先で理解すること）

### 6-1. 患者個人情報を入れない設計
本アプリはクラウド／ブラウザにデータを保持するため、**氏名・ID・生年月日・特定可能な情報は入力しない**前提。入力は「年代・性別・主訴」の匿名ラベルのみ。画面上部に常時注意表示あり。新機能でも**個人特定情報を促す入力欄を作らない**こと。

### 6-2. window.storage の制約（＝最優先タスクの根拠）
現状の `Store` は Claude のアーティファクト実行環境専用の `window.storage` API を使用。**本人のPC / 自己ホスト / ローカルでファイルを開いた場合は `window.storage` が存在せず、in-memory フォールバックになりリロードで消える。**

→ 自己ホストして日常使いするなら、**`localStorage` または `IndexedDB` の永続アダプタへの差し替えが必須**（§8 の P1）。`Store` オブジェクト1箇所を変えるだけで済むよう抽象化済み。

---

## 7. 次のステップ（優先度付きバックログ）

### P1（自己ホストで実運用するために必要）
1. **永続化アダプタの差し替え** … `Store.load/save` を `localStorage`（手軽）か `IndexedDB`（容量・堅牢）に。環境判定して `window.storage` があればそれ、なければ localStorage、のハイブリッドが理想。
2. **Obsidian 出力を本人 vault の慣習に完全準拠** … 現状は汎用 frontmatter（`type/admitted/status/tags`）と callout（`abstract/question/note`）。**実際の reference note を1枚読み込んで、frontmatterキー名・tag体系・callout種別・wikilink命名を寄せる**。`toObsidian()` 1関数に集約済み。

### P2（学習・実務価値を高める）
3. **総診向け鑑別テンプレ** … Problem 追加時に主訴カテゴリを選ぶと、鑑別の型（例：発熱→感染巣系統／VINDICATE 等）をプレースホルダ or チェックリストで提示。
4. **退院サマリ書き出し** … Obsidian出力とは別に、経過要約フォーマットの生成。
5. **JSON エクスポート／インポート** … バックアップと端末間移行。

### P3（磨き込み）
6. キーボードショートカット（新規・保存・次のケース）
7. ケース検索、tag/主訴での絞り込み
8. 学習トピックの集計ダッシュボード（頻出テーマの可視化 → 弱点把握）

### 将来構想
9. **Claude API 連携**（Anthropic API）… 匿名スケルトンのみを渡し、鑑別の抜け指摘・振り返りの深掘り・学習トピック提案。§6-1 を厳守し、個人情報は絶対に送らない。

---

## 8. 起動・開発

```bash
# そのままブラウザで開く（in-memory 動作、リロードで消える点に注意）
open casebook.html

# 簡易サーバ（自己ホスト時の動作確認）
python3 -m http.server 8000   # → http://localhost:8000/casebook.html
```

- 依存パッケージなし。編集は `casebook.html` を直接。
- 単一ファイルを維持するか、規模拡大時に JS/CSS を分割するかは判断に委ねる（分割する場合は §3 の状態管理方針を踏襲）。

---

## 9. 変更時チェックリスト

- [ ] ユーザー入力の新規表示箇所は `esc()` を通したか
- [ ] テキスト入力欄を追加した場合、`oninput` で全 `render()` を呼んでいないか（フォーカス飛び防止）
- [ ] データモデルを変えた場合、`Store.load()` の欠損補完 or マイグレーションを入れたか
- [ ] 個人特定情報を促す入力欄を作っていないか（§6-1）
- [ ] mobile（〜520px）で崩れないか
- [ ] Obsidian出力（`toObsidian()`）が変更後も valid な markdown か

---

## 10. Claude Code への申し送り

このプロジェクトを開く際は：
1. この `HANDOFF.md` を読む
2. `casebook.html` の `Store` / データモデル / `render*` の3点を把握
3. まず **P1-1（永続化）** か **P1-2（Obsidian準拠）** から着手するのが有効
4. Obsidian準拠を進める場合は、開発者に **実際の reference note を1枚共有してもらう**と精度が上がる

必要なら、このリポジトリ用の `CLAUDE.md`（コーディング規約・上記制約の要約）を別途作成してよい。
