/* 票据识别：从文件名 / PDF 文本层 / 图片 OCR 中抽取票据类型、金额、日期、票号
   设计原则：
   1. 零依赖通道优先——文件名解析与 PDF 文本层抽取不引入任何库，离线可用
   2. 联网 OCR 为可选项——仅在设置中开启时按需加载 Tesseract.js，失败静默降级
   3. 识别结果只是「建议值」——一律回填到表单由人工确认，绝不静默写入金额 */

/* Tesseract.js 按需加载地址（仅在用户开启 OCR 时请求） */
const OCR_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const OCR_LANG = "chi_sim+eng";

/* 票据类型关键词：按顺序命中，越靠前优先级越高。
   含增值税发票的「税收分类项目名称」写法（航空运输 / 住宿服务 等），
   真实电子发票多用这套词，而非「机票」「饭店」等口语词。 */
const KIND_KEYWORDS = [
  ["火车票", ["火车票", "高铁", "动车", "铁路", "车票", "检票口", "车次", "列车", "railway", "train"]],
  ["飞机票", ["飞机票", "登机牌", "航班", "电子客票", "机票", "值机", "航段", "航空运输", "民用航空", "民航", "boarding", "flight", "airline"]],
  ["住宿票据", ["住宿", "酒店", "宾馆", "客房", "房费", "住宿费", "旅店", "hotel", "inn"]],
  ["市内交通票据", ["出租车", "网约车", "滴滴", "地铁", "公交", "打车", "市内交通", "出租汽车", "taxi"]],
  ["餐饮票据", ["餐饮", "餐费", "就餐", "餐厅", "饭店", "食品", "餐饮费"]],
  ["会议邀请函", ["邀请函", "邀请", "会议通知", "报到通知", "invitation"]]
];

/* 金额锚点词：出现这些词时，紧随其后的数字最可能是票据金额。
   中文与英文分开存放——英文需 \b 单词边界（否则 "fee" 会命中 "coffee"），
   但 \b 对中文无效（中文被视作 non-word），故中文不能用 \b 包裹。 */
const AMOUNT_KEYWORDS_CN = "价税合计|合计金额|价税|合计|小写|票价|票款|实付|应付|总计|总额|金额|共计|费用|报销金额";
const AMOUNT_KEYWORDS_EN = "amount|total|fare|price|fee|sum|grand|payment";
const AMOUNT_ANCHOR = "(?:" + AMOUNT_KEYWORDS_CN + "|\\b(?:" + AMOUNT_KEYWORDS_EN + ")\\b)";

/* 货币前缀：¥ / ￥ / CNY / RMB。
   MONEY_PREFIX_OPT 用于「锚点词 + 数字」——此时货币符号可有可无（Grand Total 248.50）；
   MONEY_PREFIX 用于「仅凭货币符号找数字」——此时符号必须存在，否则会命中任意数字。 */
const MONEY_PREFIX = "(?:[¥￥]|CNY|RMB|RMB¥)\\s*";
const MONEY_PREFIX_OPT = "(?:(?:[¥￥]|CNY|RMB|RMB¥)\\s*)?";

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

/* 中文大写金额 → 数字：「柒佰陆拾贰圆整」→762、「玖佰伍拾陆圆伍角整」→956.5
   为什么值得做：中式发票的大写金额是法定要素，几乎必有；而且汉字比数字稳健得多——
   汉字被错表解码会立刻变成乱码（容易发现、也容易被可读性评分排除），
   数字被错表解码后**仍然是数字**，肉眼和评分都分辨不出来。
   所以小写金额因字体子集缺字而解丢时，大写就是最可靠的兜底。 */
const RMB_UPPER_CHARS = "零〇壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整正";
const RMB_DIGITS = { "零": 0, "〇": 0, "壹": 1, "贰": 2, "叁": 3, "肆": 4, "伍": 5, "陆": 6, "柒": 7, "捌": 8, "玖": 9 };
const RMB_SECTION = { "拾": 10, "佰": 100, "仟": 1000 };
const RMB_BIG = { "万": 1e4, "亿": 1e8 };

