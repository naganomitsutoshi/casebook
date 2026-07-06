# SPEC-phase2: E2E 暗号化同期（設計書 §5.4 準拠）

> 目的: スマホ・PC の2端末で同じ症例データを使う（R4）。サーバ（Firebase）には**暗号化済みデータしか置かない**＝運営者にも読めない（E2E暗号化）。
> 前提: 設計書 §5.4 で CEO 決裁済み（Firebase Auth + Firestore + WebCrypto、写真は同期対象外、フィールド単位の後勝ち）。
> リリース: ブランチ `phase2-sync`。**v9.1 実機QA通過 ＋ CEO の Firebase 初期設定完了まで main に取り込まない**。

## 1. スコープ

- 同期対象: `casebook:v2` 本体（症例＋ゴミ箱）のみ
- 対象外: 写真（IndexedDB・端末内限定=設計原則）、`casebook:theme` / `casebook:stats` / `casebook:settings`（端末ごとの好み・ナッジ装置）、自動バックアップ
- 同期は**任意機能**。未設定なら従来どおり完全ローカル・外部通信ゼロ（Firebase SDK の読み込み自体が発生しない）

## 2. アーキテクチャ

```
[端末A] casebook:v2 ⇄ 同期エンジン ⇄ AES-GCM暗号化 ⇄ Firestore users/{uid}/cases/{caseId} ⇄ 復号 ⇄ [端末B]
```

- **認証**: Firebase Auth（メール＋パスワード、本人1アカウント）。パスワードは保存しない（Auth の永続セッションに依存。切れたら再ログイン導線）
- **暗号**: WebCrypto。PBKDF2(パスフレーズ, salt, 310,000回, SHA-256) → AES-GCM 256bit。salt と「鍵確認用の既知平文の暗号文」は `users/{uid}/meta/crypto` に保存（2台目はこれで同じ鍵を再導出・検証）
- 導出済み鍵(JWK)・設定は localStorage `casebook:sync` に保持（毎回のパスフレーズ入力を不要に。端末内は平文データと同じ信頼境界）
- **リカバリー**: パスフレーズの紙保管を初期設定時に案内（紛失時はサーバ側データ復元不能。端末内データ＋JSONバックアップは無事）

## 3. データ形式（Firestore）

- `users/{uid}/cases/{caseId}`: `{ v:1, iv, blob, deleted:bool, updatedAt:serverTimestamp }`
  - `blob` = base64(AES-GCM(JSON{ case, mt }))。`mt` = フィールド別最終更新時刻マップ
  - 完全削除は物理削除でなく `deleted:true`（墓標。別端末の復活防止）
- `users/{uid}/meta/crypto`: `{ v:1, salt, iter, check:{iv, blob} }`
- セキュリティルール（手順書で CEO が貼付）: `request.auth.uid == uid` のみ read/write 可

## 4. 競合解決（フィールド単位 LWW）

- 保存のたびに同期層が「前回スナップショット」と比較し、変わった**症例トップレベルフィールド**（problems / meds / events / days / severity …）に現在時刻を刻印（`mt`）→ 既存の全ミューテーション箇所は無改修
- 取り込み時: ローカルと リモートの `mt` をフィールドごとに比較し新しい方を採用。配列はフィールド一括置換（設計書決裁: 単独ユーザー2端末では十分）
- 端末間の順序づけはクライアント時刻（同一人物の2端末・§5.4 で許容）。Firestore の serverTimestamp は監査用

## 5. 同期タイミング

- アプリ起動時に全件 pull→マージ→差分 push（失敗してもローカル動作は不変）
- 保存成功後 5 秒デバウンスで差分 push
- 一覧下部の「今すぐ同期」ボタン
- 常時リスナー（onSnapshot）は使わない（MVP・朝夕2端末運用には起動時同期で十分）

## 6. UI（一覧下部 Data 行の下に Sync 行）

- 状態表示: `未設定` / `同期済み HH:MM` / `オフライン（ローカル保存は正常）` / `再ログインが必要` / `エラー`
- 設定モーダル: Firebase 設定JSON貼付欄・メール・パスワード・パスフレーズ（確認つき）・有効化／無効化。無効化はローカルデータに触らない
- 別端末にしか無い写真は「写真は端末内のみ（同期対象外）」表示

## 7. 不変条件との整合

- 外部通信は**同期を有効化した場合のみ**、宛先は Firebase（gstatic の SDK 読込含む）に限定。それ以外は従来どおりゼロ
- 送信されるのは暗号文のみ（症例テキストの平文・写真は一切送らない）
- `casebook:v2` のスキーマ・保存キーは無変更（同期状態は別キー `casebook:sync`）
- JSONバックアップに `casebook:sync`（鍵material）は含めない
- 純ロジック（差分検出・マージ・照合計画・暗号ヘルパ）は `<script id="logic">` に置き Node でテスト（DOM/localStorage 参照なし）。Firebase 転送層は差し替え可能な interface（テストは in-memory 転送で2端末収束を検証）

## 8. テスト（tests/verify-phase2.js）

1. 暗号 roundtrip（導出→暗号化→復号一致、誤パスフレーズで復号失敗）
2. フィールド差分検出
3. フィールド単位 LWW マージ（両側更新の交差）
4. 照合計画（新規 push／リモート新規取込／完全削除→墓標／墓標の復活防止／無変更→push なし）
5. 擬似転送で2端末シミュレーション→最終状態収束

## 9. リリース手順（QA 通過後）

1. CEO: 手順書に沿って Firebase プロジェクト作成・Auth/Firestore 有効化・ルール貼付（ブラウザ作業 約15分）
2. CTO: `phase2-sync` を main へ取り込み（v10.0）→ Pages 反映
3. CEO: 端末1で同期設定（設定JSON貼付＋パスフレーズ決定）→ 端末2で同じ設定→ 双方向反映を実機確認
4. Vercel 移行は**保留を提案**: 同期はクライアント完結で追加サーバ不要になり、移行の目的（当初想定）が消えた。URL変更は PWA 再インストール・QA 手順の作り直しを招くため、必要性が生じるまで GitHub Pages 継続
