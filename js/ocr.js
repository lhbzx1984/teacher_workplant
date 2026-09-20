/* 票据识别：从文件名 / PDF 文本层 / 图片 OCR 中抽取票据类型、金额、日期、票号
   设计原则：
   1. 零依赖通道优先——文件名解析与 PDF 文本层抽取不引入任何库，离线可用
   2. 联网 OCR 为可选项——仅在设置中开启时按需加载 Tesseract.js，失败静默降级
   3. 识别结果只是「建议值」——一律回填到表单由人工确认，绝不静默写入金额 */

/* Tesseract.js 按需加载地址（仅在用户开启 OCR 时请求） */
const OCR_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const OCR_LANG = "chi_sim+eng";

/* 票据类型关键词：按顺序命中，越靠前优先级越高 */
const KIND_KEYWORDS = [
  ["火车票", ["火车票", "高铁", "动车", "铁路", "车票", "检票口", "车次", "列车", "railway", "train"]],
  ["飞机票", ["飞机票", "登机牌", "航班", "电子客票", "机票", "值机", "航段", "boarding", "flight", "airline"]],
  ["住宿票据", ["住宿", "酒店", "宾馆", "客房", "房费", "住宿费", "旅店", "hotel", "inn"]],
  ["市内交通票据", ["出租车", "网约车", "滴滴", "地铁", "公交", "打车", "市内交通", "客运", "taxi"]],
  ["餐饮票据", ["餐饮", "餐费", "就餐", "餐厅", "饭店", "食品", "餐饮费"]],
  ["会议邀请函", ["邀请函", "邀请", "会议通知", "报到通知", "invitation"]]
];

/* 金额锚点词：出现这些词时，紧随其后的数字最可能是票据金额 */
const AMOUNT_KEYWORDS = "价税合计|合计金额|价税|合计|小写|票价|票款|实付|应付|总计|总额|金额|共计|费用|报销金额";

/* ===================== 文本归一化与基础抽取 ===================== */

function normText(text) {
  return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
}

/* 数字串 → 金额；过滤 0、负数、异常大值与非数字 */
function toMoney(s) {
  const v = parseFloat(String(s).replace(/,/g, "").replace(/[。]/g, "."));
  return (isFinite(v) && v > 0 && v < 200000) ? Math.round(v * 100) / 100 : null;
}

function isValidISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return false;
  const mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

/* 金额抽取：①锚点词就近数字 ②¥ 前缀取最大 ③「N 元」取最大 */
function pickAmountFromText(text) {
  const flat = normText(text);
  if (!flat) return null;
  /* 千分位优先（1,280.00），其次普通小数（553.00）；逗号一律按千分位处理 */
  const N = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{1,7}(?:\\.\\d{1,2})?)";

  let m = flat.match(new RegExp("(?:" + AMOUNT_KEYWORDS + ")[^0-9]{0,14}[¥￥]?\\s*" + N));
  if (m) { const v = toMoney(m[1]); if (v) return v; }

  const cands = [];
  let re = /[¥￥]\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,7}(?:\.\d{1,2})?)/g, mm;
  while ((mm = re.exec(flat))) { const v = toMoney(mm[1]); if (v) cands.push(v); }
  if (cands.length) return Math.max.apply(Math, cands);

  re = new RegExp(N + "\\s*元", "g");
  while ((mm = re.exec(flat))) { const v = toMoney(mm[1]); if (v) cands.push(v); }
  if (cands.length) return Math.max.apply(Math, cands);

  return null;
}

