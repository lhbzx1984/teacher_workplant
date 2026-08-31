"use strict";

function renderSettings(view) {
  const s = DB.settings;

  let h = "";
  h += '<div class="page-head"><div class="page-title">学期与设置<small>学期是全局骨架，所有业务都挂在学年的时间轴上</small></div></div>';

  h += '<div class="card"><div class="card-head"><div class="card-title">教师信息</div></div><div class="card-body">' +
    '<div class="form-row">' +
    fieldHTML("姓名", '<input class="input" id="set-name" value="' + esc(s.teacherName) + '">') +
    fieldHTML("工号", '<input class="input" id="set-no" value="' + esc(s.teacherNo) + '">') +
    fieldHTML("所在学院", '<input class="input" id="set-dept" value="' + esc(s.dept) + '">') +
    "</div>" +
    '<button class="btn" id="set-save">保存</button></div></div>';

  h += '<div class="card"><div class="card-head"><div class="card-title">学期管理</div>' +
    '<button class="btn" id="term-add">新增学期</button></div>' +
    (DB.terms.length ? termsTableHTML() : '<div class="empty">还没有学期，点击“新增学期”开始</div>') +
    '<div class="card-body hint">提示：开始日期填开学第一周的<b>周一</b>，系统将据此自动计算当前教学周；同一时间只能有一个“当前学期”。</div></div>';

  h += '<div class="card"><div class="card-head"><div class="card-title">特殊日程<small style="font-weight:400;margin-left:6px">监考 · 毕业答辩 · 课程答辩 · 特殊事件，自动同步到仪表盘教学日历</small></div>' +
    '<button class="btn" id="event-add">新增日程</button></div>' +
    (DB.events.length ? eventsTableHTML() : '<div class="empty">还没有特殊日程，监考、答辩、例会、假期等均可在此登记</div>') +
    "</div>";

  h += '<div class="card"><div class="card-head"><div class="card-title">数据管理</div></div><div class="card-body">' +
    '<div class="info-box">数据保存在本浏览器的本地存储中，仅限本机访问。建议每学期初、期末各导出一次备份文件。</div>' +
    '<div class="flex">' +
    '<button class="btn" id="data-export">导出备份（JSON）</button>' +
    '<button class="btn btn-light" id="data-import">从备份文件恢复</button>' +
    '<input type="file" id="data-import-file" accept=".json" style="display:none">' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-light" id="data-tpl">下载学生导入模板</button>' +
    '<button class="btn btn-light" id="data-reseed">载入演示数据</button>' +
    '<button class="btn btn-danger" id="data-clear">清空全部数据</button>' +
    "</div></div></div>";

  view.innerHTML = h;
  bindSettings(view);
}

function termsTableHTML() {
  return '<table class="tbl"><thead><tr><th>学期</th><th>开始日期</th><th>周数</th><th>当前</th><th>关联课程</th><th style="width:150px">操作</th></tr></thead><tbody>' +
    DB.terms.slice().sort(function (a, b) { return a.startDate < b.startDate ? 1 : -1; }).map(function (t) {
      const n = DB.courses.filter(function (c) { return c.termId === t.id; }).length;
      return "<tr><td><b>" + esc(t.name) + "</b></td><td>" + esc(t.startDate) + "</td><td>" + t.weeks + " 周</td>" +
        "<td>" + (t.current ? badge("当前学期", "blue") : "") + "</td><td>" + n + " 门</td>" +
        '<td><span class="flex" style="gap:10px">' +
        (t.current ? "" : '<span class="link" data-term-cur="' + t.id + '">设为当前</span>') +
        '<span class="link" data-term-edit="' + t.id + '">编辑</span>' +
        '<span class="link" data-term-del="' + t.id + '">删除</span></span></td></tr>';
    }).join("") + "</tbody></table>";
}