function rmbUpperToNumber(str) {
  if (!str) return null;
  const s = String(str).replace(/\s+/g, "");
  /* 只认「大写数字 + 圆/元」的组合：必须带圆或元才成立，
     否则「一次性」这类普通汉字里的「一」会被误判成金额。 */
  const m = s.match(new RegExp("[" + RMB_UPPER_CHARS + "]{2,}"));
  if (!m) return null;
  const t = m[0];
  const cut = t.search(/[圆元]/);
  if (cut < 0) return null;
  const head = t.slice(0, cut);       /* 圆/元 之前的整数部分 */
  const tail = t.slice(cut + 1);      /* 角、分 */
  let intVal = 0, section = 0, cur = 0, seen = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (RMB_DIGITS[ch] != null) { cur = RMB_DIGITS[ch]; seen = true; continue; }
    if (RMB_SECTION[ch] != null) { if (cur === 0) cur = 1; section += cur * RMB_SECTION[ch]; cur = 0; seen = true; continue; }
    if (RMB_BIG[ch] != null) { section += cur; intVal += section * RMB_BIG[ch]; section = 0; cur = 0; continue; }
  }
  intVal += section + cur;
  if (!seen) return null;
  let dec = 0;
  const jm = tail.match(/([零〇壹贰叁肆伍陆柒捌玖])\s*角/);
  if (jm) dec += RMB_DIGITS[jm[1]] / 10;
  const fm = tail.match(/([零〇壹贰叁肆伍陆柒捌玖])\s*分/);
  if (fm) dec += RMB_DIGITS[fm[1]] / 100;
  const v = intVal + dec;
  return (isFinite(v) && v > 0 && v < 200000) ? Math.round(v * 100) / 100 : null;
}

/* 金额抽取：①锚点词就近数字 ②¥ 前缀取最大 ③大写反推 ④「N 元」取最大

   优先级不是一个死顺序，而是「证据强弱」：
   - 锚点词（「（小写）¥553.00」）是发票上显式标注的字段，证据最强，一旦命中即采信；
   - ¥ 取最大值是启发式猜测，可能与明细行冲突，需与大写交叉校验；
   - 大写金额是法定金额，小写缺失或不可信时兜底。 */
function pickAmountFromText(text) {
  const flat = normText(text);
  if (!flat) return null;
  /* 千分位优先（1,280.00），其次普通小数（553.00）；逗号一律按千分位处理 */
  const N = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{1,7}(?:\\.\\d{1,2})?)";
  let anchored = null, bySymbol = null;

  /* ① 锚点词就近数字：锚点与数字间可夹货币符号、冒号、空格（如 "Amount: CNY 1,280.00"）。
     逐个候选试解——第一个匹配可能落在发票号等超长数字上（被 toMoney 判为无效），
     此时应继续往后找，而不是放弃锚点分支。 */
  let re1 = new RegExp(AMOUNT_ANCHOR + "[^0-9]{0,20}" + MONEY_PREFIX_OPT + N, "gi"), m1;
  while ((m1 = re1.exec(flat))) { const v = toMoney(m1[1]); if (v) { anchored = v; break; } }

  /* ② 货币符号后取最大值：¥1280.00 / CNY 1,280.00 / RMB 88.50 */
  let re = new RegExp(MONEY_PREFIX + N, "gi"), mm, cands = [];
  while ((mm = re.exec(flat))) { const v = toMoney(mm[1]); if (v) cands.push(v); }
  if (cands.length) bySymbol = Math.max.apply(Math, cands);

  /* ③ 中文大写金额反推 */
  const upper = rmbUpperToNumber(flat);

  /* 显式字段最可信，直接采信 */
  if (anchored != null) return anchored;
  /* 只有启发式结果时与大写交叉校验：一致取小写，冲突取大写（法定金额为准） */
  if (bySymbol != null) {
    if (upper == null || Math.abs(upper - bySymbol) <= 0.01) return bySymbol;
    return upper;
  }
  if (upper != null) return upper;

  /* ④ 「N 元」取最大 */
  cands = [];
  re = new RegExp(N + "\\s*元", "g");
  while ((mm = re.exec(flat))) { const v = toMoney(mm[1]); if (v) cands.push(v); }
  return cands.length ? Math.max.apply(Math, cands) : null;
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

