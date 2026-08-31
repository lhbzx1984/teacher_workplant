"use strict";

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toast(msg) {
  const root = $("#toast-root");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(function () {
    t.style.transition = "opacity .25s";
    t.style.opacity = "0";
    setTimeout(function () { t.remove(); }, 260);
  }, 2400);
}

function go(hash) {
  location.hash = "#/" + String(hash).replace(/^#?\/?/, "");
}

/* ===================== 模态框 ===================== */

function closeModal() {
  const root = $("#modal-root");
  root.innerHTML = "";
}

function openModal(opts) {
  const root = $("#modal-root");
  root.innerHTML =
    '<div class="modal-overlay">' +
      '<div class="modal' + (opts.wide ? " wide" : "") + '">' +
        '<div class="modal-head">' +
          '<div class="modal-title">' + esc(opts.title || "") + '</div>' +
          '<button class="modal-close" data-close>&times;</button>' +
        '</div>' +
        '<div class="modal-body">' + (opts.body || "") + '</div>' +
        (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : "") +
      '</div>' +
    '</div>';

  const overlay = $(".modal-overlay", root);
  overlay.addEventListener("mousedown", function (e) {
    if (e.target === overlay) closeModal();
  });
  $$("[data-close]", root).forEach(function (b) { b.addEventListener("click", closeModal); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onEsc); }
  });
  return overlay;
}

function fieldHTML(label, inner, required) {
  return '<div class="field"><label>' + esc(label) + (required ? '<span class="req">*</span>' : "") + '</label>' + inner + '</div>';
}

function inputHTML(name, value, opts) {
  opts = opts || {};
  return '<input class="input" name="' + name + '" value="' + esc(value) + '"' +
    (opts.type ? ' type="' + opts.type + '"' : "") +
    (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : "") +
    (opts.attrs || "") + '>';
}

function selectHTML(name, value, options, opts) {
  opts = opts || {};
  let h = '<select class="input" name="' + name + '"' + (opts.attrs || "") + ">";
  if (opts.allowEmpty) h += '<option value="">' + (opts.emptyText || "请选择") + "</option>";
  options.forEach(function (o) {
    const v = typeof o === "string" ? o : o.value;
    const t = typeof o === "string" ? o : o.text;
    h += '<option value="' + esc(v) + '"' + (String(v) === String(value) ? " selected" : "") + ">" + esc(t) + "</option>";
  });
  return h + "</select>";
}

function textareaHTML(name, value, opts) {
  opts = opts || {};
  return '<textarea class="input" name="' + name + '" rows="' + (opts.rows || 4) + '"' +
    (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : "") + ">" + esc(value) + "</textarea>";
}

function formModal(opts) {
  const overlay = openModal({
    title: opts.title,
    wide: opts.wide,
    body: '<form data-form>' + opts.body + "</form>",
    foot:
      '<button class="btn btn-light" data-close>取消</button>' +
      '<button class="btn" data-ok>' + esc(opts.okText || "保存") + "</button>"
  });
  const form = $("[data-form]", overlay);
  $("[data-ok]", overlay).addEventListener("click", function () {
    const data = {};
    /* checkbox 按 checked 取布尔值（未勾选时 value 恒为 "on"，不能作真值依据）；其余取 value */
    $$("[name]", form).forEach(function (inp) {
      if (inp.type === "checkbox") data[inp.name] = !!inp.checked;
      else if (inp.type === "radio") { if (inp.checked) data[inp.name] = inp.value; }
      else data[inp.name] = inp.value;
    });
    if (opts.validate && opts.validate(data) === false) return;
    if (opts.onSubmit(data) !== false) closeModal();
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    $("[data-ok]", overlay).click();
  });
  setTimeout(function () { const f = $("input,select,textarea", form); f && f.focus(); }, 30);
  return overlay;
}

function confirmModal(msg, onOk, okText) {
  const overlay = openModal({
    title: "请确认",
    body: '<div style="font-size:13px;line-height:1.7">' + msg + "</div>",
    foot:
      '<button class="btn btn-light" data-close>取消</button>' +
      '<button class="btn btn-danger" data-ok>' + esc(okText || "确认") + "</button>"
  });
  $("[data-ok]", overlay).addEventListener("click", function () {
    closeModal();
    onOk();
  });
}

/* ===================== 小组件 ===================== */

function badge(text, color) {
  return '<span class="badge badge-' + (color || "gray") + '">' + esc(text) + "</span>";
}

function emptyHTML(msg, action) {
  return '<div class="empty"><div class="empty-icon">&#9673;</div><div>' + esc(msg) + "</div>" +
    (action ? '<button class="btn btn-light btn-sm" data-empty-action style="margin-top:14px">' + esc(action) + "</button>" : "") + "</div>";
}

function countBadge(arr) {
  return arr && arr.length ? '<span class="badge badge-gray">' + arr.length + "</span>" : "";
}

function levelBadge(level) {
  if (level === "国家级") return badge(level, "red");
  if (level === "省部级") return badge(level, "purple");
  if (level === "省级") return badge(level, "purple");
  if (level === "市厅级" || level === "厅局级") return badge(level, "blue");
  if (level === "校级") return badge(level, "green");
  return badge(level || "-", "gray");
}

function statusBadge(text) {
  if (text === "在研" || text === "报名中" || text === "备赛中") return badge(text, "blue");
  if (text === "已结题" || text === "已获奖" || text === "已结束") return badge(text, "green");
  return badge(text || "-", "gray");
}

function gradeColor(v) {
  if (v == null) return "text-2";
  if (v < 60) return "badge-red";
  if (v >= 90) return "badge-green";
  return "text-2";
}
