"use strict";

/* 教学日历状态：月偏移量（0=本月）与实时刷新定时器 */
let calOffset = 0;
let calTimer = null;

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

  h += '<div class="card cal-card"><div class="card-head"><div class="card-title">教学日历' +
    '<small style="font-weight:400;margin-left:6px">月视图 · 课程时段与特殊日程 · 已上 / 进行中 / 未上状态随时间自动刷新</small></div></div>' +
    '<div id="cal-box">' + calendarMonthHTML() + "</div></div>";

  h += '<div class="grid grid-2" style="margin-top:14px">';
  h += '<div class="card"><div class="card-head"><div class="card-title">近期待办</div><span class="muted">未来 30 天</span></div><div class="card-body" id="dash-todos">' + todoListHTML() + "</div></div>";
  h += '<div class="card"><div class="card-head"><div class="card-title">本学期课程</div>' +
    (term ? '<button class="btn btn-light btn-sm" data-go="courses">进入管理</button>' : "") +
    "</div>" + (termCourses.length ? courseMiniTable(termCourses) : '<div class="empty" style="padding:26px">' + (term ? "本学期还没有课程" : "请先在“学期与设置”中创建学期") + "</div>") + "</div>";
  h += "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">待跟进台账</div><span class="muted">班主任工作 · 谈话 / 走访后续</span></div>' + followUpListHTML() + "</div>";

  view.innerHTML = h;
}

/* ===================== 教学日历（月视图） ===================== */

function calendarMonthHTML() {
  const term = currentTerm();
  const today = todayISO();

  /* 当前显示月份的第一天（含月偏移） */
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
  const y = first.getFullYear(), m = first.getMonth();
  const pad = function (n) { return String(n).padStart(2, "0"); };
  const firstISO = y + "-" + pad(m + 1) + "-01";
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const lastISO = y + "-" + pad(m + 1) + "-" + pad(daysInMonth);

  /* 月网格从首日所在周的周一开始，行数按月长短自适应（5~6 行） */
  const startISO = mondayOfISO(firstISO);
  const weeks = Math.ceil((isoWeekday(firstISO) - 1 + daysInMonth) / 7);
  const days = [];
  for (let i = 0; i < weeks * 7; i++) days.push(addDaysISO(startISO, i));

  /* 网格覆盖到的教学周范围（只统计在教学周内的日期） */
  let wMin = null, wMax = null;
  days.forEach(function (d) {
    const w = term ? weekNoOfTerm(term, d) : null;
    if (w != null) {
      if (wMin == null || w < wMin) wMin = w;
      if (wMax == null || w > wMax) wMax = w;
    }
  });
  const weekLabel = wMin == null ? "不在教学周内" : "第 " + wMin + (wMax !== wMin ? " – " + wMax : "") + " 教学周";

  let h = '<div class="cal-toolbar">' +
    '<div class="cal-nav">' +
    '<button class="btn btn-light btn-sm" data-cal-prev title="上一月">‹</button>' +
    '<button class="btn btn-light btn-sm" data-cal-now>本月</button>' +
    '<button class="btn btn-light btn-sm" data-cal-next title="下一月">›</button></div>' +
    '<div class="cal-week-label">' + (term ? esc(term.name) + " · " : "") + y + " 年 " + (m + 1) + " 月" +
    '<span class="muted">' + weekLabel + " · " + days[0] + " ~ " + days[days.length - 1] + "</span></div>" +
    '<div class="cal-legend">' +
    '<span class="cal-lg cal-lg-done"><i></i>已上 / 已结束</span>' +
    '<span class="cal-lg cal-lg-ongoing"><i></i>进行中</span>' +
    '<span class="cal-lg cal-lg-todo"><i></i>未上 / 未开始</span>' +
    "</div></div>";

  h += '<div class="cal-grid cal-grid-month">';
  "一二三四五六日".split("").forEach(function (w) { h += '<div class="cal-dow">周' + w + "</div>"; });
  days.forEach(function (d) { h += calDayHTML(d, today, term, firstISO, lastISO); });
  h += "</div>";
  return h;
}

function calDayHTML(dateISO, today, term, monthFirst, monthLast) {
  const d = parseISO(dateISO);
  if (!d) return "";
  const wd = isoWeekday(dateISO);
  const items = calendarItemsOfDate(dateISO, term);
  const isToday = dateISO === today;
  const inMonth = dateISO >= monthFirst && dateISO <= monthLast;
  const inTerm = term ? weekNoOfTerm(term, dateISO) != null : false;
  const weekNo = term ? weekNoOfTerm(term, dateISO) : null;

  let head = '<div class="cal-day-head"><span class="cal-day-num">' + d.getDate() + "</span>";
  if (wd === 1 && weekNo != null) head += '<span class="cal-weekno">第 ' + weekNo + " 周</span>";
  if (isToday) head += '<span class="cal-today-tag">今天</span>';
  head += "</div>";

  let h = '<div class="cal-day' + (inMonth ? "" : " cal-dim") + (isToday ? " cal-today" : "") + (inTerm ? "" : " cal-out") + '">' + head;

  if (!items.length) h += '<div class="cal-empty">—</div>';

  items.forEach(function (it) {
    const st = timeStatus(dateISO, it.start, it.end);
    const timeTxt = it.start ? it.start : "全天";
    const fullTime = it.start ? (it.start + (it.end ? "-" + it.end : "")) : "全天";
    const color = it.kind === "course" ? (it.typeTag === "实验" ? "purple" : "blue") : eventTypeColor(it.typeTag);
    const loc = it.location ? " · " + it.location : "";
    h += '<div class="cal-item tag-' + color + " cal-" + st + '" data-cal-go="' + it.go + '" ' +
      'title="' + esc(it.title) + " " + esc(fullTime) + esc(loc) + '">' +
      '<span class="cal-item-time">' + esc(timeTxt) + "</span>" +
      '<span class="cal-item-title">' + (st === "done" && it.kind === "course" ? "✓ " : "") + esc(it.title) + "</span>" +
      '<i class="cal-tag">' + esc(it.typeTag) + "</i>" +
      (st === "ongoing" ? '<span class="cal-live">进行中</span>' : "") +
      "</div>";
  });

  return h + "</div>";
}

/* 定时刷新：每 30 秒重算状态（已上 / 进行中 / 未上），离开仪表盘自动停止 */
function bindCalendar(view) {
  const box = $("#cal-box", view);
  if (!box) return;

  function refreshCal() {
    const live = document.getElementById("cal-box");
    if (!live) {
      if (calTimer) { clearInterval(calTimer); calTimer = null; }
      return;
    }
    live.innerHTML = calendarMonthHTML();
  }

  box.addEventListener("click", function (e) {
    if (e.target.closest("[data-cal-prev]")) { calOffset--; refreshCal(); }
    else if (e.target.closest("[data-cal-next]")) { calOffset++; refreshCal(); }
    else if (e.target.closest("[data-cal-now]")) { calOffset = 0; refreshCal(); }
    else {
      const it = e.target.closest("[data-cal-go]");
      if (it) go(it.getAttribute("data-cal-go"));
    }
  });

  if (calTimer) clearInterval(calTimer);
  calTimer = setInterval(refreshCal, 30000);
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

  DB.events.forEach(function (ev) {
    const d = daysUntil(ev.date);
    if (d === null || d < 0 || d > 30) return;
    items.push({
      date: ev.date, color: eventTypeColor(ev.type),
      text: "【" + ev.type + "】" + ev.title,
      overdue: false, days: d, go: "settings"
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
  bindCalendar(view);
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
