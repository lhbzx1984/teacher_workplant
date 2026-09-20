"use strict";

let tripTab = "info";

const TRIP_TABS = [["info", "概览"], ["members", "差旅人员"], ["receipts", "票据与附件"], ["allowance", "补助与汇总"]];
const TRIP_TITLES = ["教授", "副教授", "讲师", "助教", "研究员", "其他"];

/* ===================== 列表 ===================== */

function renderTrips(view) {
  const typeFilter = window.__tripType || "";
  const statusFilter = window.__tripStatus || "";
  let list = (DB.trips || []).slice().sort(function (a, b) { return (a.startDate || "") < (b.startDate || "") ? 1 : -1; });
  if (typeFilter) list = list.filter(function (t) { return t.type === typeFilter; });
  if (statusFilter) list = list.filter(function (t) { return t.status === statusFilter; });

  const ongoing = (DB.trips || []).filter(function (t) { return t.status !== "已完成"; }).length;
  const totalCost = sum(DB.trips || [], function (t) { return tripTotal(t); });
  const reimTotal = sum(DB.reimbursements || [], function (r) { return r.amount; });

  let h = '<div class="page-head"><div class="page-title">差旅项目<small>新建项目 · 差旅人员 · 票据上传 · 补助自动核算 · 财务报销</small></div>' +
    '<div class="toolbar"><button class="btn" id="trip-add">新建差旅项目</button></div></div>';

  h += '<div class="grid grid-4" style="margin-bottom:14px">' +
    statCard("差旅项目", (DB.trips || []).length, "个", "含已结束项目") +
    statCard("未结束", ongoing, "个", "计划中 / 进行中") +
    statCard("差旅总费用", fmtMoney(totalCost), "", "票据金额 + 补助") +
    statCard("已报销", fmtMoney(reimTotal), "", "财务报销单合计") +
    "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">差旅项目台账（' + list.length + "）</div>" +
    '<span class="flex" style="gap:8px">' +
    '<select class="input" id="trip-type-filter" style="width:152px"><option value="">全部类型</option>' +
    TRIP_TYPES.map(function (t) { return '<option value="' + t + '"' + (typeFilter === t ? " selected" : "") + ">" + t + "</option>"; }).join("") +
    "</select>" +
    '<select class="input" id="trip-status-filter" style="width:130px"><option value="">全部状态</option>' +
    TRIP_STATUS.map(function (s) { return '<option value="' + s + '"' + (statusFilter === s ? " selected" : "") + ">" + s + "</option>"; }).join("") +
    "</select></span></div>";

  if (!list.length) {
    h += '<div class="empty">' + ((DB.trips || []).length ? "没有符合筛选条件的差旅项目" : "还没有差旅项目——点击右上角「新建差旅项目」开始") + "</div>";
  } else {
    h += '<table class="tbl"><thead><tr><th>项目名称</th><th>类型</th><th>地点</th><th>起止时间</th>' +
      '<th style="width:56px">天数</th><th style="width:56px">人数</th><th>费用合计</th><th>状态</th><th style="width:110px">操作</th></tr></thead><tbody>';
    list.forEach(function (t) {
      const reason = t.reason || "";
      h += '<tr class="clickable" data-go="trip/' + t.id + '"><td><b>' + esc(t.name) + "</b>" +
        (reason ? '<div class="muted">' + esc(reason.slice(0, 26)) + (reason.length > 26 ? "…" : "") + "</div>" : "") + "</td>" +
        "<td>" + badge(t.type, tripTypeColor(t.type)) + "</td><td>" + esc(t.place || "-") + "</td>" +
        "<td>" + esc(t.startDate || "-") + " ~ " + esc(t.endDate || "-") + "</td>" +
        "<td>" + tripDays(t) + "</td><td>" + ((t.members || []).length) + "</td>" +
        "<td>" + fmtMoney(tripTotal(t)) + '<div class="muted">票 ' + fmtMoney(tripReceiptTotal(t)) + " + 补 " + fmtMoney(tripAllowanceTotal(t)) + "</div></td>" +
        "<td>" + statusBadge(t.status) + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-trip-edit="' + t.id + '">编辑</span>' +
        '<span class="link" data-trip-del="' + t.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  view.innerHTML = h;
  bindTrips(view);
}

function bindTrips(view) {
  const add = $("#trip-add", view);
  add && add.addEventListener("click", function () { tripForm(null); });

  const typeSel = $("#trip-type-filter", view);
  typeSel && typeSel.addEventListener("change", function () { window.__tripType = typeSel.value; renderApp(); });
  const stSel = $("#trip-status-filter", view);
  stSel && stSel.addEventListener("change", function () { window.__tripStatus = stSel.value; renderApp(); });

  $$("[data-trip-edit]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const t = getTrip(el.getAttribute("data-trip-edit"));
      t && tripForm(t);
    });
  });
  $$("[data-trip-del]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const id = el.getAttribute("data-trip-del");
      const t = getTrip(id);
      if (!t) return;
      confirmModal("确定删除差旅项目 <b>" + esc(t.name) + "</b>？<br><span style='color:var(--red-600)'>人员、票据与补助记录将一并删除。</span>", function () {
        DB.trips = DB.trips.filter(function (x) { return x.id !== id; });
        DB.reimbursements = DB.reimbursements.filter(function (r) { return r.tripId !== id; });
        saveDB(); renderApp(); toast("差旅项目已删除");
      });
    });
  });
}

