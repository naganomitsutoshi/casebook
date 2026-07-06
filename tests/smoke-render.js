// v4 スモーク: メインscriptをDOMスタブで実行し、各画面の描画関数が例外なくHTMLを返すか確認する
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s+id="([^"]*)")?\s*>([\s\S]*?)<\/script>/g)];
const logicSrc = scripts.find(m => m[1] === "logic")[2];
const mainSrc = scripts.find(m => !m[1])[2];

function makeEl(){
  return {
    innerHTML: "", textContent: "", value: "",
    style: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    focus(){}, click(){},
    dataset: {}
  };
}
const els = {};
const documentStub = {
  getElementById(id){ if(!els[id]){ els[id] = makeEl(); } return els[id]; },
  querySelector(){ return null; },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
  addEventListener(){},
  documentElement: makeEl(),
  visibilityState: "visible"
};
const sandbox = {
  console,
  document: documentStub,
  window: {},
  navigator: {},
  localStorage: {
    _m: {},
    getItem(k){ return this._m[k] || null; },
    setItem(k, v){ this._m[k] = v; }
  },
  indexedDB: { open(){ return {}; } },
  URL: { createObjectURL(){ return "blob:x"; }, revokeObjectURL(){} },
  setTimeout, clearTimeout,
  module: { exports: {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(logicSrc, sandbox);
sandbox.LOGIC = sandbox.module.exports;
vm.runInContext(mainSrc, sandbox);

(async () => {
  await new Promise(r => setTimeout(r, 20)); // boot() の非同期完了待ち

  // アプリ本体と同じローカル日付（UTC の toISOString とはズレうる）
  const localISO = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const today = localISO(new Date());
  const run = vm.runInContext.bind(null);

  // 症例を1件作ってフル描画を通す
  vm.runInContext(`
    var c = LOGIC.ensureCaseShape({
      ageBand:"80代", sex:"M", cc:"誤嚥性肺炎", admittedAt:"${today}",
      severity:"watcher", patientSummary:"80代男性、誤嚥性肺炎。抗菌薬治療中", room:"402",
      contingency:[{id:"x1", text:"夜間発熱→血培"}],
      problems:[{id:"p1", title:"肺炎", assessment:"改善傾向", active:true}],
      meds:[{id:"m1", name:"ABPC/SBT", route:"inj", startDate:"${today}", endDate:null, note:""}],
      events:[{id:"e1", date:"${today}", type:"test", title:"嚥下評価", note:""}],
      days:[{date:"${today}", todos:[{id:"t1", text:"採血", done:false}], waits:[{id:"w1", text:"培養", resolved:false}], hooks:[{id:"h1", text:"抗菌薬の根拠"}]}]
    });
    DB.cases.push(c);
    VIEW = { name:"case", caseId:c.id, tab:"today", filter:"active" };
  `, sandbox);

  const checks = [
    ["renderListV21()", ["入院中", "case-row", "Trash", "theme-seg", "Export 連続", "累計", "dot-untouched", "progress-row", "バックアップ", "復元", "handleRestoreInput", "v8."]],
    ["renderCaseV21()", ["Problem List", "To Do", "Waiting", "Contingency Plan", "Hooks", "tabs-bar", "症例ラベル", "入院日", "updateCaseLabel", "today-progress", "Rm 402", "部屋番号", "Discharge Checklist", "toggleDcChecklist"]],
    ["(VIEW.tab='log', renderCaseV21())", ["Log", "todoInput-" + today]],
    ["(VIEW.tab='timeline', renderCaseV21())", ["Timeline", "band-inj", "tl-legend", "開始"]],
    ["renderTrash()", ["Trash"]]
  ];
  for (const [expr, needles] of checks) {
    const out = vm.runInContext(expr, sandbox);
    if (typeof out !== "string" || !out.length) { console.error("NG: " + expr + " が文字列を返さない"); process.exit(1); }
    for (const n of needles) {
      if (!out.includes(n)) { console.error("NG: " + expr + " に「" + n + "」が無い"); process.exit(1); }
    }
  }

  // v6: 今日ビューの並び: Problem List → To Do → Waiting → Contingency Plan → Hooks
  vm.runInContext("VIEW.tab='today'", sandbox);
  const todayHtml = vm.runInContext("renderCaseV21()", sandbox);
  const order = ["Problem List", "To Do", "Waiting", "Contingency Plan", "Hooks"].map(s => todayHtml.indexOf("<h2>" + s + "</h2>"));
  if (order.some(i => i < 0) || order.some((v, i) => i > 0 && v < order[i - 1])) {
    console.error("NG: 今日ビューのパネル並びが仕様と違う: " + order.join(",")); process.exit(1);
  }

  // v6: 追加欄は各パネルの一番下（list が add-row より先に出る）
  const todoBlock = vm.runInContext("renderTodoLike(c, c.days[0], 'todo')", sandbox);
  if (todoBlock.indexOf('class="list"') < 0 || todoBlock.indexOf('class="list"') > todoBlock.indexOf("add-row")) {
    console.error("NG: 追加欄がパネル最下部になっていない"); process.exit(1);
  }

  // v6: 未来日付イベントが経過表に列として出る（イベント反映バグの回帰テスト）
  const futureDate = localISO(new Date(Date.now() + 3 * 86400000));
  vm.runInContext(`c.events.push({id:"e2", date:"${futureDate}", type:"surgery", title:"手術予定", note:""})`, sandbox);
  const tlHtml = vm.runInContext("(VIEW.tab='timeline', renderCaseV21())", sandbox);
  if (!tlHtml.includes("future") || !tlHtml.includes("手術予定") || !tlHtml.includes(futureDate.slice(5).replace("-", "/"))) {
    console.error("NG: 未来日付のイベントが経過表に反映されない"); process.exit(1);
  }

  // v6: テーマ切替（casebook:theme に保存・casebook:v2 とは別キー）
  vm.runInContext("setTheme('dark')", sandbox);
  if (sandbox.document.documentElement.dataset.theme !== "dark" || sandbox.localStorage.getItem("casebook:theme") !== "dark") {
    console.error("NG: setTheme('dark') が反映されない"); process.exit(1);
  }
  vm.runInContext("setTheme('auto')", sandbox);
  if (sandbox.document.documentElement.dataset.theme !== "light") {
    console.error("NG: auto テーマの解決が light にならない（matchMedia 無し環境）"); process.exit(1);
  }

  // v7: タッチ記録は casebook:stats（別キー）に保存され、未更新ドットが消える
  vm.runInContext("markCaseTouched(c.id)", sandbox);
  const statsRaw = sandbox.localStorage.getItem("casebook:stats");
  if (!statsRaw || !statsRaw.includes(today)) {
    console.error("NG: markCaseTouched が casebook:stats に保存されない"); process.exit(1);
  }
  if (sandbox.localStorage.getItem("casebook:v2") && sandbox.localStorage.getItem("casebook:v2").includes("touched")) {
    console.error("NG: タッチ記録が casebook:v2 に混入"); process.exit(1);
  }
  const listTouched = vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'active'}; renderListV21()", sandbox);
  if (listTouched.includes("dot-untouched")) {
    console.error("NG: タッチ済み症例に未更新ドットが残る"); process.exit(1);
  }

  // v7: Export 記録でストリークが 1 になり、14日ドット表に ● が出る
  vm.runInContext("markExportedToday()", sandbox);
  const listExported = vm.runInContext("renderListV21()", sandbox);
  if (!listExported.includes("Export 連続 1 日") || !listExported.includes("●")) {
    console.error("NG: Export ストリークが一覧に反映されない"); process.exit(1);
  }

  // v5: 一覧の重症度順ソート（不安定 → 要注意）
  vm.runInContext(`
    var c2 = LOGIC.ensureCaseShape({ ageBand:"70代", sex:"F", cc:"心不全", admittedAt:"${today}", severity:"unstable",
      days:[{date:"${today}", todos:[], waits:[], hooks:[]}] });
    DB.cases.push(c2);
  `, sandbox);
  const listHtml = vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'active'}; renderListV21()", sandbox);
  if (listHtml.indexOf("心不全") < 0 || listHtml.indexOf("心不全") > listHtml.indexOf("誤嚥性肺炎")) {
    console.error("NG: 一覧が重症度順（不安定が先頭）になっていない"); process.exit(1);
  }
  // v5: 装飾撤去の確認（ヒーロー・英語飾りラベルが無い）
  for (const banned of ["hero", "eyebrow", "today-first", "Open Todos"]) {
    if (listHtml.includes(banned)) { console.error("NG: 一覧に撤去済み要素「" + banned + "」が残存"); process.exit(1); }
  }

  // v8.0: 退院済み症例は一覧・症例画面を描画しても days が増えない（汚染バグ回帰）
  vm.runInContext(`
    var cd = LOGIC.ensureCaseShape({ ageBand:"90代", sex:"F", cc:"心不全増悪", admittedAt:"2026-06-01", status:"discharged", dischargedAt:"2026-06-10",
      days:[{date:"2026-06-10", todos:[{id:"t9", text:"残タスク", done:false}], waits:[{id:"w9", text:"病理結果", resolved:false}], hooks:[]}] });
    DB.cases.push(cd);
  `, sandbox);
  const daysBefore = vm.runInContext("cd.days.length", sandbox);
  vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'all'}; renderListV21()", sandbox);
  const dischargedCaseHtml = vm.runInContext("VIEW={name:'case',caseId:cd.id,tab:'today',filter:'all'}; renderCaseV21()", sandbox);
  const daysAfter = vm.runInContext("cd.days.length", sandbox);
  if (daysBefore !== daysAfter) { console.error("NG: 退院済み症例の描画で days が増える（汚染バグ再発）"); process.exit(1); }
  if (!dischargedCaseHtml.includes("残タスク")) { console.error("NG: 退院済み症例の Today タブに最終日の内容が出ない"); process.exit(1); }
  if (!dischargedCaseHtml.includes("Pending after discharge") || !dischargedCaseHtml.includes("病理結果")) {
    console.error("NG: 退院済み症例に Pending after discharge パネルが出ない"); process.exit(1);
  }
  if (dischargedCaseHtml.includes("today-progress")) { console.error("NG: 退院済み症例に進捗バーが出る"); process.exit(1); }
  const listAllHtml = vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'all'}; renderListV21()", sandbox);
  if (!listAllHtml.includes("残 2")) { console.error("NG: 退院済みカードに 残 n フラグが出ない"); process.exit(1); }

  // v8.0: 退院予定日の表示（編集欄・ヘッダmeta・カードフラグ）と退院書き出しナッジ
  vm.runInContext("c.plannedDischargeAt = '2099-01-01'; VIEW={name:'case',caseId:c.id,tab:'today',filter:'active'}; VIEW.caseEdit=true", sandbox);
  const caseHtmlPd = vm.runInContext("renderCaseV21()", sandbox);
  if (!caseHtmlPd.includes("退院予定日") || !caseHtmlPd.includes("updatePlannedDischarge") || !caseHtmlPd.includes("退院予定 2099-01-01")) {
    console.error("NG: 退院予定日の編集欄/ヘッダ表示が無い"); process.exit(1);
  }
  const listHtmlPd = vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'all'}; renderListV21()", sandbox);
  if (!listHtmlPd.includes("退院予定 01/01")) { console.error("NG: カードに退院予定フラグが無い"); process.exit(1); }
  if (!listHtmlPd.includes("退院書き出しが未実施") || !listHtmlPd.includes("書き出し未")) {
    console.error("NG: 退院書き出し未実施ナッジ/フラグが無い"); process.exit(1);
  }
  vm.runInContext("c.plannedDischargeAt = ''; VIEW.caseEdit=false", sandbox);

  // v8.1: 定期処方曜日チップ（設定は casebook:settings・casebook:v2 とは別キー）
  const listRx = vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'active'}; renderListV21()", sandbox);
  if (!listRx.includes("定期処方曜日") || !listRx.includes("toggleRxWeekday(1)")) {
    console.error("NG: 一覧に定期処方曜日チップが無い"); process.exit(1);
  }
  vm.runInContext("toggleRxWeekday(new Date().getDay())", sandbox);
  const settingsRaw = sandbox.localStorage.getItem("casebook:settings");
  if (!settingsRaw || !settingsRaw.includes("rxWeekdays")) { console.error("NG: 曜日設定が casebook:settings に保存されない"); process.exit(1); }
  const rxTodoAdded = vm.runInContext("c.days.some(d => d.todos.some(t => t.src === 'rx'))", sandbox);
  if (!rxTodoAdded) { console.error("NG: 当日曜日をONにしても rx To Do が注入されない"); process.exit(1); }

  // v8.2: 一覧ツールバーから新規症例ボタンを撤去（New は下部ナビ／トップバー側）
  const listNoNew = vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'active'}; renderListV21()", sandbox);
  if (listNoNew.includes("新規症例")) { console.error("NG: 一覧に新規症例ボタンが残存"); process.exit(1); }
  if (!html.includes('onclick="newCaseModal()"')) { console.error("NG: New の入口（下部ナビ/トップバー）が無い"); process.exit(1); }

  // v8.2: 空タイトルの追加は無反応でなくトーストで知らせる
  vm.runInContext("VIEW={name:'case',caseId:c.id,tab:'today',filter:'active'}; renderCaseV21()", sandbox);
  sandbox.document.getElementById("evTitle").value = "";
  vm.runInContext("createEvent()", sandbox);
  if (sandbox.document.getElementById("toast").textContent !== "タイトルを入力してください") {
    console.error("NG: 空タイトル追加でフィードバックが出ない"); process.exit(1);
  }
  sandbox.document.getElementById("medName").value = "";
  vm.runInContext("createMed()", sandbox);
  if (sandbox.document.getElementById("toast").textContent !== "薬剤名を入力してください") {
    console.error("NG: 薬剤名空でフィードバックが出ない"); process.exit(1);
  }
  // 正常追加でイベントが増え、成功トーストが出る
  sandbox.document.getElementById("evTitle").value = "胸部CT";
  sandbox.document.getElementById("evDate").value = futureDate;
  sandbox.document.getElementById("evType").value = "test";
  sandbox.document.getElementById("evNote").value = "";
  const evBefore = vm.runInContext("c.events.length", sandbox);
  vm.runInContext("createEvent()", sandbox);
  if (vm.runInContext("c.events.length", sandbox) !== evBefore + 1) { console.error("NG: createEvent でイベントが追加されない"); process.exit(1); }
  if (!sandbox.document.getElementById("toast").textContent.includes("イベントを追加")) { console.error("NG: イベント追加の成功トーストが出ない"); process.exit(1); }
  const tlAfterCreate = vm.runInContext("(VIEW.tab='timeline', renderCaseV21())", sandbox);
  if (!tlAfterCreate.includes("胸部CT")) { console.error("NG: 追加イベントが Timeline に出ない"); process.exit(1); }
  vm.runInContext("VIEW.tab='today'", sandbox);

  // v8.1: Order 2段階（チップ表示・done→Waiting 自動生成・1回限り）
  const todayTabOrder = vm.runInContext("VIEW={name:'case',caseId:c.id,tab:'today',filter:'active'}; renderCaseV21()", sandbox);
  if (!todayTabOrder.includes("toggleOrderMode")) { console.error("NG: To Do 追加行に Order チップが無い"); process.exit(1); }
  vm.runInContext(`
    var od = LOGIC.getDay(c, "${today}") || LOGIC.ensureTodayDay(c, "${today}");
    od.todos.push({ id:"ord1", text:"血培", done:false, src:"order", promoted:false });
    updateTextItem(c.id, "${today}", "todo", "ord1", "done", true);
  `, sandbox);
  if (!vm.runInContext(`LOGIC.getDay(c, "${today}").waits.some(w => w.text === "結果確認: 血培")`, sandbox)) {
    console.error("NG: Order done で Waiting に結果確認が生成されない"); process.exit(1);
  }
  vm.runInContext(`updateTextItem(c.id, "${today}", "todo", "ord1", "done", false); updateTextItem(c.id, "${today}", "todo", "ord1", "done", true)`, sandbox);
  if (vm.runInContext(`LOGIC.getDay(c, "${today}").waits.filter(w => w.text === "結果確認: 血培").length`, sandbox) !== 1) {
    console.error("NG: Order の Waiting 自動生成が1回限りでない"); process.exit(1);
  }

  // v8.1: Week ビュー（当日イベントが載る・下部ナビに Week がある）
  const weekHtml = vm.runInContext("VIEW={name:'week',caseId:null,tab:'today',filter:'active'}; renderWeekView()", sandbox);
  if (!weekHtml.includes("Week") || !weekHtml.includes("今日") || !weekHtml.includes("嚥下評価")) {
    console.error("NG: Week ビューに当日イベントが出ない"); process.exit(1);
  }
  if (!html.includes('data-nav="week"')) { console.error("NG: 下部ナビに Week が無い"); process.exit(1); }

  // render() 本体もDOMスタブ上で例外なく通るか
  vm.runInContext("render()", sandbox);
  vm.runInContext("VIEW={name:'week',caseId:null,tab:'today',filter:'active'}; render()", sandbox);
  vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'active'}; render()", sandbox);

  console.log("SMOKE ALL PASSED");
})().catch(e => { console.error("NG:", e); process.exit(1); });
