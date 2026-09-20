"use strict";

/* 票据通用能力：上传 → 识别 → 核对 → 保存 → 预览
   差旅与竞赛共用这一套，只是「可选类别」与「默认类别」不同（opts.kinds / opts.defaultKind）。
   为什么抽出来：票据逻辑与「票据挂在谁身上」无关，复制一份到竞赛只会让两边各改各的、越走越偏。 */

/* 类别兜底：识别出的类别若不在当前场景的可选列表里，按候选顺序收敛。
   为什么是数组而不是单值：同一个识别结果在不同场景要落到不同科目——
   「设备器材票据」在科研场景应显示为「仪器设备票据」，反过来也一样；
   差旅场景没有这些采购类科目，统一落到「其他票据」。最后一个候选固定为「其他票据」。 */
const RECEIPT_KIND_FALLBACK = {
  "器件耗材票据": ["耗材材料票据", "其他票据"],
  "设备器材票据": ["仪器设备票据", "其他票据"],
  "资料图书票据": ["其他票据"],
  "软件服务票据": ["其他票据"],
  "竞赛报名费": ["其他票据"],
  "专家评审费": ["专家咨询费", "其他票据"],
  "仪器设备票据": ["设备器材票据", "其他票据"],
  "耗材材料票据": ["器件耗材票据", "其他票据"],
  "测试化验加工票据": ["设备器材票据", "其他票据"],
  "版面费票据": ["资料图书票据", "其他票据"],
  "专利费票据": ["其他票据"],
  "外协服务票据": ["软件服务票据", "其他票据"],
  "专家咨询费": ["专家评审费", "其他票据"]
};

/* 把识别出的类别收敛到当前场景的可选范围内，保证下拉框一定有一项被选中 */
function sanitizeReceiptKind(kind, kinds, defaultKind) {
  if (kind && kinds.indexOf(kind) >= 0) return kind;
  /* 只有「已知类别」才做场景映射；完全陌生的类别回落到场景默认，不做任何猜测 */
  const cands = RECEIPT_KIND_FALLBACK[kind];
  if (cands) {
    for (let i = 0; i < cands.length; i++) {
      if (kinds.indexOf(cands[i]) >= 0) return cands[i];
    }
  }
  return defaultKind || kinds[0];
}

function receiptKindColor(kind) {
  if (kind === "火车票" || kind === "飞机票") return "blue";
  if (kind === "住宿票据") return "purple";
  if (kind === "市内交通票据" || kind === "餐饮票据") return "teal";
  if (kind === "会议邀请函") return "amber";
  /* 采购类：器材紫、资料软件青、费用类琥珀（差旅 / 竞赛 / 科研共用同一套色） */
  if (kind === "器件耗材票据" || kind === "设备器材票据" ||
    kind === "仪器设备票据" || kind === "耗材材料票据" || kind === "测试化验加工票据") return "purple";
  if (kind === "资料图书票据" || kind === "软件服务票据" || kind === "版面费票据") return "teal";
  if (kind === "竞赛报名费" || kind === "专家评审费" || kind === "专家咨询费" ||
    kind === "专利费票据" || kind === "外协服务票据") return "amber";
  return "gray";
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function isPDFFile(f) {
  return /pdf/i.test((f && f.type) || "") || /\.pdf$/i.test((f && f.name) || "");
}

/* 识别来源徽章：让「金额是怎么来的」始终可见，避免盲信自动识别 */
function recogBadgeHTML(rc) {
  if (!rc || !rc.source || rc.source === "none") return badge("未识别", "gray");
  if (rc.source === "filename") return badge("文件名", "teal");
  if (rc.source === "pdf") return badge("PDF文本", "blue");
  if (rc.source === "ocr") return badge("OCR", "purple");
  return badge("未识别", "gray");
}

function recogSourceText(src) {
  if (src === "filename") return "文件名识别";
  if (src === "pdf") return "PDF 文本识别";
  if (src === "ocr") return "OCR 识别";
  return "手动填写";
}

function readAsDataURL(file, cb) {
  const reader = new FileReader();
  reader.onload = function () { cb(reader.result); };
  reader.onerror = function () { toast("读取失败：" + file.name); cb(""); };
  reader.readAsDataURL(file);
}

/* 图片压缩：等比缩放到最大边 maxSide，JPEG 质量 quality；失败或异常时回退原图 */
function compressImageFile(file, maxSide, quality, cb) {
  readAsDataURL(file, function (url) {
    if (!url) { cb(""); return; }
    const img = new Image();
    img.onload = function () {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL("image/jpeg", quality));
      } catch (e) { cb(url); }
    };
    img.onerror = function () { cb(url); };
    img.src = url;
  });
}

