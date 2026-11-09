---
name: 校园突发事件预警平台
description: 深藏青石墨发布台 + 冷灰白画布的模拟预警推演指挥界面——等级是挂出来的信号牌，确认是盖下去的戳（模拟演练，非真实警情）
colors:
  # 壳层（恒深，不随 .dark 切换）
  shell: "oklch(0.23 0.055 264)"            # 发布台藏青
  shell-foreground: "oklch(0.935 0.015 262)" # 壳上银白
  shell-muted: "oklch(0.73 0.05 265)"        # 壳上雾蓝
  shell-border: "oklch(0.32 0.06 264)"       # 藏青界线
  # 交互主色（靛青；--shell-accent 与 --ring 与此同值）
  indigo: "oklch(0.545 0.185 264)"           # 靛青
  indigo-foreground: "oklch(0.985 0.005 250)" # 靛上银白
  indigo-bright: "oklch(0.68 0.15 264)"      # 亮靛（壳上活动图标）
  indigo-veil: "oklch(0.545 0.185 264 / 16%)" # 靛青晕（导航活动底）
  # 画布（恒浅，亮环境投影可读）
  canvas: "oklch(0.972 0.004 250)"           # 冷灰白
  ink: "oklch(0.24 0.03 262)"                # 石墨墨字
  card-white: "oklch(1 0 0)"                 # 纯白卡面
  mist: "oklch(0.945 0.008 250)"             # 雾灰底（secondary/muted 同值）
  mist-ink: "oklch(0.52 0.035 262)"          # 雾灰墨
  canvas-border: "oklch(0.925 0.01 255)"     # 冷灰界线（border/input 同值）
  # 等级四色（红Ⅰ/橙Ⅱ/黄Ⅲ/蓝Ⅳ，只用于信号牌与告警）
  severity-i: "oklch(0.53 0.19 27)"          # 预警红（Ⅰ）
  severity-ii: "oklch(0.63 0.19 45)"         # 预警橙（Ⅱ）
  severity-iii: "oklch(0.78 0.15 90)"        # 预警黄（Ⅲ）
  severity-iv: "oklch(0.48 0.17 262)"        # 预警蓝（Ⅳ）
  severity-ink: "oklch(0.28 0.03 60)"        # 牌上墨（Ⅱ/Ⅲ 亮底配墨字）
  # 行灯与演练标识
  amber-standby: "oklch(0.75 0.15 70)"       # 待确认琥珀（行灯点；文字用 oklch(0.8 0.13 70) 同族）
  amber-drill: "oklch(0.8 0.13 50)"          # 演练徽标橙（壳上描边；边框用 oklch(0.75 0.14 50) 同族）
typography:
  title:
    fontFamily: "'Noto Serif SC', 'Songti SC', 'SimSun', serif"
    fontSize: "18px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
  caption:
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "11px"
    fontWeight: 400
  micro:
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: "17px"
    letterSpacing: "0.2em"
  mono-clock:
    fontFamily: "'IBM Plex Mono', ui-monospace, Consolas, monospace"
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "0.05em"
    fontFeature: "tnum"
rounded:
  sm: "0.225rem"   # 徽标 / chip / 壳层按钮（calc(var(--radius) * 0.6)）
  badge: "0.25rem" # 等级信号牌（sm 尺寸）
  md: "0.3rem"     # md 尺寸等级牌（calc(var(--radius) * 0.8)）
  lg: "0.375rem"   # 基准 --radius
  full: "9999px"   # 空态图标圆
spacing:
  rail: "220px"          # 导航栏展开宽
  rail-collapsed: "64px" # 导航栏折叠宽
  status-bar: "48px"     # 顶部演练状态条高
  page-header: "60px"    # 画布页面头最小高
  control: "36px"        # 画布按钮 / 导航项高
  control-sm: "28px"     # 壳层小按钮高
  gutter: "24px"         # 页面水平留白（px-6）
  group-gap: "20px"      # 导航分组间距
  inline-gap: "10px"     # 行内元素间距（gap-2.5）
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.indigo-foreground}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 16px"
  shell-button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.shell-foreground}"
    rounded: "{rounded.sm}"
    height: "28px"
    padding: "0 12px"
  shell-button-solid:
    backgroundColor: "{colors.indigo}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: "28px"
    padding: "0 12px"
  severity-plate-i:
    backgroundColor: "{colors.severity-i}"
    textColor: "#ffffff"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
  severity-plate-ii:
    backgroundColor: "{colors.severity-ii}"
    textColor: "{colors.severity-ink}"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
  severity-plate-iii:
    backgroundColor: "{colors.severity-iii}"
    textColor: "{colors.severity-ink}"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
  severity-plate-iv:
    backgroundColor: "{colors.severity-iv}"
    textColor: "#ffffff"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
  nav-item-active:
    backgroundColor: "{colors.indigo-veil}"
    textColor: "#ffffff"
    height: "36px"
    padding: "0 16px"
  phase-chip:
    backgroundColor: "oklch(0.545 0.185 264 / 30%)"
    textColor: "oklch(0.85 0.06 264)"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: 校园突发事件预警平台