/* ===================== 详情 ===================== */

function renderTripDetail(view, id) {
  const trip = getTrip(id);
  if (!trip) { view.innerHTML = emptyHTML("差旅项目不存在或已被删除"); return; }
  tripTab = TRIP_TABS.some(function (t) { return t[0] === tripTab; }) ? tripTab : "info";

  let h = '<div class="page-head"><div class="page-title">' + esc(trip.name) +
    '<small>' + esc(trip.type) + " · " + esc(trip.place || "未填地点") + " · " + esc(trip.startDate || "?") + " ~ " + esc(trip.endDate || "?") + "</small></div>" +
    '<div class="toolbar"><button class="btn btn-light btn-sm" data-go="trips">返回列表</button>' +
    '<button class="btn btn-light btn-sm" id="trip-edit">编辑项目</button>' +
    '<button class="btn btn-sm" id="trip-reim">生成报销单</button></div></div>';

  h += '<div class="tabs">' + TRIP_TABS.map(function (t) {
    return '<div class="tab' + (tripTab === t[0] ? " active" : "") + '" data-trip-tab="' + t[0] + '">' + t[1] +
      (t[0] === "members" && (trip.members || []).length ? " " + (trip.members || []).length : "") +
      (t[0] === "receipts" && (trip.receipts || []).length ? " " + (trip.receipts || []).length : "") +
      "</div>";
  }).join("") + "</div>";

  h += '<div id="trip-tab-body">' + tripTabBodyHTML(trip) + "</div>";
  view.innerHTML = h;
  bindTripDetail(view, trip);
}

function tripTabBodyHTML(trip) {
  if (tripTab === "members") return tripMembersHTML(trip);
  if (tripTab === "receipts") return tripReceiptsHTML(trip);
  if (tripTab === "allowance") return tripAllowanceHTML(trip);
  return tripInfoHTML(trip);
}

