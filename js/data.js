"use strict";

const DB_KEY = "teacher_workbench_v1";
let DB = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultDB() {
  return {
    meta: { version: 1, createdAt: new Date().toISOString() },
    settings: { teacherName: "", teacherNo: "", dept: "" },
    terms: [],
    students: [],
    courses: [],
    attendance: [],
    grades: [],
    assignments: [],
    logs: [],
    awards: [],
    competitions: [],
    teams: [],
    compResults: [],
    projects: [],
    outputs: [],
    expenses: [],
    events: []
  };
}

/* 课程考核方式选项 */
const EXAM_TYPES = ["闭卷考试", "开卷考试", "考查", "论文/报告", "机试", "其他"];

function examTypeOf(course) {
  return (course && course.examType) || "闭卷考试";
}

/* 旧数据迁移：补齐课程缺失字段（slots / examType） */
function normalizeCourses() {
  (DB.courses || []).forEach(function (c) {
    if (!c.slots) c.slots = [];
    if (!c.examType) c.examType = "闭卷考试";
  });
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      DB = JSON.parse(raw);
      const def = defaultDB();
      for (const k of Object.keys(def)) {
        if (DB[k] === undefined) DB[k] = def[k];
      }
      normalizeCourses();
    } else {
      DB = seedDemo();
      saveDB();
      DB.__firstRun = true;
    }
  } catch (e) {
    console.error("数据加载失败，已重置", e);
    DB = defaultDB();
  }
  return DB;
}

function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  } catch (e) {
    toast("保存失败：本地存储空间不足");
    console.error(e);
  }
}

function resetDB(empty) {
  DB = empty ? defaultDB() : seedDemo();
  saveDB();
}

/* ===================== 学期与日期 ===================== */

function currentTerm() {
  return DB.terms.find(function (t) { return t.current; }) || null;
}

function getTerm(id) {
  return DB.terms.find(function (t) { return t.id === id; }) || null;
}

function parseISO(s) {
  const p = String(s || "").split("-");
  if (p.length !== 3) return null;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return isNaN(d.getTime()) ? null : d;
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function daysUntil(dateStr) {
  const d = parseISO(dateStr);
  if (!d) return null;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - base) / 86400000);
}

function weekNoOfTerm(term, dateISO) {
  if (!term || !term.startDate || !dateISO) return null;
  const start = parseISO(term.startDate);
  const d = parseISO(dateISO);
  if (!start || !d) return null;
  const diff = Math.floor((d - start) / 86400000);
  if (diff < 0) return null;
  const week = Math.floor(diff / 7) + 1;
  return week > Number(term.weeks || 20) ? null : week;
}

function termWeekNow(term) {
  return weekNoOfTerm(term || currentTerm(), todayISO());
}

/* ===================== 教学日历 ===================== */

/* ISO 星期：1=周一 … 7=周日 */
function isoWeekday(dateISO) {
  const d = parseISO(dateISO);
  if (!d) return null;
  return d.getDay() === 0 ? 7 : d.getDay();
}