## Overview

**Creative North Star: "信号牌指挥台"（The Signal-Plate Command Deck）**

演练即一次预警发布：等级是挂出来的牌，人工确认是盖下去的戳。整套界面是一间现代企业级应急指挥中心——专业、严谨、精致：左侧一根深藏青石墨的骨架立住指挥台的气场，冷灰白的画布保证课堂投影等亮环境下的可读性；仪表感不来自装饰，而来自等宽数字与一根粗细的规则线。

世界由三层恒定材质构成：壳层恒深（发布台藏青，带彩度、绝不退化为中性灰黑），画布恒浅（冷灰白），卡面纯白。深度靠明度阶梯与留白表达，不靠阴影。彩色被严格管制：靛青只做交互，预警红/橙/黄/蓝只出现在等级信号牌与告警处，且永远携带图标与文字。

确认的视觉反参照（不做什么）：真实警情系统的拟真外观、游戏化元素、中性灰黑通用 SaaS 侧栏、用颜色单独承载状态。

**Key Characteristics:**

- 深藏青石墨壳 + 冷灰白画布的双层恒定材质，明度分层替代阴影
- 等级四色严格限于信号牌与告警，图标 + 文字 + 色牌三件套同时出现
- 仪表感来自等宽数字（mono + tabular-nums），不来自装饰性图形
- 结构线一律 1px 一根粗细，分区靠留白不靠框线堆叠
- 按钮描边为主，实心只留给唯一主动作
- 「模拟演练」徽标常驻任何视口，绝不与真实警情混淆

## Colors

色板是一座发布台的物料账：深藏青的台身、冷灰白的台面、靛青的操作件、四块只准挂出的等级色牌。

### Primary — 交互靛青
- **靛青** `{colors.indigo}`：唯一交互主色。画布主按钮、壳层实心按钮、焦点环（`--ring` 同值）、壳层强调（`--shell-accent` 同值）、选区底色。一色三岗，但永远只表达「可操作」。
- **靛上银白** `{colors.indigo-foreground}`：靛青底上的文字。
- **亮靛** `{colors.indigo-bright}`：深壳上的活动导航图标与品牌图标，比靛青亮一档以在暗底上立住。
- **靛青晕** `{colors.indigo-veil}`：导航活动项的 16% 透明底，是壳层里唯一的「块状强调」。

### Neutral — 壳层（恒深）
- **发布台藏青** `{colors.shell}`：导航栏与状态条的底色。带明确彩度（hue 264），拒绝中性灰黑 SaaS 默认。
- **壳上银白** `{colors.shell-foreground}`：壳层主文字；次级文字用其 70% 透明变体。
- **壳上雾蓝** `{colors.shell-muted}`：壳层字段标签（「当前演练」「阶段」「真实」）与分组标题。
- **藏青界线** `{colors.shell-border}`：壳层内唯一分隔线色，也作状态条与画布的交界。

### Neutral — 画布（恒浅）
- **冷灰白** `{colors.canvas}`：画布底色，为亮环境投影校准。
- **石墨墨字** `{colors.ink}`：画布主文字。
- **纯白卡面** `{colors.card-white}`：页面头与卡片的底，比画布亮半档。
- **雾灰底** `{colors.mist}`：次级底色（空态图标圆、次级按钮 hover）；**雾灰墨** `{colors.mist-ink}` 为其上文字。
- **冷灰界线** `{colors.canvas-border}`：画布上的分隔线与输入描边基准（`--border` 与 `--input` 同值）。

