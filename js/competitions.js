"use strict";

let compTab = "info";

const COMP_LEVELS = ["国家级", "省级", "市厅级", "校级"];
const COMP_STATUS = ["报名中", "备赛中", "初赛", "决赛", "已结束"];

/* 竞赛详情四个页签：经费与票据复用差旅那套票据能力，只是类别换成采购类 */
const COMP_TABS = [["info", "概览"], ["teams", "参赛团队"], ["results", "获奖成果"], ["expense", "经费与票据"]];

const COMP_RECEIPT_OPTS = {
  kinds: RECEIPT_KINDS_COMP,
  defaultKind: "器件耗材票据",
  notePlaceholder: "如：Arduino 开发板 ×5 / 3D 打印耗材",
  hint: "支持图片（JPG/PNG，自动压缩）与 PDF 文件。上传时会<b>自动识别</b>票据类别、金额与日期" +
    "（文件名 → PDF 文本层 → 图片 OCR）；器件耗材、设备器材、资料图书、软件服务、报名费等发票会归入对应类别，" +
    "发票上的品名也会自动填进备注，识别结果请核对。"
};

function renderCompetitions(view) {
  const list = DB.competitions.slice().sort(function (a, b) {
    return (a.regDeadline || "") < (b.regDeadline || "") ? -1 : 1;
  });

  let h = '<div class="page-head"><div class="page-title">学科竞赛<small>竞赛库 · 参赛团队 · 备赛进度 · 获奖成果</small></div>' +
    '<div class="toolbar"><button class="btn" id="comp-add">新增竞赛</button></div></div>';

  if (!list.length) {
    h += '<div class="card"><div class="empty">还没有竞赛项目，把常带的赛事先录入进来</div></div>';
  } else {
    h += '<div class="card"><table class="tbl"><thead><tr><th>竞赛名称</th><th>级别</th><th>报名截止</th><th>决赛时间</th><th>状态</th><th>团队</th><th>获奖</th><th style="width:96px">经费</th><th style="width:110px">操作</th></tr></thead><tbody>';
    list.forEach(function (c) {
      const teams = DB.teams.filter(function (t) { return t.competitionId === c.id; });
      const results = DB.compResults.filter(function (r) { return r.competitionId === c.id; });
      const spent = compReceiptTotal(c);
      const budget = compBudgetOf(c);
      const d = daysUntil(c.regDeadline);
      const regHint = d !== null && d >= 0 && d <= 14 && c.status !== "已结束" ? badge(d === 0 ? "今天截止" : d + " 天后截止", "red") : "";
      h += '<tr class="clickable" data-go="comp/' + c.id + '"><td><b>' + esc(c.name) + '</b> <span class="muted">' + esc(c.organizer || "") + "</span>" +
        ((c.trackReg || c.trackFinal) ? ' <span class="badge badge-red">跟踪中</span>' : "") + "</td>" +
        "<td>" + levelBadge(c.level) + "</td>" +
        "<td>" + esc(c.regDeadline || "-") + " " + regHint + "</td><td>" + esc(c.finalDate || "-") + "</td>" +
        "<td>" + statusBadge(c.status) + "</td><td>" + teams.length + "</td><td>" + results.length + "</td>" +
        "<td>" + (spent ? fmtMoney(spent) + (budget ? '<div class="muted">预算 ' + fmtMoney(budget) + "</div>" : '<div class="muted">未设预算</div>')
          : '<span class="muted">—</span>') + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-comp-edit="' + c.id + '">编辑</span><span class="link" data-comp-del="' + c.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table></div>";

    const byLevel = {};
    DB.compResults.forEach(function (r) {
      const comp = getCompetition(r.competitionId);
      const lv = comp ? comp.level : "其他";
      byLevel[lv] = (byLevel[lv] || 0) + 1;
    });
    h += '<div class="grid grid-2" style="margin-top:14px">';
    h += '<div class="card"><div class="card-head"><div class="card-title">历年获奖（按竞赛级别）</div></div><div class="card-body">';
    if (!Object.keys(byLevel).length) h += '<div class="hint">暂无获奖记录</div>';
    else {
      const maxL = Math.max.apply(null, Object.keys(byLevel).map(function (k) { return byLevel[k]; }).concat([1]));
      Object.keys(byLevel).forEach(function (k) {
        h += '<div class="hbar-row"><div class="hbar-label">' + k + "</div>" +
          '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(byLevel[k] / maxL * 100) + '%">' + byLevel[k] + "</div></div></div>";
      });
    }
    h += "</div></div>";
    h += '<div class="card"><div class="card-head"><div class="card-title">历年获奖（按年度）</div></div><div class="card-body">';
    const byYear = {};
    DB.compResults.forEach(function (r) {
      const y = (r.date || "").slice(0, 4) || "未填日期";
      byYear[y] = (byYear[y] || 0) + 1;
    });
    if (!Object.keys(byYear).length) h += '<div class="hint">暂无获奖记录</div>';
    else {
      const maxY = Math.max.apply(null, Object.keys(byYear).map(function (k) { return byYear[k]; }).concat([1]));
      Object.keys(byYear).sort().reverse().forEach(function (k) {
        h += '<div class="hbar-row"><div class="hbar-label">' + k + "</div>" +
          '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(byYear[k] / maxY * 100) + '%">' + byYear[k] + "</div></div></div>";
      });
    }
    h += "</div></div></div>";
  }

  view.innerHTML = h;
  bindCompetitions(view);
}

function competitionForm(comp) {
  formModal({
    title: comp ? "编辑竞赛" : "新增竞赛",
    body:
      fieldHTML("竞赛名称", inputHTML("name", comp ? comp.name : "", { placeholder: "如：蓝桥杯全国软件大赛" }), true) +
      '<div class="form-row">' +
      fieldHTML("级别", selectHTML("level", comp ? comp.level : "省级", COMP_LEVELS)) +
      fieldHTML("当前状态", selectHTML("status", comp ? comp.status : "报名中", COMP_STATUS)) +
      "</div>" +
      fieldHTML("主办单位", inputHTML("organizer", comp ? comp.organizer : "")) +
      '<div class="form-row">' +
      fieldHTML("报名截止", inputHTML("regDeadline", comp ? comp.regDeadline : todayISO(), { type: "date" }), true) +
      fieldHTML("决赛/国赛时间", inputHTML("finalDate", comp ? comp.finalDate : "", { type: "date" })) +
      "</div>" +
      fieldHTML("官网", inputHTML("website", comp ? comp.website : "", { placeholder: "https://" })) +
      '<div class="form-row">' +
      fieldHTML("经费预算（元）", inputHTML("budget", comp && comp.budget ? comp.budget : "", { type: "number", attrs: ' min="0" step="100"', placeholder: "选填，用于经费执行率统计" })) +
      fieldHTML("备注", inputHTML("note", comp ? comp.note : "", { placeholder: "如：个人赛，每生限报一个组别" })) +
      "</div>" +
      fieldHTML("同步到日历（跟踪）", '<div class="flex" style="gap:18px;flex-wrap:wrap;font-size:13px">' +
        '<label class="flex" style="gap:6px"><input type="checkbox" name="trackReg"' + (comp && comp.trackReg ? " checked" : "") + ">跟踪<b>报名截止</b></label>" +
        '<label class="flex" style="gap:6px"><input type="checkbox" name="trackFinal"' + (comp && comp.trackFinal ? " checked" : "") + ">跟踪<b>决赛时间</b></label>" +
        "</div>") +
      '<div class="hint" style="margin-top:6px">跟踪的时间点以红色显示在教学日历，并纳入仪表盘「明日提醒」（提前一天）</div>',
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写竞赛名称"); return false; }
      if (!data.regDeadline) { toast("请选择报名截止日期"); return false; }
      const payload = {
        name: data.name.trim(), level: data.level, status: data.status,
        organizer: data.organizer.trim(), regDeadline: data.regDeadline,
        finalDate: data.finalDate, website: data.website.trim(), note: data.note.trim(),
        budget: Number(data.budget) || 0,
        trackReg: !!data.trackReg, trackFinal: !!data.trackFinal
      };
      if (comp) { Object.assign(comp, payload); toast("竞赛已更新"); }
      else { DB.competitions.push(Object.assign({ id: uid() }, payload)); toast("竞赛已创建"); }
      saveDB(); renderApp();
    }
  });
}

function bindCompetitions(view) {
  const add = $("#comp-add", view);
  add && add.addEventListener("click", function () { competitionForm(null); });
  $$("[data-comp-edit]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      competitionForm(getCompetition(el.getAttribute("data-comp-edit")));
    });
  });
  $$("[data-comp-del]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const c = getCompetition(el.getAttribute("data-comp-del"));
      const n = DB.teams.filter(function (t) { return t.competitionId === c.id; }).length + DB.compResults.filter(function (r) { return r.competitionId === c.id; }).length;
      const hasReim = (DB.reimbursements || []).some(function (r) {
        return (r.sourceType || (r.tripId ? "trip" : "")) === "competition" && (r.sourceId || r.tripId) === c.id;
      });
      confirmModal("确定删除竞赛 <b>" + esc(c.name) + "</b>？" +
        (n ? "<br><span style='color:var(--red-600)'>该赛事下有 " + n + " 条团队/获奖记录，将一并删除。</span>" : "") +
        (hasReim ? "<br><span style='color:var(--red-600)'>已生成的报销单不会删除，但会失去关联来源。</span>" : ""), function () {
        DB.competitions = DB.competitions.filter(function (x) { return x.id !== c.id; });
        DB.teams = DB.teams.filter(function (t) { return t.competitionId !== c.id; });
        DB.compResults = DB.compResults.filter(function (r) { return r.competitionId !== c.id; });
        saveDB(); toast("竞赛已删除"); renderApp();
      }, "删除");
    });
  });
}

