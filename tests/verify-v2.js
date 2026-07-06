// v2 検証: script 抽出 → 構文チェック → 純ロジック単体テスト
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s+id="([^"]*)")?\s*>([\s\S]*?)<\/script>/g)];
console.log("script blocks:", scripts.map(m => m[1] || "(main)").join(", "));

// 1) 構文チェック
for (const m of scripts) {
  new vm.Script(m[2], { filename: m[1] || "main" }); // throws on syntax error
}
console.log("syntax: OK");

// 2) logic ブロックを Node で読む
const logicSrc = scripts.find(m => m[1] === "logic");
if (!logicSrc) { console.error("NG: <script id=\"logic\"> が無い"); process.exit(1); }
if (/document\.|window\.|localStorage|indexedDB/.test(logicSrc[2])) {
  console.error("NG: logic ブロックに DOM/storage 参照あり"); process.exit(1);
}
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(logicSrc[2], sandbox);
const L = Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox;
for (const fn of ["rolloverCase", "purgeTrash", "buildDailyExport", "buildDischargeExport"]) {
  if (typeof L[fn] !== "function") { console.error("NG: 関数なし " + fn); process.exit(1); }
}
console.log("logic exports: OK");

// 3) 繰越テスト
const mkCase = () => ({
  id: "c1", createdAt: "2026-07-01", status: "active", deletedAt: null,
  ageBand: "80代", sex: "男性", cc: "誤嚥性肺炎", admittedAt: "2026-07-01", dischargedAt: null,
  admission: { note: "入院時メモ", photoIds: ["p1", "p2"], routine: { vte: true } },
  problems: [{ id: "pr1", title: "誤嚥性肺炎", assessment: "A評価", active: true }],
  meds: [{ id: "m1", name: "ABPC/SBT", route: "注射", startDate: "2026-07-01", endDate: null, note: "" }],
  events: [{ id: "e1", date: "2026-07-03", type: "検査", title: "嚥下造影", note: "" }],
  days: [{
    date: "2026-07-03",
    collect: { fever: "ok", meal: "warn", bowel: "", sleep: "ok", pain: "ok", note: "食思不振" }, // v3で廃止された旧形式（後方互換テストを兼ねる）
    todos: [{ id: "t1", text: "済んだ仕事", done: true }, { id: "t2", text: "未完の仕事", done: false }],
    waits: [{ id: "w1", text: "培養結果", resolved: false }, { id: "w2", text: "解消済み", resolved: true }],
    hooks: [{ id: "h1", text: "嚥下評価の根拠は？" }]
  }],
  summary: { course: "", outcome: "" }, lastExportedAt: null
});

let c = mkCase();
const rolled = L.rolloverCase(c, "2026-07-04");
const days = (rolled && rolled.days) || c.days;
const today = days.find(d => d.date === "2026-07-04");
if (!today) { console.error("NG: 繰越で今日のエントリが作られない"); process.exit(1); }
if (!today.todos.some(t => t.text === "未完の仕事" && !t.done)) { console.error("NG: 未完todo繰越なし"); process.exit(1); }
if (today.todos.some(t => t.text === "済んだ仕事")) { console.error("NG: 完了todoまで繰越"); process.exit(1); }
if (!today.waits.some(w => w.text === "培養結果" && !w.resolved)) { console.error("NG: 未解消の待ち繰越なし"); process.exit(1); }
if (today.waits.some(w => w.text === "解消済み")) { console.error("NG: 解消済みの待ちまで繰越"); process.exit(1); }
const prev = days.find(d => d.date === "2026-07-03");
if (prev.todos.length !== 2 || prev.waits.length !== 2) { console.error("NG: 前日データが変更された"); process.exit(1); }
// 冪等性
const again = L.rolloverCase(rolled && rolled.days ? rolled : c, "2026-07-04");
const days2 = (again && again.days) || c.days;
if (days2.filter(d => d.date === "2026-07-04").length !== 1) { console.error("NG: 繰越が冪等でない"); process.exit(1); }
console.log("rolloverCase: OK");

