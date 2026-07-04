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
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
  addEventListener(){},
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

  const today = new Date().toISOString().slice(0, 10);
  const run = vm.runInContext.bind(null);

  // 症例を1件作ってフル描画を通す
  vm.runInContext(`
    var c = LOGIC.ensureCaseShape({
      ageBand:"80代", sex:"M", cc:"誤嚥性肺炎", admittedAt:"${today}",
      severity:"watcher", patientSummary:"80代男性、誤嚥性肺炎。抗菌薬治療中",
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
    ["renderListV21()", ["今日の症例カード", "新規症例"]],
    ["renderCaseV21()", ["今日やる", "待ち", "もしもプラン", "ひっかかり", "問題リスト", "tabs-bar"]],
    ["(VIEW.tab='log', renderCaseV21())", ["過去ログ", "todoInput-" + JSON.stringify(new Date().toISOString().slice(0,10)).slice(1, 11)]],
    ["(VIEW.tab='timeline', renderCaseV21())", ["経過表", "band-inj", "tl-legend", "開始"]],
    ["renderTrash()", ["ゴミ箱"]]
  ];
  for (const [expr, needles] of checks) {
    const out = vm.runInContext(expr, sandbox);
    if (typeof out !== "string" || !out.length) { console.error("NG: " + expr + " が文字列を返さない"); process.exit(1); }
    for (const n of needles) {
      if (!out.includes(n)) { console.error("NG: " + expr + " に「" + n + "」が無い"); process.exit(1); }
    }
  }

  // 今日ビューの並び: 今日やる → 待ち → もしもプラン → ひっかかり → 問題リスト
  vm.runInContext("VIEW.tab='today'", sandbox);
  const todayHtml = vm.runInContext("renderCaseV21()", sandbox);
  const order = ["今日やる", "待ち", "もしもプラン", "ひっかかり", "問題リスト"].map(s => todayHtml.indexOf("<h2>" + s + "</h2>"));
  if (order.some(i => i < 0) || order.some((v, i) => i > 0 && v < order[i - 1])) {
    console.error("NG: 今日ビューのパネル並びが仕様と違う: " + order.join(",")); process.exit(1);
  }

  // render() 本体もDOMスタブ上で例外なく通るか
  vm.runInContext("render()", sandbox);
  vm.runInContext("VIEW={name:'list',caseId:null,tab:'today',filter:'active'}; render()", sandbox);

  console.log("SMOKE ALL PASSED");
})().catch(e => { console.error("NG:", e); process.exit(1); });