function addDaysISO(dateISO, n) {
  const d = parseISO(dateISO);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* 所在周的周一 */
function mondayOfISO(dateISO) {
  const wd = isoWeekday(dateISO);
  if (wd == null) return null;
  return addDaysISO(dateISO, 1 - wd);
}

/* "HH:MM" → 当日分钟数，非法返回 null */
function parseHM(t) {
  const p = String(t || "").trim().split(":");
  if (p.length !== 2) return null;
  const h = Number(p[0]), m = Number(p[1]);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/* 时间状态："done"=已结束/已上，"ongoing"=进行中，"todo"=未开始/未上 */
function timeStatus(dateISO, start, end) {
  if (!dateISO) return "todo";
  const today = todayISO();
  if (dateISO < today) return "done";
  if (dateISO > today) return "todo";
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const s = parseHM(start), e = parseHM(end);
  if (s != null && nowMin < s) return "todo";
  if (e != null && nowMin > e) return "done";
  return "ongoing";
}

function courseSlotsOf(course) {
  return (course && Array.isArray(course.slots)) ? course.slots : [];
}

/* 授课时段可读标签：周一 08:00-09:40（理论） */
function slotLabel(slot) {
  const day = Number(slot.day);
  const dayCN = "一二三四五六日".charAt((day >= 1 && day <= 7 ? day : 1) - 1);
  return "周" + dayCN + " " + (slot.start || "?") + (slot.end ? "-" + slot.end : "") + "（" + (slot.type || "理论") + "）";
}

/* 某一天的日历条目：当前学期课程时段（按周几匹配）+ 特殊日程，按开始时间排序 */
function calendarItemsOfDate(dateISO, term) {
  const items = [];
  const wd = isoWeekday(dateISO);
  (DB.courses || []).forEach(function (c) {
    if (term && c.termId !== term.id) return;
    courseSlotsOf(c).forEach(function (s) {
      if (Number(s.day) !== wd) return;
      items.push({
        kind: "course", ref: c, title: c.name, typeTag: s.type || "理论",
        start: s.start || "", end: s.end || "", go: "course/" + c.id
      });
    });
  });
  (DB.events || []).forEach(function (ev) {
    if (ev.date !== dateISO) return;
    items.push({
      kind: "event", ref: ev, title: ev.title, typeTag: ev.type,
      start: ev.start || "", end: ev.end || "", location: ev.location || "",
      go: "settings"
    });
  });
  items.sort(function (a, b) { return (parseHM(a.start) || 0) - (parseHM(b.start) || 0); });
  return items;
}

const EVENT_TYPES = ["监考", "毕业答辩", "课程答辩", "特殊事件"];
const EVENT_TYPE_COLOR = { "监考": "amber", "毕业答辩": "purple", "课程答辩": "blue", "特殊事件": "red" };

function eventTypeColor(type) {
  return EVENT_TYPE_COLOR[type] || "gray";
}

function getEvent(id) {
  return (DB.events || []).find(function (e) { return e.id === id; }) || null;
}

/* ===================== 查询助手 ===================== */

function getStudent(id) { return DB.students.find(function (s) { return s.id === id; }) || null; }
function getCourse(id) { return DB.courses.find(function (c) { return c.id === id; }) || null; }
function getCompetition(id) { return DB.competitions.find(function (c) { return c.id === id; }) || null; }
function getProject(id) { return DB.projects.find(function (p) { return p.id === id; }) || null; }

function courseStudents(courseId) {
  const c = getCourse(courseId);
  if (!c) return [];
  return (c.roster || []).map(getStudent).filter(Boolean);
}

function studentCourses(studentId) {
  return DB.courses.filter(function (c) { return (c.roster || []).indexOf(studentId) >= 0; });
}

function totalScore(g, weights) {
  if (!g) return null;
  const w = weights || { regular: 30, midterm: 20, final: 50 };
  const parts = [];
  if (g.regular !== "" && g.regular != null && !isNaN(Number(g.regular))) parts.push([Number(g.regular), w.regular]);
  if (g.midterm !== "" && g.midterm != null && !isNaN(Number(g.midterm))) parts.push([Number(g.midterm), w.midterm]);
  if (g.final !== "" && g.final != null && !isNaN(Number(g.final))) parts.push([Number(g.final), w.final]);
  if (!parts.length) return null;
  let sum = 0, wsum = 0;
  parts.forEach(function (p) { sum += p[0] * p[1]; wsum += p[1]; });
  return wsum ? Math.round(sum / wsum * 10) / 10 : null;
}

function fmtMoney(n) {
  if (n == null || isNaN(Number(n))) return "-";
  return "¥" + Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function sum(arr, fn) {
  return arr.reduce(function (a, b) { return a + (fn ? Number(fn(b)) || 0 : Number(b) || 0); }, 0);
}

/* ===================== 备份与恢复 ===================== */

function exportJSONBackup() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "教师工作台备份_" + todayISO() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("备份文件已导出");
}

function importJSONBackup(file, done) {
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(reader.result);
      if (!data.settings) throw new Error("格式不符");
      if (!data.meta || !data.terms) throw new Error("这不是工作台备份文件");
      DB = data;
      const def = defaultDB();
      for (const k of Object.keys(def)) if (DB[k] === undefined) DB[k] = def[k];
      normalizeCourses();
      saveDB();
      toast("数据已恢复");
      done && done();
    } catch (e) {
      toast("恢复失败：" + (e.message || "文件解析错误"));
    }
  };
  reader.readAsText(file, "utf-8");
}

