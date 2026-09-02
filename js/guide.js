"use strict";

/* ===================== 工作台使用说明向导 =====================
   分步讲解 + 纯 CSS 动画演示（可视化动态指导使用过程）
   步骤内容为纯数据（GUIDE_STEPS），渲染函数 guideStepBody 不碰 DOM，
   便于冒烟测试；交互装配集中在 openGuide。 */

/* 演示动画共用时间类（.gdm-t1~t6 依次延迟入场，换步时重建 DOM 自动重播） */

const GUIDE_STEPS = [

  {
    tag: "总览", title: "认识教师工作台", go: "dashboard",
    text: [
      "工作台由 <b>7 大模块</b>组成：仪表盘、课程教学、学生管理、学科竞赛、科研项目、考核汇总、学期与设置，全部通过<b>左侧导航</b>切换。",
      "顶栏实时显示<b>当前学期与教学周</b>；右上角「<b>＋ 快速录入</b>」聚合六类高频操作，30 秒内完成一次录入。",
      "本向导可随时从左侧「<b>使用说明</b>」按钮重新打开。"
    ],
    demo:
      '<div class="gdm gdm-app">' +
        '<div class="gdm-side">' +
          '<div class="gdm-brand">师</div>' +
          ["仪表盘", "课程教学", "学生管理", "学科竞赛", "科研项目", "考核汇总", "学期与设置"].map(function (n) {
            return '<div class="gdm-nav"><i></i>' + n + "</div>";
          }).join("") +
        "</div>" +
        '<div class="gdm-main">' +
          '<div class="gdm-top"><span class="gdm-pill">2026 秋季学期 · 第 1 周</span><span class="gdm-qk">＋ 快速录入</span></div>' +
          '<div class="gdm-grid"><i></i><i></i><i></i></div>' +
          '<div class="gdm-calbar"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
        "</div>" +
      "</div>"
  },

  {
    tag: "第 1 步", title: "学期与设置 · 一切的根基", go: "settings",
    text: [
      "在「学期与设置」中<b>创建学期</b>：填写起止日期后，系统自动换算第 1–N 教学周，顶栏与日历都依赖它。",
      "填写<b>教师信息</b>（学校 / 学院 / 教师专业），保存后显示在左侧边栏，并用于考核汇总的署名。",
      "演示：三行信息依次保存，随后出现在侧边栏教师信息卡中。"
    ],
    demo:
      '<div class="gdm gdm-form">' +
        '<div class="gdm-f gdm-t1"><label>学校</label><span class="gdm-input">某某师范大学<i class="gdm-caret"></i></span></div>' +
        '<div class="gdm-f gdm-t2"><label>学院</label><span class="gdm-input">数智传媒与设计艺术学院</span></div>' +
        '<div class="gdm-f gdm-t3"><label>教师专业</label><span class="gdm-input">智能交互设计</span></div>' +
        '<div class="gdm-arrow gdm-t4">▾ 保存后显示在左侧边栏</div>' +
        '<div class="gdm-sideinfo gdm-t5">' +
          '<div class="gdm-sideinfo-title">教师信息</div>' +
          '<div>某某师范大学</div><div>数智传媒与设计艺术学院</div><div>智能交互设计</div>' +
        "</div>" +
      "</div>"
  },

  {
    tag: "第 2 步", title: "课程教学 · 档案与成绩", go: "courses",
    text: [
      "新建课程档案：设置<b>理论 / 实验 / 实践 / 上机学时</b>，按<b>周次与单双周</b>添加授课时段（如实验双周 1-16 周）。",
      "课程名单支持<b>粘贴 TSV 一键导入</b>（学号自动去重复用档案池）。",
      "课程详情内可录<b>成绩册</b>（平时 / 期中 / 期末按比例自动加权）与<b>考勤</b>。"
    ],
    demo:
      '<div class="gdm gdm-course">' +
        '<div class="gdm-course-head gdm-t1"><b>数据结构</b><span>2025 级计科 1 班 · 理论 32 + 实验 16 + 上机 16 学时</span></div>' +
        '<div class="gdm-slot gdm-t2"><i class="gdm-dot gdm-dot-blue"></i>周一 08:00-09:40 · 理论 · 1-18 周</div>' +
        '<div class="gdm-slot gdm-t3"><i class="gdm-dot gdm-dot-purple"></i>周三 10:00-12:30 · 实验 · 1-16 周·双周</div>' +
        '<div class="gdm-slot gdm-t4"><i class="gdm-dot gdm-dot-teal"></i>周四 08:00-11:50 · 实践 · 6-14 周</div>' +
        '<div class="gdm-slot gdm-t5"><i class="gdm-dot gdm-dot-amber"></i>周五 14:00-16:30 · 上机 · 3-14 周·机房</div>' +
        '<div class="gdm-row gdm-t6">名单 42 人 · <span class="gdm-chip gdm-chip-blue">粘贴 TSV 一键导入</span></div>' +
        '<div class="gdm-row gdm-t7">成绩册：平时 30% + 期中 20% + 期末 50% 自动加权</div>' +
      "</div>"
  },

  {
    tag: "第 3 步", title: "学生管理 · 档案池与班主任台账", go: "students",
    text: [
      "全局<b>学生档案池</b>：一份档案多门课程共享，录入一次处处可用。",
      "班主任工作台账覆盖 <b>8 大类</b>：谈话 / 走访宿舍 / 班会 / 活动 / 评奖评优 / 就业 / 贫困生申报 / 其他，每条可关联学生。",
      "「<b>统计分析</b>」子模块自动输出月度趋势、分类统计、完成率与活跃度排行。"
    ],
    demo:
      '<div class="gdm gdm-ledger">' +
        [["谈话", "blue", "新学期适应性谈话", "09-02"],
         ["走访宿舍", "amber", "走访 3 号楼 502", "09-03"],
         ["评奖评优", "red", "国家奖学金评议", "09-05"],
         ["就业", "teal", "就业推荐表盖章", "09-08"],
         ["贫困生申报", "purple", "贫困生认定材料收缴", "09-12"]].map(function (r, i) {
          return '<div class="gdm-lg-row gdm-t' + (i + 1) + '">' +
            '<span class="gdm-badge gdm-badge-' + r[1] + '">' + r[0] + "</span>" + r[2] +
            '<span class="gdm-date">' + r[3] + "</span></div>";
        }).join("") +
        '<div class="gdm-stats gdm-t6"><i style="width:72%"></i><i style="width:48%"></i><i style="width:60%"></i></div>' +
      "</div>"
  },

  {
    tag: "第 4 步", title: "跟踪事项 · 以台账为基础", go: "students",
    text: [
      "跟踪事项<b>不能自由输入</b>：在台账列表点击「<b>一键转跟踪</b>」，把某条台账升级为跟踪事项。",
      "跟踪事项在日历中统一显示为<b>红色</b>；已被跟踪的台账自动<b>让位</b>，同一天不会重复出现。",
      "明日到期的跟踪事项会出现在仪表盘「<b>明日提醒</b>」条中，点击直达。"
    ],
    demo:
      '<div class="gdm gdm-track">' +
        '<div class="gdm-lg-row gdm-t1"><span class="gdm-badge gdm-badge-teal">就业</span>就业推荐表盖章<span class="gdm-date">09-08</span><span class="gdm-link">一键转跟踪 →</span></div>' +
        '<div class="gdm-arrow gdm-t2">▾ 台账让位，日历只显示一次</div>' +
        '<div class="gdm-calrow gdm-t3"><span class="gdm-day">08</span><span class="gdm-chip gdm-chip-red">跟踪事项 · 就业推荐表盖章</span></div>' +
        '<div class="gdm-calrow gdm-t4"><span class="gdm-day">09</span><span class="gdm-chip gdm-chip-red">跟踪事项 · 就业推荐表盖章</span></div>' +
        '<div class="gdm-legend gdm-t5"><i class="gdm-lg-dot gdm-lg-red"></i>跟踪事项 = 红色，明日到期自动提醒</div>' +
      "</div>"
  },

  {
    tag: "第 5 步", title: "科研节点与竞赛时间跟踪", go: "projects",
    text: [
      "科研项目里为每个节点（开题 / 中期 / 结题等）设置日期，勾选「<b>同步到日历</b>」即纳入跟踪。",
      "竞赛可分别跟踪<b>报名截止</b>与<b>决赛</b>两个日期，详情页与列表都能快捷切换。",
      "被跟踪的节点与日期以<b>红色</b>进入教学日历和明日提醒；已完成的节点显示<b>绿色</b>。"
    ],
    demo:
      '<div class="gdm gdm-track">' +
        '<div class="gdm-lg-row gdm-t1"><span class="gdm-check">☑</span>中期检查 · 09-20<span class="gdm-badge gdm-badge-red">跟踪中</span></div>' +
        '<div class="gdm-lg-row gdm-t2"><span class="gdm-check">☐</span>结题验收 · 11-30<span class="gdm-muted">未跟踪</span></div>' +
        '<div class="gdm-lg-row gdm-t3"><span class="gdm-check">☑</span>蓝桥杯<span class="gdm-badge gdm-badge-red">报名截止 09-10</span><span class="gdm-badge gdm-badge-red">决赛 04-15</span></div>' +
        '<div class="gdm-arrow gdm-t4">▾ 勾选后同步到教学日历</div>' +
        '<div class="gdm-calrow gdm-t5"><span class="gdm-day">20</span><span class="gdm-chip gdm-chip-red">科研节点 · 中期检查</span></div>' +
        '<div class="gdm-calrow gdm-t6"><span class="gdm-day">10</span><span class="gdm-chip gdm-chip-red">竞赛报名截止 · 蓝桥杯</span></div>' +
      "</div>"
  },

  {
    tag: "第 6 步", title: "教学日历 · 全局月视图", go: "dashboard",
    text: [
      "仪表盘的教学日历汇总<b>全部日程</b>：课程时段、跟踪事项、科研节点、竞赛日期、特殊事件（监考 / 答辩等）。",
      "课程按时间三态着色：<b>绿色 ✓ 已上</b>、<b>金色闪烁 进行中</b>、<b>蓝色 未上</b>，每 30 秒自动刷新。",
      "点击任意条目<b>直达对应模块</b>；顶部按钮可切换上一个月 / 本月 / 下一个月。"
    ],
    demo:
      '<div class="gdm gdm-calmini">' +
        '<div class="gdm-dow-row">' + ["一", "二", "三", "四", "五", "六", "日"].map(function (d) { return "<span>" + d + "</span>"; }).join("") + "</div>" +
        '<div class="gdm-cellgrid">' +
          ["done", "done", "done", "done", "done", "dim", "dim",
           "done", "done", "today", "todo", "todo", "dim", "dim",
           "todo", "todo", "todo", "todo", "dim", "dim", "dim"].map(function (c, i) {
            return '<div class="gdm-cell c-' + c + '" style="animation-delay:' + (0.25 + i * 0.13) + 's">' +
              (c === "today" ? '<span class="gdm-today-tag">今天</span>' : "") +
              (c === "done" ? "<b>✓</b>" : "") + "</div>";
          }).join("") +
        "</div>" +
        '<div class="gdm-legend">' +
          '<i class="gdm-lg-dot gdm-lg-green"></i>已上' +
          '<i class="gdm-lg-dot gdm-lg-gold"></i>进行中' +
          '<i class="gdm-lg-dot gdm-lg-blue"></i>未上' +
        "</div>" +
      "</div>"
  },

  {
    tag: "最后", title: "数据安全 · 放心使用", go: "settings",
    text: [
      "所有数据保存在<b>本机浏览器</b>中，不上传任何服务器，双击即用、零依赖。",
      "建议养成习惯：定期点击侧边栏底部「<b>导出数据备份</b>」，生成 JSON 文件留存。",
      "考核汇总模块支持一键导出全年工作量。<b>向导到此结束，开始使用吧！</b>"
    ],
    demo:
      '<div class="gdm gdm-data">' +
        '<div class="gdm-shield gdm-t1"><b>本机存储</b>不上传服务器 · 零依赖 · 双击即用</div>' +
        '<div class="gdm-export gdm-t2">⬇ 导出数据备份（JSON）</div>' +
        '<div class="gdm-arrow gdm-t3">▾</div>' +
        '<div class="gdm-file gdm-t4"><b>✓</b> teacher_workplant_备份.json 已保存</div>' +
        '<div class="gdm-export gdm-t5">⬇ 考核汇总 · 一键导出全年工作量</div>' +
      "</div>"
  }
];