// 4) ゴミ箱 purge テスト
const dataT = { version: 2, cases: [
  Object.assign(mkCase(), { id: "old", deletedAt: "2026-06-01T00:00:00Z" }),
  Object.assign(mkCase(), { id: "recent", deletedAt: "2026-07-01T00:00:00Z" }),
  Object.assign(mkCase(), { id: "live", deletedAt: null })
]};
const purgedRes = L.purgeTrash(dataT, "2026-07-04");
const pd = purgedRes && purgedRes.data ? purgedRes.data : (purgedRes || dataT);
const ids = pd.cases.map(x => x.id);
if (ids.includes("old")) { console.error("NG: 30日超が purge されない"); process.exit(1); }
if (!ids.includes("recent") || !ids.includes("live")) { console.error("NG: purge しすぎ"); process.exit(1); }
console.log("purgeTrash: OK");

// 5) 書き出しテスト
c = mkCase();
Object.assign(c, L.rolloverCase(c, "2026-07-04"));
const td = c.days.find(d => d.date === "2026-07-04");
td.hooks.push({ id: "h2", text: "嚥下評価の根拠は？" });
const daily = L.buildDailyExport({ version: 2, cases: [c] }, "2026-07-04");
for (const s of ["# Casebook Export 2026-07-04", "## Case:", "### Problem List", "### To Do", "### Waiting", "### Hooks", "80代", "誤嚥性肺炎", "未完の仕事", "培養結果", "嚥下評価の根拠は？"]) {
  if (!daily.includes(s)) { console.error("NG: 日次書き出しに欠落: " + s); process.exit(1); }
}
if (/<img|blob:/.test(daily)) { console.error("NG: 日次書き出しに画像データ混入"); process.exit(1); }
const dis = L.buildDischargeExport(c);
for (const s of ["casebook-discharge", "## Admission Note", "## Discharge Summary", "### My Practice", "## Unresolved Waiting", "入院時メモ", "ABPC/SBT", "嚥下造影", "A評価"]) {
  if (!dis.includes(s)) { console.error("NG: 退院書き出しに欠落: " + s); process.exit(1); }
}
console.log("buildDailyExport / buildDischargeExport: OK");

// 6) v2.1: 重症度・私の実践・退院時未解消の待ち
c.severity = "watcher";
c.summary.myPractice = "家族カンファを自分で主導した";
const daily21 = L.buildDailyExport({ version: 2, cases: [c] }, "2026-07-04");
if (!daily21.includes("要注意")) { console.error("NG: 日次書き出しに重症度なし"); process.exit(1); }
const dis21 = L.buildDischargeExport(c);
if (!dis21.includes("家族カンファを自分で主導した")) { console.error("NG: 退院書き出しに私の実践なし"); process.exit(1); }
if (!dis21.includes("培養結果")) { console.error("NG: 退院時未解消の待ちが列挙されない"); process.exit(1); }
// 後方互換: severity / myPractice の無い旧データでも動く
const legacy = mkCase();
delete legacy.severity;
delete legacy.summary.myPractice;
Object.assign(legacy, L.rolloverCase(legacy, "2026-07-04"));
L.buildDailyExport({ version: 2, cases: [legacy] }, "2026-07-04");
L.buildDischargeExport(legacy);
console.log("v2.1 (severity / myPractice / pending-waits / backward-compat): OK");

