"use strict";

let studentTab = "pool";

const STUDENT_TAGS = ["资助", "心理关注", "重点关注", "学业预警"];
/* 台账类型体系（LOG_TYPES / ledgerTypeColor）已提升至数据层 data.js */

function renderStudents(view) {
  /* 支持 #/students/todos、#/students/logs 等直达子页 */
  const routeTab = parseHash().id;
  if (routeTab) studentTab = routeTab;

  const tabs = [
    ["pool", "学生档案"],
    ["logs", "工作台账" + countBadge(DB.logs.filter(function (l) { return l.followUp && !l.done; }))],
    ["todos", "跟踪事项" + countBadge(DB.todos.filter(function (t) { return t.status !== "完成"; }))],
    ["awards", "评奖评优" + countBadge(DB.awards)],
    ["stats", "统计分析"]
  ];

  let h = '<div class="page-head"><div class="page-title">班主任学生管理<small>学生档案 · 工作台账（评奖评优/就业/贫困生申报）· 跟踪事项 · 统计分析</small></div>' +
    '<div class="toolbar"><button class="btn btn-light" id="stu-import">导入学生</button><button class="btn" id="stu-add">新建学生档案</button></div></div>';
  h += '<div class="tabs">' + tabs.map(function (t) {
    return '<div class="tab' + (studentTab === t[0] ? " active" : "") + '" data-stu-tab="' + t[0] + '">' + t[1] + "</div>";
  }).join("") + "</div><div id='stu-tab-body'></div>";

  view.innerHTML = h;

  const body = $("#stu-tab-body", view);
  if (studentTab === "pool") renderStudentPool(body);
  else if (studentTab === "logs") renderLogList(body);
  else if (studentTab === "todos") renderTodoList(body);
  else if (studentTab === "awards") renderAwardList(body);
  else renderStudentStats(body);

  $$(".tab", view).forEach(function (t) {
    t.addEventListener("click", function () { studentTab = t.getAttribute("data-stu-tab"); renderApp(); });
  });
  $("#stu-import", view).addEventListener("click", function () { studentImportModal(); });
  $("#stu-add", view).addEventListener("click", function () { studentForm(null, null); });
}

/* ---------- 学生名单批量导入（Excel / 粘贴） ---------- */

function studentImportModal() {
  const overlay = openModal({
    title: "导入学生名单", wide: true,
    body:
      '<div class="info-box">支持两种方式：① 选择 .xlsx / .xls / .csv 文件（需要联网加载解析库）；② 直接从 Excel 复制区域后粘贴到下方文本框。没有现成表格？<span class="link" id="stu-import-tpl">下载导入模板</span><br>表头需包含：<b>学号、姓名</b>（其余列：性别、班级、宿舍、电话、生源地、家庭情况、备注 均为可选）。已有相同学号的学生会自动更新信息而不是重复建档。</div>' +
      '<div class="field"><label>方式一：Excel 文件</label>' +
      '<input type="file" id="stu-import-file" class="input" accept=".xlsx,.xls,.csv"></div>' +
      '<div class="field"><label>方式二：粘贴表格（复制 Excel 区域后在此粘贴）</label>' +
      '<textarea class="input" id="stu-import-paste" rows="7" placeholder="学号\t姓名\t性别\t班级\n2023030101\t张三\t男\t计科2301"></textarea></div>' +
      '<div id="stu-import-preview"></div>',
    foot:
      '<button class="btn btn-light" data-close>取消</button>' +
      '<button class="btn" data-ok>确认导入</button>'
  });

  let pending = null;

  $("#stu-import-tpl", overlay).addEventListener("click", function () { downloadStudentsTemplate(); });

  $("#stu-import-file", overlay).addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    $("#stu-import-preview", overlay).innerHTML = '<div class="hint">正在解析文件…</div>';
    parseExcelFile(file, function (res) { applyPreview(res); });
  });

  function applyPreview(res) {
    const box = $("#stu-import-preview", overlay);
    if (res.error) { pending = null; box.innerHTML = '<div class="warn-box">' + esc(res.error) + "</div>"; return; }
    pending = res.students;
    let newCnt = 0;
    res.students.forEach(function (ns) { if (!findStudentByImport(ns)) newCnt++; });
    box.innerHTML = '<div class="hint" style="margin-bottom:8px">解析到 <b>' + res.students.length + "</b> 名学生（新建 " + newCnt + " 人、更新 " + (res.students.length - newCnt) + " 人），前 5 行预览：</div>" +
      '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th>性别</th><th>班级</th><th>导入方式</th></tr></thead><tbody>' +
      res.students.slice(0, 5).map(function (s) {
        return "<tr><td>" + esc(s.no) + "</td><td>" + esc(s.name) + "</td><td>" + esc(s.gender) + "</td><td>" + esc(s.className) + "</td><td>" +
          (findStudentByImport(s) ? "更新已有档案" : "新建档案") + "</td></tr>";
      }).join("") +
      "</tbody></table>";
  }

  $("[data-ok]", overlay).addEventListener("click", function () {
    if (!pending) {
      const text = $("#stu-import-paste", overlay).value;
      if (!text.trim()) { toast("请先选择文件或粘贴表格数据"); return; }
      applyPreview(parsePastedText(text));
      if (!pending) return;
    }
    let created = 0, updated = 0;
    pending.forEach(function (ns) {
      const exist = findStudentByImport(ns);
      if (exist) {
        ["gender", "className", "dorm", "phone", "hometown", "family", "notes"].forEach(function (k) {
          if (ns[k]) exist[k] = ns[k];
        });
        updated++;
      } else {
        DB.students.push(Object.assign({ tags: [] }, ns, { id: uid() }));
        created++;
      }
    });
    saveDB();
    closeModal();
    toast("导入完成：新建 " + created + " 人，更新 " + updated + " 人");
    renderApp();
  });
}

