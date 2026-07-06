// Phase 2 検証: E2E 暗号化同期の純ロジック（SPEC-phase2 §8）
// 1) 暗号 roundtrip 2) フィールド差分 3) LWW マージ 4) 照合計画 5) 擬似転送で2端末収束
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s+id="([^"]*)")?\s*>([\s\S]*?)<\/script>/g)];
const logicSrc = scripts.find(m => m[1] === "logic")[2];

const sandbox = {
  module: { exports: {} },
  console,
  crypto: globalThis.crypto,
  btoa: globalThis.btoa,
  atob: globalThis.atob,
  TextEncoder,
  TextDecoder
};
vm.createContext(sandbox);
vm.runInContext(logicSrc, sandbox);
const L = sandbox.module.exports;

const clone = (x) => JSON.parse(JSON.stringify(x));
const mkCase = (id, over) => Object.assign({
  id, createdAt: "2026-07-01", status: "active", deletedAt: null, severity: "stable",
  patientSummary: "", ageBand: "80代", sex: "男性", cc: "肺炎", admittedAt: "2026-07-01",
  dischargedAt: null, admission: { note: "", photoIds: [], routine: {} },
  contingency: [], problems: [], meds: [], events: [],
  days: [{ date: "2026-07-06", todos: [], waits: [], hooks: [] }]
}, over || {});

