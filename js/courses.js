"use strict";

let courseTab = "roster";

function renderCourses(view) {
  const term = currentTerm();
  const selTermId = window.__courseTermFilter || (term && term.id) || "";

  const courses = DB.courses.filter(function (c) { return !selTermId || c.termId === selTermId; });

  let h = "";
  h += '<div class="page-head"><div class="page-title">课程教学<small>课程档案 · 名单 · 成绩册 · 考勤 · 作业实验 · 教学进度</small></div>' +
    '<div class="toolbar">' +
    '<select class="input" id="course-term-filter" style="width:220px">' +
    (DB.terms.length ? DB.terms.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === selTermId ? " selected" : "") + ">" + esc(t.name) + (t.current ? "（当前）" : "") + "</option>";
    }).join("") : '<option value="">暂无学期</option>') +
    "</select>" +
    '<button class="btn" id="course-add">新增课程</button></div></div>';

  if (!DB.terms.length) {
    h += '<div class="card"><div class="empty"><div class="empty-icon">&#9673;</div>请先到“学期与设置”创建学期，再添加课程<button class="btn btn-light btn-sm" data-go="settings" style="margin-top:14px;display:inline-block">前往设置</button></div></div>';
  } else if (!courses.length) {
    h += '<div class="card"><div class="empty"><div class="empty-icon">&#9673;</div>' + (selTermId ? "该学期还没有课程" : "暂无课程") + '<button class="btn btn-light btn-sm" id="course-add-2" style="margin-top:14px">新增第一门课程</button></div></div>';
  } else {
    h += '<div class="card">' +
      '<table class="tbl"><thead><tr><th>课程</th><th>课程号</th><th>班级</th><th>性质</th><th>考核方式</th><th>学分</th><th>理论/实验学时</th><th>名单</th><th style="width:120px">操作</th></tr></thead><tbody>' +
      courses.map(function (c) {
        return '<tr class="clickable" data-go="course/' + c.id + '">' +
          "<td><b>" + esc(c.name) + "</b></td><td>" + esc(c.no || "-") + "</td><td>" + esc(c.className || "-") + "</td>" +
          "<td>" + badge(c.nature || "必修", "blue") + "</td><td>" + badge(examTypeOf(c), "amber") + "</td><td>" + esc(c.credits || "-") + "</td>" +
          "<td>" + (c.theoryHours || 0) + " / " + (c.labHours || 0) + "</td>" +
          "<td>" + (c.roster || []).length + " 人</td>" +
          '<td><span class="flex" style="gap:10px;justify-content:flex-end"><span class="link" data-course-edit="' + c.id + '">编辑</span><span class="link" data-course-del="' + c.id + '">删除</span></span></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  view.innerHTML = h;
  bindCourses(view);
}

function courseForm(course) {
  const term = currentTerm();
  const overlay = formModal({
    title: course ? "编辑课程" : "新增课程",
    body:
      '<div class="form-row">' +
      fieldHTML("课程名称", inputHTML("name", course ? course.name : "", { placeholder: "如：数据结构" }), true) +
      fieldHTML("课程号", inputHTML("no", course ? course.no : "", { placeholder: "如：CS2103" })) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("开课学期", selectHTML("termId", course ? course.termId : (term && term.id), DB.terms.map(function (t) { return { value: t.id, text: t.name }; }), { allowEmpty: true, emptyText: "请选择学期" }), true) +
      fieldHTML("课程性质", selectHTML("nature", course ? course.nature : "必修", ["必修", "选修", "实践"])) +
      fieldHTML("考核方式", selectHTML("examType", examTypeOf(course), EXAM_TYPES)) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("学分", inputHTML("credits", course ? course.credits : 3, { type: "number", attrs: ' step="0.5" min="0.5"' })) +
      fieldHTML("理论学时", inputHTML("theoryHours", course ? course.theoryHours : 32, { type: "number", attrs: ' min="0"' })) +
      fieldHTML("实验学时", inputHTML("labHours", course ? course.labHours : 0, { type: "number", attrs: ' min="0"' })) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("授课班级", inputHTML("className", course ? course.className : "", { placeholder: "如：计科2301" })) +
      "</div>" +
      '<div class="section-title" style="margin-top:4px">授课时段<span style="font-weight:400;font-size:12px;color:var(--ink-3);margin-left:8px">将同步显示在仪表盘教学日历</span></div>' +
      '<div id="slot-rows"></div>' +
      '<div class="flex" style="margin-bottom:13px">' +
      '<button type="button" class="btn btn-light btn-sm" id="slot-add">＋ 添加时段</button>' +
      '<span class="hint">同一门课可添加多个时段，类型分「理论 / 实验 / 实践」</span></div>' +
      '<div class="section-title" style="margin-top:4px">成绩权重（%）</div>' +
      '<div class="form-row">' +
      fieldHTML("平时", inputHTML("w1", course ? course.weights.regular : 30, { type: "number", attrs: ' min="0" max="100"' })) +
      fieldHTML("期中", inputHTML("w2", course ? course.weights.midterm : 20, { type: "number", attrs: ' min="0" max="100"' })) +
      fieldHTML("期末", inputHTML("w3", course ? course.weights.final : 50, { type: "number", attrs: ' min="0" max="100"' })) +
      "</div>",
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写课程名称"); return false; }
      if (!data.termId) { toast("请选择开课学期"); return false; }
      const w1 = Number(data.w1) || 0, w2 = Number(data.w2) || 0, w3 = Number(data.w3) || 0;
      if (w1 + w2 + w3 !== 100) { toast("三项成绩权重之和必须等于 100"); return false; }
      const newSlots = readSlotRows(overlay, term);
      for (let i = 0; i < newSlots.length; i++) {
        if (newSlots[i].start && newSlots[i].end && newSlots[i].end < newSlots[i].start) {
          toast("第 " + (i + 1) + " 个时段的结束时间不能早于开始时间");
          return false;
        }
      }
      const payload = {
        name: data.name.trim(), no: data.no.trim(), termId: data.termId, nature: data.nature,
        examType: data.examType,
        credits: data.credits, theoryHours: Number(data.theoryHours) || 0, labHours: Number(data.labHours) || 0,
        className: data.className.trim(), weights: { regular: w1, midterm: w2, final: w3 },
        slots: newSlots
      };
      if (course) {
        Object.assign(course, payload);
        toast("课程已更新");
      } else {
        DB.courses.push(Object.assign({ id: uid(), roster: [], progress: "" }, payload));
        toast("课程已创建，接下来可导入学生名单");
      }
      saveDB();
      renderApp();
    }
  });

  /* —— 授课时段行编辑器（无 name 属性，避免混入表单数据） —— */
  const rowsBox = $("#slot-rows", overlay);
  const maxWeek = Number(term && term.weeks) || 20;
  const newSlot = function () { return { type: "理论", day: 1, start: "08:00", end: "09:40", weekStart: 1, weekEnd: maxWeek, weekMode: "all", room: "" }; };
  let slotList = course ? JSON.parse(JSON.stringify(courseSlotsOf(course))) : [];
  if (!slotList.length) slotList = [newSlot()];

  function renderSlotRows() {
    rowsBox.innerHTML = slotList.map(function (s) { return slotRowHTML(s, term); }).join("") ||
      '<div class="hint" style="margin-bottom:8px">尚未设置授课时段，课程不会出现在教学日历中</div>';
  }
  renderSlotRows();

  $("#slot-add", overlay).addEventListener("click", function () {
    slotList = readSlotRows(overlay, term);
    slotList.push(newSlot());
    renderSlotRows();
  });
  rowsBox.addEventListener("click", function (e) {
    const del = e.target.closest("[data-slot-del]");
    if (!del) return;
    slotList = readSlotRows(overlay, term);
    slotList.splice(Array.prototype.indexOf.call(rowsBox.querySelectorAll(".slot-row"), del.closest(".slot-row")), 1);
    renderSlotRows();
  });
}

function slotRowHTML(slot, term) {
  slot = slot || {};
  const term0 = term || currentTerm();
  const maxWeek = Number(term0 && term0.weeks) || 20;
  const day = Number(slot.day) >= 1 && Number(slot.day) <= 7 ? Number(slot.day) : 1;
  const ws = Math.max(1, Math.min(maxWeek, Number(slot.weekStart) || 1));
  const we = Math.max(ws, Math.min(maxWeek, Number(slot.weekEnd) || maxWeek));
  const mode = slot.weekMode || "all";
  return '<div class="slot-row">' +
    '<select class="input" data-slot-type>' +
    ["理论", "实验", "实践"].map(function (t) { return '<option' + ((slot.type || "理论") === t ? " selected" : "") + ">" + t + "</option>"; }).join("") +
    "</select>" +
    '<select class="input" data-slot-day>' +
    [1, 2, 3, 4, 5, 6, 7].map(function (d) { return '<option value="' + d + '"' + (day === d ? " selected" : "") + ">周" + "一二三四五六日".charAt(d - 1) + "</option>"; }).join("") +
    "</select>" +
    '<input type="time" class="input" data-slot-start value="' + esc(slot.start || "") + '">' +
    '<span class="slot-dash">–</span>' +
    '<input type="time" class="input" data-slot-end value="' + esc(slot.end || "") + '">' +
    '<input type="text" class="input" data-slot-room value="' + esc(slot.room || "") + '" placeholder="教室/实验室" title="上课地点，将同步显示在日历">' +
    '<span class="slot-weeks" title="该时段上课的教学周范围">第' +
    '<input type="number" class="input" data-slot-ws value="' + ws + '" min="1" max="' + maxWeek + '">–' +
    '<input type="number" class="input" data-slot-we value="' + we + '" min="1" max="' + maxWeek + '">周</span>' +
    '<select class="input" data-slot-mode>' +
    [["all", "每周"], ["odd", "单周"], ["even", "双周"]].map(function (m) { return '<option value="' + m[0] + '"' + (mode === m[0] ? " selected" : "") + ">" + m[1] + "</option>"; }).join("") +
    "</select>" +
    '<button type="button" class="btn btn-light btn-sm" data-slot-del>删除</button>' +
    "</div>";
}

/* 从弹窗 DOM 读取全部时段行；起止时间均为空的行视为未填写、自动忽略。
   周数容错：起始周下限 1；结束周为空或越界取学期周数；结束早于起始时取起始周 */
function readSlotRows(overlay, term) {
  const maxWeek = Number(term && term.weeks) || 20;
  const rows = [];
  $$(".slot-row", overlay).forEach(function (row) {
    const start = $("[data-slot-start]", row).value;
    const end = $("[data-slot-end]", row).value;
    if (!start && !end) return;
    let ws = Math.max(1, Math.min(maxWeek, Number($("[data-slot-ws]", row).value) || 1));
    let we = Number($("[data-slot-we]", row).value) || maxWeek;
    we = Math.max(ws, Math.min(maxWeek, we));
    rows.push({
      type: $("[data-slot-type]", row).value,
      day: Number($("[data-slot-day]", row).value),
      start: start, end: end,
      weekStart: ws, weekEnd: we, weekMode: $("[data-slot-mode]", row).value,
      room: $("[data-slot-room]", row).value.trim()
    });
  });
  return rows;
}

function bindCourses(view) {
  const addBtn = $("#course-add", view) || $("#course-add-2", view);
  addBtn && addBtn.addEventListener("click", function () { courseForm(null); });

  const sel = $("#course-term-filter", view);
  sel && sel.addEventListener("change", function (e) {
    window.__courseTermFilter = e.target.value;
    renderApp();
  });

  $$("[data-course-edit]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      courseForm(getCourse(el.getAttribute("data-course-edit")));
    });
  });
  $$("[data-course-del]", view).forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const c = getCourse(el.getAttribute("data-course-del"));
      confirmModal("确定删除课程 <b>" + esc(c.name) + "</b>？<br><span style='color:var(--red-600)'>其名单、成绩、考勤、作业记录将一并删除。</span>", function () {
        DB.courses = DB.courses.filter(function (x) { return x.id !== c.id; });
        DB.grades = DB.grades.filter(function (g) { return g.courseId !== c.id; });
        DB.attendance = DB.attendance.filter(function (a) { return a.courseId !== c.id; });
        DB.assignments = DB.assignments.filter(function (a) { return a.courseId !== c.id; });
        saveDB();
        toast("课程已删除");
        renderApp();
      }, "删除");
    });
  });
}