function tripInfoHTML(trip) {
  const days = tripDays(trip);
  const people = tripPeople(trip);
  let h = '<div class="grid grid-4">' +
    statCard("票据金额", fmtMoney(tripReceiptTotal(trip)), "", (trip.receipts || []).length + " 张票据 / 附件") +
    statCard("市内交通补助", fmtMoney(tripTransportAllowance(trip)), "", days + " 天 × " + people + " 人 × " + fmtMoney(trip.allowance.transport)) +
    statCard("餐费补助", fmtMoney(tripMealAllowance(trip)), "", days + " 天 × " + people + " 人 × " + fmtMoney(trip.allowance.meal)) +
    statCard("费用合计", fmtMoney(tripTotal(trip)), "", "票据 + 补助") +
    "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">项目信息</div>' + statusBadge(trip.status) + "</div>" +
    '<table class="tbl"><tbody>' +
    "<tr><th style=\"width:120px\">项目类型</th><td>" + badge(trip.type, tripTypeColor(trip.type)) + "</td></tr>" +
    "<tr><th>出差地点</th><td>" + esc(trip.place || "-") + "</td></tr>" +
    "<tr><th>差旅时间</th><td>" + esc(trip.startDate || "-") + " ~ " + esc(trip.endDate || "-") +
    ' <span class="muted">（共 ' + days + " 天，含首尾两天）</span></td></tr>" +
    "<tr><th>出差事由</th><td>" + esc(trip.reason || "-") + "</td></tr>" +
    "<tr><th>差旅人员</th><td>" + ((trip.members || []).length
      ? (trip.members || []).map(function (m) { return esc(m.name) + '<span class="muted">（' + esc(m.title || "—") + "）</span>"; }).join("、")
      : '<span class="muted">尚未添加人员，补助暂按 1 人计算</span>') + "</td></tr>" +
    "<tr><th>备注</th><td>" + esc(trip.note || "-") + "</td></tr>" +
    "</tbody></table></div>";
  return h;
}