/* 票号抽取：车次（G/D/K/Z/T/C 开头）或发票号码。
   中文标签常被 PDF 拆成单字（"发 票 号 码 ："），故额外准备一份去空格副本用于匹配。 */
function pickTicketNoFromText(text) {
  const flat = normText(text);
  if (!flat) return null;
  let m = flat.match(/(?:^|[^A-Za-z0-9])([GDKZTC]\d{1,4})(?![0-9])/);
  if (m) return m[1];
  const tight = flat.replace(/\s+/g, "");
  m = tight.match(/发票号码[^0-9]{0,8}(\d{8,20})/) || flat.match(/发票号码[^0-9]{0,8}(\d{8,20})/);
  if (m) return m[1];
  m = tight.match(/(?:发票号|票据号|No\.?|NO\.?)[^0-9]{0,6}(\d{6,20})/);
  if (m) return m[1];
  /* 兜底：数电票（电子发票）号码固定 20 位，且标签常与数值分开渲染，
     靠关键词抓不到时，用「独立出现的 20 位数字」反推。 */
  m = flat.match(/(?:^|[^0-9])(\d{20})(?![0-9])/);
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

/* ===================== CID → Unicode 映射（ToUnicode CMap） ===================== */

/* 十六进制串 → Unicode 文本：每 4 位十六进制为一个 UTF-16BE 码元 */
function cmapHexToStr(h) {
  let s = String(h || "").replace(/[^0-9A-Fa-f]/g, "");
  if (!s) return "";
  if (s.length % 4) s = new Array(5 - (s.length % 4)).join("0") + s;
  let out = "";
  for (let i = 0; i < s.length; i += 4) {
    const cp = parseInt(s.substr(i, 4), 16);
    if (cp > 0) out += String.fromCharCode(cp);
  }
  return out;
}

/* 解析 ToUnicode CMap：支持 bfchar（一对一）与 bfrange（区间/数组）两种形式。
   中文电子发票几乎都依赖它——内容流里存的是字形索引，不经此表解码就是乱码。 */
function parseToUnicode(text) {
  const map = {};
  if (!text) return map;
  let re = /beginbfchar([\s\S]*?)endbfchar/g, m;
  while ((m = re.exec(text))) {
    let r2 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, m2;
    while ((m2 = r2.exec(m[1]))) map[parseInt(m2[1], 16)] = cmapHexToStr(m2[2]);
  }
  re = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = re.exec(text))) {
    const r3 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g;
    let m3;
    while ((m3 = r3.exec(m[1]))) {
      const lo = parseInt(m3[1], 16), hi = parseInt(m3[2], 16);
      if (m3[3]) {
        /* 连续区间 <lo> <hi> <起始码>：区间内码点依次递增 */
        const dst = cmapHexToStr(m3[3]);
        const base = dst ? dst.charCodeAt(dst.length - 1) : 0;
        for (let k = 0; lo + k <= hi && k < 65535; k++) {
          map[lo + k] = String.fromCharCode(base + k);
        }
      } else if (m3[4]) {
        const items = m3[4].match(/<[0-9A-Fa-f]+>/g) || [];
        for (let k = 0; k < items.length && lo + k <= hi; k++) {
          map[lo + k] = cmapHexToStr(items[k].slice(1, -1));
        }
      }
    }
  }
  return map;
}

/* 十六进制字面量 → 字节数组 */
function hexToBytes(h) {
  let s = String(h || "").replace(/[^0-9A-Fa-f]/g, "");
  if (s.length % 2) s = s.slice(0, s.length - 1);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.substr(i, 2), 16);
  return out;
}

/* 可读性打分：可打印字符（含 CJK 与 Latin-1 补充区）占比。
   注意 U+FFFF 与 U+FFFD 是 PDF 的 .notdef 占位（CMap 里常写作 <0000> <FFFF>），
   必须算作不可读——否则「1 字节解码」靠 .notdef 填满也能拿满分，会盖过正确的 2 字节解码。 */
function readableScore(s) {
  if (!s) return 0;
  let good = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xFFFF || c === 0xFFFD) continue;
    if (c === 0x20 || (c >= 0x30 && c <= 0x7e) || (c >= 0xa0 && c <= 0xFFFE)) good++;
  }
  return good / s.length;
}