/* ===================== 课程详情 ===================== */

function renderCourseDetail(view, courseId) {
  const c = getCourse(courseId);
  if (!c) { view.innerHTML = '<div class="empty">课程不存在<button class="btn btn-light btn-sm" data-go="courses" style="margin-top:14px">返回列表</button></div>'; return; }
  const term = getTerm(c.termId);
  const week = weekNoOfTerm(term, todayISO());

  const tabs = [
    ["roster", "学生名单" + countBadge(c.roster)],
    ["grades", "成绩册"],
    ["attendance", "考勤记录" + countBadge(DB.attendance.filter(function (a) { return a.courseId === c.id; }))],
    ["assignments", "作业与实验"],
    ["plan", "教学进度"]
  ];

  let h = "";
  h += '<div class="page-head"><div class="flex"><span class="link" data-go="courses" style="margin-right:4px">课程教学</span><span class="muted">/</span><div class="page-title">' + esc(c.name) +
    "<small>" + esc(c.no || "") + " · " + esc(term ? term.name : "未设置学期") + (week ? " · 当前第 " + week + " 周" : "") + "</small></div></div>" +
    '<div class="toolbar"><span class="muted">理论 ' + (c.theoryHours || 0) + ' 学时 · 实验 ' + (c.labHours || 0) + ' 学时 · 考核方式 ' + examTypeOf(c) + ' · 权重 平时' + c.weights.regular + "/期中" + c.weights.midterm + "/期末" + c.weights.final + '</span><button class="btn btn-light" data-course-edit="' + c.id + '">编辑课程</button></div></div>';

  h += '<div class="tabs">' + tabs.map(function (t) {
    return '<div class="tab' + (courseTab === t[0] ? " active" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</div>";
  }).join("") + "</div>";

  const slots = courseSlotsOf(c);
  if (slots.length) {
    h += '<div class="card" style="padding:10px 18px"><div class="flex">' +
      '<span class="muted" style="flex:0 0 auto">授课时段</span>' +
      slots.map(function (s) { return badge(slotLabel(s, term), s.type === "实验" ? "purple" : (s.type === "实践" ? "teal" : "blue")); }).join("") +
      '<span class="muted" style="flex:0 0 auto">同步显示在仪表盘教学日历</span></div></div>';
  }

  h += '<div id="course-tab-body"></div>';
  view.innerHTML = h;

  const body = $("#course-tab-body", view);
  if (courseTab === "roster") renderCourseRoster(body, c);
  else if (courseTab === "grades") renderCourseGrades(body, c);
  else if (courseTab === "attendance") renderCourseAttendance(body, c);
  else if (courseTab === "assignments") renderCourseAssignments(body, c);
  else renderCoursePlan(body, c);

  $$(".tab", view).forEach(function (t) {
    t.addEventListener("click", function () {
      courseTab = t.getAttribute("data-tab");
      renderApp();
    });
  });
  const editBtn = $("[data-course-edit]", view);
  editBtn && editBtn.addEventListener("click", function () { courseForm(c); });
}

/* ---------- Tab 1: 名单 ---------- */

function renderCourseRoster(body, c) {
  const students = courseStudents(c.id);

  let h = '<div class="card"><div class="card-head"><div class="card-title">选课名单（' + students.length + " 人）</div>" +
    '<div class="toolbar">' +
    '<button class="btn" id="roster-add">添加学生</button>' +
    '<button class="btn btn-light" id="roster-import">导入名单</button>' +
    "</div></div>";

  if (!students.length) {
    h += '<div class="empty">名单为空，可以“导入名单”（支持 Excel / 粘贴表格）或逐个添加</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th>性别</th><th>班级</th><th>宿舍</th><th>电话</th><th style="width:60px">操作</th></tr></thead><tbody>' +
      students.slice().sort(function (a, b) { return (a.no || "").localeCompare(b.no || ""); }).map(function (s) {
        return "<tr><td>" + esc(s.no || "-") + "</td><td><span class='link' data-go='student/" + s.id + "'><b>" + esc(s.name) + "</b></span></td>" +
          "<td>" + esc(s.gender || "-") + "</td><td>" + esc(s.className || "-") + "</td><td>" + esc(s.dorm || "-") + "</td><td>" + esc(s.phone || "-") + "</td>" +
          '<td><span class="link" data-roster-remove="' + s.id + '">移除</span></td></tr>';
      }).join("") + "</tbody></table>";
  }
  h += "</div>";

  body.innerHTML = h;

  $("#roster-add", body).addEventListener("click", function () { rosterAddModal(c); });
  $("#roster-import", body).addEventListener("click", function () { rosterImportModal(c); });

  $$("[data-roster-remove]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      const sid = el.getAttribute("data-roster-remove");
      c.roster = c.roster.filter(function (x) { return x !== sid; });
      DB.grades = DB.grades.filter(function (g) { return !(g.courseId === c.id && g.studentId === sid); });
      saveDB();
      toast("已从名单移除");
      renderApp();
    });
  });
}