/* 选择票据文件 → 读取（图片压缩 / PDF 原样）→ 批量填写票据信息 */
function pickReceiptFiles(owner, opts) {
  opts = opts || {};
  const kinds = opts.kinds || RECEIPT_KINDS_TRIP;
  const defaultKind = opts.defaultKind || kinds[0];
  const inp = document.createElement("input");
  inp.type = "file";
  inp.multiple = true;
  inp.accept = "image/*,application/pdf";
  inp.addEventListener("change", function () {
    const files = Array.prototype.slice.call(inp.files || []);
    if (!files.length) return;
    const tooBig = files.filter(function (f) { return f.size > 4 * 1024 * 1024; });
    if (tooBig.length) { toast("「" + tooBig[0].name + "」超过 4MB，请压缩后再上传"); return; }
    toast("正在读取 " + files.length + " 个文件…");
    const jobs = files.map(function (f) {
      return new Promise(function (resolve) {
        if (isPDFFile(f)) {
          readAsDataURL(f, function (url) { resolve({ file: f, dataUrl: url }); });
        } else {
          compressImageFile(f, 1600, 0.72, function (url) { resolve({ file: f, dataUrl: url }); });
        }
      });
    });
    Promise.all(jobs).then(function (list) {
      const rows = list.filter(function (x) { return x.dataUrl; });
      if (!rows.length) { toast("没有可保存的文件"); return; }
      toast("正在识别 " + rows.length + " 个票据…");
      Promise.all(rows.map(function (x) {
        return recognizeReceipt(x.file, x.dataUrl).catch(function () { return null; })
          .then(function (rec) { x.rec = rec; return x; });
      })).then(function () {
        receiptBatchForm(owner, rows, { kinds: kinds, defaultKind: defaultKind });
      });
    });
  });
  inp.click();
}

