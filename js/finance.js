"use strict";

/* 待生成报销单的来源：差旅 + 竞赛 + 科研项目（三者都能产生报销） */
function pendingSourceCount() {
  const used = function (type, id) {
    return (DB.reimbursements || []).some(function (r) {
      return (r.sourceType || (r.tripId ? "trip" : "")) === type && (r.sourceId || r.tripId) === id;
    });
  };
  let n = 0;
  (DB.trips || []).forEach(function (t) { if (!used("trip", t.id)) n++; });
  (DB.competitions || []).forEach(function (c) { if (!used("competition", c.id)) n++; });
  (DB.projects || []).forEach(function (p) { if (!used("project", p.id)) n++; });
  return n;
}

/* 来源类型中文名：提示文案与确认弹窗共用，避免三处各写一套 */
function reimTypeLabel(type) {
  if (type === "trip") return "差旅项目";
  if (type === "competition") return "竞赛项目";
  if (type === "project") return "科研项目";
  return "项目";
}

function renderFinance(view) {
  const statusFilter = window.__reimStatus || "";
  const all = DB.reimbursements || [];
  let list = all.slice().sort(function (a, b) { return (a.applyDate || "") < (b.applyDate || "") ? 1 : -1; });
  if (statusFilter) list = list.filter(function (r) { return r.status === statusFilter; });

  const total = sum(all, function (r) { return r.amount; });
  const doneSum = sum(all.filter(function (r) { return r.status === "已报销"; }), function (r) { return r.amount; });
  const pendingSum = sum(all.filter(function (r) { return r.status === "待提交" || r.status === "审批中"; }), function (r) { return r.amount; });
  const pendingSrc = pendingSourceCount();

  let h = '<div class="page-head"><div class="page-title">财务报销<small>差旅 · 竞赛 · 科研项目票据汇总 · 报销单状态跟踪</small></div>' +
    '<div class="toolbar"><button class="btn" id="reim-add">生成报销单</button></div></div>';

  h += '<div class="grid grid-4" style="margin-bottom:14px">' +
    statCard("报销单", all.length, "张", pendingSrc ? pendingSrc + " 个项目待生成" : "全部项目已生成") +
    statCard("报销总额", fmtMoney(total), "", "全部报销单合计") +
    statCard("已报销", fmtMoney(doneSum), "", "已到账 / 已办结") +
    statCard("在途金额", fmtMoney(pendingSum), "", "待提交 + 审批中") +
    "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">报销单（' + list.length + "）</div>" +
    '<select class="input" id="reim-status-filter" style="width:130px"><option value="">全部状态</option>' +
    REIM_STATUS.map(function (s) { return '<option value="' + s + '"' + (statusFilter === s ? " selected" : "") + ">" + s + "</option>"; }).join("") +
    "</select></div>";

  if (!list.length) {
    h += '<div class="empty">' + (all.length ? "没有该状态的报销单" : "还没有报销单——到「差旅项目」「学科竞赛 → 经费与票据」或「科研项目 → 经费与票据」中点击「生成报销单」，或点击右上角按钮") + "</div>";
  } else {
    h += '<table class="tbl"><thead><tr><th>单号</th><th>报销事项</th><th>关联项目</th><th>申请人</th><th>申请日期</th>' +
      "<th>金额</th><th>状态</th><th style=\"width:150px\">操作</th></tr></thead><tbody>";
    list.forEach(function (r) {
      const src = reimSourceOf(r);
      h += "<tr><td>" + esc(r.no || "-") + "</td><td><b>" + esc(r.title || "-") + "</b>" +
        (r.note ? '<div class="muted">' + esc(r.note.slice(0, 22)) + (r.note.length > 22 ? "…" : "") + "</div>" : "") + "</td>" +
        "<td>" + reimSourceCellHTML(src) + "</td>" +
        "<td>" + esc(r.applicant || "-") + "</td><td>" + esc(r.applyDate || "-") + "</td>" +
        "<td><b>" + fmtMoney(r.amount) + "</b>" + (r.items && r.items.length ? '<div class="muted">' + r.items.length + " 项明细</div>" : "") + "</td>" +
        "<td>" + badge(r.status, reimStatusColor(r.status)) + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-reim-view="' + r.id + '">明细</span>' +
        '<span class="link" data-reim-export="' + r.id + '">申请单</span>' +
        '<span class="link" data-reim-edit="' + r.id + '">编辑</span>' +
        '<span class="link" data-reim-del="' + r.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  view.innerHTML = h;
  bindFinance(view);
}

/* 「关联项目」单元格：差旅 / 竞赛 / 科研 / 手工录入，有来源时可点击跳转 */
function reimSourceColor(type) {
  if (type === "competition") return "purple";
  if (type === "project") return "teal";
  return "blue";
}

function reimSourceCellHTML(src) {
  if (!src || !src.type) return '<span class="muted">手工录入</span>';
  const short = src.name.length > 16 ? src.name.slice(0, 16) + "…" : src.name;
  const color = reimSourceColor(src.type);
  return badge(src.label, color) + " " +
    (src.go ? '<span class="link" data-go="' + src.go + '">' + esc(short) + "</span>"
      : '<span class="muted">' + esc(short || "已删除") + "</span>");
}

function bindFinance(view) {
  const add = $("#reim-add", view);
  add && add.addEventListener("click", reimSourceForm);

  const sel = $("#reim-status-filter", view);
  sel && sel.addEventListener("change", function () { window.__reimStatus = sel.value; renderApp(); });

  $$("[data-reim-view]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = getReimbursement(el.getAttribute("data-reim-view"));
      r && viewReimbursement(r);
    });
  });
  $$("[data-reim-export]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = getReimbursement(el.getAttribute("data-reim-export"));
      r && exportFundRequestForm(r);
    });
  });
  $$("[data-reim-edit]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = getReimbursement(el.getAttribute("data-reim-edit"));
      r && reimForm(r);
    });
  });
  $$("[data-reim-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const id = el.getAttribute("data-reim-del");
      const r = getReimbursement(id);
      if (!r) return;
      confirmModal("确定删除报销单 <b>" + esc(r.no || r.title) + "</b>？", function () {
        DB.reimbursements = DB.reimbursements.filter(function (x) { return x.id !== id; });
        saveDB(); renderApp(); toast("报销单已删除");
      });
    });
  });
}