### Status — 等级四色与行灯
- **预警红（Ⅰ）** `{colors.severity-i}` / **预警橙（Ⅱ）** `{colors.severity-ii}` / **预警黄（Ⅲ）** `{colors.severity-iii}` / **预警蓝（Ⅳ）** `{colors.severity-iv}`：只出现在等级信号牌与告警处。Ⅱ、Ⅲ 亮度高，牌上必须配**牌上墨** `{colors.severity-ink}` 墨字；Ⅰ、Ⅳ 深底配白字。
- **待确认琥珀** `{colors.amber-standby}`：行灯状态点（等待人工确认时状态条上的圆点），文字用同族更亮的 `oklch(0.8 0.13 70)`，永远伴随「等待人工确认」文字。
- **演练徽标橙** `{colors.amber-drill}`：「模拟演练」徽标在深壳上的描边与文字色（描边 `oklch(0.75 0.14 50)` 同族）；画布变体直接复用预警橙描边配深橙文字。

### Named Rules
**The 挂牌法则（The Signal-Plate Rule）.** 等级四色只出现在信号牌与告警处，且永远是「色牌 + 图标 + 文字」三件套同时出现。任何地方不得只用一块色表达等级，也不得把等级四色挪作装饰、图表或普通强调。

## Typography

**Heading Font:** 思源宋体（Noto Serif SC，自托管 @fontsource，回退 Songti SC / SimSun）——标题、品牌名、公告与等级信号牌的字体
**Body Font:** 思源黑体（Noto Sans SC，自托管 @fontsource，回退 PingFang SC / Microsoft YaHei）
**Label/Mono Font:** IBM Plex Mono（自托管 @fontsource，回退 ui-monospace / Consolas）——一切数字的载体

**Character:** 「公文发布」排印组合（2026-11-09 用户选定）：宋体标题 + 黑体界面继承中国公文的传统——标题与公告是正式的发布文书，操作界面是现代工作台；仪表感全部交给等宽数字与字距工程（10px 微标签配 0.2em–0.3em 宽字距）。三种字体全部经 @fontsource npm 包自托管（globals.css 顶部 @import），本地单机运行不依赖任何网络字体服务。

### Hierarchy
- **Title** (宋体 700, 18px, -0.025em)：画布页面标题（PageHeader）、空态标题；品牌标题为宋体 15px 加宽字距变体。
- **Body** (400, 14px)：画布按钮与正文。
- **Caption** (400/600, 13px)：辅助说明、导航项、状态条演练名（600）。
- **Label** (400, 11px)：状态条字段标签。
- **Micro** (500, 10px, 0.2em–0.3em, 行高 17px)：徽标、导航分组标题、单机标识——靠字距而非字号建立存在感。
- **Clock** (600, 18px，等宽 + tabular-nums)：模拟时钟；真实钟为 12px 弱化变体。
- **Plate**（宋体 700/800）：等级信号牌与「已确认」戳——全站实心彩色块上的文字一律宋体，公文即视感。

### Named Rules
**The 等宽仪表法则（The Mono-Gauge Rule）.** 一切会跳动的数字（时钟、计数、编号、时长）一律等宽栈 + `tabular-nums`。仪表感来自数字不跳宽，不来自装饰性图形。
**The 公文标题法则（The Gazette Heading Rule）.** 宋体只属于「发布物」——页面标题、品牌名、公告、信号牌、确认戳；操作件（按钮、菜单、徽标、输入）一律黑体。宋体出现在按钮上即违例。

## Layout

全局骨架是「一根骨架 + 一条状态线 + 一张台面」：左侧 220px 可折叠导航（`{spacing.rail}`，折叠为 `{spacing.rail-collapsed}` 图标栏），顶部 48px（`{spacing.status-bar}`）演练状态条，其余为弹性冷灰白画布（`min-w-0` 防溢出）。桌面优先，1440 基准。

- **导航折叠**：视口 < 1280px 默认折叠为图标栏，用户偏好记入 localStorage 后优先生效；折叠态分组标题退化为 1px 短线，条目以 title 提示。
- **状态条**：全局唯一演练态势行——运行态挂等级牌 + 模拟钟 + 暂停控制；空闲态只留「空闲 + 发起演练」。窄屏逐级让位（演练名截断 → 字段标签隐藏 → 真实钟让位），但「模拟演练」徽标与模拟钟永不隐藏。
- **画布页**：PageHeader（最小高 60px，px-6，底 1px 线）+ 内容区；内容自带头尾呼吸（空态 py-20）。
- **分区靠留白**：导航分组间距 20px（`{spacing.group-gap}`），无框线堆叠、无嵌套卡片。
- **断点**：sm 640（状态条次级信息显隐）/ md 768（「进入工作区」与运行态真实钟）/ lg 1024（状态条字段标签与分隔线）/ xl 1280（导航默认折叠阈值、演练名解除截断）。