/* ===================== 竞赛详情 ===================== */

function renderCompDetail(view, compId) {
  const c = getCompetition(compId);
  if (!c) { view.innerHTML = '<div class="empty">竞赛不存在<button class="btn btn-light btn-sm" data-go="competitions" style="margin-top:14px">返回</button></div>'; return; }
  /* 页签状态跨竞赛保留，但必须落在合法范围内 */
  compTab = COMP_TABS.some(function (t) { return t[0] === compTab; }) ? compTab : "info";

  const teams = DB.teams.filter(function (t) { return t.competitionId === c.id; });
  const results = DB.compResults.filter(function (r) { return r.competitionId === c.id; });

  let h = '<div class="page-head"><div class="flex"><span class="link" data-go="competitions" style="margin-right:4px">学科竞赛</span><span class="muted">/</span>' +
    '<div class="page-title">' + esc(c.name) + "<small>" + levelBadge(c.level) + " " + statusBadge(c.status) + "</small></div></div>" +
    '<div class="toolbar">' + (c.website ? '<a class="btn btn-light" href="' + esc(c.website) + '" target="_blank">打开官网</a>' : "") +
    '<button class="btn btn-light" data-comp-edit="' + c.id + '">编辑</button></div></div>';

  const regD = daysUntil(c.regDeadline);
  const finD = daysUntil(c.finalDate);
  const budget = compBudgetOf(c);
  const spent = compReceiptTotal(c);

  h += '<div class="tabs">' + COMP_TABS.map(function (t) {
    return '<div class="tab' + (compTab === t[0] ? " active" : "") + '" data-comp-tab="' + t[0] + '">' + t[1] +
      (t[0] === "teams" && teams.length ? " " + teams.length : "") +
      (t[0] === "results" && results.length ? " " + results.length : "") +
      (t[0] === "expense" ? (spent ? " " + fmtMoney(spent) : "") : "") +
      (t[0] === "info" && budget ? " " + fmtMoney(budget) : "") +
      "</div>";
  }).join("") + "</div>";

  h += '<div id="comp-tab-body">' + compTabBodyHTML(c, teams, results) + "</div>";

  view.innerHTML = h;
  bindCompDetail(view, c);
}

