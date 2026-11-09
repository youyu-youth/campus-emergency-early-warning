---
version: 1
slug: "src-app-layout-tsx"
primary_target: "src/app/layout.tsx"
related_targets: ["src/components/shell/app-nav-rail.tsx","src/components/shell/drill-status-bar.tsx","src/components/shell/page-header.tsx"]
---

壳层（AppNavRail / DrillStatusBar / PageHeader + 状态语言基础）。访客模式：Operate。受众：操作员（课堂教师/学生），亮环境桌面浏览器 1440 基准，本地单机、无登录。

**Job：** 任何页面一眼看到：有无演练、事件等级、模拟时钟、暂停控制；「模拟演练」标识常驻；为全站立视觉世界。
**Action/task：** 导航七页（态势/推演/复盘三组）+ 状态条空闲态「一键发起」。
**Proof/content：** 演练名、阶段（感知→研判→处置→通知→复盘）、模拟时钟 HH:mm:ss、等级 Ⅰ–Ⅳ、DrillStatus 六态。
**Constraints：** docs/design.md §2.1 布局、§8 反目标（不拟真警情、不游戏化、状态不裸用颜色）；Tailwind v4 + shadcn + lucide；中文系统字体栈 + 等宽数字。

## Direction contract

THESIS：壳层是预警发布台——等级是挂出来的信号牌、人工确认是盖下去的戳；拒绝「中性灰黑 SaaS 侧栏」的类别默认。

OWN-WORLD：深藏青石墨壳（带彩度 #1a2340 系，恒深）+ 冷灰白画布（恒浅，亮环境投影可读）；靛青 #3b5bdb 交互主色；等级四色（红Ⅰ/橙Ⅱ/黄Ⅲ/蓝Ⅳ）只做真工作且永远配文字+图标；等宽数字承载仪表感；1px 规则线一根粗细，分区靠留白；行灯状态点（琥珀=待确认、红=异常）。焦点红圈全站唯一（载体=事件详情工作区的当前事件标题，工作区轮落地）；确认戳（ConfirmStamp）载体=工作区时间线 ⚑ 节点，工作区轮接入。

STORY：操作员进入任意页面即知全局态势——空闲见「空闲+一键发起」，运行见挂牌+跳动模拟钟+暂停控制；模拟/真实时钟并列注明来源；「模拟演练」常驻，绝不与真实警情混淆。

FIRST VIEWPORT：左 220px 可折叠导航（品牌+演练徽标、三组菜单、单机标识）+ 48px 状态条（运行态：演练名、阶段 chip、18px 等宽模拟钟、暂停按钮、模拟演练徽标；空闲态：空闲标注+发起按钮）+ 冷灰白画布。签名动作「挂牌」：演练启动时状态条升起等级信号牌，等级变化换牌。

FORM：信号牌指挥台（assigned）；七候选共鸣序第 4；`seed:6d9a560b67650252`；锁定草图 `.impeccable/mocks/decision/shell-assigned.html`（code-led 组合基准：布局、色板、密度按它，欠响应式与全部状态）。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