function tripMembersHTML(trip) {
  const list = trip.members || [];
  let h = '<div class="card"><div class="card-head"><div class="card-title">差旅人员（' + list.length + "）</div>" +
    '<button class="btn btn-sm" id="member-add">添加人员</button></div>';
  if (!list.length) {
    h += '<div class="empty">还没有差旅人员——添加人员后，补助将按「人数 × 天数」自动核算</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>工号</th><th>姓名</th><th>学院</th><th>专业</th><th>职称</th><th>电话</th><th style="width:110px">操作</th></tr></thead><tbody>';
    list.forEach(function (m) {
      h += "<tr><td>" + esc(m.staffNo || "-") + "</td><td><b>" + esc(m.name) + "</b></td><td>" + esc(m.dept || "-") + "</td>" +
        "<td>" + esc(m.major || "-") + "</td><td>" + badge(m.title || "-", "gray") + "</td><td>" + esc(m.phone || "-") + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-member-edit="' + m.id + '">编辑</span>' +
        '<span class="link" data-member-del="' + m.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";
  return h;
}

function tripReceiptsHTML(trip) {
  const list = trip.receipts || [];
  let h = '<div class="card"><div class="card-head"><div class="card-title">票据与附件（' + list.length + "）</div>" +
    '<button class="btn btn-sm" id="receipt-upload">上传票据</button></div>' +
    '<div class="hint" style="margin:0 0 10px;padding:0 18px">支持图片（JPG/PNG，自动压缩）与 PDF 文件；火车票、飞机票、住宿票据请填写金额，会议邀请函等仅作佐证材料不计入金额。</div>';
  if (!list.length) {
    h += '<div class="empty">还没有票据——点击「上传票据」添加火车票、飞机票、住宿票据或会议邀请函</div>';
  } else {
    h += '<div class="rcpt-grid">';
    list.forEach(function (r) {
      const billable = RECEIPT_BILLABLE.indexOf(r.kind) >= 0;
      const isPDF = /pdf/i.test(r.fileType || "") || /\.pdf$/i.test(r.fileName || "");
      h += '<div class="rcpt-card">' +
        '<div class="rcpt-thumb' + (isPDF ? " rcpt-pdf" : "") + '" data-rcpt-view="' + r.id + '">' +
        (isPDF ? '<span class="rcpt-pdf-tag">PDF</span>' : '<img src="' + r.dataUrl + '" alt="' + esc(r.fileName || "") + '">') +
        "</div>" +
        '<div class="rcpt-meta">' +
        '<div class="rcpt-kind">' + badge(r.kind, billable ? tripReceiptColor(r.kind) : "gray") + "</div>" +
        '<div class="rcpt-name" title="' + esc(r.fileName || "") + '">' + esc(r.fileName || "未命名文件") + "</div>" +
        '<div class="rcpt-sub">' + (billable ? fmtMoney(r.amount) : "佐证材料") + (r.date ? " · " + esc(r.date) : "") + "</div>" +
        (r.note ? '<div class="rcpt-sub">' + esc(r.note) + "</div>" : "") +
        "</div>" +
        '<div class="rcpt-ops">' +
        '<span class="link" data-rcpt-edit="' + r.id + '">编辑</span>' +
        '<span class="link" data-rcpt-del="' + r.id + '">删除</span>' +
        "</div></div>";
    });
    h += "</div>";
  }
  h += "</div>";
  return h;
}

function tripReceiptColor(kind) {
  if (kind === "火车票" || kind === "飞机票") return "blue";
  if (kind === "住宿票据") return "purple";
  if (kind === "市内交通票据" || kind === "餐饮票据") return "teal";
  if (kind === "会议邀请函") return "amber";
  return "gray";
}

function tripAllowanceHTML(trip) {
  const days = tripDays(trip);
  const people = tripPeople(trip);
  const tp = Number(trip.allowance && trip.allowance.transport);
  const ml = Number(trip.allowance && trip.allowance.meal);
  const tStd = isNaN(tp) ? ALLOWANCE_TRANSPORT : tp;
  const mStd = isNaN(ml) ? ALLOWANCE_MEAL : ml;

  let h = '<div class="card"><div class="card-head"><div class="card-title">补助核算</div>' +
    '<span class="muted">按「人数 × 天数 × 标准」自动计算</span></div>' +
    '<table class="tbl"><thead><tr><th>项目</th><th>标准（元 / 人 · 天）</th><th>人数</th><th>天数</th><th>小计</th></tr></thead><tbody>' +
    "<tr><td>市内交通补助</td><td>" + fmtMoney(tStd) + "</td><td>" + people + "</td><td>" + days + "</td><td><b>" + fmtMoney(tripTransportAllowance(trip)) + "</b></td></tr>" +
    "<tr><td>餐费补助</td><td>" + fmtMoney(mStd) + "</td><td>" + people + "</td><td>" + days + "</td><td><b>" + fmtMoney(tripMealAllowance(trip)) + "</b></td></tr>" +
    '<tr><td colspan="4" style="text-align:right"><b>补助合计</b></td><td><b>' + fmtMoney(tripAllowanceTotal(trip)) + "</b></td></tr>" +
    "</tbody></table>" +
    '<div class="form-row" style="padding:0 18px 14px">' +
    fieldHTML("市内交通标准（元/天）", '<input class="input" id="allow-transport" type="number" min="0" step="10" value="' + tStd + '">') +
    fieldHTML("餐费标准（元/天）", '<input class="input" id="allow-meal" type="number" min="0" step="10" value="' + mStd + '">') +
    '<div class="field"><label>&nbsp;</label><button class="btn btn-light" id="allow-save">保存标准</button></div>' +
    "</div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">费用汇总</div>' +
    '<button class="btn btn-sm" id="trip-reim-2">生成报销单</button></div>' +
    '<table class="tbl"><tbody>' +
    "<tr><th style=\"width:140px\">票据金额</th><td>" + fmtMoney(tripReceiptTotal(trip)) + "</td></tr>" +
    "<tr><th>市内交通补助</th><td>" + fmtMoney(tripTransportAllowance(trip)) + "</td></tr>" +
    "<tr><th>餐费补助</th><td>" + fmtMoney(tripMealAllowance(trip)) + "</td></tr>" +
    '<tr><th>合计</th><td><b style="font-size:15px">' + fmtMoney(tripTotal(trip)) + "</b></td></tr>" +
    "</tbody></table></div>";
  return h;
}

function bindTripDetail(view, trip) {
  $$("[data-trip-tab]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      tripTab = el.getAttribute("data-trip-tab");
      renderApp();
    });
  });

  const edit = $("#trip-edit", view);
  edit && edit.addEventListener("click", function () { tripForm(trip); });

  /* 人员 */
  const mAdd = $("#member-add", view);
  mAdd && mAdd.addEventListener("click", function () { memberForm(trip, null); });
  $$("[data-member-edit]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const m = (trip.members || []).find(function (x) { return x.id === el.getAttribute("data-member-edit"); });
      m && memberForm(trip, m);
    });
  });
  $$("[data-member-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const mid = el.getAttribute("data-member-del");
      trip.members = (trip.members || []).filter(function (x) { return x.id !== mid; });
      saveDB(); renderApp(); toast("人员已移除");
    });
  });

  /* 票据 */
  const up = $("#receipt-upload", view);
  up && up.addEventListener("click", function () { pickReceiptFiles(trip); });
  $$("[data-rcpt-view]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = (trip.receipts || []).find(function (x) { return x.id === el.getAttribute("data-rcpt-view"); });
      r && viewReceipt(r);
    });
  });
  $$("[data-rcpt-edit]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = (trip.receipts || []).find(function (x) { return x.id === el.getAttribute("data-rcpt-edit"); });
      r && receiptForm(trip, r);
    });
  });
  $$("[data-rcpt-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const rid = el.getAttribute("data-rcpt-del");
      confirmModal("确定删除这张票据？删除后无法恢复。", function () {
        trip.receipts = (trip.receipts || []).filter(function (x) { return x.id !== rid; });
        saveDB(); renderApp(); toast("票据已删除");
      });
    });
  });

  /* 补助标准保存 */
  const aSave = $("#allow-save", view);
  aSave && aSave.addEventListener("click", function () {
    const t = Number($("#allow-transport", view).value);
    const m = Number($("#allow-meal", view).value);
    trip.allowance = { transport: isNaN(t) || t < 0 ? ALLOWANCE_TRANSPORT : t, meal: isNaN(m) || m < 0 ? ALLOWANCE_MEAL : m };
    saveDB(); renderApp(); toast("补助标准已保存");
  });

  /* 生成报销单 */
  $$("#trip-reim, #trip-reim-2", view).forEach(function (el) {
    el.addEventListener("click", function () { createReimbursement(trip); });
  });
}

