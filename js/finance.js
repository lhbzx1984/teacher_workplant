"use strict";

function renderFinance(view) {
  const statusFilter = window.__reimStatus || "";
  const all = DB.reimbursements || [];
  let list = all.slice().sort(function (a, b) { return (a.applyDate || "") < (b.applyDate || "") ? 1 : -1; });
  if (statusFilter) list = list.filter(function (r) { return r.status === statusFilter; });

  const total = sum(all, function (r) { return r.amount; });
  const doneSum = sum(all.filter(function (r) { return r.status === "已报销"; }), function (r) { return r.amount; });
  const pendingSum = sum(all.filter(function (r) { return r.status === "待提交" || r.status === "审批中"; }), function (r) { return r.amount; });
  const tripCount = (DB.trips || []).filter(function (t) {
    return !all.some(function (r) { return r.tripId === t.id; });
  }).length;

  let h = '<div class="page-head"><div class="page-title">财务报销<small>差旅票据与补助汇总 · 报销单状态跟踪</small></div>' +
    '<div class="toolbar"><button class="btn" id="reim-add">从差旅生成报销单</button></div></div>';

  h += '<div class="grid grid-4" style="margin-bottom:14px">' +
    statCard("报销单", all.length, "张", tripCount ? tripCount + " 个差旅待生成" : "全部差旅已生成") +
    statCard("报销总额", fmtMoney(total), "", "全部报销单合计") +
    statCard("已报销", fmtMoney(doneSum), "", "已到账 / 已办结") +
    statCard("在途金额", fmtMoney(pendingSum), "", "待提交 + 审批中") +
    "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">报销单（' + list.length + "）</div>" +
    '<select class="input" id="reim-status-filter" style="width:130px"><option value="">全部状态</option>' +
    REIM_STATUS.map(function (s) { return '<option value="' + s + '"' + (statusFilter === s ? " selected" : "") + ">" + s + "</option>"; }).join("") +
    "</select></div>";

  if (!list.length) {
    h += '<div class="empty">' + (all.length ? "没有该状态的报销单" : "还没有报销单——到「差旅项目」中点击「生成报销单」，或点击右上角按钮") + "</div>";
  } else {
    h += '<table class="tbl"><thead><tr><th>单号</th><th>报销事项</th><th>关联差旅</th><th>申请人</th><th>申请日期</th>' +
      "<th>金额</th><th>状态</th><th style=\"width:150px\">操作</th></tr></thead><tbody>";
    list.forEach(function (r) {
      const trip = r.tripId ? getTrip(r.tripId) : null;
      h += "<tr><td>" + esc(r.no || "-") + "</td><td><b>" + esc(r.title || "-") + "</b>" +
        (r.note ? '<div class="muted">' + esc(r.note.slice(0, 22)) + (r.note.length > 22 ? "…" : "") + "</div>" : "") + "</td>" +
        "<td>" + (trip ? '<span class="link" data-go="trip/' + trip.id + '">' + esc(trip.name.slice(0, 16)) + (trip.name.length > 16 ? "…" : "") + "</span>" : '<span class="muted">已删除的差旅</span>') + "</td>" +
        "<td>" + esc(r.applicant || "-") + "</td><td>" + esc(r.applyDate || "-") + "</td>" +
        "<td><b>" + fmtMoney(r.amount) + "</b>" + (r.items && r.items.length ? '<div class="muted">' + r.items.length + " 项明细</div>" : "") + "</td>" +
        "<td>" + badge(r.status, reimStatusColor(r.status)) + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-reim-view="' + r.id + '">明细</span>' +
        '<span class="link" data-reim-edit="' + r.id + '">编辑</span>' +
        '<span class="link" data-reim-del="' + r.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  view.innerHTML = h;
  bindFinance(view);
}

function bindFinance(view) {
  const add = $("#reim-add", view);
  add && add.addEventListener("click", reimFromTripForm);

  const sel = $("#reim-status-filter", view);
  sel && sel.addEventListener("change", function () { window.__reimStatus = sel.value; renderApp(); });

  $$("[data-reim-view]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = getReimbursement(el.getAttribute("data-reim-view"));
      r && viewReimbursement(r);
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
  const trip = r.tripId ? getTrip(r.tripId) : null;
  openModal({
    title: "报销明细 · " + (r.no || r.title),
    wide: true,
    body:
      '<div class="flex" style="gap:10px;margin-bottom:12px">' +
      badge(r.status, reimStatusColor(r.status)) +
      "<span>报销事项：" + esc(r.title || "-") + "</span>" +
      "<span>申请人：" + esc(r.applicant || "-") + "</span>" +
      "<span>申请日期：" + esc(r.applyDate || "-") + "</span>" +
      (trip ? '<span class="link" data-go="trip/' + trip.id + '">查看差旅项目</span>' : "") +
      "</div>" +
      reimItemsTableHTML(r) +
      (r.note ? '<div class="hint" style="margin-top:10px">备注：' + esc(r.note) + "</div>" : ""),
    foot: '<button class="btn btn-light" data-close>关闭</button>'
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

/* 从差旅项目生成报销单：已生成过的会提示重新生成 */
function reimFromTripForm() {
  if (!(DB.trips || []).length) {
    toast("请先在「差旅项目」中创建差旅项目");
    return;
  }
  formModal({
    title: "从差旅生成报销单",
    body:
      '<div class="hint" style="margin-bottom:10px">选择差旅项目后，将自动汇总其票据金额与市内交通 / 餐费补助生成报销明细。</div>' +
      fieldHTML("差旅项目", selectHTML("tripId", "", (DB.trips || []).map(function (t) {
        const has = DB.reimbursements.some(function (r) { return r.tripId === t.id; });
        return { value: t.id, text: t.name + "（" + t.type + " · " + fmtMoney(tripTotal(t)) + (has ? " · 已生成" : "") + "）" };
      }))),
    onSubmit: function (data) {
      const trip = getTrip(data.tripId);
      if (!trip) { toast("请选择差旅项目"); return false; }
      createReimbursement(trip);
    }
  });
}