### Named Rules
**The 双钟法则（The Two-Clocks Rule）.** 模拟时钟是全局唯一时钟源，只此一处跳动；真实钟与它并列且必须带「真实」来源标注。空间不够时真实钟让位，模拟钟与「模拟演练」徽标永不退场。

## Elevation & Depth

本系统没有 box-shadow。深度由三层明度阶梯表达：发布台藏青壳（L 0.23）→ 冷灰白画布（L 0.972）→ 纯白卡面（L 1.0），辅以 1px 规则线与留白分区。浏览器表面与设计同源：选区用靛青底（`::selection`），焦点环为 2px 靛青 outline（offset 1px），滚动条 10px、thumb 5px 圆角冷灰（hover 加深半档）。任何新表面不得引入阴影抬升——要分层，调明度。

## Shapes

形式语言是克制而秩序化的：一根粗细的线、描边为主的操作件、实心只属于信号牌。

- **一根线**：所有结构分隔线 1px 一根粗细（壳内藏青界线、画布冷灰界线），没有第二种线宽，没有双线。
- **圆角克制**：徽标/chip/壳层按钮 0.225rem（`{rounded.sm}`）、等级牌 0.25rem（`{rounded.badge}`）、md 纉牌 0.3rem（`{rounded.md}`）、空态图标圆 full（`{rounded.full}`）。基准 `--radius` 0.375rem，无更大圆角容器。
- **描边语言**：按钮以 1px 描边为主；实心底只留给唯一主动作（画布「发起演练」、壳层「进入工作区」）与等级信号牌——信号牌是全站唯一的大面积实心彩色块。

### Named Rules
**The 一根线法则（The One-Line Rule）.** 结构线永远 1px 一根粗细。要分区，先加留白；留白不够，加一根 1px 线；永远不要框线套框线。

## Components

### Buttons
- **Shape:** 小圆角直角感（0.225rem）；画布高 36px、壳层高 28px。
- **Primary（画布实心）**: 靛青底 + 靛上银白字，hover 提亮 10%（brightness-110）。
- **Secondary（画布描边）**: 透明底 + 冷灰界线描边 + 墨字，hover 雾灰底。
- **壳层描边**: 透明底 + 靛青描边 + 壳上银白 80% 字，hover 靛青晕底（暂停/恢复、折叠导航）。
- **壳层实心**: 靛青底白字，hover 提亮（「进入工作区」，状态条内唯一实心动作）。
- **Focus:** 全站统一 2px 靛青 outline（见 Elevation & Depth）。

### Chips
- **阶段 chip**: 靛青 30% 透明底 + 亮靛文字（`oklch(0.85 0.06 264)`），0.225rem 圆角，11px 中字重——状态条标注当前推演阶段（感知/研判/处置/通知/复盘）。

### Cards / Containers
- **PageHeader**: 纯白卡面底、最小高 60px、px-6 py-3、底 1px 冷灰界线；左「标题 + 一句职责」，右操作区（间距 10px）。画布内的容器性表面以此为基准：白卡面 + 1px 线，无阴影。

### Navigation（AppNavRail）
- 深藏青整根骨架（h-screen），品牌区（盾形图标 + 15px 加宽字距标题 + 徽标）→ 三组菜单（态势/推演/复盘，分组标题 10px/0.3em 壳上雾蓝）→ 底部（单机标识 + 折叠按钮）。
- **条目**: 高 36px、13px、图标 16px；活动项靛青晕底 + 白字 + 亮靛图标 + 600 字重；非活动壳上银白 70%，hover 靛青晕 60% 底回升全亮。
- **折叠态**: 64px 图标栏居中排布，宽度过渡 200ms。