(async () => {
  // 1) 暗号 roundtrip
  const salt = L.syncRandomSaltB64();
  const key = await L.syncDeriveKey("correct horse", salt, 10000); // テストは低回数で高速化（実運用は PBKDF2_ITER）
  const enc = await L.syncEncryptJson(key, { hello: "世界", n: [1, 2, 3] });
  const dec = await L.syncDecryptJson(key, enc.blob, enc.iv);
  // vm 実行環境はプロトタイプが別物になるため JSON 文字列で比較
  assert.strictEqual(JSON.stringify(dec), JSON.stringify({ hello: "世界", n: [1, 2, 3] }));
  const wrongKey = await L.syncDeriveKey("wrong pass", salt, 10000);
  let failed = false;
  try { await L.syncDecryptJson(wrongKey, enc.blob, enc.iv); } catch (e) { failed = true; }
  assert.ok(failed, "誤パスフレーズで復号が失敗すること");
  assert.ok(L.PBKDF2_ITER >= 310000, "実運用の反復回数");
  console.log("1) crypto roundtrip: OK");

  // 2) フィールド差分
  const a = mkCase("c1");
  const b = clone(a);
  b.cc = "心不全";
  b.meds.push({ id: "m1", name: "フロセミド" });
  assert.strictEqual(L.syncDiffFields(a, b).sort().join(","), "cc,meds");
  assert.strictEqual(L.syncDiffFields(null, a).includes("cc"), true, "新規はほぼ全フィールドが差分");
  assert.strictEqual(L.syncDiffFields(a, clone(a)).length, 0, "同一なら差分なし");
  console.log("2) diff fields: OK");

  // 3) LWW マージ（交差した更新: ローカルの新しい severity とリモートの新しい cc が両方生きる）
  const local = mkCase("c1", { severity: "unstable", cc: "肺炎" });
  const remote = mkCase("c1", { severity: "stable", cc: "心不全" });
  const res3 = L.syncMergeCase(local, { severity: "2026-07-07T10:00:00Z", cc: "2026-07-07T08:00:00Z" },
    remote, { severity: "2026-07-07T09:00:00Z", cc: "2026-07-07T09:30:00Z" });
  assert.strictEqual(res3.merged.severity, "unstable", "ローカルが新しい severity はローカル採用");
  assert.strictEqual(res3.merged.cc, "心不全", "リモートが新しい cc はリモート採用");
  assert.strictEqual(res3.tookRemote, true);
  console.log("3) field-level LWW merge: OK");

  // 4) 照合計画
  // 4a) 新規ローカル → push
  let data = { version: 2, cases: [mkCase("c1")] };
  let state = L.syncEmptyState();
  let r = L.syncReconcile(data, state, [], "2026-07-07T10:00:00Z");
  assert.strictEqual(r.pushes.length, 1);
  assert.strictEqual(r.pushes[0].id, "c1");
  assert.strictEqual(r.pushes[0].deleted, false);
  L.syncClearDirty(state, ["c1"]);
  // 4b) 無変更 → push なし
  r = L.syncReconcile(data, state, [{ id: "c1", deleted: false, case: clone(data.cases[0]), mt: clone(state.mt.c1) }], "2026-07-07T10:01:00Z");
  assert.strictEqual(r.pushes.length, 0, "無変更なら push しない");
  assert.strictEqual(r.localChanged, false);
  // 4c) リモート新規 → 取り込み
  r = L.syncReconcile(data, state, [{ id: "c2", deleted: false, case: mkCase("c2"), mt: { cc: "2026-07-07T09:00:00Z" } }], "2026-07-07T10:02:00Z");
  assert.strictEqual(data.cases.length, 2);
  assert.strictEqual(r.localChanged, true);
  // 4d) 完全削除 → 墓標 push、以後の同 id リモートは取り込まない
  data.cases = data.cases.filter(c => c.id !== "c2");
  r = L.syncReconcile(data, state, [], "2026-07-07T10:03:00Z");
  assert.ok(r.pushes.some(p => p.id === "c2" && p.deleted === true), "完全削除は墓標を push");
  L.syncClearDirty(state, ["c2"]);
  r = L.syncReconcile(data, state, [{ id: "c2", deleted: false, case: mkCase("c2"), mt: {} }], "2026-07-07T10:04:00Z");
  assert.strictEqual(data.cases.some(c => c.id === "c2"), false, "墓標済み id は復活しない");
  // 4e) リモート墓標 → ローカル削除
  r = L.syncReconcile(data, state, [{ id: "c1", deleted: true, case: null, mt: null }], "2026-07-07T10:05:00Z");
  assert.strictEqual(data.cases.length, 0, "リモートの墓標でローカルからも消える");
  assert.strictEqual(r.localChanged, true);
  console.log("4) reconcile plan: OK");

  // 5) 擬似転送で2端末シミュレーション
  const remoteStore = {}; // Firestore の代わり（暗号化は 1) で検証済みのため平文で模擬）
  const dev = () => ({ data: { version: 2, cases: [] }, state: L.syncEmptyState() });
  const syncDevice = (d, now) => {
    const remoteList = Object.keys(remoteStore).map(id => clone(Object.assign({ id }, remoteStore[id])));
    const out = L.syncReconcile(d.data, d.state, remoteList, now);
    out.pushes.forEach(p => { remoteStore[p.id] = clone({ deleted: p.deleted, case: p.case, mt: p.mt }); });
    L.syncClearDirty(d.state, out.pushes.map(p => p.id));
    return out;
  };
  const A = dev(), B = dev();
  // A が c1 を作成 → 同期
  A.data.cases.push(mkCase("c1"));
  syncDevice(A, "2026-07-07T08:00:00Z");
  // B が受信
  syncDevice(B, "2026-07-07T08:10:00Z");
  assert.strictEqual(B.data.cases.length, 1);
  // B が cc を編集して同期、A はオフラインのまま severity を編集（後で同期）
  B.data.cases[0].cc = "心不全増悪";
  syncDevice(B, "2026-07-07T09:00:00Z");
  A.data.cases[0].severity = "unstable";
  L.syncNoteLocalChanges(A.data, A.state, "2026-07-07T09:30:00Z"); // 保存時フック相当（オフライン刻印）
  syncDevice(A, "2026-07-07T10:00:00Z");
  syncDevice(B, "2026-07-07T10:10:00Z");
  assert.strictEqual(A.data.cases[0].cc, "心不全増悪", "A に B の編集が届く");
  assert.strictEqual(A.data.cases[0].severity, "unstable", "A 自身の編集も生きる");
  assert.deepStrictEqual(clone(B.data.cases), clone(A.data.cases), "2端末が収束する");
  // A が完全削除 → B からも消える。同時期に B が新規 c2 → A に届く
  A.data.cases = [];
  B.data.cases.push(mkCase("c2", { cc: "蜂窩織炎" }));
  syncDevice(A, "2026-07-07T11:00:00Z");
  syncDevice(B, "2026-07-07T11:10:00Z");
  syncDevice(A, "2026-07-07T11:20:00Z");
  assert.strictEqual(B.data.cases.length, 1, "B: c1 が消え c2 が残る");
  assert.strictEqual(B.data.cases[0].id, "c2");
  assert.strictEqual(A.data.cases.length, 1, "A: c2 が届く");
  assert.deepStrictEqual(clone(A.data.cases), clone(B.data.cases), "削除・新規を挟んでも収束する");
  // 同期を繰り返しても余計な push が出ない（安定状態）
  const quiet = syncDevice(A, "2026-07-07T12:00:00Z");
  assert.strictEqual(quiet.pushes.length, 0, "安定状態で push なし");
  console.log("5) two-device convergence: OK");

  console.log("verify-phase2: ALL OK");
})().catch((e) => { console.error("NG:", e); process.exit(1); });