function rosterAddModal(course) {
  const avail = DB.students.filter(function (s) { return (course.roster || []).indexOf(s.id) < 0; });
  let listHTML = avail.length
    ? '<table class="tbl"><thead><tr><th style="width:36px"></th><th>学号</th><th>姓名</th><th>班级</th></tr></thead><tbody>' +
      avail.map(function (s) {
        return '<tr><td><input type="checkbox" data-pick="' + s.id + '"></td><td>' + esc(s.no || "-") + "</td><td><b>" + esc(s.name) + "</b></td><td>" + esc(s.className || "-") + "</td></tr>";
      }).join("") + "</tbody></table>"
    : '<div class="empty" style="padding:20px">学生池中没有可选学生，可先到“学生管理”建档，或用“导入名单”新建</div>';

  const overlay = openModal({
    title: "添加学生到 " + course.name, wide: true,
    body: listHTML,
    foot:
      '<button class="btn btn-light" data-new-student>新建学生并加入</button>' +
      '<span class="spacer" style="flex:1"></span>' +
      '<button class="btn btn-light" data-close>取消</button>' +
      '<button class="btn" data-ok>加入名单</button>'
  });

  $("[data-new-student]", overlay).addEventListener("click", function () {
    studentForm(null, function (ns) {
      course.roster = course.roster || [];
      course.roster.push(ns.id);
      saveDB();
      closeModal();
      toast("已新建并加入名单");
      renderApp();
    });
  });
  $("[data-ok]", overlay).addEventListener("click", function () {
    const picked = $$("[data-pick]", overlay).filter(function (i) { return i.checked; }).map(function (i) { return i.getAttribute("data-pick"); });
    if (!picked.length) { toast("请先勾选学生"); return; }
    course.roster = (course.roster || []).concat(picked);
    saveDB();
    closeModal();
    toast("已加入 " + picked.length + " 名学生");
    renderApp();
  });
}

