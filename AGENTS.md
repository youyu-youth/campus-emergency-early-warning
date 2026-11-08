# AGENTS.md — 校园突发事件预警平台

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->



<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->



## 编码规范和使用习惯

- 技术文档查询时，使用 context7 mcp 来查询 文档



## 1. 项目定位与核心闭环

- 本项目面向校园突发事件的**模拟预警与多智能体协同应急推演**，用于教学、演练与决策辅助。
- 模拟事件包括消防警报、学生突发疾病等，所有事件、设备数据及处置动作默认均为演练数据。
- **核心闭环**：事件模拟 → 异常信号感知与上报 → 事件等级研判与任务分配 → 多角色协同处置 → 通知生成与模拟分发 → 处置时间线与复盘改进。
- 监测感知智能体接收模拟传感器或摄像头异常信号并上报事件。
- 指挥调度智能体判断事件等级，向保安、医务、后勤分配和调整任务。
- 处置执行智能体分别模拟保安、医务、后勤的响应动作及执行反馈。
- 通知发布智能体生成面向师生和家长的通知，并在演练环境中模拟分发。
- 复盘评估智能体在事件结束后生成处置时间线、问题分析和改进建议。

## 2. 固定技术栈

- 前后端：Next.js（App Router）+ TypeScript，统一使用 TypeScript。
- UI：Tailwind CSS + shadcn/ui；优先复用既有组件。
- AI：LangGraph.js 负责图编排；LangChain.js 负责模型调用、工具和结构化输出。
- 持久化：SQLite，保存演练、事件、任务、执行日志、报告及必要的图执行状态。
- 遵循项目已有包管理器、脚本、版本和配置，不擅自迁移技术栈。

## 3. 模块架构与职责边界

- `src/app/`：页面、布局与 Route Handlers；API 负责校验、授权、调用业务层和返回响应。
- `src/components/`：通用与业务 UI；禁止在组件中实现核心应急规则。
- `src/agents/`：各独立业务 Agent 的提示词、工具、输入输出协议和测试。
- `src/graph/`：LangGraph 状态、节点、边、路由、并行、暂停及恢复。
- `src/simulation/`：模拟信号、场景演变、演练时钟、资源与动作规则。
- `src/styles/`：存放跨页面复用的公共样式，不必将所有样式都拆成 CSS 文件。
- `src/db/`：SQLite Schema、迁移及数据访问；`src/lib/`：共享基础能力。
- 依赖方向：页面/API → 业务服务/Graph → Agent/仿真引擎 → 数据访问；禁止随意跨层耦合。

## 4. Multi-Agent 协作规范

- 每类 Agent 职责单一、接口独立，明确输入、输出、工具权限和失败处理方式。
- LangGraph 是唯一的 Agent 编排入口，负责共享状态、条件路由、任务交接与并行执行。
- 监测感知 Agent：接收模拟异常信号，提取位置、类型、时间和证据，提交事件上报。
- 指挥调度 Agent：研判事件等级，制定任务，指派保安、医务、后勤并根据反馈重新调度。
- 处置执行 Agents：按保安、医务、后勤角色执行模拟任务，返回耗时、资源消耗和处置结果。
- 通知发布 Agent：按事件状态生成师生及家长通知，记录模拟分发对象、内容和状态。
- 复盘评估 Agent：仅基于留存的事件与动作日志生成时间线、指标、问题及改进建议。
- Agent 之间经 Graph 状态与受控工具协作，不直接修改其他 Agent 内部状态。
- Agent 输出必须结构化并经运行时校验；超时、失败及无效输出必须可恢复或降级。

## 5. 仿真与事件状态规范

- LLM 负责分析、解释和提出建议；事件演变、响应时长、资源变化和评分由规则计算。
- 模拟传感器/摄像头信号应有明确来源与数据结构，不得伪装成真实设备数据。
- 同一场景配置与随机种子应尽量得到可复现的推演结果。
- 区分模拟时间 `simulationTime` 与真实系统时间，日志应注明时间来源。
- 事件与任务使用明确状态机；所有状态变化都必须经过规则校验。
- 每个步骤记录原始输入、Agent 决策、任务分配、执行反馈、通知和状态变化。
- 长流程分步执行并持久化进度，避免依赖单个长时间运行的 HTTP 请求。
- 前端可使用轮询或 SSE 展示进展，第一版不增加独立消息基础设施。

## 6. 数据与 API 规范

- SQLite 仅允许服务端访问，数据库文件和敏感配置不得提交到 Git。
- 数据库结构变更提供迁移方案，避免破坏历史演练记录。
- 演练、事件、任务、通知和报告使用稳定 ID，保持关联与时间字段完整。
- 使用环境变量保存密钥，禁止将凭据写入源码、日志或前端。
- 外部可访问的接口必须实施服务端鉴权及必要的访问控制。

## 7. UI / UX 规范

- 优先设计清晰、专业的校园应急指挥界面，突出事件等级、任务状态与执行进度。
- 核心页面：总览仪表盘、事件模拟、应急指挥、演练记录、复盘报告。
- 所有模拟事件及通知必须显著标识「模拟演练」，避免与真实警情混淆。
- 状态不能只用颜色表达，需搭配文字、图标和可理解的反馈。
- 关键操作具备加载、成功、失败、空状态；暂停、恢复、重置需有明确交互。
- 以桌面端为主，兼顾基础响应式和可访问性，不重复引入大型 UI 体系。

## 8. 代码质量与测试

- 使用严格 TypeScript 类型、明确接口和小模块，避免 `any` 与重复业务逻辑。
- 提示词、业务规则、模型配置和 UI 文案分离；复杂确定性逻辑优先写纯函数。
- 新增功能同步维护类型、必要的测试、迁移及文档。
- 至少测试：异常信号上报、事件分级、任务分配、处置反馈、Graph 路由及输出解析。
- 使用固定场景与模拟模型响应测试 Agent；无需真实模型也应能验证核心流程。
- 完成前执行已有 lint、typecheck、test、build；未能执行时如实说明。

## 9. AI 编码 Agent 执行规范

- 先复用现有能力，再新增文件或依赖；未经要求不得进行大规模重构。
- 优先完成端到端事件演练闭环，不优先增加炫技功能或复杂基础设施。
- 不伪造传感器数据来源、模型调用结果、应急结果或测试通过记录。
- 真实通知、真实设备控制与实际应急指挥不属于默认范围，必须经过独立安全设计与人工审批。