/* 单步内容渲染（纯函数，不碰 DOM） */
function guideStepBody(i) {
  const s = GUIDE_STEPS[i];
  return '<div class="gd-step">' +
    '<div class="gd-info">' +
      '<div class="gd-step-tag">' + esc(s.tag) + " · " + (i + 1) + " / " + GUIDE_STEPS.length + "</div>" +
      '<div class="gd-step-title">' + esc(s.title) + "</div>" +
      '<div class="gd-step-text">' + s.text.map(function (p) { return "<p>" + p + "</p>"; }).join("") + "</div>" +
      (s.go ? '<div class="gd-step-go link" data-gd-go="' + esc(s.go) + '">前往该模块 →</div>' : "") +
    "</div>" +
    '<div class="gd-demo">' + s.demo + "</div>" +
  "</div>";
}

/* ===================== 向导交互装配 =====================
   上一步 / 下一步 / 进度点跳转 / 自动播放 / ← → 键盘翻页；
   每次换步重建 DOM，CSS 动画自动重播。 */
function openGuide() {
  let idx = 0;
  let autoTimer = null;

  const overlay = openModal({
    title: "工作台使用说明 · 新手向导",
    wide: true,
    body: '<div id="gd-wrap"></div><div class="gd-dots" id="gd-dots"></div>',
    foot:
      '<div class="gd-foot">' +
        '<button class="btn btn-light btn-sm" id="gd-auto" title="每 4 秒自动切换下一步">▶ 自动播放</button>' +
        '<div class="gd-foot-right">' +
          '<button class="btn btn-light" data-close>跳过</button>' +
          '<button class="btn btn-light" id="gd-prev">上一步</button>' +
          '<button class="btn" id="gd-next">下一步</button>' +
        "</div>" +
      "</div>"
  });

  function alive() { return !!document.getElementById("gd-wrap"); }
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    const b = $("#gd-auto", overlay); if (b) b.textContent = "▶ 自动播放";
  }
  function startAuto() {
    stopAuto();
    autoTimer = setInterval(function () { next(); }, 4000);
    const b = $("#gd-auto", overlay); if (b) b.textContent = "⏸ 暂停播放";
  }
  function next() {
    if (!alive()) { stopAuto(); return; }
    if (idx < GUIDE_STEPS.length - 1) { idx++; render(); }
    else stopAuto();
  }
  function prev() {
    if (!alive()) { stopAuto(); return; }
    stopAuto();
    if (idx > 0) { idx--; render(); }
  }

  function render() {
    const wrap = $("#gd-wrap", overlay);
    const dots = $("#gd-dots", overlay);
    if (!wrap || !dots) { stopAuto(); return; }
    wrap.innerHTML = guideStepBody(idx);
    dots.innerHTML = GUIDE_STEPS.map(function (s, i) {
      return '<span class="gd-dot' + (i === idx ? " on" : "") + '" data-gd-step="' + i + '" title="' + esc(s.title) + '"></span>';
    }).join("");
    const pb = $("#gd-prev", overlay), nb = $("#gd-next", overlay);
    if (pb) pb.style.visibility = idx === 0 ? "hidden" : "";
    if (nb) nb.textContent = idx === GUIDE_STEPS.length - 1 ? "完成 ✓" : "下一步";
  }

  overlay.addEventListener("click", function (e) {
    const dot = e.target.closest("[data-gd-step]");
    if (dot) { stopAuto(); idx = Number(dot.getAttribute("data-gd-step")); render(); return; }
    const g = e.target.closest("[data-gd-go]");
    if (g) { closeModal(); go(g.getAttribute("data-gd-go")); return; }
    if (e.target.closest("#gd-next")) {
      if (idx === GUIDE_STEPS.length - 1) { stopAuto(); closeModal(); } else next();
      return;
    }
    if (e.target.closest("#gd-prev")) { prev(); return; }
    if (e.target.closest("#gd-auto")) { autoTimer ? stopAuto() : startAuto(); return; }
  });

  /* 键盘 ← → 翻页；向导已关闭时自动解绑 */
  document.addEventListener("keydown", function onKey(e) {
    if (!alive()) { document.removeEventListener("keydown", onKey); return; }
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  });

  render();
}