function rosterImportModal(course) {
  const overlay = openModal({
    title: "导入学生名单", wide: true,
    body:
      '<div class="info-box">支持两种方式：① 选择 .xlsx / .xls / .csv 文件（需要联网加载解析库）；② 直接从 Excel 复制区域后粘贴到下方文本框。<br>表头需包含：<b>学号、姓名</b>（其余列：性别、班级、宿舍、电话、生源地、家庭情况、备注 均为可选）。已有相同学号的学生会自动更新信息而不是重复建档。</div>' +
      '<div class="field"><label>方式一：Excel 文件</label>' +
      '<input type="file" id="roster-file" class="input" accept=".xlsx,.xls,.csv"></div>' +
      '<div class="field"><label>方式二：粘贴表格（复制 Excel 区域后在此粘贴）</label>' +
      '<textarea class="input" id="roster-paste" rows="7" placeholder="学号\t姓名\t性别\t班级\n2023030101\t张三\t男\t计科2301"></textarea></div>' +
      '<div id="roster-preview"></div>',
    foot:
      '<button class="btn btn-light" data-close>取消</button>' +
      '<button class="btn" data-ok>确认导入</button>'
  });

  let pending = null;

  $("#roster-file", overlay).addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    $("#roster-preview", overlay).innerHTML = '<div class="hint">正在解析文件…</div>';
    parseExcelFile(file, function (res) { applyPreview(res); });
  });

  function applyPreview(res) {
    const box = $("#roster-preview", overlay);
    if (res.error) { pending = null; box.innerHTML = '<div class="warn-box">' + esc(res.error) + "</div>"; return; }
    pending = res.students;
    box.innerHTML = '<div class="hint" style="margin-bottom:8px">解析到 <b>' + res.students.length + "</b> 名学生，前 5 行预览：</div>" +
      '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th>性别</th><th>班级</th></tr></thead><tbody>' +
      res.students.slice(0, 5).map(function (s) { return "<tr><td>" + esc(s.no) + "</td><td>" + esc(s.name) + "</td><td>" + esc(s.gender) + "</td><td>" + esc(s.className) + "</td></tr>"; }).join("") +
      "</tbody></table>";
  }

  $("[data-ok]", overlay).addEventListener("click", function () {
    if (!pending) {
      const text = $("#roster-paste", overlay).value;
      if (!text.trim()) { toast("请先选择文件或粘贴表格数据"); return; }
      applyPreview(parsePastedText(text));
      if (!pending) return;
    }
    let added = 0, created = 0;
    pending.forEach(function (ns) {
      let exist = ns.no ? DB.students.find(function (s) { return s.no && s.no === ns.no; }) : null;
      if (!exist) exist = DB.students.find(function (s) { return s.name === ns.name && (!ns.className || s.className === ns.className); });
      if (exist) {
        ["gender", "className", "dorm", "phone", "hometown", "family", "notes"].forEach(function (k) {
          if (ns[k]) exist[k] = ns[k];
        });
      } else {
        exist = Object.assign({ tags: [] }, ns, { id: uid() });
        DB.students.push(exist);
        created++;
      }
      if ((course.roster || []).indexOf(exist.id) < 0) {
        course.roster = course.roster || [];
        course.roster.push(exist.id);
        added++;
      }
    });
    saveDB();
    closeModal();
    toast("导入完成：新建 " + created + " 人，新加入名单 " + added + " 人");
    renderApp();
  });
}