/* 报销明细：票据项 + 补助项 + 合计 */
function reimItemsTableHTML(r) {
  const items = r.items || [];
  if (!items.length) return '<div class="empty" style="padding:18px">这张报销单还没有明细</div>';
  return '<table class="tbl"><thead><tr><th style="width:90px">类别</th><th>项目</th><th style="width:120px">金额</th></tr></thead><tbody>' +
    items.map(function (it) {
      return "<tr><td>" + badge(it.kind || "-", it.kind === "补助" ? "teal" : "blue") + "</td><td>" + esc(it.name) + "</td><td>" + fmtMoney(it.amount) + "</td></tr>";
    }).join("") +
    '<tr><td colspan="2" style="text-align:right"><b>合计</b></td><td><b>' + fmtMoney(sum(items, function (it) { return it.amount; })) + "</b></td></tr>" +
    "</tbody></table>";
}

/* 只读明细弹窗 */
function viewReimbursement(r) {
  const src = reimSourceOf(r);
  openModal({
    title: "报销明细 · " + (r.no || r.title),
    wide: true,
    body:
      '<div class="flex" style="gap:10px;margin-bottom:12px">' +
      badge(r.status, reimStatusColor(r.status)) +
      "<span>报销事项：" + esc(r.title || "-") + "</span>" +
      "<span>申请人：" + esc(r.applicant || "-") + "</span>" +
      "<span>申请日期：" + esc(r.applyDate || "-") + "</span>" +
      (src.go ? badge(src.label, reimSourceColor(src.type)) +
        '<span class="link" data-go="' + src.go + '">查看来源项目</span>' : "") +
      "</div>" +
      reimItemsTableHTML(r) +
      (r.note ? '<div class="hint" style="margin-top:10px">备注：' + esc(r.note) + "</div>" : ""),
    foot: '<button class="btn" data-reim-export-foot>导出资金申请单</button>' +
      '<button class="btn btn-light" data-close>关闭</button>',
    onOpen: function (root) {
      const b = $("[data-reim-export-foot]", root);
      b && b.addEventListener("click", function () { closeModal(); exportFundRequestForm(r); });
    }
  });
}