/* ---------- 学生池 ---------- */

function renderStudentPool(body) {
  const q = (window.__stuSearch || "").trim();
  const tagFilter = window.__stuTag || "";

  let list = DB.students.slice().sort(function (a, b) { return (a.no || "").localeCompare(b.no || ""); });
  if (q) {
    list = list.filter(function (s) {
      return (s.name || "").indexOf(q) >= 0 || (s.no || "").indexOf(q) >= 0 || (s.className || "").indexOf(q) >= 0;
    });
  }
  if (tagFilter) list = list.filter(function (s) { return (s.tags || []).indexOf(tagFilter) >= 0; });

  let h = '<div class="card"><div class="card-body" style="border-bottom:1px solid var(--border)"><div class="flex">' +
    '<input class="input search-input" id="stu-search" placeholder="搜索姓名 / 学号 / 班级" value="' + esc(q) + '">' +
    '<select class="input" id="stu-tag-filter" style="width:160px">' +
    '<option value="">全部标签</option>' +
    STUDENT_TAGS.map(function (t) { return '<option value="' + t + '"' + (tagFilter === t ? " selected" : "") + ">" + t + "</option>"; }).join("") +
    "</select></div></div>";

  if (!DB.students.length) {
    h += '<div class="empty">学生档案为空：点击「导入学生」用 Excel 模板批量建档（模板可在本页导入弹窗或“学期与设置 → 数据管理”下载），或手动新建</div>';
  } else if (!list.length) {
    h += '<div class="empty">没有符合条件的学生</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>学号</th><th>姓名</th><th>性别</th><th>班级</th><th>宿舍</th><th>电话</th><th>标签</th><th style="width:110px">操作</th></tr></thead><tbody>';
    list.forEach(function (s) {
      h += "<tr><td>" + esc(s.no || "-") + "</td>" +
        '<td><span class="link" data-go="student/' + s.id + '"><b>' + esc(s.name) + "</b></span></td>" +
        "<td>" + esc(s.gender || "-") + "</td><td>" + esc(s.className || "-") + "</td><td>" + esc(s.dorm || "-") + "</td><td>" + esc(s.phone || "-") + "</td>" +
        "<td>" + (s.tags || []).map(function (t) { return badge(t, t === "心理关注" ? "red" : t === "资助" ? "amber" : "gray"); }).join(" ") + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-stu-edit="' + s.id + '">编辑</span><span class="link" data-stu-del="' + s.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  body.innerHTML = h;

  const search = $("#stu-search", body);
  search.addEventListener("input", function () {
    window.__stuSearch = search.value;
    const pos = search.selectionStart;
    renderStudentPool(body);
    const nsearch = $("#stu-search", body);
    nsearch.focus();
    nsearch.setSelectionRange(pos, pos);
  });
  $("#stu-tag-filter", body).addEventListener("change", function (e) {
    window.__stuTag = e.target.value;
    renderStudentPool(body);
  });
  $$("[data-stu-edit]", body).forEach(function (el) { el.addEventListener("click", function () { studentForm(getStudent(el.getAttribute("data-stu-edit")), null); }); });
  $$("[data-stu-del]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      const s = getStudent(el.getAttribute("data-stu-del"));
      confirmModal("确定删除学生 <b>" + esc(s.name) + "</b>？<br><span style='color:var(--red-600)'>其选课、成绩、考勤、台账关联将一并移除，建议仅在录错人时使用。</span>", function () {
        DB.students = DB.students.filter(function (x) { return x.id !== s.id; });
        DB.courses.forEach(function (c) { c.roster = (c.roster || []).filter(function (id) { return id !== s.id; }); });
        DB.grades = DB.grades.filter(function (g) { return g.studentId !== s.id; });
        DB.attendance.forEach(function (a) { if (a.records) delete a.records[s.id]; });
        DB.logs.forEach(function (l) { l.studentIds = (l.studentIds || []).filter(function (id) { return id !== s.id; }); });
        DB.awards = DB.awards.filter(function (a) { return a.studentId !== s.id; });
        DB.compResults.forEach(function (r) { r.studentIds = (r.studentIds || []).filter(function (id) { return id !== s.id; }); });
        saveDB();
        toast("学生档案已删除");
        renderApp();
      }, "删除");
    });
  });
}