// 7) v2.2: ROUTINE テンプレ整合・旧キー移行・患者サマリ・もしもプラン
if (!Array.isArray(L.ROUTINE) || L.ROUTINE.length !== 10) { console.error("NG: LOGIC.ROUTINE が10項目でない"); process.exit(1); }
for (const k of ["meds", "allergy", "sdm", "code", "outlook", "bps", "deepin", "risk", "rehab", "acp"]) {
  if (!L.ROUTINE.some(r => r.k === k)) { console.error("NG: ROUTINE に " + k + " が無い"); process.exit(1); }
}
// 旧キー移行: vte→risk, disposition→rehab, nutrition は破棄
const mig = mkCase();
mig.admission.routine = { vte: true, disposition: true, nutrition: true, meds: true };
const disMig = L.buildDischargeExport(mig);
for (const s of ["リスクスクリーニング", "リハGoal", "休薬・内服調整"]) {
  if (!disMig.includes(s)) { console.error("NG: 退院書き出しに移行後ルーチン欠落: " + s); process.exit(1); }
}
if (/^- (vte|disposition|nutrition|meds)$/m.test(disMig)) { console.error("NG: 退院書き出しに raw キーが残存"); process.exit(1); }
// 患者サマリ（I-PASS P）
const c22 = mkCase();
Object.assign(c22, L.rolloverCase(c22, "2026-07-04"));
c22.patientSummary = "80代男性、誤嚥性肺炎で入院。抗菌薬治療中、嚥下評価待ち";
c22.contingency = [{ id: "x1", text: "夜間38.5℃以上→血培2セット" }];
const daily22 = L.buildDailyExport({ version: 2, cases: [c22] }, "2026-07-04");
if (!daily22.includes("P: 80代男性、誤嚥性肺炎で入院")) { console.error("NG: 日次書き出しに患者サマリなし"); process.exit(1); }
if (!daily22.includes("Contingency Plan") || !daily22.includes("夜間38.5℃以上→血培2セット")) { console.error("NG: 日次書き出しにもしもプランなし"); process.exit(1); }
const dis22 = L.buildDischargeExport(c22);
if (!dis22.includes("Patient Summary")) { console.error("NG: 退院書き出しに患者サマリ節なし"); process.exit(1); }
if (dis22.includes("血培2セット")) { console.error("NG: 退院書き出しに contingency が混入"); process.exit(1); }
// サマリ未記入なら P: 行を出さない
const noSum = mkCase();
Object.assign(noSum, L.rolloverCase(noSum, "2026-07-04"));
const dailyNoSum = L.buildDailyExport({ version: 2, cases: [noSum] }, "2026-07-04");
if (/^P: /m.test(dailyNoSum)) { console.error("NG: サマリ未記入なのに P: 行が出る"); process.exit(1); }
// 後方互換: patientSummary / contingency の無い旧データでも動く（mkCase 自体が旧形式）
console.log("v2.2 (ROUTINE整合 / 旧キー移行 / patientSummary / contingency): OK");

// 8) v3: 「今日の収集」の全面削除（mkCase は collect 入りの旧形式＝後方互換を兼ねる）
if (typeof L.COLLECT_KEYS !== "undefined" || typeof L.makeEmptyCollect !== "undefined") {
  console.error("NG: collect 系の定数/関数が logic に残存"); process.exit(1);
}
const c3 = mkCase();
Object.assign(c3, L.rolloverCase(c3, "2026-07-04"));
const day3 = c3.days.find(d => d.date === "2026-07-04");
if ("collect" in day3) { console.error("NG: 新しい日のエントリに collect が生成される"); process.exit(1); }
if (c3.days.some(d => "collect" in d)) { console.error("NG: 旧データの collect が読み込み時に除去されない"); process.exit(1); }
const daily3 = L.buildDailyExport({ version: 2, cases: [c3] }, "2026-07-04");
if (daily3.includes("今日の収集")) { console.error("NG: 日次書き出しに今日の収集が残存"); process.exit(1); }
const dis3 = L.buildDischargeExport(c3);
if (dis3.includes("- 収集:")) { console.error("NG: 退院書き出しに収集行が残存"); process.exit(1); }
console.log("v3 (collect廃止 / 旧データ後方互換): OK");