/* ===================== 学生名单导入 ===================== */

const STUDENT_COL_MAP = {
  "学号": "no", "考生号": "no", "编号": "no",
  "姓名": "name",
  "性别": "gender",
  "班级": "className", "行政班": "className", "班": "className",
  "宿舍": "dorm", "寝室": "dorm",
  "电话": "phone", "手机": "phone", "联系方式": "phone", "联系电话": "phone",
  "生源地": "hometown", "籍贯": "hometown", "来源": "hometown",
  "家庭情况": "family", "备注": "notes"
};

function parseStudentsTable(rows) {
  if (!rows.length) return { students: [], headers: [] };
  const headers = rows[0].map(function (h) { return String(h || "").trim(); });
  const colIdx = {};
  headers.forEach(function (h, i) {
    const key = STUDENT_COL_MAP[h];
    if (key && colIdx[key] === undefined) colIdx[key] = i;
  });
  if (colIdx.name === undefined) {
    for (let i = 0; i < headers.length; i++) {
      if (/姓名|名字/.test(headers[i])) { colIdx.name = i; break; }
    }
  }
  if (colIdx.name === undefined) return { error: "未找到“姓名”列，请确认第一行是表头且包含“学号、姓名”等列名" };
  const students = [];
  rows.slice(1).forEach(function (r) {
    const get = function (k) { return colIdx[k] === undefined ? "" : String(r[colIdx[k]] == null ? "" : r[colIdx[k]]).trim(); };
    const name = get("name");
    if (!name) return;
    students.push({
      id: uid(), no: get("no"), name: name, gender: get("gender"),
      className: get("className"), dorm: get("dorm"), phone: get("phone"),
      hometown: get("hometown"), family: get("family"), notes: get("notes"), tags: []
    });
  });
  if (!students.length) return { error: "没有解析到有效的学生行" };
  return { students: students };
}

function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(true);
  return new Promise(function (resolve, reject) {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = function () { resolve(true); };
    s.onerror = function () { reject(new Error("联网加载 Excel 解析库失败，可改用“粘贴表格”方式导入")); };
    document.head.appendChild(s);
  });
}

function parseExcelFile(file, cb) {
  loadSheetJS().then(function () {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        cb(parseStudentsTable(rows));
      } catch (err) {
        cb({ error: "文件解析失败：" + err.message });
      }
    };
    reader.readAsArrayBuffer(file);
  }).catch(function (err) { cb({ error: err.message }); });
}

function parsePastedText(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim() !== ""; });
  const rows = lines.map(function (l) { return l.split("\t"); });
  return parseStudentsTable(rows);
}

/* ===================== 演示数据 ===================== */