/* 批量票据信息：识别结果预填到表单，人工核对后再保存 */
function receiptBatchForm(owner, list, opts) {
  opts = opts || {};
  const kinds = opts.kinds || RECEIPT_KINDS_TRIP;
  const defaultKind = opts.defaultKind || kinds[0];
  const rows = list.filter(function (x) { return x.dataUrl; });
  if (!rows.length) { toast("没有可保存的文件"); return; }

  const recOf = function (x) {
    const rc = x.rec || {};
    return {
      amount: rc.amount == null ? null : rc.amount,
      date: rc.date || "",
      kind: sanitizeReceiptKind(rc.kind, kinds, defaultKind),
      ticketNo: rc.ticketNo || "",
      note: rc.note || "",
      source: rc.source || "none"
    };
  };
  const gotAmount = rows.filter(function (x) { return recOf(x).amount != null; }).length;
  /* PDF 抽不到文本层，多为扫描件/图片型 PDF——必须说清原因，否则用户只会以为功能坏了 */
  const pdfMiss = rows.filter(function (x) { return isPDFFile(x.file) && recOf(x).amount == null; }).length;

  const overlay = formModal({
    title: "票据信息（共 " + rows.length + " 个文件）", wide: true,
    body:
      '<div class="hint" style="margin-bottom:10px">' +
      (gotAmount ? "已自动识别 <b>" + gotAmount + "</b> 张票据的金额与类别，请核对后保存。" : "未能自动识别金额，请手动填写。") +
      "识别结果仅为建议值，金额一律以实际票据为准；会议邀请函与其他附件不计入报销金额。" +
      (pdfMiss ? "<br><b>" + pdfMiss + " 个 PDF 未读出文本层</b>：这类文件通常是扫描件或图片型 PDF（本身不含可提取文字）。" +
        "可到「学期与设置 → 票据识别」开启图片 OCR，或把 PDF 另存为图片后上传。" : "") +
      "</div>" +
      '<table class="tbl"><thead><tr><th style="width:32px">#</th><th>文件</th><th style="width:150px">票据类别</th>' +
      '<th style="width:110px">金额（元）</th><th style="width:150px">日期</th><th>品名 / 备注</th>' +
      '<th style="width:104px">识别来源</th></tr></thead><tbody>' +
      rows.map(function (x, i) {
        const rc = recOf(x);
        return '<tr><td>' + (i + 1) + '</td><td><div class="rcpt-mini-name" title="' + esc(x.file.name) + '">' + esc(x.file.name) + "</div>" +
          '<div class="muted">' + fmtSize(x.file.size) + "</div></td>" +
          "<td>" + selectHTML("kind_" + i, rc.kind, kinds) + "</td>" +
          '<td><input class="input" name="amount_' + i + '" type="number" min="0" step="0.01" placeholder="0.00"' +
          (rc.amount != null ? ' value="' + rc.amount + '"' : "") + "></td>" +
          '<td><input class="input" name="date_' + i + '" type="date" value="' + (rc.date || todayISO()) + '"></td>' +
          '<td><input class="input" name="note_' + i + '" placeholder="' + esc(opts.notePlaceholder || "选填") + '" value="' + esc(rc.note || "") + '"></td>' +
          '<td>' + recogBadgeHTML(rc) +
          (isPDFFile(x.file) ? "" : ' <span class="link" data-rrecog="' + i + '">重识别</span>') + "</td></tr>";
      }).join("") + "</tbody></table>",
    onSubmit: function (data) {
      if (!owner.receipts) owner.receipts = [];
      rows.forEach(function (x, i) {
        const rc = recOf(x);
        owner.receipts.push({
          id: uid(),
          kind: data["kind_" + i] || defaultKind,
          amount: Number(data["amount_" + i]) || 0,
          date: data["date_" + i] || "",
          note: (data["note_" + i] || "").trim(),
          fileName: x.file.name,
          fileType: x.file.type || (isPDFFile(x.file) ? "application/pdf" : "image/jpeg"),
          fileSize: x.file.size,
          dataUrl: x.dataUrl,
          recSource: rc.source || "none",
          ticketNo: rc.ticketNo || ""
        });
      });
      saveDB(); renderApp();
      toast("已添加 " + rows.length + " 个票据 / 附件");
    }
  });

  /* 选择「会议邀请函」等佐证类型时自动禁用金额输入 */
  $$("select[name^='kind_']", overlay).forEach(function (sel) {
    const idx = sel.name.slice(5);
    const amount = $("input[name='amount_" + idx + "']", overlay);
    const sync = function () {
      const billable = RECEIPT_BILLABLE.indexOf(sel.value) >= 0;
      amount.disabled = !billable;
      amount.placeholder = billable ? "0.00" : "不计金额";
      if (!billable) amount.value = "";
    };
    sel.addEventListener("change", sync);
    sync();
  });

  /* 单张「重识别」：显式调用 OCR 识别该图片并回填（不依赖全局开关） */
  $$("[data-rrecog]", overlay).forEach(function (el) {
    el.addEventListener("click", function () {
      const i = Number(el.getAttribute("data-rrecog"));
      const x = rows[i];
      if (!x || !x.dataUrl) return;
      el.textContent = "识别中…";
      ocrImageText(x.dataUrl).then(function (text) {
        const rec = text ? extractReceiptFromText(text) : {};
        if (rec.kind) rec.kind = sanitizeReceiptKind(rec.kind, kinds, defaultKind);
        const merged = mergeRecognized(recOf(x), rec, text ? "ocr" : null);
        x.rec = merged;
        const kindSel = $("select[name='kind_" + i + "']", overlay);
        const amount = $("input[name='amount_" + i + "']", overlay);
        const date = $("input[name='date_" + i + '"]', overlay);
        const note = $("input[name='note_" + i + '"]', overlay);
        if (merged.kind) kindSel.value = merged.kind;
        if (merged.amount != null) amount.value = merged.amount;
        if (merged.date) date.value = merged.date;
        if (merged.note) note.value = merged.note;
        /* 触发类型联动：佐证类票据会自动清空金额 */
        kindSel.dispatchEvent(new Event("change"));
        el.textContent = text ? "重识别" : "未识别";
        toast(text ? (merged.amount != null ? "已识别金额 " + fmtMoney(merged.amount) + "，请核对" : "已识别文字但未找到金额，请手动填写") : "未能识别，可到「学期与设置」开启识别引擎后重试");
      });
    });
  });
}