/* ===================== 表单：项目 / 人员 / 票据 ===================== */

function tripForm(trip) {
  formModal({
    title: trip ? "编辑差旅项目" : "新建差旅项目", wide: true,
    body:
      fieldHTML("项目名称", inputHTML("name", trip ? trip.name : "", { placeholder: "如：2026 年暑期访企拓岗（长三角）" }), true) +
      '<div class="form-row">' +
      fieldHTML("项目类型", selectHTML("type", trip ? trip.type : "师资培训", TRIP_TYPES), true) +
      fieldHTML("出差地点", inputHTML("place", trip ? trip.place : "", { placeholder: "如：江苏 南京" })) +
      fieldHTML("状态", selectHTML("status", trip ? trip.status : "计划中", TRIP_STATUS)) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("开始日期", inputHTML("startDate", trip ? trip.startDate : todayISO(), { type: "date" }), true) +
      fieldHTML("结束日期", inputHTML("endDate", trip ? trip.endDate : todayISO(), { type: "date" }), true) +
      "</div>" +
      fieldHTML("出差事由", textareaHTML("reason", trip ? trip.reason : "", { rows: 3, placeholder: "如：走访 3 家合作企业，洽谈实习基地与就业岗位" })) +
      fieldHTML("备注", inputHTML("note", trip ? trip.note : "", { placeholder: "选填" })),
    validate: function (data) {
      if (!data.name.trim()) { toast("请填写项目名称"); return false; }
      if (!data.startDate || !data.endDate) { toast("请填写差旅起止日期"); return false; }
      if (data.endDate < data.startDate) { toast("结束日期不能早于开始日期"); return false; }
    },
    onSubmit: function (data) {
      const payload = {
        name: data.name.trim(), type: data.type, place: data.place.trim(), status: data.status,
        startDate: data.startDate, endDate: data.endDate,
        reason: data.reason.trim(), note: data.note.trim()
      };
      if (trip) {
        Object.assign(trip, payload);
        toast("差旅项目已更新");
      } else {
        DB.trips.push(Object.assign({
          id: uid(), members: [], receipts: [],
          allowance: { transport: ALLOWANCE_TRANSPORT, meal: ALLOWANCE_MEAL }
        }, payload));
        toast("差旅项目已创建，请添加人员与票据");
      }
      saveDB(); renderApp();
    }
  });
}