function termForm(term) {
  formModal({
    title: term ? "编辑学期" : "新增学期",
    body:
      fieldHTML("学期名称", inputHTML("name", term ? term.name : "2026-2027学年 第一学期", { placeholder: "如：2026-2027学年 第一学期" }), true) +
      '<div class="form-row">' +
      fieldHTML("开始日期（开学首日周一）", inputHTML("startDate", term ? term.startDate : todayISO(), { type: "date" }), true) +
      fieldHTML("教学周数", inputHTML("weeks", term ? term.weeks : 18, { type: "number", attrs: ' min="1" max="30"' }), true) +
      "</div>",
    onSubmit: function (data) {
      if (!data.name.trim()) { toast("请填写学期名称"); return false; }
      if (!data.startDate) { toast("请选择开始日期"); return false; }
      if (term) {
        term.name = data.name.trim();
        term.startDate = data.startDate;
        term.weeks = Number(data.weeks) || 18;
        toast("学期已更新");
      } else {
        DB.terms.push({ id: uid(), name: data.name.trim(), startDate: data.startDate, weeks: Number(data.weeks) || 18, current: DB.terms.length === 0 });
        toast("学期已创建");
      }
      saveDB();
      renderApp();
    }
  });
}

/* ===================== 特殊日程 ===================== */

function eventStatusBadge(ev) {
  const st = timeStatus(ev.date, ev.start, ev.end);
  if (st === "done") return '<span class="muted">已结束</span>';
  if (st === "ongoing") return badge("进行中", "amber");
  return daysUntil(ev.date) === 0 ? badge("今天", "red") : badge("未开始", "blue");
}

function eventsTableHTML() {
  return '<table class="tbl"><thead><tr><th>类型</th><th>标题</th><th>日期</th><th>时间</th><th>地点</th><th>状态</th><th style="width:110px">操作</th></tr></thead><tbody>' +
    DB.events.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (ev) {
      const relCourse = ev.courseId ? getCourse(ev.courseId) : null;
      return "<tr><td>" + badge(ev.type, eventTypeColor(ev.type)) + "</td>" +
        "<td><b>" + esc(ev.title) + "</b>" +
        (relCourse ? '<div class="muted">关联课程：' + esc(relCourse.name) + "</div>" : "") +
        (ev.note ? '<div class="muted">' + esc(ev.note) + "</div>" : "") + "</td>" +
        "<td>" + esc(ev.date) + "</td>" +
        "<td>" + esc(ev.start && ev.end ? ev.start + "-" + ev.end : ev.start || "全天") + "</td>" +
        "<td>" + esc(ev.location || "-") + "</td>" +
        "<td>" + eventStatusBadge(ev) + "</td>" +
        '<td><span class="flex" style="gap:10px"><span class="link" data-event-edit="' + ev.id + '">编辑</span>' +
        '<span class="link" data-event-del="' + ev.id + '">删除</span></span></td></tr>';
    }).join("") + "</tbody></table>";
}

function eventForm(ev) {
  formModal({
    title: ev ? "编辑日程" : "新增日程",
    body:
      '<div class="form-row">' +
      fieldHTML("类型", selectHTML("type", ev ? ev.type : "监考", EVENT_TYPES), true) +
      fieldHTML("日期", inputHTML("date", ev ? ev.date : todayISO(), { type: "date" }), true) +
      "</div>" +
      fieldHTML("标题", inputHTML("title", ev ? ev.title : "", { placeholder: "如：数据结构期末考试监考" }), true) +
      '<div class="form-row">' +
      fieldHTML("开始时间", inputHTML("start", ev ? ev.start : "09:00", { type: "time" })) +
      fieldHTML("结束时间", inputHTML("end", ev ? ev.end : "11:00", { type: "time" })) +
      fieldHTML("地点", inputHTML("location", ev ? ev.location : "", { placeholder: "如：教学楼A305" })) +
      "</div>" +
      fieldHTML("关联课程（可选）", selectHTML("courseId", ev ? ev.courseId : "",
        DB.courses.map(function (c) { return { value: c.id, text: c.name }; }),
        { allowEmpty: true, emptyText: "不关联课程" })) +
      fieldHTML("备注", textareaHTML("note", ev ? ev.note : "", { rows: 2, placeholder: "如：提前 30 分钟到考务办领卷" })),
    onSubmit: function (data) {
      if (!data.title.trim()) { toast("请填写标题"); return false; }
      if (!data.date) { toast("请选择日期"); return false; }
      if (data.start && data.end && data.end < data.start) { toast("结束时间不能早于开始时间"); return false; }
      const payload = {
        type: data.type, title: data.title.trim(), date: data.date,
        start: data.start, end: data.end, location: data.location.trim(),
        courseId: data.courseId, note: data.note.trim()
      };
      if (ev) {
        Object.assign(ev, payload);
        toast("日程已更新");
      } else {
        DB.events.push(Object.assign({ id: uid() }, payload));
        toast("日程已登记，将同步到教学日历");
      }
      saveDB();
      renderApp();
    }
  });
}

