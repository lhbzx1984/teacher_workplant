"use strict";

let compTab = "info";

const COMP_LEVELS = ["国家级", "省级", "市厅级", "校级"];
const COMP_STATUS = ["报名中", "备赛中", "初赛", "决赛", "已结束"];

function renderCompetitions(view) {
  const list = DB.competitions.slice().sort(function (a, b) {
    return (a.regDeadline || "") < (b.regDeadline || "") ? -1 : 1;
  });

  let h = '<div class="page-head"><div class="page-title">学科竞赛<small>竞赛库 · 参赛团队 · 备赛进度 · 获奖成果</small></div>' +
    '<div class="toolbar"><button class="btn" id="comp-add">新增竞赛</button></div></div>';

  if (!list.length) {
    h += '<div class="card"><div class="empty">还没有竞赛项目，把常带的赛事先录入进来</div></div>';
  } else {
    h += '<div class="card"><table class="tbl"><thead><tr><th>竞赛名称</th><th>级别</th><th>报名截止</th><th>决赛时间</th><th>状态</th><th>团队</th><th>获奖</th><th style="width:110px">操作</th></tr></thead><tbody>';
    list.forEach(function (c) {
      const teams = DB.teams.filter(function (t) { return t.competitionId === c.id; });
      const results = DB.compResults.filter(function (r) { return r.competitionId === c.id; });
      const d = daysUntil(c.regDeadline);
      const regHint = d !== null && d >= 0 && d <= 14 && c.status !== "已结束" ? badge(d === 0 ? "今天截止" : d + " 天后截止", "red") : "";
      h += '<tr class="clickable" data-go="comp/' + c.id + '"><td><b>' + esc(c.name) + '</b> <span class="muted">' + esc(c.organizer || "") + "</span></td>" +
        "<td>" + levelBadge(c.level) + "</td>" +
        "<td>" + esc(c.regDeadline || "-") + " " + regHint + "</td><td>" + esc(c.finalDate || "-") + "</td>" +
        "<td>" + statusBadge(c.status) + "</td><td>" + teams.length + "</td><td>" + results.length + "</td>" +
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
      fieldHTML("备注", textareaHTML("note", comp ? comp.note : "", { rows: 2, placeholder: "如：个人赛，每生限报一个组别" })),
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写竞赛名称"); return false; }
      if (!data.regDeadline) { toast("请选择报名截止日期"); return false; }
      const payload = {
        name: data.name.trim(), level: data.level, status: data.status,
        organizer: data.organizer.trim(), regDeadline: data.regDeadline,
        finalDate: data.finalDate, website: data.website.trim(), note: data.note.trim()
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
      confirmModal("确定删除竞赛 <b>" + esc(c.name) + "</b>？" +
        (n ? "<br><span style='color:var(--red-600)'>该赛事下有 " + n + " 条团队/获奖记录，将一并删除。</span>" : ""), function () {
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

  const teams = DB.teams.filter(function (t) { return t.competitionId === c.id; });
  const results = DB.compResults.filter(function (r) { return r.competitionId === c.id; });

  let h = '<div class="page-head"><div class="flex"><span class="link" data-go="competitions" style="margin-right:4px">学科竞赛</span><span class="muted">/</span>' +
    '<div class="page-title">' + esc(c.name) + "<small>" + levelBadge(c.level) + " " + statusBadge(c.status) + "</small></div></div>" +
    '<div class="toolbar">' + (c.website ? '<a class="btn btn-light" href="' + esc(c.website) + '" target="_blank">打开官网</a>' : "") +
    '<button class="btn btn-light" data-comp-edit="' + c.id + '">编辑</button></div></div>';

  const regD = daysUntil(c.regDeadline);
  const finD = daysUntil(c.finalDate);
  h += '<div class="card"><div class="card-body"><div class="kv">' +
    "<div class='k'>主办单位</div><div>" + esc(c.organizer || "-") + "</div>" +
    "<div class='k'>报名截止</div><div>" + esc(c.regDeadline || "-") +
    (regD !== null && regD >= 0 && c.status !== "已结束" ? "（" + (regD === 0 ? "今天" : regD + " 天后") + "）" : "") + "</div>" +
    "<div class='k'>决赛时间</div><div>" + esc(c.finalDate || "-") +
    (finD !== null && finD >= 0 ? "（" + (finD === 0 ? "今天" : finD + " 天后") + "）" : "") + "</div>" +
    "<div class='k'>备注</div><div>" + esc(c.note || "-") + "</div>" +
    "</div></div></div>";

  h += '<div class="grid grid-2">';
  h += '<div class="card"><div class="card-head"><div class="card-title">参赛团队（' + teams.length + "）</div>" +
    '<button class="btn btn-sm" id="team-add">新建团队</button></div>';
  if (!teams.length) h += '<div class="empty" style="padding:22px">还没有组队</div>';
  else {
    h += '<table class="tbl"><thead><tr><th>团队</th><th>成员</th><th>赛道</th><th>状态</th><th style="width:90px">操作</th></tr></thead><tbody>';
    teams.forEach(function (t) {
      const names = (t.members || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
      h += "<tr><td><b>" + esc(t.name) + "</b></td><td>" + esc(names || "-") + "</td><td>" + esc(t.entryRole || "-") + "</td><td>" + statusBadge(t.status) + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-team-edit="' + t.id + '">编辑</span><span class="link" data-team-del="' + t.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">获奖成果（' + results.length + "）</div>" +
    '<button class="btn btn-sm" id="result-add">登记获奖</button></div>';
  if (!results.length) h += '<div class="empty" style="padding:22px">暂无获奖记录</div>';
  else {
    h += '<table class="tbl"><thead><tr><th style="width:96px">日期</th><th>获奖</th><th>学生</th><th>证书编号</th><th style="width:60px">操作</th></tr></thead><tbody>';
    results.forEach(function (r) {
      const names = (r.studentIds || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
      h += "<tr><td>" + esc(r.date) + "</td><td><b>" + esc(r.teamName) + "</b> " + badge(r.level, "amber") + "</td>" +
        "<td>" + esc(names) + "</td><td>" + esc(r.certNo || "-") + "</td>" +
        '<td><span class="link" data-result-del="' + r.id + '">删除</span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div></div>";

  view.innerHTML = h;
  bindCompDetail(view, c);
}

function bindCompDetail(view, c) {
  const editBtn = $("[data-comp-edit]", view);
  editBtn && editBtn.addEventListener("click", function () { competitionForm(c); });

  $("#team-add", view).addEventListener("click", function () { teamForm(c, null); });
  $$("[data-team-edit]", view).forEach(function (el) { el.addEventListener("click", function () { teamForm(c, DB.teams.find(function (t) { return t.id === el.getAttribute("data-team-edit"); })); }); });
  $$("[data-team-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除该团队？", function () {
        DB.teams = DB.teams.filter(function (t) { return t.id !== el.getAttribute("data-team-del"); });
        saveDB(); toast("团队已删除"); renderApp();
      });
    });
  });

  $("#result-add", view).addEventListener("click", function () { resultForm(c, null); });
  $$("[data-result-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除该获奖记录？", function () {
        DB.compResults = DB.compResults.filter(function (r) { return r.id !== el.getAttribute("data-result-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });
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