function memberForm(trip, member) {
  formModal({
    title: member ? "编辑差旅人员" : "添加差旅人员", wide: true,
    body:
      '<div class="form-row">' +
      fieldHTML("工号", inputHTML("staffNo", member ? member.staffNo : "", { placeholder: "如：2021086" }), true) +
      fieldHTML("姓名", inputHTML("name", member ? member.name : "", { placeholder: "如：张明" }), true) +
      fieldHTML("职称", selectHTML("title", member ? member.title : "讲师", TRIP_TITLES, { allowEmpty: true, emptyText: "未填写" })) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("学院", inputHTML("dept", member ? member.dept : (DB.settings && DB.settings.dept) || "", { placeholder: "如：数智传媒与设计艺术学院" })) +
      fieldHTML("专业", inputHTML("major", member ? member.major : (DB.settings && DB.settings.major) || "", { placeholder: "如：智能交互设计" })) +
      fieldHTML("电话", inputHTML("phone", member ? member.phone : "", { placeholder: "如：13800000000" })) +
      "</div>",
    validate: function (data) {
      if (!data.name.trim()) { toast("请填写姓名"); return false; }
      if (!data.staffNo.trim()) { toast("请填写工号"); return false; }
    },
    onSubmit: function (data) {
      const payload = {
        staffNo: data.staffNo.trim(), name: data.name.trim(), dept: data.dept.trim(),
        major: data.major.trim(), title: data.title, phone: data.phone.trim()
      };
      if (!trip.members) trip.members = [];
      if (member) {
        Object.assign(member, payload);
        toast("人员信息已更新");
      } else {
        trip.members.push(Object.assign({ id: uid() }, payload));
        toast("人员已添加，补助将按人数重新核算");
      }
      saveDB(); renderApp();
    }
  });
}

/* 选择票据文件 → 读取（图片压缩 / PDF 原样）→ 批量填写票据信息 */
function pickReceiptFiles(trip) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.multiple = true;
  inp.accept = "image/*,application/pdf";
  inp.addEventListener("change", function () {
    const files = Array.prototype.slice.call(inp.files || []);
    if (!files.length) return;
    const tooBig = files.filter(function (f) { return f.size > 4 * 1024 * 1024; });
    if (tooBig.length) { toast("「" + tooBig[0].name + "」超过 4MB，请压缩后再上传"); return; }
    toast("正在读取 " + files.length + " 个文件…");
    const jobs = files.map(function (f) {
      return new Promise(function (resolve) {
        if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          readAsDataURL(f, function (url) { resolve({ file: f, dataUrl: url }); });
        } else {
          compressImageFile(f, 1600, 0.72, function (url) { resolve({ file: f, dataUrl: url }); });
        }
      });
    });
    Promise.all(jobs).then(function (list) { receiptBatchForm(trip, list); });
  });
  inp.click();
}

function readAsDataURL(file, cb) {
  const reader = new FileReader();
  reader.onload = function () { cb(reader.result); };
  reader.onerror = function () { toast("读取失败：" + file.name); cb(""); };
  reader.readAsDataURL(file);
}

/* 图片压缩：等比缩放到最大边 maxSide，JPEG 质量 quality；失败或异常时回退原图 */
function compressImageFile(file, maxSide, quality, cb) {
  readAsDataURL(file, function (url) {
    if (!url) { cb(""); return; }
    const img = new Image();
    img.onload = function () {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL("image/jpeg", quality));
      } catch (e) { cb(url); }
    };
    img.onerror = function () { cb(url); };
    img.src = url;
  });
}