function bindSettings(view) {
  $("#set-save", view).addEventListener("click", function () {
    DB.settings.teacherName = $("#set-name", view).value.trim();
    DB.settings.teacherNo = $("#set-no", view).value.trim();
    DB.settings.dept = $("#set-dept", view).value.trim();
    saveDB();
    toast("教师信息已保存");
    renderTopbar();
  });

  $("#term-add", view).addEventListener("click", function () { termForm(null); });

  const evAdd = $("#event-add", view);
  evAdd && evAdd.addEventListener("click", function () { eventForm(null); });
  $$("[data-event-edit]", view).forEach(function (el) {
    el.addEventListener("click", function () { eventForm(getEvent(el.getAttribute("data-event-edit"))); });
  });
  $$("[data-event-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const ev = getEvent(el.getAttribute("data-event-del"));
      if (!ev) return;
      confirmModal("确定删除日程 <b>" + esc(ev.title) + "</b>（" + esc(ev.type) + " " + esc(ev.date) + "）？", function () {
        DB.events = DB.events.filter(function (x) { return x.id !== ev.id; });
        saveDB();
        toast("日程已删除");
        renderApp();
      }, "删除");
    });
  });

  $$("[data-term-cur]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      DB.terms.forEach(function (t) { t.current = t.id === el.getAttribute("data-term-cur"); });
      saveDB();
      toast("已切换当前学期");
      renderApp();
    });
  });
  $$("[data-term-edit]", view).forEach(function (el) {
    el.addEventListener("click", function () { termForm(getTerm(el.getAttribute("data-term-edit"))); });
  });
  $$("[data-term-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const id = el.getAttribute("data-term-del");
      const t = getTerm(id);
      const n = DB.courses.filter(function (c) { return c.termId === id; }).length;
      confirmModal("确定删除学期 <b>" + esc(t.name) + "</b>？" +
        (n ? '<br><span style="color:var(--red-600)">该学期下有 ' + n + " 门课程，删除学期不会删除课程，但课程将失去学期归属。</span>" : ""),
        function () {
          DB.terms = DB.terms.filter(function (x) { return x.id !== id; });
          if (!currentTerm() && DB.terms.length) DB.terms[0].current = true;
          saveDB();
          toast("学期已删除");
          renderApp();
        }, "删除");
    });
  });

  $("#data-export", view).addEventListener("click", exportJSONBackup);

  $("#data-tpl", view).addEventListener("click", downloadStudentsTemplate);

  $("#data-import", view).addEventListener("click", function () { $("#data-import-file", view).click(); });
  $("#data-import-file", view).addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    confirmModal("恢复备份将<b>覆盖当前全部数据</b>，此操作不可撤销。是否继续？", function () {
      importJSONBackup(file, function () { renderApp(); });
    });
    e.target.value = "";
  });

  $("#data-reseed", view).addEventListener("click", function () {
    confirmModal("载入演示数据将<b>覆盖当前全部数据</b>，建议先导出备份。是否继续？", function () {
      resetDB(false);
      toast("演示数据已载入");
      renderApp();
    });
  });

  $("#data-clear", view).addEventListener("click", function () {
    confirmModal("确定<b>清空全部数据</b>？此操作不可撤销，强烈建议先导出备份。", function () {
      resetDB(true);
      toast("数据已清空");
      renderApp();
    }, "清空");
  });
}
