"use strict";

/* ================================================================
   零依赖 XLSX 生成器
   ----------------------------------------------------------------
   本项目坚持「双击即用、不联网、不带第三方库」，所以不引入 SheetJS，
   而是手写最小可用的 OOXML 包：

     xlsx = 一个 ZIP 容器 + 若干 XML 部件

   两个关键简化：
   1) ZIP 采用 store 模式（压缩方法 0，不压缩）。OOXML 规范允许，
      这样就不必实现 deflate——省掉整个压缩器。
   2) 字符串一律用 inlineStr 内联，不做 sharedStrings 共享表。

   支持范围（够本项目资金申请单用）：单工作表、字体/边框/对齐、
   合并单元格、列宽、行高、纸张方向与页边距。
   ================================================================ */

/* ---------- CRC32（ZIP 必需） ---------- */
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- ZIP：store 模式打包 ---------- */
/* 固定时间戳：2026-09-20 12:00（ZIP 里 DOS 时间，与内容无关） */
const ZIP_TIME = (12 << 11) | (0 << 5) | 0;
const ZIP_DATE = ((2026 - 1980) << 9) | (9 << 5) | 20;

function zipStore(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  entries.forEach(function (e) {
    const nameBytes = enc.encode(e.name);
    const data = e.data;
    const crc = crc32(data);

    /* 本地文件头 30 字节 + 文件名 */
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);   // 签名
    lv.setUint16(4, 20, true);           // 解压所需版本
    lv.setUint16(6, 0x0800, true);       // 通用标记：文件名为 UTF-8
    lv.setUint16(8, 0, true);            // 压缩方法 0 = store
    lv.setUint16(10, ZIP_TIME, true);
    lv.setUint16(12, ZIP_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // 压缩后大小 = 原始大小
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // 扩展字段长度
    lh.set(nameBytes, 30);

    chunks.push(lh, data);

    /* 中央目录项 46 字节 + 文件名 */
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);           // 创建版本
    cv.setUint16(6, 20, true);           // 解压所需版本
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, ZIP_TIME, true);
    cv.setUint16(14, ZIP_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // 扩展字段
    cv.setUint16(32, 0, true);           // 注释
    cv.setUint16(34, 0, true);           // 起始磁盘号
    cv.setUint16(36, 0, true);           // 内部属性
    cv.setUint32(38, 0, true);           // 外部属性
    cv.setUint32(42, offset, true);      // 本地头偏移
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;
  });

  /* 中央目录 + 结束记录 */
  let cdSize = 0;
  central.forEach(function (c) { cdSize += c.length; });
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  /* 拼接为单一字节数组 */
  let total = 0;
  chunks.forEach(function (c) { total += c.length; });
  const out = new Uint8Array(total + cdSize + eocd.length);
  let p = 0;
  chunks.forEach(function (c) { out.set(c, p); p += c.length; });
  central.forEach(function (c) { out.set(c, p); p += c.length; });
  out.set(eocd, p);
  return out;
}

/* ---------- XML 转义 ---------- */
function xmlEsc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- 列号 → 列名（1 → A） ---------- */
function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellRef(r, c) { return colLetter(c) + r; }

/* ---------- 固定部件 ---------- */
const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  "</Types>";

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

function workbookXml(sheetName) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="' + xmlEsc(sheetName || "Sheet1") + '" sheetId="1" r:id="rId1"/></sheets>' +
    "</workbook>";
}