/* 单张票据编辑：改类别 / 金额 / 日期，并可就地重跑识别 */
function receiptForm(owner, receipt, opts) {
  opts = opts || {};
  const kinds = opts.kinds || RECEIPT_KINDS_TRIP;
  const overlay = formModal({
    title: "编辑票据信息", wide: true,
    body:
      '<div class="form-row">' +
      fieldHTML("票据类别", selectHTML("kind", receipt.kind, kinds), true) +
      fieldHTML("金额（元）", inputHTML("amount", receipt.amount, { type: "number", attrs: ' min="0" step="0.01"' })) +
      fieldHTML("日期", inputHTML("date", receipt.date || todayISO(), { type: "date" })) +
      "</div>" +
      fieldHTML("品名 / 备注", inputHTML("note", receipt.note || "", { placeholder: opts.notePlaceholder || "如：去程高铁 G1234" })) +
      '<div class="form-row" style="align-items:center;margin-top:4px">' +
      '<div class="field" style="flex:0 0 auto"><button type="button" class="btn btn-light" id="rcpt-recog">重新识别票据</button></div>' +
      '<div class="field"><span class="muted" id="rcpt-recog-tip">当前来源：' + recogSourceText(receipt.recSource) + "</span></div>" +
      "</div>" +
      '<div class="hint">文件：' + esc(receipt.fileName || "未命名") + "（" + fmtSize(receipt.fileSize) + "）" +
      (receipt.ticketNo ? " · 票号 " + esc(receipt.ticketNo) : "") + "</div>",
    onSubmit: function (data) {
      Object.assign(receipt, {
        kind: data.kind,
        amount: Number(data.amount) || 0,
        date: data.date,
        note: data.note.trim()
      });
      saveDB(); renderApp(); toast("票据信息已更新");
    }
  });
  const sel = $("select[name='kind']", overlay);
  const amount = $("input[name='amount']", overlay);
  const sync = function () {
    const billable = RECEIPT_BILLABLE.indexOf(sel.value) >= 0;
    amount.disabled = !billable;
    amount.placeholder = billable ? "0.00" : "不计金额";
  };
  sel && sel.addEventListener("change", sync);
  sel && sync();

  /* 重新识别：对已保存的票据再次走识别通道，结果回填表单（不直接落库） */
  const recogBtn = $("#rcpt-recog", overlay);
  const recogTip = $("#rcpt-recog-tip", overlay);
  recogBtn && recogBtn.addEventListener("click", function () {
    recogBtn.disabled = true;
    recogBtn.textContent = "识别中…";
    if (recogTip) recogTip.textContent = "正在读取票据内容…";
    recognizeStoredReceipt(receipt).then(function (rec) {
      recogBtn.disabled = false;
      recogBtn.textContent = "重新识别票据";
      if (!rec) {
        if (recogTip) recogTip.textContent = "未能识别内容，请手动填写";
        toast("未能识别该票据，请手动填写金额");
        return;
      }
      if (rec.kind) rec.kind = sanitizeReceiptKind(rec.kind, kinds, opts.defaultKind || kinds[0]);
      const kindSel = $("select[name='kind']", overlay);
      const amt = $("input[name='amount']", overlay);
      const dt = $("input[name='date']", overlay);
      const nt = $("input[name='note']", overlay);
      if (rec.kind) kindSel.value = rec.kind;
      if (rec.amount != null) amt.value = rec.amount;
      if (rec.date) dt.value = rec.date;
      if (rec.note) nt.value = rec.note;
      kindSel && kindSel.dispatchEvent(new Event("change"));
      if (recogTip) recogTip.textContent = "已识别（" + recogSourceText(rec.source) + "），请核对后保存";
      toast(rec.amount != null ? "已识别金额 " + fmtMoney(rec.amount) + "，请核对后保存" : "已识别票据信息，但未找到金额");
    });
  });
}

/* 票据预览：图片直接显示，PDF 用内嵌框架（不支持内嵌时提供新窗口打开） */
function viewReceipt(r) {
  const isPDF = /pdf/i.test(r.fileType || "") || /\.pdf$/i.test(r.fileName || "");
  const body = isPDF
    ? '<iframe src="' + r.dataUrl + '" style="width:100%;height:64vh;border:1px solid var(--line);border-radius:8px"></iframe>' +
      '<div class="hint" style="margin-top:8px">若浏览器无法内嵌预览，请 <a href="' + r.dataUrl + '" target="_blank" rel="noopener">点击在新窗口打开</a>。</div>'
    : '<div style="text-align:center"><img src="' + r.dataUrl + '" style="max-width:100%;max-height:64vh;border:1px solid var(--line);border-radius:8px"></div>';

  openModal({
    title: (r.kind || "票据") + " · " + (r.fileName || ""),
    wide: true,
    body: body +
      '<div style="margin-top:10px;font-size:13px">' +
      "金额：" + (RECEIPT_BILLABLE.indexOf(r.kind) >= 0 ? fmtMoney(r.amount) : "佐证材料（不计金额）") +
      (r.date ? " · 日期：" + esc(r.date) : "") + (r.note ? " · " + esc(r.note) : "") + "</div>",
    foot: '<button class="btn btn-light" data-close>关闭</button>' +
      '<a class="btn" href="' + r.dataUrl + '" download="' + esc(r.fileName || "票据") + '">下载</a>'
  });
}