### 信号牌（SeverityBadge，签名件）
- 等级信号牌：色牌 + ShieldAlert 图标 + 文字（Ⅰ 重大 / Ⅱ 较大 / Ⅲ 一般 / Ⅳ 轻微），加宽字距。
- 两档：sm（12px/600，状态条内）与 md（16px/800，更大尺寸 14px 图标、14px 水平内距）。
- Ⅱ、Ⅲ 亮底配牌上墨字，Ⅰ、Ⅳ 深底配白字。
- **挂牌动效**: 挂上时 `plate-in` 升起落定（0.3s, cubic-bezier(0.16, 1, 0.3, 1)）；等级变化换牌重放；`prefers-reduced-motion` 下关闭。

### 演练徽标（DrillTag，签名件）
- 「模拟演练」描边徽标：10px/500/0.2em 字距、行高 17px、0.225rem 圆角。壳上用亮橙描边+橙字，画布上用预警橙描边+深橙字。所有演练相关界面必须携带；状态条上任何视口不隐藏。

### 双钟（SimClock / RealClock，签名件）
- **SimClock**: 等宽 + tabular-nums，md 档 18px/600（状态条主仪表），sm 档 14px；跳动由数据侧驱动。
- **RealClock**: 12px 等宽弱化变体，前置「真实」来源标注，与模拟钟并列。

### 状态条（DrillStatusBar，签名组合）
- 运行态：演练名（13px/600）→ 等级牌 → 分隔线 → 阶段 chip → 模拟钟 → 暂停/恢复（或待确认琥珀行灯）→「进入工作区」；右侧常驻演练徽标 + 真实钟。分隔线为 1px × 16px 藏青界线竖段。
- 空闲态：「演练状态 空闲」+「发起演练」描边按钮。
- 数据通道：页面经 ShellDrillContext 注入运行态摘要，layout 默认空闲。

### 空态（EmptyState）
- 56px 雾灰圆底图标 + 16px/700 标题 + 13px 雾灰墨描述（max-w-md、居中PRETTY）+ 24px 间距后的行动区；整体 py-20 居中呼吸。

### 确认戳（ConfirmStamp）
- 已建成、尚未接入：1px 靛青描边小方戳（10px、Check 图标、「已确认」）， THESIS「确认是盖下去的戳」的载体，待事件详情工作区时间线 ⚑ 节点接入。见文末债务注记。

### Named Rules
**The 常驻标识法则（The Standing-Badge Rule）.** 「模拟演练」徽标常驻所有演练相关界面与状态条，任何视口、任何宽度都不隐藏。与真实警情混淆的代价大于一切布局妥协——空间不够时先让真实钟让位。

## Do's and Don'ts

### Do:
- **Do** 挂等级色时永远「色牌 + 图标 + 文字」三件套（挂牌法则）。
- **Do** 一切跳动数字用等宽栈 + `tabular-nums`（等宽仪表法则）。
- **Do** 模拟钟为全局唯一时钟源；真实钟并列并标注「真实」来源（双钟法则）。
- **Do** 「模拟演练」徽标常驻所有演练相关界面，任何视口不隐藏。
- **Do** 分区先加留白（分组 20px、页面留白 24px），线只用 1px 一根粗细（一根线法则）。
- **Do** 壳层保持藏青彩度（hue 264），深而不灰。
- **Do** 行灯状态点永远伴随文字（琥珀点 + 「等待人工确认」）。

### Don't:
- **Don't** 用颜色单独承载状态——色永远搭配文字与图标。
- **Don't** 引入真实警情系统的拟真外观或任何游戏化元素。
- **Don't** 使用 box-shadow 抬升表面——分层调明度（壳 0.23 / 画布 0.972 / 卡面 1.0）。
- **Don't** 框线套框线、卡片套卡片。
- **Don't** 把等级四色挪作装饰、图表或普通强调色。
- **Don't** 把壳做成中性灰黑通用 SaaS 侧栏。
- **Don't** 深化画布或给壳层做浅色变体——壳恒深、画布恒浅是本世界的材质法则。

---

**已知债务（是债务，不是规则）**：确认戳（ConfirmStamp）已建成未接入呈现；「朱砂焦点红圈」（全站唯一红色焦点、载体为工作区当前事件标题）尚未落地，当前全站焦点环统一为 2px 靛青——两者待事件详情工作区轮兑现后更新本文件。`globals.css` 中 `.dark` 块为 shadcn 脚手架残留，页面未挂 `.dark`，非本世界规范。
