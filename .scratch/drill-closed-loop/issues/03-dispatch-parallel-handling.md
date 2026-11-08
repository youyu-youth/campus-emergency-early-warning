# 03: 任务方案确认、三角色并行处置与重新调度

**What to build:** 定级确认后，调度智能体产出任务方案（保安/医务/后勤的角色、标题、说明），经确认点（可就地增删改派）后派发；三类任务并行执行，耗时、资源消耗、成败由规则 + 种子计算，执行叙述由模型生成；任务反馈写入时间线，事件推进到已控制。场景演变里程碑写入时间线，并可触发调度智能体的重新调度评估，经同一确认缝加派或调整任务。规格见 `../spec.md`。

**Blocked by:** 02（定级确认点）

**Status:** ready-for-agent

- [x] 任务方案在确认点展示并可调整（改角色、改内容、增删任务）后执行
- [x] 确认后任务逐条落库并进入执行，三角色在图中并行推进、各自汇合反馈
- [x] 每个任务的耗时、资源消耗、结果（done/failed）由规则 + 种子确定性计算；失败任务可重试
- [x] feedback 时间线节点记录执行叙述、耗时与资源；事件状态推进到 handling → controlled
- [x] 演变里程碑到期写入 status_change 节点（规则驱动，非模型生成）
- [x] 里程碑触发重新调度评估：需要时经确认缝加派/调整任务；不需要时记录评估结论
- [x] 处置智能体坏输出/超时降级：规则默认反馈 + anomaly 节点，不阻塞其他角色（缝 2 测试）
- [x] 缝 1 测试：确认、调整改派、并行汇合、失败重试、重新调度路径的断言

## Comments

- 2026-11-08 完成。实现:`src/agents/command.ts` 扩展任务方案(runDispatch)与重新调度评估(runDispatchEvaluation)、`src/agents/handling.ts`(三角色处置叙述,剧本键按角色分键保证并行调用确定性)、`src/simulation/task-rules.ts`(耗时/资源/成败纯函数,独立随机流,默认三角色方案)、`src/graph/dispatch.ts`(方案+评估图)、`src/graph/handling.ts`(LangGraph Send 动态扇出/汇合)、运行器 stepHandling/planDispatch/confirmDispatch。失败自动重试一次(seed 42 logistics 天然走出失败→重试成功;seed 27 双败终态 failed,事件仍 controlled)。里程碑仅事件 handling 时触发评估;处置段末(全任务终态+controlled+里程碑写全)自动暂停等 04。CLI 决策坞支持任务编辑(-n 删/r n 改派/t n 标题/d n 说明),输入改用行缓冲读取器解决多提示下管道丢行。缝 1×6 + 缝 2×9 + task-rules×5 共 20 个新测试,全量 68 绿;CLI auto/人工/编辑器三路冒烟通过。
- 已知取舍:评估结论与加派建议共用 dispatch 节点类型(以 title 区分);超期里程碑在处置段首个 tick 补写并触发一次评估(sim_time 记实际发生时刻)。
- 2026-11-08 code-review 两轴审查后的修复与裁定:① queries 状态参数改强类型(EventStatus/TaskStatus);② 角色显示词汇收敛为 state-machines.ts#ROLE_LABELS(原三处重复);③ 「进入确认缝」四步序列抽为 enterAwaitingConfirmation,空执行簿抽为 emptyHandlingState;④ 删除无消费者字段(DispatchSnapshot.milestoneOffsetMs、RedispatchGraphState.proposed),executeDispatchTasks 更名 insertScheduledTasks;⑤ 新增缝 1 并行并发测试(三角色各挂 120ms,批耗时 <300ms 断言 Send 扇出真并发)。**留给 06**:段末暂停条件在恢复(resume)后会重复触发「处置阶段完成」节点,恢复语义工单需在快照中记录段末已写标记。