function studentForm(student, afterCreate) {
  formModal({
    title: student ? "编辑学生档案" : "新建学生档案",
    body:
      '<div class="form-row">' +
      fieldHTML("学号", inputHTML("no", student ? student.no : "")) +
      fieldHTML("姓名", inputHTML("name", student ? student.name : ""), true) +
      fieldHTML("性别", selectHTML("gender", student ? student.gender : "男", ["男", "女"], { allowEmpty: true })) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("班级", inputHTML("className", student ? student.className : "", { placeholder: "如：计科2301" })) +
      fieldHTML("宿舍", inputHTML("dorm", student ? student.dorm : "", { placeholder: "如：松园3栋412" })) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("电话", inputHTML("phone", student ? student.phone : "")) +
      fieldHTML("生源地", inputHTML("hometown", student ? student.hometown : "")) +
      "</div>" +
      fieldHTML("家庭情况", textareaHTML("family", student ? student.family : "", { rows: 2, placeholder: "如有特殊情况请简要记录" })) +
      fieldHTML("标签（可多选）", '<div class="flex">' + STUDENT_TAGS.map(function (t) {
        return '<label class="flex" style="gap:4px;font-size:13px;margin-right:12px"><input type="checkbox" name="tag_' + t + '"' + (student && (student.tags || []).indexOf(t) >= 0 ? " checked" : "") + ">" + t + "</label>";
      }).join("") + "</div>") +
      fieldHTML("备注", textareaHTML("notes", student ? student.notes : "", { rows: 2 })),
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写姓名"); return false; }
      const tags = STUDENT_TAGS.filter(function (t) { return data["tag_" + t]; });
      const payload = {
        no: data.no.trim(), name: data.name.trim(), gender: data.gender,
        className: data.className.trim(), dorm: data.dorm.trim(), phone: data.phone.trim(),
        hometown: data.hometown.trim(), family: data.family.trim(), notes: data.notes.trim(), tags: tags
      };
      if (student) {
        Object.assign(student, payload);
        saveDB();
        toast("档案已更新");
        renderApp();
      } else {
        const ns = Object.assign({ id: uid() }, payload);
        DB.students.push(ns);
        saveDB();
        toast("学生已建档");
        if (afterCreate) afterCreate(ns); else renderApp();
      }
    }
  });
}

/* ---------- 学生详情 ---------- */

function renderStudentDetail(view, studentId) {
  const s = getStudent(studentId);
  if (!s) { view.innerHTML = '<div class="empty">学生不存在<button class="btn btn-light btn-sm" data-go="students" style="margin-top:14px">返回</button></div>'; return; }

  let h = '<div class="page-head"><div class="flex"><span class="link" data-go="students" style="margin-right:4px">学生管理</span><span class="muted">/</span>' +
    '<div class="page-title">' + esc(s.name) + "<small>" + esc(s.no || "") + " · " + esc(s.className || "") + "</small></div></div>" +
    '<div class="toolbar"><button class="btn btn-light" data-stu-edit="' + s.id + '">编辑档案</button><button class="btn" id="stu-log-add">记一次谈话</button></div></div>';

  h += '<div class="grid grid-2">';
  h += '<div class="card"><div class="card-head"><div class="card-title">基本档案</div>' +
    (s.tags || []).map(function (t) { return badge(t, t === "心理关注" ? "red" : "amber"); }).join(" ") +
    '</div><div class="card-body"><div class="kv">' +
    "<div class='k'>性别</div><div>" + esc(s.gender || "-") + "</div>" +
    "<div class='k'>宿舍</div><div>" + esc(s.dorm || "-") + "</div>" +
    "<div class='k'>电话</div><div>" + esc(s.phone || "-") + "</div>" +
    "<div class='k'>生源地</div><div>" + esc(s.hometown || "-") + "</div>" +
    "<div class='k'>家庭情况</div><div>" + esc(s.family || "-") + "</div>" +
    "<div class='k'>备注</div><div>" + esc(s.notes || "-") + "</div>" +
    "</div></div></div>";

  const courses = studentCourses(s.id);
  h += '<div class="card"><div class="card-head"><div class="card-title">选课与成绩</div></div>';
  if (!courses.length) {
    h += '<div class="empty" style="padding:20px">该生暂无选课记录</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>课程</th><th>平时</th><th>期中</th><th>期末</th><th>总评</th><th>旷课</th></tr></thead><tbody>';
    courses.forEach(function (c) {
      const g = DB.grades.find(function (x) { return x.courseId === c.id && x.studentId === s.id; }) || {};
      const total = totalScore(g, c.weights);
      h += '<tr class="clickable" data-go="course/' + c.id + '"><td><b>' + esc(c.name) + "</b></td>" +
        "<td>" + esc(g.regular != null ? g.regular : "-") + "</td><td>" + esc(g.midterm != null ? g.midterm : "-") + "</td>" +
        "<td>" + esc(g.final != null ? g.final : "-") + "</td>" +
        "<td>" + (total == null ? "-" : '<span style="font-weight:600;color:' + (total < 60 ? "var(--red-600)" : "var(--text)") + '">' + total + "</span>") + "</td>" +
        "<td>" + absentCount(c.id, s.id) + "</td></tr>";
    });
    h += "</tbody></table>";
  }
  h += "</div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">相关记录</div></div>';
  const logs = DB.logs.filter(function (l) { return (l.studentIds || []).indexOf(s.id) >= 0; });
  const awards = DB.awards.filter(function (a) { return a.studentId === s.id; });
  const compRs = DB.compResults.filter(function (r) { return (r.studentIds || []).indexOf(s.id) >= 0; });
  const todos = DB.todos.filter(function (t) { return (t.studentIds || []).indexOf(s.id) >= 0; });

  if (!logs.length && !awards.length && !compRs.length && !todos.length) {
    h += '<div class="empty" style="padding:24px">暂无谈话、走访、获奖、跟踪记录</div>';
  } else {
    h += '<div class="card-body"><div class="timeline">';
    todos.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) {
      h += '<div class="tl-item"><div class="tl-dot" style="border-color:var(--amber-400,#EF9F27)"></div>' +
        '<div class="tl-date">' + esc(t.date) + " · 跟踪事项</div>" +
        '<div class="tl-title"><b>' + esc(t.title) + "</b> " +
        (t.status === "完成" ? badge("完成", "green") : badge("准备", "amber")) + "</div></div>";
    });
    logs.slice().reverse().forEach(function (l) {
      h += '<div class="tl-item"><div class="tl-dot" style="border-color:var(--' + ledgerTypeColor(l.type) + '-400)"></div>' +
        '<div class="tl-date">' + esc(l.date) + " · " + esc(l.type) + "</div>" +
        '<div class="tl-title"><b>' + esc(l.title) + "</b> — " + esc((l.content || "").slice(0, 80)) + ((l.content || "").length > 80 ? "…" : "") + "</div>" +
        (l.followUp ? '<div class="muted">跟进：' + esc(l.followUp) + (l.done ? "（已完成）" : "") + "</div>" : "") + "</div>";
    });
    compRs.forEach(function (r) {
      const comp = getCompetition(r.competitionId);
      h += '<div class="tl-item"><div class="tl-dot" style="border-color:var(--amber-400,#EF9F27)"></div>' +
        '<div class="tl-date">' + esc(r.date) + " · 竞赛获奖</div>" +
        '<div class="tl-title"><b>' + esc(comp ? comp.name : "") + "</b> " + badge(r.level, "amber") + "</div></div>";
    });
    awards.forEach(function (a) {
      h += '<div class="tl-item"><div class="tl-dot" style="border-color:var(--green-600)"></div>' +
        '<div class="tl-date">' + esc(a.date) + " · 评奖评优</div>" +
        '<div class="tl-title"><b>' + esc(a.name) + "</b> " + esc(a.level || "") + "</div></div>";
    });
    h += "</div></div>";
  }
  h += "</div>";

  view.innerHTML = h;
  const editBtn = $("[data-stu-edit]", view);
  editBtn && editBtn.addEventListener("click", function () { studentForm(s, null); });
  $("#stu-log-add", view).addEventListener("click", function () { logForm(null, s.id); });
}