/* ---------- 样式表 ----------
   字体：0=宋体11  1=宋体18粗  2=宋体14粗  3=宋体12
   边框：0=无 1=四周细 2=仅下 3=左上下 4=右上下 5=仅上下
   xf 索引见 XFS 常量说明                                        */
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="\u5b8b\u4f53"/></font>' +
  '<font><b/><sz val="18"/><name val="\u5b8b\u4f53"/></font>' +
  '<font><b/><sz val="14"/><name val="\u5b8b\u4f53"/></font>' +
  '<font><sz val="12"/><name val="\u5b8b\u4f53"/></font>' +
  "</fonts>" +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="6">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right>' +
  '<top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FF000000"/></left><right/><top style="thin"><color rgb="FF000000"/></top>' +
  '<bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>' +
  '<border><left/><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top>' +
  '<bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>' +
  '<border><left/><right/><top style="thin"><color rgb="FF000000"/></top>' +
  '<bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>' +
  "</borders>" +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="12">' +
  /* 0 默认 */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  /* 1 大标题：18 粗 · 居中 */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  /* 2 日期行：14 粗 · 右对齐 · 下框 */ '<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
  /* 3 宋体12 · 居中 · 四周框 */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  /* 4 宋体12 · 居中 · 自动换行 · 四周框 */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  /* 5 宋体12 · 居中 · 换行 · 左上下框（金额大写格） */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  /* 6 宋体12 · 垂直居中 · 右上下框（小写金额格） */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
  /* 7 默认字 · 右上下框（合并区右端） */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="4" xfId="0" applyBorder="1"/>' +
  /* 8 默认字 · 下框（表头日期行其余列） */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>' +
  /* 9 默认字 · 上下框（合并区中段） */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="5" xfId="0" applyBorder="1"/>' +
  /* 10 宋体12 · 四周框 · 不设对齐（签字格） */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
  /* 11 宋体12 · 水平居中 · 四周框 */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="\u5e38\u89c4" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/* ---------- 工作表 XML ---------- */
/* sheet = { name, cols:[{min,max,width}], rows:[{ht, cells:[{c,v,s}]}], merges:[ref] } */
function sheetXml(sheet) {
  const rows = sheet.rows || [];
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="A1:' + cellRef(rows.length || 1, sheet.colCount || 9) + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18"/>';

  if (sheet.cols && sheet.cols.length) {
    x += "<cols>";
    sheet.cols.forEach(function (c) {
      x += '<col min="' + c.min + '" max="' + c.max + '" width="' + c.width + '" customWidth="1"/>';
    });
    x += "</cols>";
  }

  x += "<sheetData>";
  rows.forEach(function (row, i) {
    const r = i + 1;
    x += '<row r="' + r + '"' + (row.ht ? ' ht="' + row.ht + '" customHeight="1"' : "") + ' spans="1:' + (sheet.colCount || 9) + '">';
    (row.cells || []).forEach(function (cell) {
      const ref = typeof cell.ref === "string" ? cell.ref : cellRef(r, cell.c);
      const v = cell.v === undefined || cell.v === null ? "" : String(cell.v);
      if (v === "") {
        /* 空单元格也要写入，以承载边框 */
        x += '<c r="' + ref + '" s="' + (cell.s || 0) + '"/>';
      } else {
        x += '<c r="' + ref + '" s="' + (cell.s || 0) + '" t="inlineStr"><is><t xml:space="preserve">' +
          xmlEsc(v) + "</t></is></c>";
      }
    });
    x += "</row>";
  });
  x += "</sheetData>";

  if (sheet.merges && sheet.merges.length) {
    x += '<mergeCells count="' + sheet.merges.length + '">';
    sheet.merges.forEach(function (m) { x += '<mergeCell ref="' + m + '"/>'; });
    x += "</mergeCells>";
  }

  x += '<pageMargins left="0.708661417322835" right="0.708661417322835" top="0.748031496062992"' +
    ' bottom="0.748031496062992" header="0.31496062992126" footer="0.31496062992126"/>' +
    '<pageSetup orientation="' + (sheet.orientation || "landscape") + '" fitToWidth="1" fitToHeight="0"/>' +
    "</worksheet>";
  return x;
}

/* ---------- 对外：构建 xlsx 字节流 ---------- */
function buildXlsx(sheet) {
  const enc = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS_XML) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(sheet.name)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS_XML) },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(sheet)) }
  ]);
}

/* ---------- 对外：触发浏览器下载 ---------- */
function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