function seedDemo() {
  const db = defaultDB();
  db.settings = { teacherName: "李明", teacherNo: "20100856", dept: "计算机学院" };

  const termId = uid();
  db.terms.push({
    id: termId, name: "2026-2027学年 第一学期", startDate: "2026-08-24", weeks: 18, current: true
  });

  const names = [
    ["2023030101", "张子昂", "男", "计科2301", "松园3栋412", "13803740001", "浙江杭州", ""],
    ["2023030102", "王雨桐", "女", "计科2301", "兰园2栋508", "13903740002", "江苏南京", "家庭经济困难"],
    ["2023030103", "刘一舟", "男", "计科2301", "松园3栋413", "13703740003", "河南郑州", ""],
    ["2023030104", "陈思远", "男", "计科2301", "松园3栋415", "13603740004", "广东深圳", ""],
    ["2023030105", "赵婉清", "女", "计科2301", "兰园2栋510", "13503740005", "四川成都", ""],
    ["2023030106", "孙浩然", "男", "计科2301", "松园3栋416", "13403740006", "湖北武汉", "心理关注"]
  ];
  const ids = [];
  names.forEach(function (n, i) {
    const id = uid();
    ids.push(id);
    db.students.push({
      id: id, no: n[0], name: n[1], gender: n[2], className: n[3], dorm: n[4],
      phone: n[5], hometown: n[6], family: n[7], notes: "",
      tags: n[7].indexOf("困难") >= 0 ? ["资助"] : (n[7] ? ["重点关注"] : [])
    });
  });

  const courseId = uid();
  db.courses.push({
    id: courseId, termId: termId, no: "CS2103", name: "数据结构", nature: "必修",
    credits: 3.5, theoryHours: 48, labHours: 16, className: "计科2301",
    examType: "闭卷考试",
    weights: { regular: 30, midterm: 20, final: 50 },
    roster: ids.slice(), progress: "",
    slots: [
      { type: "理论", day: 1, start: "08:00", end: "09:40" },
      { type: "实验", day: 3, start: "10:00", end: "11:40" },
      { type: "理论", day: 5, start: "14:00", end: "15:40" }
    ]
  });

  db.events.push(
    { id: uid(), type: "特殊事件", title: "学院教学委员会例会", date: "2026-09-03", start: "16:00", end: "17:30", location: "行政楼302", courseId: "", note: "讨论本学期教学检查安排" },
    { id: uid(), type: "监考", title: "全国计算机等级考试监考", date: "2026-09-12", start: "09:00", end: "11:30", location: "教学楼B201", courseId: "", note: "提前 30 分钟到考务办领卷" },
    { id: uid(), type: "课程答辩", title: "数据结构课程设计答辩", date: "2026-09-25", start: "14:00", end: "17:30", location: "实验楼508", courseId: courseId, note: "6 名学生分两组答辩" },
    { id: uid(), type: "特殊事件", title: "国庆节放假", date: "2026-10-01", start: "", end: "", location: "", courseId: "", note: "10月1日至8日" },
    { id: uid(), type: "毕业答辩", title: "2027届毕业设计（论文）中期答辩", date: "2026-11-21", start: "08:30", end: "12:00", location: "实验楼405", courseId: "", note: "答辩小组 5 人，需提前提交评审表" }
  );

  ids.forEach(function (sid, i) {
    db.grades.push({
      courseId: courseId, studentId: sid,
      regular: [86, 78, 92, 65, 88, 54][i],
      midterm: [82, 74, 90, 58, 85, 47][i],
      final: ""
    });
  });

  db.attendance.push({
    id: uid(), courseId: courseId, date: "2026-08-25", week: 1, type: "理论",
    records: (function () { const r = {}; ids.forEach(function (s, i) { r[s] = i === 5 ? "旷" : "出"; }); return r; })()
  });

  db.assignments.push({
    id: uid(), courseId: courseId, name: "实验一：顺序表与链表", type: "实验报告",
    deadline: "2026-08-30", scores: {}
  });

  db.logs.push({
    id: uid(), date: "2026-08-20", type: "谈话", studentIds: [ids[5]],
    title: "开学以来状态低迷约谈", content: "针对开学两周三次旷课、作业未交情况进行约谈，学生反映近一个月睡眠不佳。已与家长电话沟通，约定两周后回访。",
    followUp: "10月上旬回访睡眠与出勤情况", done: false
  });

  const compId1 = uid(), compId2 = uid();
  db.competitions.push({
    id: compId1, name: "蓝桥杯全国软件和信息技术专业人才大赛", level: "省级",
    organizer: "工业和信息化部人才交流中心", website: "https://www.lanqiao.cn",
    regDeadline: "2026-09-10", finalDate: "2027-04-15", status: "备赛中", note: "个人赛，每生限报一个组别"
  });
  db.competitions.push({
    id: compId2, name: "中国国际大学生创新大赛", level: "国家级",
    organizer: "教育部等部委", website: "https://cy.ncss.cn",
    regDeadline: "2026-10-15", finalDate: "2027-03-20", status: "报名中", note: "团队赛，5人以内"
  });

  db.teams.push({
    id: uid(), competitionId: compId2, name: "智链科技——校园二手交易平台",
    members: [ids[0], ids[2], ids[3], ids[4]], entryRole: "高教主赛道",
    status: "备赛中", note: "项目计划书初稿已完成"
  });

  db.compResults.push({
    id: uid(), competitionId: compId1, teamName: "张子昂（Java B组）",
    level: "省一等奖", date: "2026-06-20", certNo: "LQB2026-GX-0821",
    studentIds: [ids[0]], note: ""
  });

  const projId = uid();
  db.projects.push({
    id: projId, name: "面向智慧校园的多模态数据融合关键技术研究", no: "2026YJS-118",
    level: "省部级", role: "主持", fund: 100000, startDate: "2026-01-01", endDate: "2027-12-31",
    status: "在研", note: "教育厅高校科研重点项目",
    milestones: [
      { id: uid(), name: "开题论证会", date: "2026-03-10", done: true },
      { id: uid(), name: "中期检查", date: "2026-09-20", done: false },
      { id: uid(), name: "结题验收", date: "2027-11-30", done: false }
    ]
  });
  db.outputs.push({
    id: uid(), type: "论文", title: "基于注意力机制的多模态校园数据融合方法",
    venue: "计算机应用研究", no: "ISSN 1001-3695", date: "2026-05-20",
    authors: "李明, 张子昂", projectId: projId, note: "北大核心"
  });
  db.expenses.push({
    id: uid(), date: "2026-06-18", item: "实验服务器租用", amount: 6800,
    category: "设备费", projectId: projId, competitionId: "", note: "阿里云年付"
  });

  return db;
}