function compTabBodyHTML(c, teams, results) {
  if (compTab === "teams") return compTeamsHTML(c, teams || []);
  if (compTab === "results") return compResultsHTML(c, results || []);
  if (compTab === "expense") return compExpenseHTML(c);
  return compInfoHTML(c);
}

function compInfoHTML(c) {
  const regD = daysUntil(c.regDeadline);
  const finD = daysUntil(c.finalDate);
  const budget = compBudgetOf(c);
  const spent = compReceiptTotal(c);
  return '<div class="card"><div class="card-body"><div class="kv">' +
    "<div class='k'>主办单位</div><div>" + esc(c.organizer || "-") + "</div>" +
    "<div class='k'>报名截止</div><div>" + esc(c.regDeadline || "-") +
    (regD !== null && regD >= 0 && c.status !== "已结束" ? "（" + (regD === 0 ? "今天" : regD + " 天后") + "）" : "") +
    (c.trackReg ? ' <span class="badge badge-red">跟踪中</span> <span class="link" data-comp-track-reg>取消跟踪</span>' : ' <span class="link" data-comp-track-reg>跟踪到日历</span>') + "</div>" +
    "<div class='k'>决赛时间</div><div>" + esc(c.finalDate || "-") +
    (finD !== null && finD >= 0 ? "（" + (finD === 0 ? "今天" : finD + " 天后") + "）" : "") +
    (c.trackFinal ? ' <span class="badge badge-red">跟踪中</span> <span class="link" data-comp-track-final>取消跟踪</span>' : ' <span class="link" data-comp-track-final>跟踪到日历</span>') + "</div>" +
    "<div class='k'>经费预算</div><div>" +
    (budget ? fmtMoney(budget) + '<span class="muted"> · 已用 ' + fmtMoney(spent) + "，剩余 " + fmtMoney(budget - spent) + "</span>"
      : '<span class="muted">未设置</span>') +
    ' <span class="link" id="comp-budget">' + (budget ? "调整" : "设置") + "</span></div>" +
    "<div class='k'>备注</div><div>" + esc(c.note || "-") + "</div>" +
    "</div></div></div>";
}