/* ===================== 资金申请单导出（xlsx） ===================== */

/* 复选框行：选中项打 ☑，其余留 □ —— 与纸质版式一致 */
function checkLine(options, picked) {
  return "   " + options.map(function (o) {
    return (o === picked ? "\u2611" : "\u25a1") + " " + o;
  }).join("        ");
}

/* 组装一张「资金申请单」工作表（版式参照学校模板） */
function buildFundRequestSheet(f) {
  const amount = Number(f.amount) || 0;
  const d = f.date ? String(f.date).split("-") : [];
  const dateLine = d.length === 3
    ? "   " + d[0] + "  \u5e74   " + Number(d[1]) + "  \u6708   " + Number(d[2]) + "  \u65e5         "
    : "  \u5e74    \u6708    \u65e5         ";
  const moneyLine = " \u00a5 " + amount.toFixed(2) + "\u5143";

  return {
    name: "\u8d44\u91d1\u7533\u8bf7\u5355",
    colCount: 6,
    orientation: "landscape",
    cols: [{ min: 1, max: 1, width: 23.7777777777778 }],
    merges: ["A1:F1", "A2:F2", "B3:C3", "E3:F3", "B4:F4", "B5:F5",
      "B6:C6", "E6:F6", "B7:C7", "E7:F7", "B8:E8"],
    rows: [
      { ht: 60, cells: [
        { c: 1, s: 1, v: "\u5929 \u6d25 \u4ec1 \u7231 \u5b66 \u9662 \u8d44 \u91d1 \u7533 \u8bf7 \u5355" },
        { c: 2, s: 0 }, { c: 3, s: 0 }, { c: 4, s: 0 }, { c: 5, s: 0 }, { c: 6, s: 0 }
      ] },
      { cells: [
        { c: 1, s: 2, v: dateLine },
        { c: 2, s: 3 }, { c: 3, s: 3 }, { c: 4, s: 3 }, { c: 5, s: 3 }, { c: 6, s: 3 }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u90e8\u95e8" },
        { c: 2, s: 3, v: f.dept }, { c: 3, s: 3 },
        { c: 4, s: 3, v: "\u7c7b\u522b" },
        { c: 5, s: 3, v: checkLine(["\u501f\u6b3e", "\u62a5\u9500"], f.category) + "  " }, { c: 6, s: 3 }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u652f\u4ed8\u4e8b\u7531" },
        { c: 2, s: 4, v: f.reason },
        { c: 3, s: 3 }, { c: 4, s: 3 }, { c: 5, s: 3 }, { c: 6, s: 3 }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u652f\u4ed8\u65b9\u5f0f" },
        { c: 2, s: 3, v: checkLine(["\u73b0\u91d1", "\u652f\u7968", "\u7535\u6c47", "\u5176\u4ed6"], f.method) },
        { c: 3, s: 3 }, { c: 4, s: 3 }, { c: 5, s: 3 }, { c: 6, s: 3 }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u5408\u540c(\u9879\u76ee)\u7f16\u53f7\u53ca\u540d\u79f0" },
        { c: 2, s: 4, v: f.project }, { c: 3, s: 3 },
        { c: 4, s: 3, v: "\u6536\u6b3e\u5355\u4f4d\u540d\u79f0" },
        { c: 5, s: 3, v: f.payee }, { c: 6, s: 3 }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u6536\u6b3e\u5355\u4f4d\u5f00\u6237\u94f6\u884c" },
        { c: 2, s: 11, v: f.bank }, { c: 3, s: 3 },
        { c: 4, s: 3, v: "\u6536\u6b3e\u5355\u4f4d\u94f6\u884c\u8d26\u53f7" },
        { c: 5, s: 11, v: f.account }, { c: 6, s: 3 }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u91d1\u989d" },
        { c: 2, s: 5, v: rmbUpperLine(amount) },
        { c: 3, s: 3 }, { c: 4, s: 3 }, { c: 5, s: 3 },
        { c: 6, s: 6, v: moneyLine }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u7533\u8bf7\u4eba" }, { c: 2, s: 10, v: f.applicant },
        { c: 3, s: 3, v: "\u90e8\u95e8(\u9879\u76ee)\u8d1f\u8d23\u4eba" }, { c: 4, s: 10 },
        { c: 5, s: 3, v: "\u8d22\u52a1\u5904\u957f" }, { c: 6, s: 10 }
      ] },
      { cells: [
        { c: 1, s: 3, v: "\u4e3b\u7ba1\u6821\u9886\u5bfc" }, { c: 2, s: 10 },
        { c: 3, s: 3, v: "\u8d22\u52a1\u526f\u6821\u957f" }, { c: 4, s: 10 },
        { c: 5, s: 3, v: "\u6821\u957f/\u4e66\u8bb0" }, { c: 6, s: 10 }
      ] }
    ]
  };
}