/* ===================== 学生名单导入（学生管理模块） ===================== */

/* 导入时识别“同一个学生”：先按学号精确匹配，再按姓名 + 班级匹配。
   与课程名单导入（courses.js）的识别语义保持一致，改一处请同步另一处。 */
function findStudentByImport(ns) {
  if (ns.no) {
    const byNo = DB.students.find(function (s) { return s.no && s.no === ns.no; });
    if (byNo) return byNo;
  }
  return DB.students.find(function (s) { return s.name === ns.name && (!ns.className || s.className === ns.className); }) || null;
}

/* 下载学生名单 Excel 导入模板：sheet1 学生名单（表头 + 示例行），sheet2 填写说明 */
function downloadStudentsTemplate() {
  loadSheetJS().then(function () {
    const rows = [
      ["学号", "姓名", "性别", "班级", "宿舍", "电话", "生源地", "家庭情况", "备注"],
      ["2023030101", "张三", "男", "计科2301", "松园3栋412", "13800000001", "浙江杭州", "", "示例行：正式填写前请删除"],
      ["2023030102", "李四", "女", "计科2301", "兰园2栋508", "13800000002", "江苏南京", "家庭经济困难", "示例行：正式填写前请删除"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 13 }, { wch: 9 }, { wch: 6 }, { wch: 11 }, { wch: 15 }, { wch: 13 }, { wch: 11 }, { wch: 16 }, { wch: 26 }];

    const guide = [
      ["列名", "是否必填", "说明"],
      ["学号", "强烈建议", "相同学号再次导入时只更新信息、不会重复建档；不填则按“姓名 + 班级”识别"],
      ["姓名", "必填", "缺失姓名的行会被跳过"],
      ["性别", "选填", "男 / 女"],
      ["班级", "选填", "如：计科2301"],
      ["宿舍", "选填", "如：松园3栋412"],
      ["电话", "选填", "手机号会被 Excel 识别为数字，导入不受影响"],
      ["生源地", "选填", "如：浙江杭州"],
      ["家庭情况", "选填", "如：家庭经济困难；导入后可在学生档案页打标签"],
      ["备注", "选填", ""]
    ];
    const gs = XLSX.utils.aoa_to_sheet(guide);
    gs["!cols"] = [{ wch: 10 }, { wch: 11 }, { wch: 62 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "学生名单");
    XLSX.utils.book_append_sheet(wb, gs, "填写说明");
    XLSX.writeFile(wb, "学生名单导入模板.xlsx");
    toast("模板已开始下载");
  }).catch(function (e) { toast(e.message); });
}
