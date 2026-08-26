"use strict";

let studentTab = "pool";

const STUDENT_TAGS = ["资助", "心理关注", "重点关注", "学业预警"];
const LOG_TYPES = ["谈话", "走访宿舍", "班会", "活动", "其他"];

function renderStudents(view) {
  const tabs = [
    ["pool", "学生档案"],
    ["logs", "工作台账" + countBadge(DB.logs.filter(function (l) { return l.followUp && !l.done; }))],
    ["awards", "评奖评优" + countBadge(DB.awards)],
    ["stats", "就业与统计"]
  ];

  let h = '<div class="page-head"><div class="page-title">班主任学生管理<small>学生档案 · 谈心谈话 · 走访台账 · 评奖评优</small></div>' +
    '<div class="toolbar"><button class="btn btn-light" id="stu-import">导入学生</button><button class="btn" id="stu-add">新建学生档案</button></div></div>';
  h += '<div class="tabs">' + tabs.map(function (t) {
    return '<div class="tab' + (studentTab === t[0] ? " active" : "") + '" data-stu-tab="' + t[0] + '">' + t[1] + "</div>";
  }).join("") + "</div><div id='stu-tab-body'></div>";

  view.innerHTML = h;

  const body = $("#stu-tab-body", view);
  if (studentTab === "pool") renderStudentPool(body);
  else if (studentTab === "logs") renderLogList(body);
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

  if (!logs.length && !awards.length && !compRs.length) {
    h += '<div class="empty" style="padding:24px">暂无谈话、走访、获奖记录</div>';
  } else {
    h += '<div class="card-body"><div class="timeline">';
    logs.slice().reverse().forEach(function (l) {
      h += '<div class="tl-item"><div class="tl-dot" style="border-color:var(--blue-400)"></div>' +
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
    h += '<div class="empty">还没有台账记录——谈话、走访宿舍、班会都值得留下记录</div>';
  } else {
    h += '<table class="tbl"><thead><tr><th style="width:100px">日期</th><th style="width:86px">类型</th><th>事项与学生</th><th>跟进</th><th style="width:110px">操作</th></tr></thead><tbody>';
    filtered.forEach(function (l) {
      const names = (l.studentIds || []).map(function (id) { const s = getStudent(id); return s ? s.name : ""; }).filter(Boolean).join("、");
      h += "<tr><td>" + esc(l.date) + "</td><td>" + badge(l.type, l.type === "谈话" ? "blue" : l.type === "走访宿舍" ? "green" : "purple") + "</td>" +
        "<td><b>" + esc(l.title) + "</b>" + (names ? '<div class="muted">' + esc(names) + "</div>" : "") +
        '<div class="muted" style="margin-top:2px">' + esc((l.content || "").slice(0, 60)) + ((l.content || "").length > 60 ? "…" : "") + "</div></td>" +
        "<td>" + (l.followUp ? (l.done ? badge("已完成", "green") : esc(l.followUp)) : "-") + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-log-edit="' + l.id + '">编辑</span>' +
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

/* ---------- 就业与统计 ---------- */

function renderStudentStats(body) {
  const classes = {};
  DB.students.forEach(function (s) {
    const cn = s.className || "未分班";
    classes[cn] = (classes[cn] || 0) + 1;
  });

  const tagCnt = {};
  DB.students.forEach(function (s) { (s.tags || []).forEach(function (t) { tagCnt[t] = (tagCnt[t] || 0) + 1; }); });

  const logByType = {};
  DB.logs.forEach(function (l) { logByType[l.type] = (logByType[l.type] || 0) + 1; });

  let h = '<div class="grid grid-2">';
  h += '<div class="card"><div class="card-head"><div class="card-title">班级分布（共 ' + DB.students.length + ' 人）</div></div><div class="card-body">';
  const maxC = Math.max.apply(null, Object.keys(classes).map(function (k) { return classes[k]; }).concat([1]));
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

  h += '<div class="card"><div class="card-head"><div class="card-title">本学年班主任工作量（台账统计）</div></div><div class="card-body"><div class="flex">';
  LOG_TYPES.forEach(function (t) {
    h += '<div class="stat" style="flex:1;border:1px solid var(--border);border-radius:10px;margin-right:6px"><div class="stat-label">' + t + "</div>" +
      '<div class="stat-value" style="font-size:20px">' + (logByType[t] || 0) + '<span class="unit">次</span></div></div>';
  });
  h += '</div><div class="hint" style="margin-top:10px">这些数据会自动汇入“考核汇总”模块的班主任工作量部分。</div></div></div>';

  body.innerHTML = h;
}