/* 批量票据信息：一次为每个文件填写类型 / 金额 / 日期 */
function receiptBatchForm(trip, list) {
  const rows = list.filter(function (x) { return x.dataUrl; });
  if (!rows.length) { toast("没有可保存的文件"); return; }

  const overlay = formModal({
    title: "票据信息（共 " + rows.length + " 个文件）", wide: true,
    body:
      '<div class="hint" style="margin-bottom:10px">请为每个文件选择票据类型并填写金额；会议邀请函与其他附件不计入报销金额。</div>' +
      '<table class="tbl"><thead><tr><th style="width:32px">#</th><th>文件</th><th style="width:150px">票据类型</th>' +
      '<th style="width:110px">金额（元）</th><th style="width:150px">日期</th><th>备注</th></tr></thead><tbody>' +
      rows.map(function (x, i) {
        return '<tr><td>' + (i + 1) + '</td><td><div class="rcpt-mini-name" title="' + esc(x.file.name) + '">' + esc(x.file.name) + "</div>" +
          '<div class="muted">' + fmtSize(x.file.size) + "</div></td>" +
          "<td>" + selectHTML("kind_" + i, "火车票", RECEIPT_KINDS) + "</td>" +
          '<td><input class="input" name="amount_' + i + '" type="number" min="0" step="0.01" placeholder="0.00"></td>' +
          '<td><input class="input" name="date_' + i + '" type="date" value="' + todayISO() + '"></td>' +
          '<td><input class="input" name="note_' + i + '" placeholder="选填"></td></tr>';
      }).join("") + "</tbody></table>",
    onSubmit: function (data) {
      if (!trip.receipts) trip.receipts = [];
      rows.forEach(function (x, i) {
        trip.receipts.push({
          id: uid(),
          kind: data["kind_" + i] || "其他附件",
          amount: Number(data["amount_" + i]) || 0,
          date: data["date_" + i] || "",
          note: (data["note_" + i] || "").trim(),
          fileName: x.file.name,
          fileType: x.file.type || (/pdf$/i.test(x.file.name) ? "application/pdf" : "image/jpeg"),
          fileSize: x.file.size,
          dataUrl: x.dataUrl
        });
      });
      saveDB(); renderApp();
      toast("已添加 " + rows.length + " 个票据 / 附件");
    }
  });

  /* 选择「会议邀请函」等佐证类型时自动禁用金额输入 */
  $$("select[name^='kind_']", overlay).forEach(function (sel) {
    const idx = sel.name.slice(5);
    const amount = $("input[name='amount_" + idx + "']", overlay);
    const sync = function () {
      const billable = RECEIPT_BILLABLE.indexOf(sel.value) >= 0;
      amount.disabled = !billable;
      amount.placeholder = billable ? "0.00" : "不计金额";
      if (!billable) amount.value = "";
    };
    sel.addEventListener("change", sync);
    sync();
  });
}

function receiptForm(trip, receipt) {
  const overlay = formModal({
    title: "编辑票据信息", wide: true,
    body:
      '<div class="form-row">' +
      fieldHTML("票据类型", selectHTML("kind", receipt.kind, RECEIPT_KINDS), true) +
      fieldHTML("金额（元）", inputHTML("amount", receipt.amount, { type: "number", attrs: ' min="0" step="0.01"' })) +
      fieldHTML("日期", inputHTML("date", receipt.date || todayISO(), { type: "date" })) +
      "</div>" +
      fieldHTML("备注", inputHTML("note", receipt.note || "", { placeholder: "如：去程高铁 G1234" })) +
      '<div class="hint" style="margin-top:8px">文件：' + esc(receipt.fileName || "未命名") + "（" + fmtSize(receipt.fileSize) + "）</div>",
    onSubmit: function (data) {
      Object.assign(receipt, {
        kind: data.kind,
        amount: Number(data.amount) || 0,
        date: data.date,
        note: data.note.trim()
      });
      saveDB(); renderApp(); toast("票据信息已更新");
    }
  });
  const sel = $("select[name='kind']", overlay);
  const amount = $("input[name='amount']", overlay);
  const sync = function () {
    const billable = RECEIPT_BILLABLE.indexOf(sel.value) >= 0;
    amount.disabled = !billable;
    amount.placeholder = billable ? "0.00" : "不计金额";
  };
  sel && sel.addEventListener("change", sync);
  sel && sync();
}