/* 字形码 → 文本：同时尝试 2 字节（CID / Identity-H）与 1 字节（简单字体），取更可读者。
   中文发票多为 Identity-H，此时 CID 即 Unicode 码点，2 字节解码配合 CMap 可完整还原中文。 */
function decodeGlyphBytes(bytes, cmap) {
  if (!bytes || !bytes.length) return "";
  const decode = function (width) {
    let out = "";
    for (let i = 0; i + width - 1 < bytes.length; i += width) {
      let cid = 0;
      for (let k = 0; k < width; k++) cid = (cid << 8) | bytes[i + k];
      const mapped = cmap ? cmap[cid] : null;
      out += mapped != null ? mapped : String.fromCharCode(cid);
    }
    return out;
  };
  const one = decode(1);
  const two = bytes.length >= 2 ? decode(2) : "";
  if (!two) return one;
  return readableScore(two) >= readableScore(one) ? two : one;
}

/* ===================== 内容流文本抽取 ===================== */

/* TJ 数组展开：[(a) -5 (b)] TJ → (a) Tj (b) Tj，便于统一按 Tj 扫描 */
function expandTJArrays(src) {
  return String(src).replace(/\[([^\[\]]{0,4000})\]\s*TJ/g, function (_, inner) {
    return inner.replace(/(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)/g, "$1 Tj ");
  });
}