// 9) v7: ゲーミフィケーション純ロジック（ストリーク・stats剪定）
if (L.prevDateISO("2026-07-01") !== "2026-06-30") { console.error("NG: prevDateISO が前日を返さない"); process.exit(1); }
if (L.prevDateISO("2026-01-01") !== "2025-12-31") { console.error("NG: prevDateISO の年跨ぎ"); process.exit(1); }
if (L.computeStreak(["2026-07-02", "2026-07-03", "2026-07-04"], "2026-07-04") !== 3) { console.error("NG: streak 連続3日"); process.exit(1); }
if (L.computeStreak(["2026-07-02", "2026-07-03"], "2026-07-04") !== 2) { console.error("NG: streak 今日未実施は昨日から数える"); process.exit(1); }
if (L.computeStreak(["2026-07-01", "2026-07-03"], "2026-07-04") !== 1) { console.error("NG: streak 途切れ"); process.exit(1); }
if (L.computeStreak([], "2026-07-04") !== 0) { console.error("NG: streak 空"); process.exit(1); }
const pruned = L.pruneStatsDays({ "2026-01-01": { exported: true }, "2026-07-01": { exported: true }, "bad-key": {} }, "2026-07-04", 90);
if (pruned["2026-01-01"] || !pruned["2026-07-01"] || pruned["bad-key"]) { console.error("NG: pruneStatsDays の剪定が仕様と違う"); process.exit(1); }
console.log("v7 (prevDateISO / computeStreak / pruneStatsDays): OK");

// 10) v8.0: 退院済み days 汚染の救済（getLastMeaningfulDay）
if (typeof L.getLastMeaningfulDay !== "function") { console.error("NG: getLastMeaningfulDay が無い"); process.exit(1); }
const cDis = mkCase();
Object.assign(cDis, L.rolloverCase(cDis, "2026-07-04"));
cDis.status = "discharged"; cDis.dischargedAt = "2026-07-04";
// 汚染を再現: 退院後の描画で末尾に空の day が追記されてしまった既存データ
cDis.days.push({ date: "2026-07-05", todos: [], waits: [], hooks: [] });
const lm = L.getLastMeaningfulDay(L.ensureCaseShape(cDis));
if (!lm || lm.date !== "2026-07-04") { console.error("NG: getLastMeaningfulDay が内容のある最終日を返さない"); process.exit(1); }
const disPolluted = L.buildDischargeExport(cDis);
if (!disPolluted.includes("培養結果")) { console.error("NG: 末尾に空 day があると Unresolved Waiting が消える"); process.exit(1); }
console.log("v8.0 (getLastMeaningfulDay / polluted-days rescue): OK");

// 11) v8.0: parseBackup（バックアップ検証）
const goodBk = JSON.stringify({ app: "casebook", exportedAt: "2026-07-06T09:00:00.000Z", data: { version: 2, cases: [mkCase()] }, stats: { days: {}, totals: { recordDays: 3 } }, theme: "dark", settings: { rxWeekdays: [1, 4] } });
const pb = L.parseBackup(goodBk);
if (!pb.ok || pb.data.cases.length !== 1 || pb.theme !== "dark" || !pb.stats || !pb.settings) { console.error("NG: parseBackup が正しい payload を受理しない"); process.exit(1); }
if (!L.parseBackup("{oops").error) { console.error("NG: parseBackup が壊れた JSON を弾かない"); process.exit(1); }
if (L.parseBackup(JSON.stringify({ app: "other", data: {} })).ok) { console.error("NG: parseBackup が別アプリの JSON を受理する"); process.exit(1); }
if (L.parseBackup(JSON.stringify({ app: "casebook" })).ok) { console.error("NG: parseBackup が data 無しを受理する"); process.exit(1); }
console.log("v8.0 (parseBackup): OK");

// 12) v8.0: 部屋番号は保持されるが書き出しには出ない
const cRoom = mkCase();
cRoom.room = "R999X";
const shapedRoom = L.ensureCaseShape(cRoom);
if (shapedRoom.room !== "R999X") { console.error("NG: ensureCaseShape が room を保全しない"); process.exit(1); }
Object.assign(cRoom, L.rolloverCase(cRoom, "2026-07-04"));
if (L.buildDailyExport({ version: 2, cases: [cRoom] }, "2026-07-04").includes("R999X")) { console.error("NG: 日次書き出しに部屋番号が混入"); process.exit(1); }
if (L.buildDischargeExport(cRoom).includes("R999X")) { console.error("NG: 退院書き出しに部屋番号が混入"); process.exit(1); }
console.log("v8.0 (room: persisted, never exported): OK");

console.log("ALL TESTS PASSED");