/* 导出前先给用户核对一次：收款信息等模板里没有的字段需要补填 */
function exportFundRequestForm(r) {
  const src = reimSourceOf(r);
  const so = src.obj;
  const st = DB.settings || {};
  /* 事由与项目名称按来源拼：差旅写「项目名 · 事由」，竞赛与科研写各自的经费口径 */
  const reasonDefault = so
    ? (src.type === "trip" ? so.name + (so.reason ? " · " + so.reason : "")
      : src.type === "project" ? so.name + "科研经费（仪器设备、耗材材料、版面专利与外协差旅）"
        : so.name + "竞赛经费（器件耗材与参赛差旅）")
    : (r.title || "");
  const projectDefault = so
    ? (src.type === "trip" ? so.name + "（" + so.type + "）"
      : src.type === "project" ? so.name + "（" + (so.level || "科研") + "项目" + (so.no ? " · " + so.no : "") + "）"
        : so.name + "（" + (so.level || "学科") + "竞赛）")
    : (r.title || "");
  formModal({
    title: "\u5bfc\u51fa\u8d44\u91d1\u7533\u8bf7\u5355 \u00b7 " + (r.no || r.title),
    wide: true,
    body:
      '<div class="hint" style="margin-bottom:10px">' +
      "\u5c06\u6309\u5b66\u6821\u300a\u8d44\u91d1\u7533\u8bf7\u5355\u300b\u6a21\u677f\u751f\u6210 <b>.xlsx</b> \u6587\u4ef6\uff0c\u91d1\u989d\u5927\u5c0f\u5199\u81ea\u52a8\u586b\u5165\uff1b" +
      "\u6536\u6b3e\u4fe1\u606f\u4f1a\u8bb0\u4f4f\uff0c\u4e0b\u6b21\u5bfc\u51fa\u81ea\u52a8\u5e26\u51fa\u3002</div>" +
      '<div class="form-row">' +
      fieldHTML("\u7533\u8bf7\u65e5\u671f", inputHTML("date", r.applyDate || todayISO(), { type: "date" })) +
      fieldHTML("\u90e8\u95e8", inputHTML("dept", st.dept || st.school || "", { placeholder: "\u5982\uff1a\u6570\u667a\u4f20\u5a92\u4e0e\u8bbe\u8ba1\u827a\u672f\u5b66\u9662" })) +
      fieldHTML("\u7c7b\u522b", selectHTML("category", "\u62a5\u9500", ["\u62a5\u9500", "\u501f\u6b3e"])) +
      "</div>" +
      fieldHTML("\u652f\u4ed8\u4e8b\u7531", textareaHTML("reason", reasonDefault,
        { rows: 2, placeholder: "\u5982\uff1a\u8d75\u67d0\u5e02\u57f9\u8bad\u5dee\u65c5\u8d39 / \u7ade\u8d5b\u5668\u4ef6\u8017\u6750\u91c7\u8d2d" })) +
      fieldHTML("\u652f\u4ed8\u65b9\u5f0f", selectHTML("method", st.payMethod || "\u7535\u6c47", ["\u73b0\u91d1", "\u652f\u7968", "\u7535\u6c47", "\u5176\u4ed6"])) +
      fieldHTML("\u5408\u540c(\u9879\u76ee)\u7f16\u53f7\u53ca\u540d\u79f0", inputHTML("project", projectDefault, { placeholder: "\u53ef\u7559\u7a7a" })) +
      '<div class="form-row">' +
      fieldHTML("\u6536\u6b3e\u5355\u4f4d\u540d\u79f0", inputHTML("payeeName", st.payeeName || "", { placeholder: "\u5982\uff1a\u5929\u6d25\u4ec1\u7231\u5b66\u9662" })) +
      fieldHTML("\u5f00\u6237\u94f6\u884c", inputHTML("payeeBank", st.payeeBank || "", { placeholder: "\u53ef\u7559\u7a7a" })) +
      fieldHTML("\u94f6\u884c\u8d26\u53f7", inputHTML("payeeAccount", st.payeeAccount || "", { placeholder: "\u53ef\u7559\u7a7a" })) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("\u7533\u8bf7\u4eba", inputHTML("applicant", r.applicant || st.teacherName || "")) +
      fieldHTML("\u91d1\u989d\uff08\u5143\uff09", '<div class="form-static">' + fmtMoney(r.amount) +
        '<span class="muted"> · ' + (r.items || []).length + " \u9879\u660e\u7ec6\u5408\u8ba1</span></div>") +
      "</div>",
    onSubmit: function (data) {
      /* 记住收款信息，免得每次重填 */
      DB.settings.payMethod = data.method;
      DB.settings.payeeName = data.payeeName.trim();
      DB.settings.payeeBank = data.payeeBank.trim();
      DB.settings.payeeAccount = data.payeeAccount.trim();
      saveDB();

      const sheet = buildFundRequestSheet({
        date: data.date,
        dept: data.dept.trim(),
        category: data.category,
        reason: data.reason.trim(),
        method: data.method,
        project: data.project.trim(),
        payee: data.payeeName.trim(),
        bank: data.payeeBank.trim(),
        account: data.payeeAccount.trim(),
        applicant: data.applicant.trim(),
        amount: r.amount
      });
      const fname = "\u8d44\u91d1\u7533\u8bf7\u5355_" + (r.no || r.title || "") + "_" + (data.date || todayISO()) + ".xlsx";
      downloadBytes(buildXlsx(sheet), fname,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast("\u8d44\u91d1\u7533\u8bf7\u5355\u5df2\u5bfc\u51fa");
    }
  });
}

/* 编辑报销单：状态流转 + 申请人 / 日期 / 备注；金额由明细合计决定，不可手改 */
function reimForm(r) {
  formModal({
    title: "编辑报销单", wide: true,
    body:
      '<div class="form-row">' +
      fieldHTML("报销单号", '<div class="form-static">' + esc(r.no || "-") + "</div>") +
      fieldHTML("申请人", inputHTML("applicant", r.applicant || (DB.settings && DB.settings.teacherName) || "", { placeholder: "如：李华" })) +
      fieldHTML("申请日期", inputHTML("applyDate", r.applyDate || todayISO(), { type: "date" })) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("状态", selectHTML("status", r.status || "待提交", REIM_STATUS)) +
      fieldHTML("备注", inputHTML("note", r.note || "", { placeholder: "如：财务已受理，预计月底到账" })) +
      "</div>" +
      '<div class="card-title" style="margin:12px 0 6px">报销明细（' + (r.items || []).length + " 项 · 合计 " + fmtMoney(r.amount) + "）</div>" +
      reimItemsTableHTML(r),
    onSubmit: function (data) {
      r.applicant = data.applicant.trim();
      r.applyDate = data.applyDate;
      r.status = data.status;
      r.note = data.note.trim();
      saveDB(); renderApp(); toast("报销单已更新");
    }
  });
}

/* ===================== 生成报销单（差旅 / 竞赛通用） ===================== */

/* 报销明细 = 逐张可报销票据（+ 差旅的两项补助；竞赛无补助） */
function fillReimbursement(r, source, sourceType) {
  const items = [];
  (source.receipts || []).forEach(function (x) {
    if (RECEIPT_BILLABLE.indexOf(x.kind) < 0) return;
    items.push({ name: x.kind + (x.note ? "（" + x.note + "）" : ""), amount: Number(x.amount) || 0, kind: "票据" });
  });
  if (sourceType === "trip") {
    const days = tripDays(source), people = tripPeople(source);
    const tp = tripTransportAllowance(source), ml = tripMealAllowance(source);
    if (tp) items.push({ name: "市内交通补助（" + days + " 天 × " + people + " 人 × " + fmtMoney(tripStd(source).transport) + "）", amount: tp, kind: "补助" });
    if (ml) items.push({ name: "餐费补助（" + days + " 天 × " + people + " 人 × " + fmtMoney(tripStd(source).meal) + "）", amount: ml, kind: "补助" });
  }
  r.items = items;
  r.amount = sum(items, function (it) { return it.amount; });
  r.title = source.name;
  r.applyDate = r.applyDate || todayISO();
}

/* 按来源类型取回项目对象：三处调用点共用，避免 if/else 各写一遍 */
function reimSourceObject(type, id) {
  if (type === "competition") return getCompetition(id);
  if (type === "project") return getProject(id);
  return getTrip(id);
}

/* 为一个来源（差旅 / 竞赛 / 科研项目）生成或刷新报销单 */
function createReimbursement(source, sourceType) {
  if (!source) return;
  const type = sourceType || "trip";
  const existing = (DB.reimbursements || []).find(function (r) {
    return (r.sourceType || (r.tripId ? "trip" : "")) === type && (r.sourceId || r.tripId) === source.id;
  });
  const label = reimTypeLabel(type);
  if (existing) {
    confirmModal("该" + label + "已生成报销单（" + esc(existing.no) + "），是否重新生成？<br><span class='muted'>重新生成将覆盖原有明细与金额。</span>", function () {
      fillReimbursement(existing, source, type);
      existing.sourceType = type;
      existing.sourceId = source.id;
      saveDB(); renderApp(); toast("报销单已更新");
      go("finance");
    });
    return;
  }
  const r = {
    id: uid(),
    no: "BX" + todayISO().replace(/-/g, "") + "-" + ((DB.reimbursements || []).length + 1),
    sourceType: type,
    sourceId: source.id,
    tripId: type === "trip" ? source.id : "",
    title: source.name,
    applicant: (DB.settings && DB.settings.teacherName) || "",
    applyDate: todayISO(),
    status: "待提交",
    items: [],
    amount: 0,
    note: ""
  };
  fillReimbursement(r, source, type);
  DB.reimbursements.push(r);
  saveDB(); renderApp();
  toast("报销单已生成：" + r.no);
  go("finance");
}

/* 来源清单：按类型取可选项目，附可报销金额与「已生成」标记 */
function reimSourceOptions(type) {
  if (type === "project") {
    return (DB.projects || []).map(function (p) {
      const has = (DB.reimbursements || []).some(function (r) {
        return (r.sourceType || (r.tripId ? "trip" : "")) === "project" && (r.sourceId || r.tripId) === p.id;
      });
      return { value: p.id, text: p.name + "（" + (p.level || "项目") + " · " + fmtMoney(projReceiptTotal(p)) + (has ? " · 已生成" : "") + "）" };
    });
  }
  if (type === "competition") {
    return (DB.competitions || []).map(function (c) {
      const has = (DB.reimbursements || []).some(function (r) {
        return (r.sourceType || (r.tripId ? "trip" : "")) === "competition" && (r.sourceId || r.tripId) === c.id;
      });
      return { value: c.id, text: c.name + "（" + (c.level || "竞赛") + " · " + fmtMoney(compReceiptTotal(c)) + (has ? " · 已生成" : "") + "）" };
    });
  }
  return (DB.trips || []).map(function (t) {
    const has = (DB.reimbursements || []).some(function (r) {
      return (r.sourceType || (r.tripId ? "trip" : "")) === "trip" && (r.sourceId || r.tripId) === t.id;
    });
    return { value: t.id, text: t.name + "（" + t.type + " · " + fmtMoney(tripTotal(t)) + (has ? " · 已生成" : "") + "）" };
  });
}

/* 生成报销单：先选来源类型，再选具体项目（两级联动） */
function reimSourceForm() {
  const hasTrip = (DB.trips || []).length > 0;
  const hasComp = (DB.competitions || []).length > 0;
  const hasProj = (DB.projects || []).length > 0;
  if (!hasTrip && !hasComp && !hasProj) {
    toast("请先在「差旅项目」「学科竞赛」或「科研项目」中创建项目");
    return;
  }
  const typeOpts = [];
  if (hasTrip) typeOpts.push({ value: "trip", text: "差旅项目（票据 + 补助）" });
  if (hasComp) typeOpts.push({ value: "competition", text: "学科竞赛（器件耗材 + 参赛差旅）" });
  if (hasProj) typeOpts.push({ value: "project", text: "科研项目（仪器耗材 + 版面专利 + 外协差旅）" });
  const firstType = hasTrip ? "trip" : hasComp ? "competition" : "project";

  /* 三种来源各自的口径说明：补助只有差旅有，采购 / 科研科目一律实报实销 */
  const TIPS = {
    trip: "差旅按<b>票据 + 补助</b>汇总：补助为「人数 × 天数 × 标准」。",
    competition: "竞赛按<b>票据实报实销</b>：先在竞赛详情「经费与票据」上传器件耗材等发票，再生成报销单。",
    project: "科研按<b>票据实报实销</b>：先在科研项目「经费与票据」上传仪器设备、耗材材料、版面费、专利费、外协费等发票，再生成报销单。"
  };

  const overlay = formModal({
    title: "生成报销单",
    body:
      '<div class="hint" style="margin-bottom:10px">差旅项目汇总票据金额与市内交通 / 餐费补助；' +
      "竞赛与科研项目按票据实报实销，不含补助。</div>" +
      '<div class="form-row">' +
      fieldHTML("来源类型", selectHTML("srcType", firstType, typeOpts)) +
      fieldHTML("项目", '<select class="input" name="srcId"></select>') +
      "</div>" +
      '<div class="hint" id="reim-src-tip"></div>',
    onSubmit: function (data) {
      const type = data.srcType;
      const obj = reimSourceObject(type, data.srcId);
      if (!obj) { toast("请选择项目"); return false; }
      createReimbursement(obj, type);
    }
  });

  const typeSel = $("select[name='srcType']", overlay);
  const idSel = $("select[name='srcId']", overlay);
  const tip = $("#reim-src-tip", overlay);
  const refresh = function () {
    const type = typeSel.value;
    const opts = reimSourceOptions(type);
    idSel.innerHTML = opts.length
      ? opts.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.text) + "</option>"; }).join("")
      : '<option value="">暂无项目</option>';
    if (tip) tip.innerHTML = TIPS[type] || "";
  };
  typeSel.addEventListener("change", refresh);
  refresh();
}