/* ---------- 工作台账 ---------- */

function renderLogList(body) {
  const list = DB.logs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });

  let h = '<div class="card"><div class="card-head"><div class="card-title">班主任工作台账（' + list.length + " 条）</div>" +
    '<div class="toolbar">' +
    '<select class="input" id="log-type-filter" style="width:130px"><option value="">全部类型</option>' +
    LOG_TYPES.map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select>" +
    '<button class="btn" id="log-add">新增台账</button></div></div>';

  const typeFilter = window.__logType || "";
  const filtered = typeFilter ? list.filter(function (l) { return l.type === typeFilter; }) : list;

  if (!filtered.length) {
    h += '<div class="empty">还没有台账记录——谈话、走访、班会，以及评奖评优、就业、贫困生申报等班级工作都值得留档</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th style="width:100px">日期</th><th style="width:86px">类型</th><th>事项与学生</th><th>跟进</th><th style="width:150px">操作</th></tr></thead><tbody>';
    filtered.forEach(function (l) {
      const names = (l.studentIds || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
      h += "<tr><td>" + esc(l.date) + "</td><td>" + badge(l.type, ledgerTypeColor(l.type)) + "</td>" +
        "<td><b>" + esc(l.title) + "</b>" + (names ? '<div class="muted">' + esc(names) + "</div>" : "") +
        '<div class="muted" style="margin-top:2px">' + esc((l.content || "").slice(0, 60)) + ((l.content || "").length > 60 ? "…" : "") + "</div></td>" +
        "<td>" + (l.followUp ? (l.done ? badge("已完成", "green") : esc(l.followUp)) : "-") + "</td>" +
        '<td><span class="flex" style="gap:10px">' +
        (l.followUp && !l.done ? '<span class="link" data-log-todo="' + l.id + '">转跟踪事项</span>' : "") +
        '<span class="link" data-log-edit="' + l.id + '">编辑</span>' +
        (l.followUp && !l.done ? '<span class="link" data-log-done="' + l.id + '">完成</span>' : "") +
        '<span class="link" data-log-del="' + l.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";
  body.innerHTML = h;

  $("#log-add", body).addEventListener("click", function () { logForm(null, null); });
  $("#log-type-filter", body).addEventListener("change", function (e) { window.__logType = e.target.value; renderApp(); });
  const sel = $("#log-type-filter", body);
  if (window.__logType) sel.value = window.__logType;

  $$("[data-log-edit]", body).forEach(function (el) { el.addEventListener("click", function () { logForm(DB.logs.find(function (l) { return l.id === el.getAttribute("data-log-edit"); }), null); }); });
  $$("[data-log-todo]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      const l = DB.logs.find(function (x) { return x.id === el.getAttribute("data-log-todo"); });
      if (l) todoFromLog(l);
    });
  });
  $$("[data-log-done]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      const l = DB.logs.find(function (x) { return x.id === el.getAttribute("data-log-done"); });
      l.done = true; saveDB(); toast("已标记完成"); renderApp();
    });
  });
  $$("[data-log-del]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除这条台账记录？", function () {
        DB.logs = DB.logs.filter(function (l) { return l.id !== el.getAttribute("data-log-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });
}

function logForm(log, presetStudentId) {
  formModal({
    title: log ? "编辑台账" : "新增台账", wide: true,
    body:
      '<div class="form-row">' +
      fieldHTML("日期", inputHTML("date", log ? log.date : todayISO(), { type: "date" }), true) +
      fieldHTML("类型", selectHTML("type", log ? log.type : (presetStudentId ? "谈话" : "班会"), LOG_TYPES)) +
      "</div>" +
      fieldHTML("标题", inputHTML("title", log ? log.title : "", { placeholder: "如：开学以来状态低迷约谈 / 走访松园3栋" }), true) +
      fieldHTML("内容记录", textareaHTML("content", log ? log.content : "", { rows: 5, placeholder: "记录要点、学生反馈、处理措施等" })) +
      fieldHTML("跟进安排", inputHTML("followUp", log ? log.followUp : "", { placeholder: "如：两周后回访出勤情况（留空表示无需跟进）" })) +
      fieldHTML("涉及学生（可多选）", '<div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:10px">' +
        (DB.students.length ? DB.students.map(function (s) {
          return '<label class="flex" style="gap:6px;font-size:13px;margin:0 0 8px 0"><input type="checkbox" name="stu_' + s.id + '"' +
            ((log && (log.studentIds || []).indexOf(s.id) >= 0) || s.id === presetStudentId ? " checked" : "") + ">" +
            esc(s.name) + '<span class="muted">' + esc(s.no || "") + "</span></label>";
        }).join("") : '<span class="hint">学生池为空</span>') + "</div>"),
    onSubmit: function (data) {
      if (!data.title.trim()) { toast("请填写标题"); return false; }
      const studentIds = DB.students.filter(function (s) { return data["stu_" + s.id]; }).map(function (s) { return s.id; });
      const payload = {
        date: data.date, type: data.type, title: data.title.trim(),
        content: data.content.trim(), followUp: data.followUp.trim(), studentIds: studentIds
      };
      if (log) {
        Object.assign(log, payload);
        toast("台账已更新");
      } else {
        DB.logs.push(Object.assign({ id: uid(), done: false }, payload));
        toast("台账已记录");
      }
      saveDB();
      renderApp();
    }
  });
}

/* ---------- 跟踪事项 ---------- */

function renderTodoList(body) {
  /* 未完成在前（按日期升序），已完成在后（按日期降序） */
  const pending = DB.todos.filter(function (t) { return t.status !== "完成"; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  const done = DB.todos.filter(function (t) { return t.status === "完成"; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  const list = pending.concat(done);

  let h = '<div class="card"><div class="card-head"><div class="card-title">跟踪事项（' + DB.todos.length + " 项，待办 " + pending.length + "）</div>" +
    '<span class="muted">班级事务盯办 · 可从工作台账一键转事项 · 自动同步教学日历与仪表盘明日提醒</span>' +
    '<button class="btn" id="todo-add">新增事项</button></div>';

  if (!list.length) {
    h += '<div class="empty">还没有跟踪事项——班费收缴、材料提交、活动筹备等需要盯办的事务都可以在这里登记</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th style="width:104px">日期</th><th>事项</th><th>涉及学生</th><th style="width:90px">状态</th><th style="width:150px">操作</th></tr></thead><tbody>';
    list.forEach(function (t) {
      const names = (t.studentIds || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
      const isDone = t.status === "完成";
      const linked = t.ledgerId ? getLog(t.ledgerId) : null;
      h += '<tr class="' + (isDone ? "muted" : "") + '"><td>' + esc(t.date) +
        (daysUntil(t.date) === 0 && !isDone ? " <span class='badge badge-red'>今天</span>" : "") +
        (daysUntil(t.date) === 1 && !isDone ? " <span class='badge badge-amber'>明天</span>" : "") +
        (daysUntil(t.date) < 0 && !isDone ? " <span class='badge badge-red'>已逾期</span>" : "") +
        "</td><td><b>" + esc(t.title) + "</b>" +
        (linked ? " " + badge("台账·" + linked.type, ledgerTypeColor(linked.type)) : "") +
        (t.note ? '<div class="muted">' + esc(t.note) + "</div>" : "") + "</td>" +
        "<td>" + (names ? esc(names) : "-") + "</td>" +
        "<td>" + (isDone ? badge("完成", "green") : badge("准备", "amber")) + "</td>" +
        '<td><span class="flex" style="gap:10px">' +
        (isDone
          ? '<span class="link" data-todo-reopen="' + t.id + '">恢复</span>'
          : '<span class="link" data-todo-done="' + t.id + '">完成</span>') +
        '<span class="link" data-todo-edit="' + t.id + '">编辑</span>' +
        '<span class="link" data-todo-del="' + t.id + '">删除</span></span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";
  body.innerHTML = h;

  $("#todo-add", body).addEventListener("click", function () { todoForm(null); });

  $$("[data-todo-done]", body).forEach(function (el) {
    el.addEventListener("click", function () { setTodoStatus(el.getAttribute("data-todo-done"), "完成"); });
  });
  $$("[data-todo-reopen]", body).forEach(function (el) {
    el.addEventListener("click", function () { setTodoStatus(el.getAttribute("data-todo-reopen"), "准备"); });
  });
  $$("[data-todo-edit]", body).forEach(function (el) {
    el.addEventListener("click", function () { todoForm(getTodo(el.getAttribute("data-todo-edit"))); });
  });
  $$("[data-todo-del]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      const t = getTodo(el.getAttribute("data-todo-del"));
      if (!t) return;
      confirmModal("确定删除跟踪事项 <b>" + esc(t.title) + "</b>？", function () {
        DB.todos = DB.todos.filter(function (x) { return x.id !== t.id; });
        saveDB(); toast("事项已删除"); renderApp();
      }, "删除");
    });
  });
}

function setTodoStatus(id, status) {
  const t = getTodo(id);
  if (!t) return;
  t.status = status;
  saveDB();
  toast(status === "完成" ? "已标记完成，日历将显示为绿色" : "已恢复为待办");
  renderApp();
}

function getTodo(id) {
  return (DB.todos || []).find(function (t) { return t.id === id; }) || null;
}

/* 从台账条目一键转跟踪事项：标题、跟进安排、涉及学生一并带入，并自动关联台账 */
function todoFromLog(log) {
  todoForm(null, {
    title: log.title, note: log.followUp || "", ledgerId: log.id, studentIds: log.studentIds || []
  });
}

function todoForm(todo, prefill) {
  const t = todo || prefill || {};
  const linkedLogs = DB.logs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  formModal({
    title: todo ? "编辑跟踪事项" : "新增跟踪事项",
    body:
      '<div class="form-row">' +
      fieldHTML("事项标题", inputHTML("title", t.title || "", { placeholder: "如：收缴英语四级报名费" }), true) +
      fieldHTML("截止日期", inputHTML("date", t.date || todayISO(), { type: "date" }), true) +
      "</div>" +
      '<div class="form-row">' +
      fieldHTML("状态", selectHTML("status", t.status || "准备", ["准备", "完成"])) +
      fieldHTML("备注", inputHTML("note", t.note || "", { placeholder: "如：每人 30 元，扫码收款后登记" })) +
      "</div>" +
      fieldHTML("关联台账（可选）", selectHTML("ledgerId", t.ledgerId || "", linkedLogs.map(function (l) {
        return { value: l.id, text: l.type + " · " + l.date + " " + l.title };
      }), { allowEmpty: true, emptyText: "不关联，独立登记事项" }) +
        '<div class="hint" style="margin-top:5px">从工作台账（评奖评优 / 就业 / 贫困生申报等）中选择一条关联，日历将显示台账类型标签</div>') +
      fieldHTML("涉及学生（可多选）", '<div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:10px">' +
        (DB.students.length ? DB.students.map(function (s) {
          return '<label class="flex" style="gap:6px;font-size:13px;margin:0 0 8px 0"><input type="checkbox" name="stu_' + s.id + '"' +
            ((t.studentIds || []).indexOf(s.id) >= 0 ? " checked" : "") + ">" +
            esc(s.name) + '<span class="muted">' + esc(s.no || "") + "</span></label>";
        }).join("") : '<span class="hint">学生池为空</span>') + "</div>"),
    onSubmit: function (data) {
      if (!data.title.trim()) { toast("请填写事项标题"); return false; }
      if (!data.date) { toast("请选择截止日期"); return false; }
      const studentIds = DB.students.filter(function (s) { return data["stu_" + s.id]; }).map(function (s) { return s.id; });
      const payload = {
        title: data.title.trim(), date: data.date, status: data.status,
        note: data.note.trim(), studentIds: studentIds
      };
      if (data.ledgerId) payload.ledgerId = data.ledgerId;
      if (todo) {
        Object.assign(todo, payload);
        if (!data.ledgerId) delete todo.ledgerId;
        toast("事项已更新");
      } else {
        DB.todos.push(Object.assign({ id: uid() }, payload));
        toast("事项已登记，将同步到教学日历");
      }
      saveDB();
      renderApp();
    }
  });
}

/* ---------- 评奖评优 ---------- */

function renderAwardList(body) {
  const list = DB.awards.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  let h = '<div class="card"><div class="card-head"><div class="card-title">评奖评优记录</div><button class="btn" id="award-add">新增记录</button></div>';
  if (!list.length) {
    h += '<div class="empty">暂无评奖评优记录</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th style="width:100px">日期</th><th>学生</th><th>荣誉名称</th><th>级别</th><th>备注</th><th style="width:60px">操作</th></tr></thead><tbody>';
    list.forEach(function (a) {
      const s = getStudent(a.studentId);
      h += "<tr><td>" + esc(a.date) + "</td><td>" + (s ? '<span class="link" data-go="student/' + s.id + '">' + esc(s.name) + "</span>" : "-") + "</td>" +
        "<td><b>" + esc(a.name) + "</b></td><td>" + levelBadge(a.level) + "</td><td>" + esc(a.note || "-") + "</td>" +
        '<td><span class="link" data-award-del="' + a.id + '">删除</span></td></tr>';
    });
    h += "</tbody></table>";
  }
  h += "</div>";
  body.innerHTML = h;

  $("#award-add", body).addEventListener("click", function () {
    formModal({
      title: "新增评奖评优",
      body:
        '<div class="form-row">' +
        fieldHTML("日期", inputHTML("date", todayISO(), { type: "date" }), true) +
        fieldHTML("学生", selectHTML("studentId", "", DB.students.map(function (s) { return { value: s.id, text: s.name + "（" + (s.no || "") + "）" }; }), { allowEmpty: true, emptyText: "请选择学生" }), true) +
        "</div>" +
        '<div class="form-row">' +
        fieldHTML("荣誉名称", inputHTML("name", "", { placeholder: "如：国家奖学金 / 校三好学生" }), true) +
        fieldHTML("级别", selectHTML("level", "校级", ["国家级", "省级", "校级", "院级"])) +
        "</div>" +
        fieldHTML("备注", inputHTML("note", "")),
      onSubmit: function (data) {
        if (!data.studentId) { toast("请选择学生"); return false; }
        if (!data.name.trim()) { toast("请填写荣誉名称"); return false; }
        DB.awards.push({ id: uid(), date: data.date, studentId: data.studentId, name: data.name.trim(), level: data.level, note: data.note.trim() });
        saveDB(); toast("记录已保存"); renderApp();
      }
    });
  });
  $$("[data-award-del]", body).forEach(function (el) {
    el.addEventListener("click", function () {
      confirmModal("确定删除这条记录？", function () {
        DB.awards = DB.awards.filter(function (a) { return a.id !== el.getAttribute("data-award-del"); });
        saveDB(); toast("已删除"); renderApp();
      });
    });
  });
}

/* ---------- 统计分析（学生管理独立模块） ---------- */

function renderStudentStats(body) {
  const logs = DB.logs || [];
  const todos = DB.todos || [];
  const students = DB.students || [];

  /* 台账分类统计 */
  const byType = {};
  LOG_TYPES.forEach(function (t) { byType[t] = { total: 0, done: 0 }; });
  logs.forEach(function (l) {
    const k = byType[l.type] ? l.type : "其他";
    byType[k].total++;
    if (l.done) byType[k].done++;
  });
  const logDone = logs.filter(function (l) { return l.done; }).length;

  /* 月度台账趋势（近 6 个月） */
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    months.push({ key: key, label: d.getFullYear() + "年" + (d.getMonth() + 1) + "月", n: 0 });
  }
  logs.forEach(function (l) {
    const k = String(l.date || "").slice(0, 7);
    const m = months.find(function (x) { return x.key === k; });
    if (m) m.n++;
  });

  /* 跟踪事项统计 */
  const todoPending = todos.filter(function (t) { return t.status !== "完成"; });
  const todoDone = todos.filter(function (t) { return t.status === "完成"; });
  const todoOverdue = todoPending.filter(function (t) { return t.date < todayISO(); });
  const todoSoon = todoPending.filter(function (t) {
    const d = daysUntil(t.date);
    return d !== null && d >= 0 && d <= 7;
  }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  const doneRate = todos.length ? Math.round(todoDone.length / todos.length * 100) : 0;

  /* 就业 · 资助 · 评优动态 */
  const dynamicLogs = logs.filter(function (l) {
    return l.type === "就业" || l.type === "贫困生申报" || l.type === "评奖评优";
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });

  /* 学生维度活跃度 */
  const perStu = {};
  students.forEach(function (s) { perStu[s.id] = { name: s.name, cls: s.className, logs: 0, todos: 0 }; });
  logs.forEach(function (l) { (l.studentIds || []).forEach(function (id) { if (perStu[id]) perStu[id].logs++; }); });
  todos.forEach(function (t) { (t.studentIds || []).forEach(function (id) { if (perStu[id]) perStu[id].todos++; }); });
  const actives = Object.keys(perStu).map(function (id) { return perStu[id]; })
    .filter(function (x) { return x.logs + x.todos > 0; })
    .sort(function (a, b) { return (b.logs + b.todos) - (a.logs + a.todos); })
    .slice(0, 8);

  /* 班级分布 */
  const classes = {};
  students.forEach(function (s) {
    const cn = s.className || "未分班";
    classes[cn] = (classes[cn] || 0) + 1;
  });
  const maxC = Math.max.apply(null, Object.keys(classes).map(function (k) { return classes[k]; }).concat([1]));

  /* 重点关注群体 */
  const tagCnt = {};
  students.forEach(function (s) { (s.tags || []).forEach(function (t) { tagCnt[t] = (tagCnt[t] || 0) + 1; }); });

  const maxType = Math.max.apply(null, LOG_TYPES.map(function (t) { return byType[t].total; }).concat([1]));
  const maxMonth = Math.max.apply(null, months.map(function (m) { return m.n; }).concat([1]));
  const typeFill = {
    "谈话": "var(--blue-400)", "走访宿舍": "var(--green-400)", "班会": "var(--purple-400)",
    "活动": "var(--amber-400)", "评奖评优": "var(--red-400)", "就业": "var(--teal-400)",
    "贫困生申报": "var(--purple-400)", "其他": "var(--gray-400)"
  };

  let h = '<div class="card"><div class="card-head"><div class="card-title">班主任工作概览</div><span class="muted">统计口径：本机全部数据 · 台账含评奖评优 / 就业 / 贫困生申报</span></div><div class="card-body">' +
    '<div class="grid grid-4" style="gap:12px">' +
    statCard("学生总数", students.length, "人", "档案池") +
    statCard("台账记录", logs.length, "条", "已完成 " + logDone + " 条") +
    statCard("跟踪事项", todos.length, "项", "待办 " + todoPending.length + " · 逾期 " + todoOverdue.length) +
    statCard("事项完成率", doneRate + "%", "", todoDone.length + " / " + todos.length) +
    "</div></div></div>";

  h += '<div class="grid grid-2">';
  h += '<div class="card"><div class="card-head"><div class="card-title">班级分布（共 ' + students.length + ' 人）</div></div><div class="card-body">';
  Object.keys(classes).sort().forEach(function (k) {
    h += '<div class="hbar-row"><div class="hbar-label">' + esc(k) + "</div>" +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(classes[k] / maxC * 100) + '%">' + classes[k] + "</div></div></div>";
  });
  if (!Object.keys(classes).length) h += '<div class="hint">暂无学生数据</div>';
  h += "</div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">重点关注群体</div></div><div class="card-body">';
  if (!Object.keys(tagCnt).length) h += '<div class="hint">暂无标记学生</div>';
  else {
    h += '<table class="tbl"><tbody>' +
      STUDENT_TAGS.map(function (t) {
        return "<tr><td>" + badge(t, t === "心理关注" ? "red" : "amber") + "</td><td style='text-align:right;font-weight:600'>" + (tagCnt[t] || 0) + " 人</td></tr>";
      }).join("") + "</tbody></table>";
  }
  h += "</div></div></div>";

  h += '<div class="grid grid-2">';
  h += '<div class="card"><div class="card-head"><div class="card-title">台账分类统计（' + logs.length + " 条）</div></div><div class=\"card-body\">";
  LOG_TYPES.forEach(function (t) {
    const d = byType[t];
    h += '<div class="hbar-row"><div class="hbar-label">' + esc(t) + "</div>" +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(d.total / maxType * 100) + '%;background:' + typeFill[t] + '">' +
      d.total + (d.done ? '<span style="opacity:.8"> · ' + d.done + "</span>" : "") + "</div></div></div>";
  });
  h += '<div class="hint" style="margin-top:8px">条数 · 其中已完成数；台账数据会自动汇入「考核汇总」的班主任工作量。</div></div></div>';

  h += '<div class="card"><div class="card-head"><div class="card-title">台账月度趋势</div><span class="muted">近 6 个月</span></div><div class="card-body">';
  months.forEach(function (m) {
    h += '<div class="hbar-row"><div class="hbar-label" style="flex-basis:96px">' + esc(m.label) + "</div>" +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.round(m.n / maxMonth * 100) + '%">' + (m.n || "") + "</div></div></div>";
  });
  if (!months.some(function (m) { return m.n > 0; })) h += '<div class="hint">近 6 个月没有台账记录</div>';
  h += "</div></div></div>";

  h += '<div class="grid grid-2">';
  h += '<div class="card"><div class="card-head"><div class="card-title">跟踪事项统计</div><span class="muted">准备 / 完成 两态</span></div><div class="card-body">' +
    '<div class="grid grid-3" style="gap:10px">' +
    statCard("待办", todoPending.length, "项", todoOverdue.length ? "逾期 " + todoOverdue.length + " 项" : "无逾期") +
    statCard("已完成", todoDone.length, "项", "含历史事项") +
    statCard("完成率", doneRate + "%", "", todoDone.length + " / " + todos.length) +
    "</div>" +
    '<div class="bar-track" style="margin-top:12px"><div class="bar-fill" style="width:' + doneRate + '%"></div></div>' +
    (todoSoon.length
      ? '<div class="section-title">近 7 天到期</div><table class="tbl"><tbody>' + todoSoon.slice(0, 6).map(function (t) {
          const lg = t.ledgerId ? getLog(t.ledgerId) : null;
          return "<tr><td>" + esc(t.date) + "</td><td>" + esc(t.title) +
            (lg ? " " + badge(lg.type, ledgerTypeColor(lg.type)) : "") + "</td></tr>";
        }).join("") + "</tbody></table>"
      : '<div class="hint" style="margin-top:10px">近 7 天没有到期事项</div>') +
    "</div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">就业 · 资助 · 评优动态</div><span class="muted">台账条目</span></div><div class="card-body">';
  if (!dynamicLogs.length) {
    h += '<div class="hint">暂无就业、资助、评优类台账——可在「工作台账」中按类型登记</div>';
  } else {
    h += '<div class="timeline">';
    dynamicLogs.forEach(function (l) {
      const names = (l.studentIds || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
      h += '<div class="tl-item"><div class="tl-dot" style="border-color:var(--' + ledgerTypeColor(l.type) + '-400)"></div>' +
        '<div class="tl-date">' + esc(l.date) + " · " + badge(l.type, ledgerTypeColor(l.type)) + "</div>" +
        '<div class="tl-title">' + esc(l.title) + (names ? '<span class="muted">（' + esc(names) + "）</span>" : "") + "</div></div>";
    });
    h += "</div>";
  }
  h += "</div></div></div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">学生工作活跃度 TOP</div><span class="muted">按台账 + 跟踪事项涉及次数</span></div>';
  if (!actives.length) {
    h += '<div class="empty">暂无数据——新增台账或跟踪事项后自动生成</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th>学生</th><th>班级</th><th>台账</th><th>事项</th><th>合计</th></tr></thead><tbody>';
    actives.forEach(function (x) {
      h += "<tr><td><b>" + esc(x.name) + "</b></td><td>" + esc(x.cls || "-") + "</td>" +
        "<td>" + x.logs + " 次</td><td>" + x.todos + " 次</td>" +
        '<td><span style="font-weight:600">' + (x.logs + x.todos) + "</span></td></tr>";
    });
    h += "</tbody></table>";
  }
  h += "</div>";

  body.innerHTML = h;
}