function compTeamsHTML(c, teams) {
  let h = '<div class="card"><div class="card-head"><div class="card-title">参赛团队（' + teams.length + "）</div>" +
    '<button class="btn btn-sm" id="team-add">新建团队</button></div>';
  if (!teams.length) return h + '<div class="empty" style="padding:22px">还没有组队</div></div>';
  h += '<table class="tbl"><thead><tr><th>团队</th><th>成员</th><th>赛道</th><th>状态</th><th style="width:90px">操作</th></tr></thead><tbody>';
  teams.forEach(function (t) {
    const names = (t.members || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
    h += "<tr><td><b>" + esc(t.name) + "</b></td><td>" + esc(names || "-") + "</td><td>" + esc(t.entryRole || "-") + "</td><td>" + statusBadge(t.status) + "</td>" +
      '<td><span class="flex" style="gap:10px"><span class="link" data-team-edit="' + t.id + '">编辑</span><span class="link" data-team-del="' + t.id + '">删除</span></span></td></tr>';
  });
  return h + "</tbody></table></div>";
}

function compResultsHTML(c, results) {
  let h = '<div class="card"><div class="card-head"><div class="card-title">获奖成果（' + results.length + "）</div>" +
    '<button class="btn btn-sm" id="result-add">登记获奖</button></div>';
  if (!results.length) return h + '<div class="empty" style="padding:22px">暂无获奖记录</div></div>';
  h += '<table class="tbl"><thead><tr><th style="width:96px">日期</th><th>获奖</th><th>学生</th><th>证书编号</th><th style="width:60px">操作</th></tr></thead><tbody>';
  results.forEach(function (r) {
    const names = (r.studentIds || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
    h += "<tr><td>" + esc(r.date) + "</td><td><b>" + esc(r.teamName) + "</b> " + badge(r.level, "amber") + "</td>" +
      "<td>" + esc(names) + "</td><td>" + esc(r.certNo || "-") + "</td>" +
      '<td><span class="link" data-result-del="' + r.id + '">删除</span></td></tr>';
  });
  return h + "</tbody></table></div>";
}

/* ===================== 竞赛经费与票据 ===================== */

function compExpenseHTML(c) {
  const total = compReceiptTotal(c);
  const material = compMaterialTotal(c);
  const travel = compTravelTotal(c);
  const budget = compBudgetOf(c);
  const byKind = compExpenseByKind(c);
  const reim = (DB.reimbursements || []).find(function (r) {
    return (r.sourceType || (r.tripId ? "trip" : "")) === "competition" && (r.sourceId || r.tripId) === c.id;
  });

  let h = '<div class="grid grid-4">' +
    statCard("票据合计", fmtMoney(total), "", ((c.receipts || []).length) + " 个票据 / 附件") +
    statCard("器件器材类", fmtMoney(material), "", "器件耗材 · 设备器材 · 资料图书 · 软件服务") +
    statCard("参赛差旅类", fmtMoney(travel), "", "交通 · 住宿 · 市内交通 · 餐饮") +
    statCard("经费预算", budget ? fmtMoney(budget) : "未设置", "",
      budget ? (total > budget ? "已超支 " + fmtMoney(total - budget) : "剩余 " + fmtMoney(budget - total)) : "点下方「设置预算」填写") +
    "</div>";

  /* 预算执行条：有预算才显示，超支转红 */
  if (budget) {
    const pct = Math.min(100, Math.round(total / budget * 100));
    h += '<div class="card"><div class="card-body">' +
      '<div class="hbar-row"><div class="hbar-label">预算执行</div>' +
      '<div class="hbar-track"><div class="hbar-fill' + (total > budget ? " hbar-fill-danger" : "") + '" style="width:' + pct + '%">' + pct + "%</div></div>" +
      '<div class="muted" style="font-size:12px">' + fmtMoney(total) + " / " + fmtMoney(budget) + "</div></div>" +
      "</div></div>";
  }

  h += '<div class="card"><div class="card-head"><div class="card-title">经费汇总</div>' +
    '<span class="flex" style="gap:8px"><button class="btn btn-light btn-sm" id="comp-budget-2">设置预算</button>' +
    '<button class="btn btn-sm" id="comp-reim">' + (reim ? "重新生成报销单" : "生成报销单") + "</button></span></div>" +
    '<table class="tbl"><tbody>' +
    "<tr><th style=\"width:150px\">器件器材类</th><td>" + fmtMoney(material) + "</td></tr>" +
    "<tr><th>参赛差旅类</th><td>" + fmtMoney(travel) + "</td></tr>" +
    '<tr><th>合计</th><td><b style="font-size:15px">' + fmtMoney(total) + "</b></td></tr>" +
    "<tr><th>报销单</th><td>" + (reim
      ? '<span class="link" data-go="finance">' + esc(reim.no) + "</span> · " + badge(reim.status, reimStatusColor(reim.status)) + " · " + fmtMoney(reim.amount)
      : '<span class="muted">尚未生成</span>') + "</td></tr>" +
    "</tbody></table></div>";

  if (byKind.length) {
    h += '<div class="card"><div class="card-head"><div class="card-title">按类别汇总</div></div>' +
      '<table class="tbl"><thead><tr><th>类别</th><th style="width:80px">张数</th><th style="width:120px">金额</th><th style="width:140px">占比</th></tr></thead><tbody>';
    byKind.forEach(function (k) {
      const pct = total ? Math.round(k.amount / total * 100) : 0;
      h += "<tr><td>" + badge(k.kind, receiptKindColor(k.kind)) + "</td><td>" + k.count + "</td><td>" + fmtMoney(k.amount) + "</td>" +
        '<td><div class="hbar-track" style="height:8px"><div class="hbar-fill" style="width:' + pct + '%"></div></div> ' + pct + "%</td></tr>";
    });
    h += "</tbody></table></div>";
  }

  /* 票据墙：与差旅共用同一套上传 / 识别 / 预览能力 */
  h += receiptsGridHTML(c, COMP_RECEIPT_OPTS);
  return h;
}

/* 预算设置：只管一个数字，单独弹窗避免与竞赛表单耦合 */
function compBudgetForm(c) {
  formModal({
    title: "设置经费预算 · " + c.name,
    body:
      '<div class="hint" style="margin-bottom:10px">预算仅用于经费页的<b>执行率统计</b>，不影响报销单金额。</div>' +
      fieldHTML("经费预算（元）", inputHTML("budget", c.budget || "", { type: "number", attrs: ' min="0" step="100"', placeholder: "如：5000" })),
    onSubmit: function (data) {
      c.budget = Number(data.budget) || 0;
      saveDB(); renderApp(); toast(c.budget ? "预算已保存" : "已清除预算");
    }
  });
}

function bindCompDetail(view, c) {
  const editBtn = $("[data-comp-edit]", view);
  editBtn && editBtn.addEventListener("click", function () { competitionForm(c); });

  const regToggle = $("[data-comp-track-reg]", view);
  regToggle && regToggle.addEventListener("click", function () {
    c.trackReg = !c.trackReg;
    saveDB(); toast(c.trackReg ? "已跟踪报名截止，同步到教学日历" : "已取消跟踪报名截止"); renderApp();
  });
  const finalToggle = $("[data-comp-track-final]", view);
  finalToggle && finalToggle.addEventListener("click", function () {
    c.trackFinal = !c.trackFinal;
    saveDB(); toast(c.trackFinal ? "已跟踪决赛时间，同步到教学日历" : "已取消跟踪决赛时间"); renderApp();
  });

  /* 页签切换 */
  $$("[data-comp-tab]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      compTab = el.getAttribute("data-comp-tab");
      renderApp();
    });
  });

  const teamAdd = $("#team-add", view);
  teamAdd && teamAdd.addEventListener("click", function () { teamForm(c, null); });
  $$("[data-team-edit]", view).forEach(function (el) { el.addEventListener("click", function () { teamForm(c, DB.teams.find(function (t) { return t.id === el.getAttribute("data-team-edit"); })); }); });
  $$("[data-team-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除该团队？", function () {
        DB.teams = DB.teams.filter(function (t) { return t.id !== el.getAttribute("data-team-del"); });
        saveDB(); toast("团队已删除"); renderApp();
      });
    });
  });

  const resultAdd = $("#result-add", view);
  resultAdd && resultAdd.addEventListener("click", function () { resultForm(c, null); });
  $$("[data-result-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除该获奖记录？", function () {
        DB.compResults = DB.compResults.filter(function (r) { return r.id !== el.getAttribute("data-result-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });

  /* 经费与票据：上传 / 预览 / 编辑 / 删除（与差旅同一套） */
  bindReceiptOps(view, c, COMP_RECEIPT_OPTS);

  $$("#comp-budget, #comp-budget-2", view).forEach(function (el) {
    el.addEventListener("click", function () { compBudgetForm(c); });
  });
  const reimBtn = $("#comp-reim", view);
  reimBtn && reimBtn.addEventListener("click", function () { createReimbursement(c, "competition"); });
}

function teamForm(comp, team) {
  formModal({
    title: (team ? "编辑" : "新建") + "参赛团队 · " + comp.name, wide: true,
    body:
      fieldHTML("团队名称", inputHTML("name", team ? team.name : "", { placeholder: "如：智链科技——校园二手交易平台" }), true) +
      '<div class="form-row">' +
      fieldHTML("赛道/组别", inputHTML("entryRole", team ? team.entryRole : "", { placeholder: "如：高教主赛道 / Java B组" })) +
      fieldHTML("状态", selectHTML("status", team ? team.status : "备赛中", COMP_STATUS)) +
      "</div>" +
      fieldHTML("团队成员（可多选）", '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:10px">' +
        (DB.students.length ? DB.students.map(function (s) {
          return '<label class="flex" style="gap:6px;font-size:13px;margin:0 0 8px 0"><input type="checkbox" name="stu_' + s.id + '"' +
            (team && (team.members || []).indexOf(s.id) >= 0 ? " checked" : "") + ">" +
            esc(s.name) + '<span class="muted">' + esc(s.className || "") + " " + esc(s.no || "") + "</span></label>";
        }).join("") : '<span class="hint">学生池为空，请先在学生管理建档</span>') + "</div>") +
      fieldHTML("备注", textareaHTML("note", team ? team.note : "", { rows: 2, placeholder: "如：项目计划书初稿已完成" })),
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写团队名称"); return false; }
      const members = DB.students.filter(function (s) { return data["stu_" + s.id]; }).map(function (s) { return s.id; });
      const payload = { name: data.name.trim(), entryRole: data.entryRole.trim(), status: data.status, members: members, note: data.note.trim() };
      if (team) { Object.assign(team, payload); toast("团队已更新"); }
      else { DB.teams.push(Object.assign({ id: uid(), competitionId: comp.id }, payload)); toast("团队已创建"); }
      saveDB(); renderApp();
    }
  });
}

function resultForm(comp, result) {
  formModal({
    title: (result ? "编辑" : "登记") + "获奖成果 · " + comp.name, wide: true,
    body:
      '<div class="form-row">' +
      fieldHTML("获奖日期", inputHTML("date", result ? result.date : todayISO(), { type: "date" }), true) +
      fieldHTML("获奖等级", inputHTML("level", result ? result.level : "省一等奖", { placeholder: "如：国家二等奖 / 省一等奖" }), true) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("团队/个人名称", inputHTML("teamName", result ? result.teamName : "", { placeholder: "如：智链科技队 / 张子昂（Java B组）" }), true) +
      fieldHTML("证书编号", inputHTML("certNo", result ? result.certNo : "", { placeholder: "用于职称材料核验" })) +
      "</div>" +
      fieldHTML("获奖学生（可多选）", '<div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:10px">' +
        (DB.students.length ? DB.students.map(function (s) {
          return '<label class="flex" style="gap:6px;font-size:13px;margin:0 0 8px 0"><input type="checkbox" name="stu_' + s.id + '"' +
            (result && (result.studentIds || []).indexOf(s.id) >= 0 ? " checked" : "") + ">" +
            esc(s.name) + '<span class="muted">' + esc(s.className || "") + " " + esc(s.no || "") + "</span></label>";
        }).join("") : '<span class="hint">学生池为空</span>') + "</div>") +
      fieldHTML("备注", inputHTML("note", result ? result.note : "")),
    onSubmit: function (data) {
      if (!data.level.trim()) { toast("请填写获奖等级"); return false; }
      if (!data.teamName.trim()) { toast("请填写团队或个人名称"); return false; }
      const studentIds = DB.students.filter(function (s) { return data["stu_" + s.id]; }).map(function (s) { return s.id; });
      const payload = { date: data.date, level: data.level.trim(), teamName: data.teamName.trim(), certNo: data.certNo.trim(), studentIds: studentIds, note: data.note.trim() };
      if (result) { Object.assign(result, payload); toast("成果已更新"); }
      else { DB.compResults.push(Object.assign({ id: uid(), competitionId: comp.id }, payload)); toast("获奖成果已登记"); }
      saveDB(); renderApp();
    }
  });
}