/* 日期抽取：2026年9月1日 / 2026-09-01 / 2026.09.01 / 20260901 */
function pickDateFromText(text) {
  const flat = normText(text);
  if (!flat) return null;
  let m = flat.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*日?/);
  if (!m) m = flat.match(/(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (!m) return null;
  const iso = m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  return isValidISO(iso) ? iso : null;
}

/* 类型抽取：命中关键词最多的类型胜出 */
function pickKindFromText(text) {
  const flat = normText(text).toLowerCase();
  if (!flat) return null;
  let best = null, bestHit = 0;
  KIND_KEYWORDS.forEach(function (pair) {
    let hit = 0;
    pair[1].forEach(function (kw) { if (flat.indexOf(kw) >= 0) hit++; });
    if (hit > bestHit) { bestHit = hit; best = pair[0]; }
  });
  return best;
}

/* 票号抽取：车次（G/D/K/Z/T/C 开头）或发票号码 */
function pickTicketNoFromText(text) {
  const flat = normText(text);
  if (!flat) return null;
  let m = flat.match(/(?:^|[^A-Za-z0-9])([GDKZTC]\d{1,4})(?![0-9])/);
  if (m) return m[1];
  m = flat.match(/发票号码[^0-9]{0,8}(\d{8,20})/);
  if (m) return m[1];
  m = flat.match(/(?:发票号|票据号|No\.?|NO\.?)[^0-9]{0,6}(\d{6,20})/);
  if (m) return m[1];
  return null;
}

/* 从一段文本中抽取全部票据要素 */
function extractReceiptFromText(text) {
  const flat = normText(text);
  return {
    amount: pickAmountFromText(flat),
    date: pickDateFromText(flat),
    kind: pickKindFromText(flat),
    ticketNo: pickTicketNoFromText(flat)
  };
}

/* ===================== 文件名解析（零依赖、离线可用） ===================== */

/* 去掉扩展名与已识别片段后，剩余部分作为备注线索（去程/返程/北京南-上海虹桥 等） */
function fileNameNote(name, used) {
  let s = String(name || "").replace(/\.[a-z0-9]+$/i, "");
  s = s.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  (used || []).forEach(function (u) { if (u) s = s.split(String(u)).join(" "); });
  s = s.replace(/[¥￥第￥]/g, " ").replace(/\s+/g, " ").trim();
  /* 去掉纯数字残片（如 IMG_20260901 的日期已被抽取） */
  s = s.replace(/(^|\s)\d{1,8}(\s|$)/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 ? s.slice(0, 40) : "";
}

function parseReceiptFileName(name) {
  const raw = String(name || "");
  const base = raw.replace(/\.[a-z0-9]+$/i, "");
  const amount = pickAmountFromText(base);
  const date = pickDateFromText(base);
  const kind = pickKindFromText(base);
  let used = [];
  const dm = base.match(/20\d{2}\s*[年\-\/.]?\s*\d{1,2}\s*[月\-\/.]?\s*\d{1,2}\s*日?/);
  if (dm) used.push(dm[0]);
  if (kind) used.push(kind);
  const am = base.match(/[¥￥]?\s*\d{1,7}(?:[.,]\d{1,2})?\s*元?/);
  if (am) used.push(am[0].trim());
  return {
    amount: amount,
    date: date,
    kind: kind,
    ticketNo: pickTicketNoFromText(base),
    note: fileNameNote(raw, used)
  };
}

/* ===================== PDF 文本层抽取（零依赖） ===================== */

/* 单字节解码：避免 UTF-8 解码破坏 PDF 原始字节 */
function bytesToLatin1(bytes) {
  let out = "", CH = 8192;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + CH)));
  }
  return out;
}

/* 尝试 deflate 解压一段字节。
   注意：PDF 在 stream 数据与 endstream 之间按规范要留一个 EOL，我们按 endstream 定位时
   可能多带进 1–2 个尾部字节，Chromium 的 DecompressionStream 会因此直接报错，
   故依次尝试「原样 / 截去尾部 1–3 字节 × zlib 与 raw deflate」共 8 种组合。 */
