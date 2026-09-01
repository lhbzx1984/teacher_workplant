"use strict";

const NAV_ITEMS = [
  { group: "总览" },
  { page: "dashboard", title: "仪表盘", id: "dashboard" },
  { group: "业务工作" },
  { page: "courses", title: "课程教学", id: "courses" },
  { page: "students", title: "学生管理", id: "students" },
  { page: "competitions", title: "学科竞赛", id: "competitions" },
  { page: "projects", title: "科研项目", id: "projects" },
  { group: "汇总" },
  { page: "summary", title: "考核汇总", id: "summary" },
  { group: "系统" },
  { page: "settings", title: "学期与设置", id: "settings" }
];

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h) return { page: "dashboard", id: null };
  const parts = h.split("/");
  return { page: parts[0], id: parts[1] || null };
}

function renderNav() {
  const cur = parseHash();
  $("#nav").innerHTML = NAV_ITEMS.map(function (item) {
    if (item.group) return '<div class="nav-group">' + item.group + "</div>";
    return '<div class="nav-item' + (cur.page === item.page ? " active" : "") + '" data-nav="' + item.id + '">' +
      '<span class="nav-dot"></span>' + item.title + "</div>";
  }).join("");
}

function renderTopbar() {
  const titles = {
    dashboard: "仪表盘", courses: "课程教学", students: "班主任学生管理",
    competitions: "学科竞赛", projects: "科研项目", summary: "考核汇总", settings: "学期与设置"
  };
  const cur = parseHash();
  $("#topbar-title").textContent = titles[cur.page] || "教师工作台";

  const term = currentTerm();
  const week = termWeekNow(term);
  const now = new Date();
  const dateStr = (now.getMonth() + 1) + "月" + now.getDate() + "日 周" + "日一二三四五六".charAt(now.getDay());
  $("#topbar-info").innerHTML =
    (term
      ? '<span class="week-pill" title="当前学期与教学周"><i></i>' + esc(term.name) + (week ? " · 第 " + week + " 周" : "") + "</span>"
      : '<span class="week-pill week-pill-alert" title="尚未设置学期，教学周无法计算"><i></i>未设置学期</span>') +
    '<span class="topbar-date">' + dateStr + "</span>";

  const bt = $("#brandTerm");
  if (bt) bt.textContent = term ? term.name : "未设置学期";
}

/* 侧边栏底部教师信息：学校 / 学院 / 教师专业 三行，任一有值才显示 */
function renderSidebarInfo() {
  const box = $("#sidebar-info");
  if (!box) return;
  const s = DB.settings || {};
  const lines = [s.school, s.dept, s.major].filter(function (v) { return v && v.trim(); });
  if (!lines.length) { box.innerHTML = ""; box.style.display = "none"; return; }
  box.style.display = "";
  box.innerHTML = '<div class="sidebar-info">' +
    '<div class="sidebar-info-title">教师信息</div>' +
    [s.school, s.dept, s.major].map(function (v) {
      return '<div class="sidebar-info-line">' + esc((v || "").trim() || "—") + "</div>";
    }).join("") +
    "</div>";
}

function renderApp() {
  const view = $("#view");
  const cur = parseHash();

  renderNav();
  renderTopbar();
  renderSidebarInfo();

  let bindFn = null;
  if (cur.page === "dashboard") { renderDashboard(view); bindFn = bindDashboard; }
  else if (cur.page === "settings") renderSettings(view);
  else if (cur.page === "courses") renderCourses(view);
  else if (cur.page === "course" && cur.id) renderCourseDetail(view, cur.id);
  else if (cur.page === "students") renderStudents(view);
  else if (cur.page === "student" && cur.id) renderStudentDetail(view, cur.id);
  else if (cur.page === "competitions") renderCompetitions(view);
  else if (cur.page === "comp" && cur.id) renderCompDetail(view, cur.id);
  else if (cur.page === "projects") renderProjects(view);
  else if (cur.page === "project" && cur.id) renderProjectDetail(view, cur.id);
  else if (cur.page === "summary") renderSummary(view);
  else { location.hash = "#/dashboard"; return; }

  if (bindFn) bindFn(view);
  view.scrollTop = 0;
}

/* 全局事件委托：所有 data-go 元素统一跳转 */
document.addEventListener("click", function (e) {
  const el = e.target.closest ? e.target.closest("[data-go]") : null;
  if (el) {
    e.stopPropagation();
    go(el.getAttribute("data-go"));
    return;
  }
  const nav = e.target.closest ? e.target.closest("[data-nav]") : null;
  if (nav) {
    go(nav.getAttribute("data-nav"));
    return;
  }
  const quickAdd = e.target.closest ? e.target.closest("[data-action='quick-add']") : null;
  if (quickAdd) { openQuickAdd(); return; }
  const quickGo = e.target.closest ? e.target.closest("[data-quick-go]") : null;
  if (quickGo) { closeModal(); go(quickGo.getAttribute("data-quick-go")); return; }
  const guide = e.target.closest ? e.target.closest("[data-action='guide']") : null;
  if (guide) { openGuide(); return; }
  const backup = e.target.closest ? e.target.closest("[data-action='backup']") : null;
  if (backup) { exportJSONBackup(); }
});

/* 快速录入：六类高频入口，30 秒内完成一次录入 */
function openQuickAdd() {
  const items = [
    ["新增课程", "课程档案 · 名单导入", "courses"],
    ["新增学生", "全局学生档案池", "students"],
    ["记一次谈话", "班主任工作台账", "students"],
    ["登记竞赛成果", "学科竞赛 · 团队与获奖", "competitions"],
    ["记项目节点", "科研进度里程碑", "projects"],
    ["录成绩 / 考勤", "课程教学 · 成绩册", "courses"]
  ];
  openModal({
    title: "快速录入",
    body: '<div class="quick-grid">' + items.map(function (it) {
      return '<button class="quick-item" data-quick-go="' + it[2] + '"><b>' + it[0] + "</b><span>" + it[1] + "</span></button>";
    }).join("") + "</div>"
  });
}

function showWelcomeOnce() {
  if (!DB.__firstRun) return;
  DB.__firstRun = undefined;
  saveDB();
  const overlay = openModal({
    title: "欢迎使用教师工作台",
    body:
      '<div style="font-size:13px;line-height:1.8">' +
      "<p>已为您载入<b>演示数据</b>（示例学期、一门课程、6 名学生、竞赛与科研项目各一），方便您快速了解各模块的功能。</p>" +
      "<p>开始正式使用时，请到 <b>学期与设置 → 数据管理 → 清空全部数据</b>，然后建立自己的学期与学生名单。</p>" +
      '<div class="info-box" style="margin-top:12px">数据保存在<b>本机浏览器</b>中，不上传任何服务器。建议养成定期“导出备份”的习惯。</div>' +
      "</div>",
    foot: '<button class="btn" data-close>开始使用</button>'
  });
  $$("[data-close]", overlay).forEach(function (b) { b.addEventListener("click", function () { go("settings"); }); });
}

function init() {
  loadDB();
  if (!location.hash) location.hash = "#/dashboard";
  renderApp();
  showWelcomeOnce();
}

window.addEventListener("hashchange", renderApp);
init();
