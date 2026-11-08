# 02: 指挥调度智能体与定级确认点

**What to build:** 推演推进到研判阶段：指挥调度智能体基于事件证据提出建议等级与理由，推演自动暂停（演练进入 awaiting_confirmation，模拟时钟同步停走），CLI 交互式展示建议与理由，操作员确认或调整等级后推演继续；时间线记录 ⚑ 定级节点与确认耗时。提供 `--auto` 全自动模式跳过确认（对应场景配置的确认开关）。规格见 `../spec.md`。

**Blocked by:** 01（运行器骨架 + 感知上报）

**Status:** ready-for-agent

- [x] 事件上报后，调度智能体输出结构化的建议等级（Ⅰ–Ⅳ）与理由，经 zod 校验
- [x] 进入定级节点时演练状态转为 awaiting_confirmation 且模拟时钟停走；确认后恢复 running
- [x] CLI 展示建议等级、理由，支持确认或输入调整等级两种操作
- [x] 时间线 grading 节点 requires_confirmation=1，detail 记录确认耗时与操作员动作（operator_action 节点）
- [x] `--auto` 模式自动采纳建议，不暂停
- [x] 调度智能体坏输出/超时 → 重试一次 → 规则默认定级 + anomaly 节点，推演不中断（缝 2 测试）
- [x] 缝 1 测试：人工确认路径与 auto 路径均断言事件定级结果、⚑ 节点与状态机流转

## Comments

- 2026-11-08 完成。实现:`src/agents/command.ts`(定级 + 强度映射默认规则)、`src/graph/grading.ts`(⚑ 节点写入)、`src/runner/drill-runner.ts`(stepGrading/confirmGrading,时钟停走与恢复)、CLI `--auto` 与决策坞交互。感知与调度的「重试→超时→降级」调用环抽为 `model.ts#invokeAgent` 共用。auto 模式下 grading 节点 requires_confirmation=0(语义上无需人工确认),确认开关落库于 drills.params.autoConfirm。研判完成后演练自动暂停等待 03 处置执行。缝 1×5 + 缝 2×5 共 10 个新测试,全量 47 绿;CLI 三条路径(auto/回车确认/输入调整)冒烟通过。
- 2026-11-08 code-review 两轴审查后的裁定:① ⚑ 节点确认后在 detail 追加确认结果是规格决策 9 的明确要求,与 GLOSSARY「时间线节点不可变」冲突,已在 GLOSSARY 补记该例外;② 确认暂停由运行器经演练状态机管理而非 LangGraph interrupt(单节点图下可观察行为等价,后续任务方案/通知两个确认点沿用同一缝);③ 确认耗时从模型返回后起算,不含模型调用耗时。
