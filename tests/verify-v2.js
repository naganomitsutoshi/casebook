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
    collect: { fever: "ok", meal: "warn", bowel: "", sleep: "ok", pain: "ok", note: "食思不振" },
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
td.collect.note = "食思不振つづく";
const daily = L.buildDailyExport({ version: 2, cases: [c] }, "2026-07-04");
for (const s of ["2026-07-04", "80代", "誤嚥性肺炎", "未完の仕事", "培養結果", "嚥下評価の根拠は？"]) {
  if (!daily.includes(s)) { console.error("NG: 日次書き出しに欠落: " + s); process.exit(1); }
}
if (/<img|blob:/.test(daily)) { console.error("NG: 日次書き出しに画像データ混入"); process.exit(1); }
const dis = L.buildDischargeExport(c);
for (const s of ["casebook-discharge", "入院時メモ", "ABPC/SBT", "嚥下造影", "A評価"]) {
  if (!dis.includes(s)) { console.error("NG: 退院書き出しに欠落: " + s); process.exit(1); }
}
console.log("buildDailyExport / buildDischargeExport: OK");

console.log("ALL TESTS PASSED");
