"use strict";

function yearOfDate(d) {
  const s = String(d || "");
  if (s.length < 7) return new Date().getFullYear();
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!y) return new Date().getFullYear();
  return m >= 8 ? y : y - 1;
}

function academicYearRange(yearStart) {
  return { start: yearStart + "-08-01", end: (yearStart + 1) + "-07-31", label: yearStart + "-" + (yearStart + 1) + " 学年" };
}

function collectYears() {
  const years = {};
  DB.terms.forEach(function (t) { years[yearOfDate(t.startDate)] = true; });
  ["logs", "awards", "compResults", "outputs", "expenses"].forEach(function (k) {
    DB[k].forEach(function (r) { years[yearOfDate(r.date)] = true; });
  });
  return Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
}

function renderSummary(view) {
  const years = collectYears();
  const curYear = currentTerm() ? yearOfDate(currentTerm().startDate) : yearOfDate(todayISO());
  if (!years.length) years.push(curYear);
  const selYear = window.__sumYear || (years.indexOf(curYear) >= 0 ? curYear : years[0]);
  const range = academicYearRange(selYear);

  const inRange = function (d) { return d && d >= range.start && d <= range.end; };

  const terms = DB.terms.filter(function (t) {
    return t.startDate >= range.start && t.startDate <= range.end;
  });
  const termIds = terms.map(function (t) { return t.id; });
  const courses = DB.courses.filter(function (c) { return termIds.indexOf(c.termId) >= 0; });

  const logs = DB.logs.filter(function (l) { return inRange(l.date); });
  const awards = DB.awards.filter(function (a) { return inRange(a.date); });
  const compResults = DB.compResults.filter(function (r) { return inRange(r.date); });
  const outputs = DB.outputs.filter(function (o) { return inRange(o.date); });
  const projects = DB.projects.filter(function (p) {
    return (p.startDate >= range.start && p.startDate <= range.end) || (p.status === "在研" && p.startDate <= range.end);
  });
  const expenses = DB.expenses.filter(function (e) { return inRange(e.date); });

  const s = DB.settings;
  const courseHours = sum(courses, function (c) { return Number(c.theoryHours) + Number(c.labHours); });
  const studentCount = {};
  courses.forEach(function (c) { (c.roster || []).forEach(function (id) { studentCount[id] = 1; }); });

  let h = '<div class="page-head"><div class="page-title">考核汇总<small>一次录入，处处复用——年度考核与职称材料的数据底座</small></div>' +
    '<div class="toolbar"><select class="input" id="sum-year" style="width:180px">' +
    years.map(function (y) { return '<option value="' + y + '"' + (y === selYear ? " selected" : "") + ">" + y + "-" + (y + 1) + " 学年</option>"; }).join("") +
    '</select><button class="btn btn-light" id="sum-print">打印 / 导出 PDF</button></div></div>';

  h += '<div class="info-box">统计范围：<b>' + range.label + '</b>（' + range.start + " 至 " + range.end + "）" +
    (s.teacherName ? " · " + esc(s.teacherName) + (s.dept ? "（" + esc(s.dept) + "）" : "") : "") + "</div>";

  h += '<div class="grid grid-4">' +
    statCard("教学工作量", courseHours, "学时", courses.length + " 门课程 · " + Object.keys(studentCount).length + " 名学生") +
    statCard("班主任台账", logs.length, "条", "谈话 " + logs.filter(function (l) { return l.type === "谈话"; }).length + " 次") +
    statCard("竞赛指导获奖", compResults.length, "项", compResults.filter(function (r) { const c = getCompetition(r.competitionId); return c && c.level === "国家级"; }).length + " 项国家级") +
    statCard("科研业绩", outputs.length, "项", projects.length + " 个项目（在研/新立项）") +
    "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">一、教学工作</div></div>';
  if (!courses.length) {
    h += '<div class="empty" style="padding:20px">该学年暂无课程记录</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>学期</th><th>课程</th><th>班级</th><th>性质</th><th>学分</th><th>理论学时</th><th>实验学时</th><th>名单人数</th></tr></thead><tbody>';
    courses.forEach(function (c) {
      const t = getTerm(c.termId);
      h += "<tr><td>" + esc(t ? t.name : "-") + "</td><td><b>" + esc(c.name) + "</b> <span class='muted'>" + esc(c.no || "") + "</span></td>" +
        "<td>" + esc(c.className || "-") + "</td><td>" + esc(c.nature || "-") + "</td><td>" + esc(c.credits || "-") + "</td>" +
        "<td>" + (c.theoryHours || 0) + "</td><td>" + (c.labHours || 0) + "</td><td>" + (c.roster || []).length + "</td></tr>";
    });
    h += '<tr><td colspan="5"><b>合计</b></td><td><b>' + sum(courses, function (c) { return c.theoryHours; }) + "</b></td>" +
      "<td><b>" + sum(courses, function (c) { return c.labHours; }) + "</b></td><td><b>" + courseHours + ' 学时</b></td></tr></tbody></table>';
  }
  h += "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">二、班主任工作</div></div><div class="card-body"><div class="flex">';
  const logTypes = ["谈话", "走访宿舍", "班会", "活动"];
  logTypes.forEach(function (t) {
    const n = logs.filter(function (l) { return l.type === t; }).length;
    h += '<div class="stat" style="flex:1;border:1px solid var(--border);border-radius:10px;margin-right:6px"><div class="stat-label">' + t + "</div>" +
      '<div class="stat-value" style="font-size:20px">' + n + '<span class="unit">次</span></div></div>';
  });
  h += "</div>";
  if (awards.length) {
    h += '<div class="section-title">学生评奖评优（' + awards.length + "）</div><table class='tbl'><tbody>";
    awards.forEach(function (a) {
      const st = getStudent(a.studentId);
      h += "<tr><td style='width:100px'>" + esc(a.date) + "</td><td>" + esc(st ? st.name : "-") + "</td><td><b>" + esc(a.name) + "</b></td><td>" + levelBadge(a.level) + "</td></tr>";
    });
    h += "</tbody></table>";
  }
  h += "</div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">三、竞赛指导成果</div></div>';
  if (!compResults.length) {
    h += '<div class="empty" style="padding:20px">该学年暂无获奖记录</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th style="width:100px">日期</th><th>竞赛</th><th>级别</th><th>获奖</th><th>团队/学生</th><th>证书编号</th></tr></thead><tbody>';
    compResults.sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (r) {
      const c = getCompetition(r.competitionId);
      const names = (r.studentIds || []).map(function (id) { const st = getStudent(id); return st ? st.name : ""; }).filter(Boolean).join("、");
      h += "<tr><td>" + esc(r.date) + "</td><td><b>" + esc(c ? c.name : "-") + "</b></td><td>" + levelBadge(c ? c.level : "") + "</td>" +
        "<td>" + badge(r.level, "amber") + "</td><td>" + esc(r.teamName) + '<div class="muted">' + esc(names) + "</div></td><td>" + esc(r.certNo || "-") + "</td></tr>";
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">四、科研业绩</div></div>';
  if (!projects.length && !outputs.length) {
    h += '<div class="empty" style="padding:20px">该学年暂无科研记录</div>';
  } else {
    if (projects.length) {
      h += '<div class="section-title" style="padding:14px 18px 0">科研项目</div><table class="tbl"><thead><tr><th>项目名称</th><th>编号</th><th>级别</th><th>角色</th><th>经费</th><th>状态</th></tr></thead><tbody>';
      projects.forEach(function (p) {
        h += "<tr><td><b>" + esc(p.name) + "</b></td><td>" + esc(p.no || "-") + "</td><td>" + levelBadge(p.level) + "</td>" +
          "<td>" + esc(p.role) + "</td><td>" + fmtMoney(p.fund) + "</td><td>" + statusBadge(p.status) + "</td></tr>";
      });
      h += "</tbody></table>";
    }
    if (outputs.length) {
      h += '<div class="section-title" style="padding:14px 18px 0">研究成果</div><table class="tbl"><thead><tr><th>类型</th><th>标题</th><th>期刊/编号</th><th>作者</th><th>日期</th></tr></thead><tbody>';
      outputs.sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (o) {
        h += "<tr><td>" + badge(o.type, o.type === "论文" ? "blue" : "purple") + "</td><td><b>" + esc(o.title) + "</b>" + (o.note ? '<div class="muted">' + esc(o.note) + "</div>" : "") + "</td>" +
          "<td>" + esc(o.venue || o.no || "-") + "</td><td>" + esc(o.authors || "-") + "</td><td>" + esc(o.date) + "</td></tr>";
      });
      h += "</tbody></table>";
    }
    if (expenses.length) {
      h += '<div class="section-title" style="padding:14px 18px 0">科研经费支出</div><div class="card-body hint">该学年支出合计：<b>' + fmtMoney(sum(expenses, function (e) { return e.amount; })) + "</b>（" + expenses.length + " 笔）</div>";
    }
  }
  h += "</div>";

  view.innerHTML = h;

  $("#sum-year", view).addEventListener("change", function (e) {
    window.__sumYear = Number(e.target.value);
    renderApp();
  });
  $("#sum-print", view).addEventListener("click", function () { window.print(); });
}
