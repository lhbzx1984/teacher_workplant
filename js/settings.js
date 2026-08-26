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
