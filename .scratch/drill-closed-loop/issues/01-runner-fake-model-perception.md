# 01: 推演运行器骨架 + 假模型 + 感知智能体（信号 → 事件上报）

**What to build:** 操作员用一条命令（场景键 + 随机种子，如 `pnpm drill:run --scenario fire_alarm --seed 42`）发起演练：进程内推演运行器创建演练并驱动模拟时钟，到期信号按种子确定性产出并逐条打印在时间线上；感知智能体解读首个信号（位置/类型/时间/证据）上报为事件，后续信号作为补充证据关联同一事件。含可编排剧本的假模型适配器与感知自身的降级路径。规格见 `../spec.md`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] CLI 可发起两类场景（fire_alarm / medical_emergency）的演练，实时打印时间线，模拟时间与真实时间并列标注
- [x] 到期信号按场景脚本 + 种子确定性写入 signals（可复现）
- [x] 首个信号经感知智能体解读后创建事件（status=reported），时间线 signal 节点的 detail 含原始输入 / 决策依据 / 结构化输出三段
- [x] 同场景后续信号作为补充证据节点关联同一事件，不新开事件（单事件焦点）
- [x] 感知智能体坏输出 → 重试一次 → 仍失败按规则默认结果上报并记 anomaly 节点（缝 2 测试）
- [x] 假模型按「智能体 + 调用序」返回预设剧本，支持注入坏 JSON 与超时
- [x] 推演每步落库，图状态快照写入 graph_runs；数据库是唯一事实来源
- [x] 缝 1 端到端测试：发起 → 信号产出 → 事件上报全链路断言（vitest，无网络、固定种子）

## Comments

- 2026-11-08 完成。实现:`src/agents/`(model/perception/prompts)、`src/graph/perception.ts`、`src/runner/drill-runner.ts`、`src/db/queries.ts`、`scripts/drill-run.ts`。CLI 默认接 DeepSeek(用户提供的密钥存 `.env.local`),`--model fake` 走演示剧本离线跑。感知段完成后演练自动转 paused,等待 02 接入指挥调度。缝 1×7 + 缝 2×4 共 11 个新测试,全量 37 绿。