/* 票据卡片墙：差旅与竞赛共用，仅提示语与可选类别不同 */
function receiptsGridHTML(owner, opts) {
  opts = opts || {};
  const kinds = opts.kinds || RECEIPT_KINDS_TRIP;
  const list = owner.receipts || [];
  const uploadId = opts.uploadId || "receipt-upload";
  const hint = opts.hint || ("支持图片（JPG/PNG，自动压缩）与 PDF 文件。上传时会<b>自动识别</b>票据类别、金额与日期" +
    "（文件名 → PDF 文本层 → 图片 OCR），识别结果预填后仍可修改。");

  let h = '<div class="card"><div class="card-head"><div class="card-title">票据与附件（' + list.length + "）</div>" +
    '<button class="btn btn-sm" id="' + uploadId + '">上传票据</button></div>' +
    '<div class="hint" style="margin:0 0 10px;padding:0 18px">' + hint + "</div>";
  if (!list.length) {
    h += '<div class="empty">还没有票据——点击「上传票据」添加交通住宿票据、器件耗材发票或佐证材料</div>';
  } else {
    h += '<div class="rcpt-grid">';
    list.forEach(function (r) {
      const billable = RECEIPT_BILLABLE.indexOf(r.kind) >= 0;
      const isPDF = /pdf/i.test(r.fileType || "") || /\.pdf$/i.test(r.fileName || "");
      h += '<div class="rcpt-card">' +
        '<div class="rcpt-thumb' + (isPDF ? " rcpt-pdf" : "") + '" data-rcpt-view="' + r.id + '">' +
        (isPDF ? '<span class="rcpt-pdf-tag">PDF</span>' : '<img src="' + r.dataUrl + '" alt="' + esc(r.fileName || "") + '">') +
        "</div>" +
        '<div class="rcpt-meta">' +
        '<div class="rcpt-kind">' + badge(r.kind, billable ? receiptKindColor(r.kind) : "gray") + "</div>" +
        '<div class="rcpt-name" title="' + esc(r.fileName || "") + '">' + esc(r.fileName || "未命名文件") + "</div>" +
        '<div class="rcpt-sub">' + (billable ? fmtMoney(r.amount) : "佐证材料") + (r.date ? " · " + esc(r.date) : "") +
        " · <span class=\"rcpt-src\">" + recogSourceText(r.recSource) + "</span></div>" +
        (r.note ? '<div class="rcpt-sub">' + esc(r.note) + "</div>" : "") +
        "</div>" +
        '<div class="rcpt-ops">' +
        '<span class="link" data-rcpt-edit="' + r.id + '">编辑</span>' +
        '<span class="link" data-rcpt-del="' + r.id + '">删除</span>' +
        "</div></div>";
    });
    h += "</div>";
  }
  h += "</div>";
  return h;
}

/* 票据交互绑定（上传 / 预览 / 编辑 / 删除）。删除回调可自定义，默认刷新整页。 */
function bindReceiptOps(view, owner, opts) {
  opts = opts || {};
  const kinds = opts.kinds || RECEIPT_KINDS_TRIP;
  const uploadId = opts.uploadId || "receipt-upload";
  const afterChange = opts.afterChange || function () { renderApp(); };

  const up = $("#" + uploadId, view);
  up && up.addEventListener("click", function () { pickReceiptFiles(owner, opts); });

  $$("[data-rcpt-view]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = (owner.receipts || []).find(function (x) { return x.id === el.getAttribute("data-rcpt-view"); });
      r && viewReceipt(r);
    });
  });
  $$("[data-rcpt-edit]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const r = (owner.receipts || []).find(function (x) { return x.id === el.getAttribute("data-rcpt-edit"); });
      r && receiptForm(owner, r, opts);
    });
  });
  $$("[data-rcpt-del]", view).forEach(function (el) {
    el.addEventListener("click", function () {
      const rid = el.getAttribute("data-rcpt-del");
      confirmModal("确定删除这张票据？删除后无法恢复。", function () {
        owner.receipts = (owner.receipts || []).filter(function (x) { return x.id !== rid; });
        saveDB(); afterChange(); toast("票据已删除");
      });
    });
  });
  /* kinds 未被直接使用，但保留在 opts 里供 receiptForm / pickReceiptFiles 复用 */
  return kinds;
}