/* 抽取内容流中的全部文本串；字面串与十六进制串分开保存，解码阶段再统一处理 */
function pdfStringTokens(src) {
  const out = [];
  const s = expandTJArrays(src);
  /* (...) Tj 字面串；<...> Tj 十六进制串；' 与 " 同样是文本输出操作符 */
  let re = /\(((?:\\.|[^\\()]){0,400})\)\s*(?:Tj|'|")/g, m;
  while ((m = re.exec(s))) out.push({ lit: unescapePdfString(m[1]) });
  re = /<([0-9A-Fa-f\s]{0,800})>\s*(?:Tj|'|")/g;
  while ((m = re.exec(s))) out.push({ hex: m[1] });
  return out;
}

function pdfTokensToText(tokens, cmap) {
  let out = "";
  tokens.forEach(function (t) {
    if (t.lit != null) out += t.lit + " ";
    else if (t.hex != null) out += decodeGlyphBytes(hexToBytes(t.hex), cmap) + " ";
  });
  return out;
}

/* 清洗：剔除控制字符与替换符，保留 CJK、可打印 ASCII 与货币符号。
   注意不能像早期版本那样只留 ASCII——那样会丢掉「价税合计」等中文锚点词。 */
function cleanPdfText(s) {
  return String(s || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------------------------------------------
   按字体分别选 CMap —— 中文电子发票能否读对，全看这一步
   ---------------------------------------------------------------
   嵌入子集字体的内容流里存的是**字形索引（CID）**，且每个字体有自己
   独立的 Identity CMap。同一个 CID，在 A 字体可能是「电」、在 B 字体
   可能是「2」——CID 编码空间是「每字体一套」，不是全局一套。

   所以绝不能把所有 ToUnicode 表合并成一张：合并时后面字体的映射会
   覆盖前面字体的同名 key（1→电 被 1→2 顶掉），解码结果就是满屏乱码。

   做法：扫描内容流时跟踪 /Fx … Tf 的字体切换，把文本串按字体分段，
   再为每个字体「试解」全部候选 CMap，取可读性最高的那张。
   这样无需解析资源字典也能自适应，且表单/页面各自独立、互不干扰。 */

/* CID 命中率：按 2 字节分组，统计能在表中查到映射的比例。
   子集字体的表只覆盖自己用到的那几个字形，张冠李戴时命中率会明显掉下来。 */
function cmapCoverage(bytes, cmap) {
  if (!cmap) return 0;
  let hit = 0, total = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const cid = (bytes[i] << 8) | bytes[i + 1];
    total++;
    const mapped = cmap[cid];
    if (mapped != null && mapped !== "") hit++;
  }
  return total ? hit / total : 0;
}

/* 为一个字体的聚合字节挑最佳 CMap：**先比 CID 命中率，再比可读性**。
   不能只看可读性——「26952000003175418386」这样的数字串和一堆汉字
   都能拿满分，命中率才是区分「这表是不是给这个字体的」的硬指标。 */
function pickBestCmap(bytes, cmaps) {
  if (!bytes || !bytes.length) return null;
  if (!cmaps || !cmaps.length) return null;
  let bestMap = cmaps[0], bestKey = -1;
  cmaps.forEach(function (cm) {
    const sc = cmapCoverage(bytes, cm) * 1000 + readableScore(decodeGlyphBytes(bytes, cm));
    if (sc > bestKey) { bestKey = sc; bestMap = cm; }
  });
  return bestMap;
}

/* 把同一字体的若干字节片段拼成一段（样本越多，选表越准） */
function joinBytes(list) {
  let total = 0;
  list.forEach(function (b) { total += b.length; });
  const out = new Uint8Array(total);
  let p = 0;
  list.forEach(function (b) { out.set(b, p); p += b.length; });
  return out;
}

/* 解析一段内容流：按 Tf 切段 → 每字体选表 → 解码拼接。
   fontCmapLists 是「字体名 → 该字体的候选 CMap 表」，由资源字典推导；
   拿不到时退回候选全集。 */
function pdfContentText(src, cmaps, fontCmapLists) {
  const s = expandTJArrays(src);
  /* 字体切换 /Name <size> Tf；文本串 <hex> Tj 与 (lit) Tj（' 与 " 同样是文本输出） */
  const re = /\/([\w.\-]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>\s*(?:Tj|'|")|\(((?:\\.|[^\\()]){0,400})\)\s*(?:Tj|'|")/g;
  const segs = [];
  let cur = null, m;
  while ((m = re.exec(s))) {
    if (m[1] != null) { cur = m[1]; continue; }
    if (m[2] != null) segs.push({ font: cur || "*", hex: m[2] });
    else if (m[3] != null) segs.push({ font: cur || "*", lit: m[3] });
  }
  if (!segs.length) return "";

  /* 按字体聚合字节，为每个字体选出最合适的那张表 */
  const byFont = {};
  segs.forEach(function (g) {
    if (g.hex == null) return;
    const b = hexToBytes(g.hex);
    if (!b.length) return;
    (byFont[g.font] || (byFont[g.font] = [])).push(b);
  });
  const best = {};
  Object.keys(byFont).forEach(function (k) {
    const cand = (fontCmapLists && fontCmapLists[k]) || null;
    best[k] = pickBestCmap(joinBytes(byFont[k]), cand && cand.length ? cand : cmaps);
  });

  let out = "";
  segs.forEach(function (g) {
    if (g.hex != null) out += decodeGlyphBytes(hexToBytes(g.hex), best[g.font]) + " ";
    else if (g.lit != null) out += unescapePdfString(g.lit) + " ";
  });
  return cleanPdfText(out);
}

/* 建立「字体资源名 → 该字体 ToUnicode 表所在对象号」的候选关联。
   推导链：/Font << /F1 9 0 R >> → 字体对象 9 的 /ToUnicode 12 0 R → CMap 在对象 12。

   为什么不能靠可读性盲猜：字符集相近时评分根本分辨不出来。机票发票里
   JF3(CourierNew) 的 CID 是 3–16，JF1(KaiTi) 的 CID 恰好也是 3–16——
   两张表命中率都是 100%，而错表解出来「电子发子票票票票（普票电票通通通）」
   还是通顺汉字，可读性满分。唯一可靠的依据就是资源字典里写明的关联。

   objBodies 来自 ObjStm 展开：字体字典常常不在顶层，缺了它就关联不上。
   同一资源名（如 JF1）在不同资源字典里可能指向不同字体，故存为候选数组。 */
function pdfFontCmapCandidates(latin, objBodies) {
  const fontObjToCmap = {};
  const bodies = [];
  const take = function (num, body) {
    if (!body || num == null) return;
    const key = String(num);
    bodies.push({ num: key, body: body });
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(body);
    if (tu) fontObjToCmap[key] = tu[1];
  };
  /* 顶层对象：N G obj … endobj */
  let re = /(\d+)\s+\d+\s+obj\b([\s\S]{0,3000}?)endobj/g, m;
  while ((m = re.exec(latin))) take(m[1], m[2]);
  /* 对象流内部对象：裸字典，只有展开后才能拿到 */
  (objBodies || []).forEach(function (o) { take(o.num, o.body); });

  const cands = {};
  bodies.forEach(function (b) {
    let re2 = /\/Font\s*<<([^>]*)>>/g, m2;
    while ((m2 = re2.exec(b.body))) {
      let re3 = /\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g, m3;
      while ((m3 = re3.exec(m2[1]))) {
        const cmapObj = fontObjToCmap[m3[2]];
        if (!cmapObj) continue;
        const k = m3[1];
        if (!cands[k]) cands[k] = [];
        if (cands[k].indexOf(cmapObj) < 0) cands[k].push(cmapObj);
      }
    }
  });
  return cands;
}

/* ===================== PDF 对象与流收集 ===================== */

/* 展开 ObjStm（压缩对象流，PDF 1.5+）。
   为什么必须做：ObjStm 里的对象**不是** "N G obj … endobj" 形式，而是
   「编号 偏移」表 + 一串裸字典，按 /First 偏移依次排列。字体字典极爱藏在这里
   （机票发票就是如此：obj4/7/10/21 全在 obj36 里）。不展开就推不出
   「资源名 → 字体对象 → ToUnicode」，只能退化成全局盲猜编码表，
   于是金额段被别的字体表解成汉字乱码，数字无声消失。
   返回 [{num, body}]，body 为该对象的原始文本（含字典）。 */
function expandObjStm(dict, data) {
  const mn = /\/N\s+(\d+)/.exec(dict || "");
  const mf = /\/First\s+(\d+)/.exec(dict || "");
  if (!mn || !mf) return [];
  const latin = bytesToLatin1(data);
  const count = Number(mn[1]), base = Number(mf[1]);
  if (!(count > 0) || !(base > 0) || base >= latin.length) return [];
  const nums = (latin.slice(0, base).match(/\d+/g) || []).map(Number);
  const pairs = [];
  for (let i = 0; i + 1 < nums.length && pairs.length < count; i += 2) pairs.push([nums[i], nums[i + 1]]);
  const out = [];
  for (let i = 0; i < pairs.length; i++) {
    const start = base + pairs[i][1];
    const end = i + 1 < pairs.length ? base + pairs[i + 1][1] : latin.length;
    if (start < latin.length && end > start) {
      out.push({ num: String(pairs[i][0]), body: latin.slice(start, Math.min(end, latin.length)) });
    }
  }
  return out;
}

/* 定位所有 "N G obj <<dict>> stream ... endstream"，返回 [{num, dict, data}]。
   dict 部分用「不含 endobj / stream」的惰性匹配（tempered token）限定，
   否则对象号会错位：上一个没有流的对象（如字体字典）会被当成下一个流的
   拥有者——结果就是 CMap 挂错对象号，字体与编码表关联不上。 */
function pdfStreamChunks(bytes, latin) {
  const out = [];
  const re = /(\d+)\s+(\d+)\s+obj\b((?:(?!\bendobj\b|\bstream\b)[\s\S]){0,800}?)stream(\r?\n?)/g;
  let m;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    let end = latin.indexOf("endstream", start);
    if (end < 0 || end - start > 5 * 1024 * 1024) continue;
    /* 回退数据尾部与 endstream 之间的 EOL，避免多余字节破坏解压 */
    while (end > start && (latin[end - 1] === "\n" || latin[end - 1] === "\r" || latin[end - 1] === " ")) end--;
    if (end <= start) continue;
    /* 保留对象号：CMap 与内容流的对应关系靠它建立 */
    out.push({ num: m[1], dict: m[3] || "", data: bytes.subarray(start, end) });
  }
  return out;
}

/* 递归收集流：ObjStm（PDF 1.5+ 压缩对象）解压后内部仍是 "N G obj ... endobj" 序列，
   展开后继续查找，因此嵌套一层也能取到页面内容流。depth 防止异常文件导致死循环。
   objs 为共享累加器：ObjStm 内部对象（多数字体字典）单独用 expandObjStm 切出，
   因为那部分内容并不符合 "N G obj" 形态，递归扫描找不到它们。 */
function collectPdfStreams(bytes, latin, depth, done, objs) {
  objs = objs || [];
  const chunks = pdfStreamChunks(bytes, latin);
  const out = [];
  let i = 0;
  const step = function () {
    if (i >= chunks.length) { done(out, objs); return; }
    const c = chunks[i++];
    const flate = /\/FlateDecode/.test(c.dict);
    const objstm = /\/ObjStm/.test(c.dict);
    const proceed = function (data) {
      if (objstm && data && data.length) {
        /* 无论深度是否用尽，都先把内部对象收走——字体关联只靠这一份 */
        expandObjStm(c.dict, data).forEach(function (o) { objs.push(o); });
        if (depth < 3) {
          collectPdfStreams(data, bytesToLatin1(data), depth + 1, function (list) {
            out.push.apply(out, list);
            step();
          }, objs);
          return;
        }
      }
      out.push({ num: c.num, dict: c.dict, data: data || c.data });
      step();
    };
    if (flate) inflateBytes(c.data).then(function (d) { proceed(d && d.length ? d : c.data); });
    else proceed(c.data);
  };
  step();
}

/* 读取 PDF 并抽取文本层内容（异步；失败返回空串） */
function extractPdfText(file) {
  return new Promise(function (resolve) {
    try {
      const fr = new FileReader();
      fr.onload = function () {
        try {
          const bytes = new Uint8Array(fr.result);
          collectPdfStreams(bytes, bytesToLatin1(bytes), 0, function (list, objBodies) {
            try {
              /* 两阶段：先把所有 ToUnicode 表收齐，再解码内容流——
                 CMap 对象可能排在任何内容流之后，边扫边解会漏表。
                 每张表独立存放、绝不合并：见 pdfContentText 的说明。 */
              const cmaps = [], cmapByObj = {}, contents = [];
              list.forEach(function (c) {
                /* 图像流（JPEG/JPX/CCITT…）解压后是像素，但字节里也可能
                   碰巧出现 "Tj"，会被误当成内容流——按流字典直接排除。 */
                if (/\/(?:Image|DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)/.test(c.dict)) return;
                const latin = bytesToLatin1(c.data);
                if (/beginbfchar|beginbfrange|CIDInit|CMapName/.test(latin)) {
                  const m = parseToUnicode(latin);
                  if (Object.keys(m).length) {
                    cmaps.push(m);
                    if (c.num != null) cmapByObj[c.num] = m;
                  }
                  return;
                }
                if (!/\b(?:BT|Tj|TJ|Td|TD|Tm)\b/.test(latin)) return;
                contents.push(latin);
              });
              /* 资源字典 → 每个字体的候选表（先把对象号换成表本身）。
                 字体字典可能藏在 ObjStm 里，故必须带上 objBodies。 */
              const fontObjCands = pdfFontCmapCandidates(bytesToLatin1(bytes), objBodies);
              const fontCmapLists = {};
              Object.keys(fontObjCands).forEach(function (k) {
                const arr = [];
                fontObjCands[k].forEach(function (o) { if (cmapByObj[o]) arr.push(cmapByObj[o]); });
                if (arr.length) fontCmapLists[k] = arr;
              });
              /* 合并表仅作兜底：字体切换解析失败时，退回「一张表解全部」的旧路径 */
              const merged = {};
              cmaps.forEach(function (cm) {
                Object.keys(cm).forEach(function (k) { merged[k] = cm[k]; });
              });
              const texts = [];
              contents.forEach(function (latin) {
                let t = "";
                try { t = pdfContentText(latin, cmaps, fontCmapLists); } catch (e) { t = ""; }
                if (!t || readableScore(t) < 0.6) {
                  const t2 = cleanPdfText(pdfTokensToText(pdfStringTokens(latin), merged));
                  if (t2 && readableScore(t2) > readableScore(t)) t = t2;
                }
                /* 嵌入字体等二进制流偶有噪声，按可读性阈值过滤 */
                if (t && readableScore(t) >= 0.6) texts.push(t);
              });
              resolve(texts.join(" ").replace(/\s+/g, " ").trim());
            } catch (e) { resolve(""); }
          });
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
