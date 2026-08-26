"use strict";

function renderDashboard(view) {
  const term = currentTerm();
  const week = termWeekNow(term);
  const s = DB.settings;

  const termCourses = DB.courses.filter(function (c) { return c.termId === (term && term.id); });
  const inResearch = DB.projects.filter(function (p) { return p.status === "在研"; });
  const totalAwards = DB.compResults.length;

  const weekHTML = week
    ? '<span class="badge badge-blue">第 ' + week + ' 教学周</span>'
    : '<span class="badge badge-gray">' + (term ? "未开课或已结课" : "未设置当前学期") + "</span>";

  let h = "";
  h += '<div class="page-head"><div class="page-title">' +
    (s.teacherName ? esc(s.teacherName) + " 老师，" : "") + "欢迎回来<small>今天是 " + todayISO() + "（" + weekdayCN() + "）</small>" +
    "</div>" + weekHTML + "</div>";

  h += '<div class="grid grid-4">' +
    statCard("本学期课程", termCourses.length, "门", "共 " + sum(termCourses, function (c) { return Number(c.theoryHours) + Number(c.labHours); }) + " 学时") +
    statCard("学生总数", DB.students.length, "人", "含选课与班级管理") +
    statCard("在研项目", inResearch.length, "项", "总经费 " + fmtMoney(sum(inResearch, function (p) { return p.fund; }))) +
    statCard("竞赛获奖", totalAwards, "项", "历年累计指导成果") +
    "</div>";

  h += '<div class="grid grid-2" style="margin-top:14px">';
  h += '<div class="card"><div class="card-head"><div class="card-title">近期待办</div><span class="muted">未来 30 天</span></div><div class="card-body" id="dash-todos">' + todoListHTML() + "</div></div>";
  h += '<div class="card"><div class="card-head"><div class="card-title">本学期课程</div>' +
    (term ? '<button class="btn btn-light btn-sm" data-go="courses">进入管理</button>' : "") +
    "</div>" + (termCourses.length ? courseMiniTable(termCourses) : '<div class="empty" style="padding:26px">' + (term ? "本学期还没有课程" : "请先在“学期与设置”中创建学期") + "</div>") + "</div>";
  h += "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">待跟进台账</div><span class="muted">班主任工作 · 谈话 / 走访后续</span></div>' + followUpListHTML() + "</div>";

  view.innerHTML = h;
}

function weekdayCN() {
  return "日一二三四五六".charAt(new Date().getDay());
}

function statCard(label, value, unit, sub) {
  return '<div class="card stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' +
    (value == null ? "-" : value) + '<span class="unit">' + esc(unit || "") + "</span></div>" +
    (sub ? '<div class="stat-sub">' + esc(sub) + "</div>" : "") + "</div>";
}

function todoListHTML() {
  const items = [];

  DB.competitions.forEach(function (c) {
    const d = daysUntil(c.regDeadline);
    if (d !== null && d >= 0 && d <= 30 && c.status !== "已结束") {
      items.push({
        date: c.regDeadline, color: "amber",
        text: "【竞赛报名截止】" + c.name + "（" + c.level + "）",
        overdue: false, days: d, go: "comp/" + c.id
      });
    }
  });

  DB.projects.forEach(function (p) {
    (p.milestones || []).forEach(function (m) {
      if (m.done) return;
      const d = daysUntil(m.date);
      if (d === null || d > 30) return;
      items.push({
        date: m.date, color: "purple",
        text: "【项目节点】" + p.name + " · " + m.name,
        overdue: d < 0, days: d, go: "project/" + p.id
      });
    });
  });

  DB.assignments.forEach(function (a) {
    const d = daysUntil(a.deadline);
    if (d === null || d < 0 || d > 7) return;
    const c = getCourse(a.courseId);
    items.push({
      date: a.deadline, color: "blue",
      text: "【收缴截止】" + (c ? c.name : "课程") + " · " + a.name,
      overdue: false, days: d, go: "course/" + a.courseId
    });
  });

  items.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  if (!items.length) return '<div class="empty" style="padding:26px">未来 30 天没有待办，安心工作</div>';

  return '<div class="timeline">' + items.slice(0, 10).map(function (it) {
    return '<div class="tl-item' + (it.overdue ? " overdue" : "") + '">' +
      '<div class="tl-dot" style="border-color:var(--' + it.color + '-400)"></div>' +
      '<div class="tl-date">' + it.date + (it.overdue ? "（已逾期）" : it.days === 0 ? "（今天）" : "（" + it.days + " 天后）") + "</div>" +
      '<div class="tl-title">' + esc(it.text) + ' <span class="link" data-go="' + it.go + '">查看</span></div>' +
      "</div>";
  }).join("") + "</div>";
}

function followUpListHTML() {
  const pendings = DB.logs.filter(function (l) { return l.followUp && !l.done; });
  if (!pendings.length) return '<div class="empty" style="padding:22px">没有待跟进记录</div>';
  return '<table class="tbl"><thead><tr><th style="width:100px">日期</th><th style="width:80px">类型</th><th>事项</th><th>跟进安排</th><th style="width:70px">操作</th></tr></thead><tbody>' +
    pendings.map(function (l) {
      const names = (l.studentIds || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
      return "<tr><td>" + esc(l.date) + "</td><td>" + badge(l.type, l.type === "谈话" ? "blue" : "green") + "</td>" +
        "<td>" + esc(l.title) + (names ? '<span class="muted">（' + esc(names) + "）</span>" : "") + "</td>" +
        "<td>" + esc(l.followUp) + "</td>" +
        '<td><span class="link" data-log-done="' + l.id + '">完成</span></td></tr>';
    }).join("") + "</tbody></table>";
}

function courseMiniTable(courses) {
  const term = currentTerm();
  return '<table class="tbl"><thead><tr><th>课程</th><th>班级</th><th>性质</th><th>学时（理论/实验）</th><th>名单</th></tr></thead><tbody>' +
    courses.map(function (c) {
      return '<tr class="clickable" data-go="course/' + c.id + '"><td><b>' + esc(c.name) + '</b> <span class="muted">' + esc(c.no) + "</span></td>" +
        "<td>" + esc(c.className || "-") + "</td><td>" + badge(c.nature, "blue") + "</td>" +
        "<td>" + (c.theoryHours || 0) + " / " + (c.labHours || 0) + "</td>" +
        "<td>" + (c.roster || []).length + " 人</td></tr>";
    }).join("") + "</tbody></table>";
}

function bindDashboard(view) {
  $$("[data-log-done]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const log = DB.logs.find(function (l) { return l.id === el.getAttribute("data-log-done"); });
      if (!log) return;
      log.done = true;
      saveDB();
      toast("已标记完成");
      renderApp();
    });
  });
}