/* 票据预览：图片直接显示，PDF 用内嵌框架（不支持内嵌时提供新窗口打开） */
function viewReceipt(r) {
  const isPDF = /pdf/i.test(r.fileType || "") || /\.pdf$/i.test(r.fileName || "");
  const body = isPDF
    ? '<iframe src="' + r.dataUrl + '" style="width:100%;height:64vh;border:1px solid var(--line);border-radius:8px"></iframe>' +
      '<div class="hint" style="margin-top:8px">若浏览器无法内嵌预览，请 <a href="' + r.dataUrl + '" target="_blank" rel="noopener">点击在新窗口打开</a>。</div>'
    : '<div style="text-align:center"><img src="' + r.dataUrl + '" style="max-width:100%;max-height:64vh;border:1px solid var(--line);border-radius:8px"></div>';

  openModal({
    title: (r.kind || "票据") + " · " + (r.fileName || ""),
    wide: true,
    body: body +
      '<div style="margin-top:10px;font-size:13px">' +
      "金额：" + (RECEIPT_BILLABLE.indexOf(r.kind) >= 0 ? fmtMoney(r.amount) : "佐证材料（不计金额）") +
      (r.date ? " · 日期：" + esc(r.date) : "") + (r.note ? " · " + esc(r.note) : "") + "</div>",
    foot: '<button class="btn btn-light" data-close>关闭</button>' +
      '<a class="btn" href="' + r.dataUrl + '" download="' + esc(r.fileName || "票据") + '">下载</a>'
  });
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

/* ===================== 生成报销单 ===================== */

function createReimbursement(trip) {
  const existing = DB.reimbursements.find(function (r) { return r.tripId === trip.id; });
  if (existing) {
    confirmModal("该差旅项目已生成报销单（" + esc(existing.no) + "），是否重新生成？<br><span class='muted'>重新生成将覆盖原有明细与金额。</span>", function () {
      fillReimbursement(existing, trip);
      saveDB(); renderApp(); toast("报销单已更新");
      go("finance");
    });
    return;
  }
  const r = {
    id: uid(),
    no: "BX" + todayISO().replace(/-/g, "") + "-" + (DB.reimbursements.length + 1),
    tripId: trip.id,
    title: trip.name,
    applicant: (DB.settings && DB.settings.teacherName) || "",
    applyDate: todayISO(),
    status: "待提交",
    items: [],
    amount: 0,
    note: ""
  };
  fillReimbursement(r, trip);
  DB.reimbursements.push(r);
  saveDB(); renderApp();
  toast("报销单已生成：" + r.no);
  go("finance");
}

/* 报销明细 = 逐张可报销票据 + 市内交通补助 + 餐费补助 */
function fillReimbursement(r, trip) {
  const items = [];
  (trip.receipts || []).forEach(function (x) {
    if (RECEIPT_BILLABLE.indexOf(x.kind) < 0) return;
    items.push({ name: x.kind + (x.note ? "（" + x.note + "）" : ""), amount: Number(x.amount) || 0, kind: "票据" });
  });
  const days = tripDays(trip), people = tripPeople(trip);
  const tp = tripTransportAllowance(trip), ml = tripMealAllowance(trip);
  if (tp) items.push({ name: "市内交通补助（" + days + " 天 × " + people + " 人 × " + fmtMoney(trip.allowance.transport) + "）", amount: tp, kind: "补助" });
  if (ml) items.push({ name: "餐费补助（" + days + " 天 × " + people + " 人 × " + fmtMoney(trip.allowance.meal) + "）", amount: ml, kind: "补助" });
  r.items = items;
  r.amount = sum(items, function (it) { return it.amount; });
  r.title = trip.name;
  r.applyDate = r.applyDate || todayISO();
}