/* ---------- Tab 2: 成绩册 ---------- */

function renderCourseGrades(body, c) {
  const students = courseStudents(c.id).slice().sort(function (a, b) { return (a.no || "").localeCompare(b.no || ""); });
  const dist = { "90+": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0 };
  const warns = [];

  students.forEach(function (s) {
    const g = DB.grades.find(function (x) { return x.courseId === c.id && x.studentId === s.id; });
    const total = g ? totalScore(g, c.weights) : null;
    if (total != null) {
      if (total >= 90) dist["90+"]++;
      else if (total >= 80) dist["80-89"]++;
      else if (total >= 70) dist["70-79"]++;
      else if (total >= 60) dist["60-69"]++;
      else dist["<60"]++;
    }
    const absent = absentCount(c.id, s.id);
    if ((total != null && total < 60) || absent >= 3) warns.push({ s: s, total: total, absent: absent });
  });

  let h = "";

  if (!students.length) { body.innerHTML = '<div class="card"><div class="empty">名单为空，请先在“学生名单”页导入</div></div>'; return; }

  h += '<div class="grid grid-2" style="margin-bottom:14px">';
  h += '<div class="card"><div class="card-head"><div class="card-title">成绩分布（按总评）</div></div><div class="card-body">';
  const maxCnt = Math.max.apply(null, [dist["90+"], dist["80-89"], dist["70-79"], dist["60-69"], dist["<60"], 1]);
  Object.keys(dist).forEach(function (k) {
    h += '<div class="hbar-row"><div class="hbar-label">' + k + "</div>" +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(dist[k] / maxCnt * 100) + "%;background:" + (k === "<60" ? "var(--red-400,#E24B4A)" : k === "90+" ? "var(--green-600,#3B6D11)" : "var(--blue-400)") + '">' + dist[k] + "</div></div></div>";
  });
  h += "</div></div>";
  h += '<div class="card"><div class="card-head"><div class="card-title">学业预警（总评不及格或旷课 ≥ 3 次）</div></div><div class="card-body">';
  h += warns.length
    ? warns.map(function (w) {
        return '<div class="flex" style="justify-content:space-between;margin-bottom:8px"><span><b>' + esc(w.s.name) + "</b>（" + esc(w.s.no || "") + "）" +
          (w.total != null && w.total < 60 ? badge("总评 " + w.total, "red") : "") +
          (w.absent >= 3 ? badge("旷课 " + w.absent + " 次", "red") : "") + "</span>" +
          '<span class="link" data-go="student/' + w.s.id + '">查看档案</span></div>';
      }).join("")
    : '<div class="hint" style="padding:6px 0">暂无预警学生</div>';
  h += '</div><div class="card-head" style="border-top:1px solid var(--border)"><button class="btn btn-light btn-sm" id="grades-export">导出成绩册 Excel</button></div></div>';
  h += "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">成绩录入（平时 ' + c.weights.regular + '% / 期中 ' + c.weights.midterm + '% / 期末 ' + c.weights.final + '%，自动计算总评）</div><span class="muted">直接在表格中修改，失焦即保存</span></div>' +
    '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th>平时</th><th>期中</th><th>期末</th><th>总评</th><th>旷课</th></tr></thead><tbody>';

  students.forEach(function (s) {
    const g = DB.grades.find(function (x) { return x.courseId === c.id && x.studentId === s.id; }) || { courseId: c.id, studentId: s.id, regular: "", midterm: "", final: "" };
    const total = totalScore(g, c.weights);
    const absent = absentCount(c.id, s.id);
    const gc = total == null ? "" : total < 60 ? "var(--red-600)" : total >= 90 ? "var(--green-600)" : "var(--text)";
    h += "<tr><td>" + esc(s.no || "-") + "</td><td><b>" + esc(s.name) + "</b></td>" +
      cellInput(c.id, s.id, "regular", g.regular) +
      cellInput(c.id, s.id, "midterm", g.midterm) +
      cellInput(c.id, s.id, "final", g.final) +
      '<td style="font-weight:600;color:' + gc + '">' + (total == null ? "-" : total) + "</td>" +
      "<td>" + (absent ? badge(absent + " 次", absent >= 3 ? "red" : "gray") : "0") + "</td></tr>";
  });
  h += "</tbody></table></div>";

  body.innerHTML = h;

  $$("input[data-grade]", body).forEach(function (inp) {
    inp.addEventListener("change", function () {
      const parts = inp.getAttribute("data-grade").split("|");
      const courseId = parts[0], studentId = parts[1], key = parts[2];
      let g = DB.grades.find(function (x) { return x.courseId === courseId && x.studentId === studentId; });
      if (!g) { g = { courseId: courseId, studentId: studentId, regular: "", midterm: "", final: "" }; DB.grades.push(g); }
      let v = inp.value.trim();
      if (v !== "" && (isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100)) {
        toast("请输入 0-100 之间的分数"); inp.value = g[key]; return;
      }
      g[key] = v === "" ? "" : Number(v);
      saveDB();
      renderCourseDetail($("#view"), courseId);
    });
  });

  const exp = $("#grades-export", body);
  exp && exp.addEventListener("click", function () {
    loadSheetJS().then(function () {
      const rows = [["学号", "姓名", "平时", "期中", "期末", "总评"]];
      students.forEach(function (s) {
        const g = DB.grades.find(function (x) { return x.courseId === c.id && x.studentId === s.id; }) || {};
        rows.push([s.no, s.name, g.regular || "", g.midterm || "", g.final || "", totalScore(g, c.weights) || ""]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "成绩册");
      XLSX.writeFile(wb, c.name + "_成绩册_" + todayISO() + ".xlsx");
      toast("成绩册已导出");
    }).catch(function (e) { toast(e.message); });
  });
}

function cellInput(courseId, studentId, key, value) {
  return '<td><input class="input" style="max-width:76px;padding:5px 8px" data-grade="' + courseId + "|" + studentId + "|" + key + '" value="' + esc(value) + '"></td>';
}

function absentCount(courseId, studentId) {
  let n = 0;
  DB.attendance.forEach(function (a) {
    if (a.courseId === courseId && a.records && a.records[studentId] === "旷") n++;
  });
  return n;
}

/* ---------- Tab 3: 考勤 ---------- */

function renderCourseAttendance(body, c) {
  const sessions = DB.attendance.filter(function (a) { return a.courseId === c.id; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  let h = '<div class="card"><div class="card-head"><div class="card-title">考勤课次</div><button class="btn" id="att-add">登记考勤</button></div>';
  if (!sessions.length) {
    h += '<div class="empty">还没有考勤记录</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>日期</th><th>周次</th><th>类型</th><th>出勤</th><th>迟到</th><th>旷课</th><th>请假</th><th style="width:110px">操作</th></tr></thead><tbody>';
    sessions.forEach(function (a) {
      const cnt = { 出: 0, 迟: 0, 旷: 0, 假: 0 };
      Object.keys(a.records || {}).forEach(function (k) { if (cnt[a.records[k]] !== undefined) cnt[a.records[k]]++; });
      h += "<tr><td>" + esc(a.date) + "</td><td>第 " + (a.week || weekNoOfTerm(getTerm(c.termId), a.date) || "?") + " 周</td><td>" + badge(a.type || "理论", "blue") + "</td>" +
        "<td>" + cnt["出"] + "</td><td>" + cnt["迟"] + "</td><td>" + (cnt["旷"] ? badge(cnt["旷"] + "", "red") : 0) + "</td><td>" + cnt["假"] + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-att-edit="' + a.id + '">修改</span><span class="link" data-att-del="' + a.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  if (sessions.length) {
    h += '<div class="card"><div class="card-head"><div class="card-title">学期考勤汇总</div></div>' + attendanceSummaryTable(c) + "</div>";
  }

  body.innerHTML = h;

  $("#att-add", body).addEventListener("click", function () { attendanceForm(c, null); });
  $$("[data-att-edit]", body).forEach(function (el) {
    el.addEventListener("click", function () { attendanceForm(c, DB.attendance.find(function (a) { return a.id === el.getAttribute("data-att-edit"); })); });
  });
  $$("[data-att-del]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除这条考勤记录？", function () {
        DB.attendance = DB.attendance.filter(function (a) { return a.id !== el.getAttribute("data-att-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });
}

function attendanceSummaryTable(c) {
  const students = courseStudents(c.id).slice().sort(function (a, b) { return (a.no || "").localeCompare(b.no || ""); });
  return '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th>迟到</th><th>旷课</th><th>请假</th></tr></thead><tbody>' +
    students.map(function (s) {
      const cnt = { 迟: 0, 旷: 0, 假: 0 };
      DB.attendance.forEach(function (a) {
        if (a.courseId === c.id && a.records && a.records[s.id] && cnt[a.records[s.id]] !== undefined) cnt[a.records[s.id]]++;
      });
      return "<tr><td>" + esc(s.no || "-") + "</td><td>" + esc(s.name) + "</td><td>" + cnt["迟"] + "</td>" +
        "<td>" + (cnt["旷"] ? badge(cnt["旷"] + "", "red") : 0) + "</td><td>" + cnt["假"] + "</td></tr>";
    }).join("") + "</tbody></table>";
}

function attendanceForm(course, session) {
  const students = courseStudents(course.id);
  if (!students.length) { toast("名单为空，请先导入学生"); return; }

  const overlay = openModal({
    title: session ? "修改考勤（" + session.date + "）" : "登记考勤",
    wide: true,
    body:
      '<div class="form-row">' +
      fieldHTML("上课日期", inputHTML("date", session ? session.date : todayISO(), { type: "date" }), true) +
      fieldHTML("课型", selectHTML("type", session ? session.type : "理论", ["理论", "实验", "实践"])) +
      "</div>" +
      '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th>状态</th></tr></thead><tbody>' +
      students.map(function (s) {
        const cur = session && session.records ? session.records[s.id] || "出" : "出";
        return "<tr><td>" + esc(s.no || "-") + "</td><td><b>" + esc(s.name) + "</b></td><td>" +
          selectHTML("att_" + s.id, cur, ["出", "迟", "旷", "假"]) + "</td></tr>";
      }).join("") + "</tbody></table>",
    foot:
      '<button class="btn btn-light" data-close>取消</button>' +
      '<button class="btn" data-ok>保存考勤</button>'
  });

  $("[data-ok]", overlay).addEventListener("click", function () {
    const date = $("[name=date]", overlay).value;
    if (!date) { toast("请选择日期"); return; }
    const records = {};
    students.forEach(function (s) {
      records[s.id] = $("[name=att_" + s.id + "]", overlay).value;
    });
    if (session) {
      session.date = date;
      session.type = $("[name=type]", overlay).value;
      session.week = weekNoOfTerm(getTerm(course.termId), date);
      session.records = records;
    } else {
      DB.attendance.push({
        id: uid(), courseId: course.id, date: date,
        week: weekNoOfTerm(getTerm(course.termId), date),
        type: $("[name=type]", overlay).value, records: records
      });
    }
    saveDB();
    closeModal();
    toast("考勤已保存");
    renderApp();
  });
}

/* ---------- Tab 4: 作业与实验 ---------- */

function renderCourseAssignments(body, c) {
  const list = DB.assignments.filter(function (a) { return a.courseId === c.id; });
  const n = (c.roster || []).length;

  let h = '<div class="card"><div class="card-head"><div class="card-title">作业与实验报告</div><button class="btn" id="asg-add">布置新的作业 / 实验</button></div>';
  if (!list.length) {
    h += '<div class="empty">还没有作业或实验任务</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>名称</th><th>类型</th><th>截止日期</th><th>提交情况</th><th>平均分</th><th style="width:120px">操作</th></tr></thead><tbody>';
    list.sort(function (a, b) { return (a.deadline || "") < (b.deadline || "") ? -1 : 1; }).forEach(function (a) {
      const scores = a.scores || {};
      const subs = Object.keys(scores).filter(function (k) { return scores[k] && scores[k].sub; });
      const vals = subs.map(function (k) { return Number(scores[k].score); }).filter(function (v) { return !isNaN(v) && v > 0; });
      const avg = vals.length ? Math.round(sum(vals) / vals.length) : "-";
      const overdue = daysUntil(a.deadline) < 0;
      h += "<tr><td><b>" + esc(a.name) + "</b></td><td>" + badge(a.type, a.type === "实验报告" ? "purple" : "blue") + "</td>" +
        "<td>" + esc(a.deadline) + (overdue ? badge("已截止", "gray") : "") + "</td>" +
        "<td>" + subs.length + " / " + n + "</td><td>" + avg + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-asg-score="' + a.id + '">登记</span><span class="link" data-asg-del="' + a.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";
  body.innerHTML = h;

  $("#asg-add", body).addEventListener("click", function () { assignmentForm(c); });
  $$("[data-asg-score]", body).forEach(function (el) { el.addEventListener("click", function () { assignmentScoreModal(c, el.getAttribute("data-asg-score")); }); });
  $$("[data-asg-del]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除该作业及其成绩记录？", function () {
        DB.assignments = DB.assignments.filter(function (a) { return a.id !== el.getAttribute("data-asg-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });
}

function assignmentForm(course) {
  formModal({
    title: "布置作业 / 实验",
    body:
      fieldHTML("名称", inputHTML("name", "", { placeholder: "如：实验一 顺序表与链表" }), true) +
      '<div class="form-row">' +
      fieldHTML("类型", selectHTML("type", "实验报告", ["作业", "实验报告"])) +
      fieldHTML("截止日期", inputHTML("deadline", todayISO(), { type: "date" }), true) +
      "</div>",
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写名称"); return false; }
      DB.assignments.push({ id: uid(), courseId: course.id, name: data.name.trim(), type: data.type, deadline: data.deadline, scores: {} });
      saveDB();
      toast("已布置：" + data.name);
      renderApp();
    }
  });
}

function assignmentScoreModal(course, asgId) {
  const asg = DB.assignments.find(function (a) { return a.id === asgId; });
  if (!asg) return;
  const students = courseStudents(course.id);

  const overlay = openModal({
    title: "登记：" + asg.name, wide: true,
    body: '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th style="width:90px">已提交</th><th style="width:110px">分数</th></tr></thead><tbody>' +
      students.map(function (s) {
        const rec = (asg.scores || {})[s.id] || {};
        return "<tr><td>" + esc(s.no || "-") + "</td><td><b>" + esc(s.name) + "</b></td>" +
          '<td><select class="input" data-sub="' + s.id + '">' +
          '<option value="1"' + (rec.sub ? " selected" : "") + '>是</option><option value=""' + (!rec.sub ? " selected" : "") + ">否</option></select></td>" +
          '<td><input class="input" style="max-width:90px" data-score="' + s.id + '" value="' + esc(rec.score != null ? rec.score : "") + '"></td></tr>';
      }).join("") + "</tbody></table>",
    foot: '<button class="btn btn-light" data-close>取消</button><button class="btn" data-ok>保存</button>'
  });

  $("[data-ok]", overlay).addEventListener("click", function () {
    asg.scores = {};
    students.forEach(function (s) {
      const sub = $('[data-sub="' + s.id + '"]', overlay).value === "1";
      let score = $('[data-score="' + s.id + '"]', overlay).value.trim();
      score = score === "" ? null : (isNaN(Number(score)) ? null : Number(score));
      asg.scores[s.id] = { sub: sub, score: score };
    });
    saveDB();
    closeModal();
    toast("成绩已登记");
    renderApp();
  });
}

/* ---------- Tab 5: 教学进度 ---------- */

function renderCoursePlan(body, c) {
  if (!c.plan || !c.plan.length) {
    const term = getTerm(c.termId);
    const weeks = term ? term.weeks : 18;
    c.plan = [];
    for (let i = 1; i <= weeks; i++) c.plan.push({ week: i, theory: "", lab: "" });
  }
  const curWeek = weekNoOfTerm(getTerm(c.termId), todayISO());

  let h = '<div class="card"><div class="card-head"><div class="card-title">教学进度表<small style="font-weight:400;margin-left:6px">理论线与实验线分开记录' + (curWeek ? " · 当前第 " + curWeek + " 周" : "") + "</small></div></div>" +
    '<table class="tbl"><thead><tr><th style="width:70px">周次</th><th>理论课内容</th><th>实验课内容</th></tr></thead><tbody>';
  c.plan.forEach(function (p) {
    const isCur = curWeek === p.week;
    h += '<tr' + (isCur ? ' style="background:var(--blue-50)"' : "") + "><td><b>" + p.week + "</b>" + (isCur ? '<div class="muted">本周</div>' : "") + "</td>" +
      '<td><input class="input" data-plan="theory|' + p.week + '" value="' + esc(p.theory) + '" placeholder="如：第2章 线性表"></td>' +
      '<td><input class="input" data-plan="lab|' + p.week + '" value="' + esc(p.lab) + '" placeholder="如：实验二 单链表操作"></td></tr>';
  });
  h += "</tbody></table></div>";

  body.innerHTML = h;

  $$("[data-plan]", body).forEach(function (inp) {
    inp.addEventListener("change", function () {
      const parts = inp.getAttribute("data-plan").split("|");
      const p = c.plan.find(function (x) { return x.week === Number(parts[1]); });
      if (p) { p[parts[0]] = inp.value.trim(); saveDB(); toast("进度已保存"); }
    });
  });
}