function inflateBytes(u8) {
  const tryOne = function (bytes, fmt) {
    try {
      const ds = new DecompressionStream(fmt);
      return new Response(new Blob([bytes]).stream().pipeThrough(ds))
        .arrayBuffer()
        .then(function (buf) { return new Uint8Array(buf); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  };
  /* 环境不支持时直接放弃，由上层回退到原始字节 */
  if (typeof DecompressionStream === "undefined" || typeof Blob === "undefined" ||
    typeof Response === "undefined") return Promise.resolve(null);

  const fmts = ["deflate", "deflate-raw"];
  let fi = 0, cut = 0;
  const next = function () {
    if (fi >= fmts.length) return Promise.resolve(null);
    const bytes = cut === 0 ? u8 : u8.subarray(0, u8.length - cut);
    if (!bytes || bytes.length <= 0) { fi++; cut = 0; return next(); }
    return tryOne(bytes, fmts[fi]).then(function (out) {
      if (out && out.length) return out;
      cut++;
      if (cut > 3) { cut = 0; fi++; }
      return next();
    });
  };
  return next();
}

/* 反转义 PDF 字符串：\( \) \\ \n \r \t 与八进制 \ddd */
function unescapePdfString(s) {
  return String(s)
    .replace(/\\([nrtbf])/g, function (_, c) {
      return { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[c] || c;
    })
    .replace(/\\(\d{1,3})/g, function (_, o) { return String.fromCharCode(parseInt(o, 8)); })
    .replace(/\\([\\()])/g, "$1");
}

/* 从 PDF 内容流中抽取 Tj / TJ 操作符里的文本串 */
function pdfStrings(latin) {
  const out = [];
  let re = /\(((?:\\.|[^\\()]){0,400})\)\s*Tj/g, m;
  while ((m = re.exec(latin))) out.push(unescapePdfString(m[1]));
  re = /\[((?:[^\[\]]|\\.){0,4000})\]\s*TJ/g;
  while ((m = re.exec(latin))) {
    let re2 = /\(((?:\\.|[^\\()]){0,400})\)/g, m2;
    while ((m2 = re2.exec(m[1]))) out.push(unescapePdfString(m2[1]));
  }
  return out.join(" ");
}

/* 只保留可打印 ASCII 与常见符号：中文常为 CID 编码会乱码，但金额数字为 ASCII 可保留 */
function keepAsciiDigits(s) {
  return String(s || "").replace(/[^ -~¥￥元]/g, " ").replace(/\s+/g, " ").trim();
}

/* 读取 PDF 并抽取文本层内容（异步；失败返回空串） */
function extractPdfText(file) {
  return new Promise(function (resolve) {
    try {
      const fr = new FileReader();
      fr.onload = function () {
        try {
          const bytes = new Uint8Array(fr.result);
          const latin = bytesToLatin1(bytes);
          const chunks = [];
          let re = /stream\r?\n?/g, m;
          while ((m = re.exec(latin))) {
            const start = m.index + m[0].length;
            let end = latin.indexOf("endstream", start);
            if (end < 0 || end - start > 3 * 1024 * 1024) continue;
            /* 回退数据尾部与 endstream 之间的 EOL，避免多余字节破坏解压 */
            while (end > start && (latin[end - 1] === "\n" || latin[end - 1] === "\r" || latin[end - 1] === " ")) end--;
            if (end <= start) continue;
            chunks.push(bytes.subarray(start, end));
          }
          let i = 0;
          const next = function (text) {
            if (text) { resolve(text); return; }
            if (i >= chunks.length) { resolve(""); return; }
            const u8 = chunks[i++];
            inflateBytes(u8).then(function (out) {
              const src = out && out.length ? bytesToLatin1(out) : bytesToLatin1(u8);
              next(keepAsciiDigits(pdfStrings(src)));
            });
          };
          next("");
        } catch (e) { resolve(""); }
      };
      fr.onerror = function () { resolve(""); };
      fr.readAsArrayBuffer(file);
    } catch (e) { resolve(""); }
  });
}

/* ===================== 图片 OCR（可选，按需加载） ===================== */

let tessQueue = null;

function loadTesseract(cb) {
  try {
    if (typeof window === "undefined") return cb(new Error("no window"));
    if (window.Tesseract) return cb(null, window.Tesseract);
    if (tessQueue) { tessQueue.push(cb); return; }
    tessQueue = [cb];
    const s = document.createElement("script");
    s.src = OCR_CDN;
    s.onload = function () {
      const q = tessQueue; tessQueue = null;
      q.forEach(function (f) { f(window.Tesseract ? null : new Error("no api"), window.Tesseract); });
    };
    s.onerror = function () {
      const q = tessQueue; tessQueue = null;
      q.forEach(function (f) { f(new Error("load fail")); });
    };
    document.head.appendChild(s);
  } catch (e) { cb(e); }
}

/* 识别图片文字；任何失败都返回空串，交由上层降级 */
function ocrImageText(dataUrl) {
  return new Promise(function (resolve) {
    if (!dataUrl) { resolve(""); return; }
    loadTesseract(function (err, T) {
      if (err || !T) { resolve(""); return; }
      try {
        T.recognize(dataUrl, OCR_LANG, { logger: function () { } })
          .then(function (r) { resolve((r && r.data && r.data.text) || ""); })
          .catch(function () { resolve(""); });
      } catch (e) { resolve(""); }
    });
  });
}

/* ===================== 合并与统一入口 ===================== */

/* extra 中非空值覆盖 base；来源优先级 ocr > pdf > filename */
const SOURCE_RANK = { filename: 1, pdf: 2, ocr: 3 };

function mergeRecognized(base, extra, source) {
  const out = {
    amount: base.amount != null ? base.amount : null,
    date: base.date || "",
    kind: base.kind || "",
    ticketNo: base.ticketNo || "",
    note: base.note || "",
    source: base.amount != null || base.date || base.kind ? "filename" : "none"
  };
  if (extra && typeof extra === "object") {
    if (extra.amount != null) out.amount = extra.amount;
    if (extra.date) out.date = extra.date;
    if (extra.kind) out.kind = extra.kind;
    if (extra.ticketNo) out.ticketNo = extra.ticketNo;
  }
  if (source && (SOURCE_RANK[source] || 0) > (SOURCE_RANK[out.source] || 0)) out.source = source;
  /* 票号并入备注，便于人工核对 */
  const no = out.ticketNo || "";
  if (no && out.note.indexOf(no) < 0) out.note = (no + " " + out.note).trim().slice(0, 40);
  out.confidence = out.amount != null ? "high" : (out.kind || out.date ? "mid" : "low");
  return out;
}

/* dataURL → Blob：让已保存的票据也能再次送进识别通道 */
function dataUrlToBlob(dataUrl) {
  try {
    const parts = String(dataUrl).split(",");
    if (parts.length < 2) return null;
    const mimeMatch = /:([^;]+);/.exec(parts[0]);
    const bin = atob(parts[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: (mimeMatch && mimeMatch[1]) || "application/octet-stream" });
  } catch (e) { return null; }
}

/* 对已保存的票据（仅有 dataUrl / fileName）重新识别：PDF 走文本层，图片走 OCR */
function recognizeStoredReceipt(receipt) {
  return new Promise(function (resolve) {
    try {
      const r = receipt || {};
      if (!r.dataUrl) { resolve(null); return; }
      const isPDF = /pdf/i.test(r.fileType || "") || /\.pdf$/i.test(r.fileName || "");
      const blob = dataUrlToBlob(r.dataUrl);
      if (!blob) { resolve(null); return; }
      const empty = { amount: null, date: "", kind: "", ticketNo: "", note: "", source: "none" };
      if (isPDF) {
        extractPdfText(blob).then(function (text) {
          resolve(text ? mergeRecognized(empty, extractReceiptFromText(text), "pdf") : null);
        });
      } else {
        ocrImageText(r.dataUrl).then(function (text) {
          resolve(text ? mergeRecognized(empty, extractReceiptFromText(text), "ocr") : null);
        });
      }
    } catch (e) { resolve(null); }
  });
}

/* 是否开启联网 OCR（读取设置；沙盒或缺字段时默认关闭） */
function ocrEnabled() {
  try {
    return !!(typeof DB !== "undefined" && DB && DB.settings && DB.settings.ocrEnabled);
  } catch (e) { return false; }
}

/* 统一入口：返回 Promise<{amount,date,kind,ticketNo,note,source,confidence}> */
function recognizeReceipt(file, dataUrl) {
  const name = (file && file.name) || "";
  const isPDF = /pdf/i.test((file && file.type) || "") || /\.pdf$/i.test(name);
  const base = parseReceiptFileName(name);
  return new Promise(function (resolve) {
    const finish = function (extra, source) { resolve(mergeRecognized(base, extra, source)); };
    if (isPDF) {
      extractPdfText(file).then(function (text) {
        finish(text ? extractReceiptFromText(text) : {}, text ? "pdf" : null);
      });
      return;
    }
    if (ocrEnabled()) {
      ocrImageText(dataUrl).then(function (text) {
        finish(text ? extractReceiptFromText(text) : {}, text ? "ocr" : null);
      });
      return;
    }
    finish({}, null);
  });
}
