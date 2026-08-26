"use strict";

let projectTab = "info";

const PROJ_LEVELS = ["国家级", "省部级", "市厅级", "校级", "横向课题"];
const PROJ_STATUS = ["在研", "已结题", "已中止"];
const OUTPUT_TYPES = ["论文", "专利", "软著", "专著", "标准", "其他"];
const EXP_CATS = ["设备费", "材料费", "测试化验加工费", "差旅费", "会议费", "出版/文献/信息传播费", "劳务费", "专家咨询费", "其他"];

function renderProjects(view) {
  const statusFilter = window.__projStatus || "";
  let list = DB.projects.slice().sort(function (a, b) { return a.startDate < b.startDate ? 1 : -1; });
  if (statusFilter) list = list.filter(function (p) { return p.status === statusFilter; });

  let h = '<div class="page-head"><div class="page-title">科研项目<small>项目台账 · 节点管理 · 经费流水 · 成果库</small></div>' +
    '<div class="toolbar"><button class="btn" id="proj-add">新增项目</button></div></div>';

  h += '<div class="grid grid-4" style="margin-bottom:14px">' +
    statCard("在研项目", DB.projects.filter(function (p) { return p.status === "在研"; }).length, "项", "") +
    statCard("在研经费", sum(DB.projects.filter(function (p) { return p.status === "在研"; }), function (p) { return p.fund; }), "元", "") +
    statCard("累计支出", sum(DB.expenses, function (e) { return e.amount; }), "元", "") +
    statCard("科研成果", DB.outputs.length, "项", "论文/专利/软著等") +
    "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">项目台账（' + list.length + "）</div>" +
    '<select class="input" id="proj-status-filter" style="width:130px"><option value="">全部状态</option>' +
    PROJ_STATUS.map(function (s) { return '<option value="' + s + '"' + (statusFilter === s ? " selected" : "") + ">" + s + "</option>"; }).join("") +
    "</select></div>";

  if (!list.length) {
    h += '<div class="empty">' + (statusFilter ? "没有该状态的项目" : "还没有科研项目") + "</div>";
  } else {
    h += '<table class="tbl"><thead><tr><th>项目名称</th><th>编号</th><th>级别</th><th>角色</th><th>经费</th><th>起止</th><th>状态</th><th style="width:110px">操作</th></tr></thead><tbody>';
    list.forEach(function (p) {
      const spent = sum(DB.expenses.filter(function (e) { return e.projectId === p.id; }), function (e) { return e.amount; });
      h += '<tr class="clickable" data-go="project/' + p.id + '"><td><b>' + esc(p.name) + "</b></td><td>" + esc(p.no || "-") + "</td>" +
        "<td>" + levelBadge(p.level) + "</td><td>" + badge(p.role, p.role === "主持" ? "green" : "gray") + "</td>" +
        "<td>" + fmtMoney(p.fund) + '<div class="muted">已支 ' + fmtMoney(spent) + "</div></td>" +
        "<td>" + esc(p.startDate || "") + " ~ " + esc(p.endDate || "") + "</td><td>" + statusBadge(p.status) + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-proj-edit="' + p.id + '">编辑</span><span class="link" data-proj-del="' + p.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">科研成果库（' + DB.outputs.length + "）</div>" +
    '<button class="btn btn-sm" id="output-add">新增成果</button></div>';
  if (!DB.outputs.length) {
    h += '<div class="empty">暂无成果记录——论文、专利、软著都可以登记在这里</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>类型</th><th>标题</th><th>期刊/编号</th><th>作者</th><th>日期</th><th>关联项目</th><th style="width:60px">操作</th></tr></thead><tbody>';
    DB.outputs.slice().sort(function (a, b) { return (a.date || "") < (b.date || "") ? 1 : -1; }).forEach(function (o) {
      const p = o.projectId ? getProject(o.projectId) : null;
      h += "<tr><td>" + badge(o.type, o.type === "论文" ? "blue" : "purple") + "</td><td><b>" + esc(o.title) + "</b>" + (o.note ? '<div class="muted">' + esc(o.note) + "</div>" : "") + "</td>" +
        "<td>" + esc(o.venue || o.no || "-") + "</td><td>" + esc(o.authors || "-") + "</td><td>" + esc(o.date || "-") + "</td>" +
        "<td>" + (p ? '<span class="link" data-go="project/' + p.id + '">' + esc(p.name.slice(0, 14)) + (p.name.length > 14 ? "…" : "") + "</span>" : "-") + "</td>" +
        '<td><span class="link" data-output-del="' + o.id + '">删除</span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  view.innerHTML = h;
  bindProjects(view);
}

function projectForm(proj) {
  formModal({
    title: proj ? "编辑项目" : "新增项目", wide: true,
    body:
      fieldHTML("项目名称", inputHTML("name", proj ? proj.name : "", { placeholder: "如：面向智慧校园的多模态数据融合关键技术研究" }), true) +
      '<div class="form-row">' +
      fieldHTML("项目编号", inputHTML("no", proj ? proj.no : "", { placeholder: "如：2026YJS-118" })) +
      fieldHTML("级别", selectHTML("level", proj ? proj.level : "省部级", PROJ_LEVELS)) +
      fieldHTML("角色", selectHTML("role", proj ? proj.role : "主持", ["主持", "参与"])) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("经费（元）", inputHTML("fund", proj ? proj.fund : 0, { type: "number", attrs: ' min="0" step="1000"' })) +
      fieldHTML("开始日期", inputHTML("startDate", proj ? proj.startDate : todayISO(), { type: "date" }), true) +
      fieldHTML("结束日期", inputHTML("endDate", proj ? proj.endDate : "", { type: "date" }), true) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("状态", selectHTML("status", proj ? proj.status : "在研", PROJ_STATUS)) +
      fieldHTML("备注", inputHTML("note", proj ? proj.note : "", { placeholder: "如：教育厅高校科研重点项目" })) +
      "</div>",
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写项目名称"); return false; }
      if (!data.startDate || !data.endDate) { toast("请填写起止日期"); return false; }
      if (data.endDate < data.startDate) { toast("结束日期不能早于开始日期"); return false; }
      const payload = {
        name: data.name.trim(), no: data.no.trim(), level: data.level, role: data.role,
        fund: Number(data.fund) || 0, startDate: data.startDate, endDate: data.endDate,
        status: data.status, note: data.note.trim()
      };
      if (proj) {
        Object.assign(proj, payload);
        toast("项目已更新");
      } else {
        DB.projects.push(Object.assign({ id: uid(), milestones: [] }, payload));
        toast("项目已创建，可添加开题/中期/结题节点");
      }
      saveDB(); renderApp();
    }
  });
}

function bindProjects(view) {
  const add = $("#proj-add", view);
  add && add.addEventListener("click", function () { projectForm(null); });

  $("#proj-status-filter", view).addEventListener("change", function (e) {
    window.__projStatus = e.target.value;
    renderApp();
  });

  const outAdd = $("#output-add", view);
  outAdd && outAdd.addEventListener("click", function () { outputForm(null); });

  $$("[data-proj-edit]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      projectForm(getProject(el.getAttribute("data-proj-edit")));
    });
  });
  $$("[data-proj-del]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const p = getProject(el.getAttribute("data-proj-del"));
      const n = DB.expenses.filter(function (x) { return x.projectId === p.id; }).length;
      confirmModal("确定删除项目 <b>" + esc(p.name) + "</b>？" +
        (n ? "<br><span style='color:var(--red-600)'>该项目的 " + n + " 条经费记录将一并删除。</span>" : ""), function () {
        DB.projects = DB.projects.filter(function (x) { return x.id !== p.id; });
        DB.expenses = DB.expenses.filter(function (x) { return x.projectId !== p.id; });
        DB.outputs.forEach(function (o) { if (o.projectId === p.id) o.projectId = ""; });
        saveDB(); toast("项目已删除"); renderApp();
      }, "删除");
    });
  });
  $$("[data-output-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除该成果记录？", function () {
        DB.outputs = DB.outputs.filter(function (o) { return o.id !== el.getAttribute("data-output-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });
}

function outputForm(output) {
  formModal({
    title: output ? "编辑成果" : "新增科研成果",
    body:
      '<div class="form-row">' +
      fieldHTML("类型", selectHTML("type", output ? output.type : "论文", OUTPUT_TYPES)) +
      fieldHTML("日期", inputHTML("date", output ? output.date : todayISO(), { type: "date" }), true) +
      "</div>" +
      fieldHTML("标题", inputHTML("title", output ? output.title : "", { placeholder: "论文标题 / 专利名称 / 软著名称" }), true) +
      '<div class="form-row">' +
      fieldHTML("期刊/授权号", inputHTML("venue", output ? output.venue : "", { placeholder: "论文：期刊名；专利/软著：授权号" })) +
      fieldHTML("作者/发明人", inputHTML("authors", output ? output.authors : "", { placeholder: "如：李明, 张子昂" })) +
      "</div>" +
      fieldHTML("关联项目", selectHTML("projectId", output ? output.projectId : "", DB.projects.map(function (p) { return { value: p.id, text: p.name.slice(0, 24) }; }), { allowEmpty: true, emptyText: "不关联" })) +
      fieldHTML("备注", inputHTML("note", output ? output.note : "", { placeholder: "如：北大核心 / SCI 三区 / 已转让" })),
    onSubmit: function (data) {
      if (!data.title.trim()) { toast("请填写标题"); return false; }
      const payload = {
        type: data.type, date: data.date, title: data.title.trim(),
        venue: data.venue.trim(), authors: data.authors.trim(),
        projectId: data.projectId, note: data.note.trim()
      };
      if (output) { Object.assign(output, payload); toast("成果已更新"); }
      else { DB.outputs.push(Object.assign({ id: uid() }, payload)); toast("成果已登记"); }
      saveDB(); renderApp();
    }
  });
}

/* ===================== 项目详情 ===================== */

function renderProjectDetail(view, projId) {
  const p = getProject(projId);
  if (!p) { view.innerHTML = '<div class="empty">项目不存在<button class="btn btn-light btn-sm" data-go="projects" style="margin-top:14px">返回</button></div>'; return; }

  const expenses = DB.expenses.filter(function (e) { return e.projectId === p.id; });
  const outputs = DB.outputs.filter(function (o) { return o.projectId === p.id; });
  const spent = sum(expenses, function (e) { return e.amount; });

  let h = '<div class="page-head"><div class="flex"><span class="link" data-go="projects" style="margin-right:4px">科研项目</span><span class="muted">/</span>' +
    '<div class="page-title">' + esc(p.name) + "<small>" + levelBadge(p.level) + " " + badge(p.role, p.role === "主持" ? "green" : "gray") + " " + statusBadge(p.status) + "</small></div></div>" +
    '<div class="toolbar"><button class="btn btn-light" data-proj-edit="' + p.id + '">编辑项目</button></div></div>';

  h += '<div class="grid grid-4" style="margin-bottom:14px">' +
    statCard("项目经费", p.fund, "元", "编号 " + (p.no || "-")) +
    statCard("已支出", spent, "元", "占比 " + (p.fund ? Math.round(spent / p.fund * 100) : 0) + "%") +
    statCard("结余", p.fund - spent, "元", "") +
    statCard("起止时间", "", "", p.startDate + " ~ " + p.endDate) +
    "</div>";

  h += '<div class="card"><div class="card-body">' +
    '<div class="bar-track" style="margin-bottom:6px"><div class="bar-fill" style="width:' + Math.min(100, p.fund ? Math.round(spent / p.fund * 100) : 0) + '%"></div></div>' +
    '<div class="muted">经费执行进度：' + fmtMoney(spent) + " / " + fmtMoney(p.fund) + (p.note ? " · " + esc(p.note) : "") + "</div></div></div>";

  h += '<div class="grid grid-2">';
  h += '<div class="card"><div class="card-head"><div class="card-title">节点管理</div><button class="btn btn-sm" id="ms-add">添加节点</button></div><div class="card-body"><div class="timeline">';
  if (!(p.milestones || []).length) h += '<div class="hint">还没有节点，建议至少添加：开题、中期检查、结题验收</div>';
  (p.milestones || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (m) {
    const d = daysUntil(m.date);
    const cls = m.done ? "done" : d !== null && d < 0 ? "overdue" : "";
    h += '<div class="tl-item ' + cls + '"><div class="tl-dot"></div>' +
      '<div class="tl-date">' + esc(m.date) + (m.done ? "（已完成）" : d !== null && d < 0 ? "（已逾期）" : d !== null && d <= 30 ? "（" + d + " 天后）" : "") + "</div>" +
      '<div class="tl-title"><b>' + esc(m.name) + '</b> <span class="link" data-ms-toggle="' + m.id + '">' + (m.done ? "撤销完成" : "标记完成") + "</span> " +
      '<span class="link" data-ms-del="' + m.id + '">删除</span></div></div>';
  });
  h += "</div></div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">经费流水（' + expenses.length + "）</div>" +
    '<button class="btn btn-sm" id="exp-add">记一笔</button></div>';
  if (!expenses.length) h += '<div class="empty" style="padding:22px">暂无支出记录</div>';
  else {
    h += '<table class="tbl"><thead><tr><th>日期</th><th>事项</th><th>类别</th><th style="text-align:right">金额</th><th style="width:60px">操作</th></tr></thead><tbody>';
    expenses.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (e) {
      h += "<tr><td>" + esc(e.date) + "</td><td>" + esc(e.item) + "</td><td>" + badge(e.category, "gray") + "</td>" +
        '<td style="text-align:right;font-weight:600">' + fmtMoney(e.amount) + "</td>" +
        '<td><span class="link" data-exp-del="' + e.id + '">删除</span></td></tr>';
    });
    h += '<tr><td colspan="3" style="text-align:right"><b>合计</b></td><td style="text-align:right"><b>' + fmtMoney(spent) + "</b></td><td></td></tr></tbody></table>";
  }
  h += "</div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">本项目成果（' + outputs.length + "）</div>" +
    '<button class="btn btn-sm" id="output-add-detail">登记成果</button></div>';
  if (!outputs.length) h += '<div class="empty" style="padding:22px">暂无关联成果</div>';
  else {
    h += '<table class="tbl"><thead><tr><th>类型</th><th>标题</th><th>日期</th></tr></thead><tbody>';
    outputs.forEach(function (o) {
      h += "<tr><td>" + badge(o.type, o.type === "论文" ? "blue" : "purple") + "</td><td><b>" + esc(o.title) + "</b>" + (o.note ? '<div class="muted">' + esc(o.note) + "</div>" : "") + "</td><td>" + esc(o.date) + "</td></tr>";
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  view.innerHTML = h;
  bindProjectDetail(view, p);
}

function bindProjectDetail(view, p) {
  const editBtn = $("[data-proj-edit]", view);
  editBtn && editBtn.addEventListener("click", function () { projectForm(p); });

  $("#ms-add", view).addEventListener("click", function () {
    formModal({
      title: "添加节点",
      body:
        fieldHTML("节点名称", inputHTML("name", "", { placeholder: "如：中期检查 / 结题验收" }), true) +
        fieldHTML("日期", inputHTML("date", todayISO(), { type: "date" }), true),
      onSubmit: function (data) {
        if (!data.name.trim()) { toast("请填写节点名称"); return false; }
        p.milestones = p.milestones || [];
        p.milestones.push({ id: uid(), name: data.name.trim(), date: data.date, done: false });
        saveDB(); toast("节点已添加"); renderApp();
      }
    });
  });

  $$("[data-ms-toggle]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const m = p.milestones.find(function (x) { return x.id === el.getAttribute("data-ms-toggle"); });
      m.done = !m.done;
      saveDB(); renderApp();
    });
  });
  $$("[data-ms-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      p.milestones = p.milestones.filter(function (x) { return x.id !== el.getAttribute("data-ms-del"); });
      saveDB(); toast("节点已删除"); renderApp();
    });
  });

  function expenseForm() {
    formModal({
      title: "登记支出",
      body:
        '<div class="form-row">' +
        fieldHTML("日期", inputHTML("date", todayISO(), { type: "date" }), true) +
        fieldHTML("金额（元）", inputHTML("amount", "", { type: "number", attrs: ' min="0" step="0.01"' }), true) +
        "</div>" +
        fieldHTML("支出事项", inputHTML("item", "", { placeholder: "如：实验服务器租用" }), true) +
        '<div class="form-row">' +
        fieldHTML("类别", selectHTML("category", "设备费", EXP_CATS)) +
        "</div>" +
        fieldHTML("备注", inputHTML("note", "")),
      onSubmit: function (data) {
        if (!data.item.trim()) { toast("请填写支出事项"); return false; }
        const amount = Number(data.amount);
        if (!amount || amount <= 0) { toast("请填写有效金额"); return false; }
        DB.expenses.push({
          id: uid(), date: data.date, item: data.item.trim(), amount: amount,
          category: data.category, projectId: p.id, competitionId: "", note: data.note.trim()
        });
        saveDB(); toast("支出已登记"); renderApp();
      }
    });
  }
  $("#exp-add", view).addEventListener("click", expenseForm);
  $$("[data-exp-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除这笔支出记录？", function () {
        DB.expenses = DB.expenses.filter(function (e) { return e.id !== el.getAttribute("data-exp-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });

  const outAdd = $("#output-add-detail", view);
  outAdd && outAdd.addEventListener("click", function () { outputForm(null); });
}
