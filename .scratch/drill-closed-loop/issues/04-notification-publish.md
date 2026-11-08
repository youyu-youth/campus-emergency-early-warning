# 04: 通知发布确认与模拟送达

**What to build:** 处置阶段中，通知发布智能体为事件生成面向师生与家长两个受众的通知草稿（内容带显著「模拟演练」标识），经第三个确认点后发布（模拟），送达统计由规则 + 种子计算写入 delivery；分发失败仅标记通知自身为失败，不影响主线推演。规格见 `../spec.md`。

**Blocked by:** 03（任务派发与并行处置）

**Status:** ready-for-agent

- [x] 每个事件生成 staff_students 与 parents 两个受众的通知草稿，内容含「模拟演练」标识文案
- [x] 通知确认点暂停推演，CLI 展示通知全文，确认后状态 draft → pending_confirmation → published_sim
- [x] 送达统计（人数、送达、失败）由规则按种子确定性计算，写入 delivery 字段
- [x] notification 时间线节点 ⚑ 标记，记录发布时刻与统计
- [x] 模拟分发失败 → 通知置 failed（可重试），主线推演与处置不受影响
- [x] `--auto` 模式下通知自动确认发布
- [x] 通知智能体坏输出/超时降级：规则默认文案 + anomaly 节点（缝 2 测试）
- [x] 缝 1 测试：草稿生成、确认发布、送达统计、失败不影响主线的断言

## Comments

- 2026-11-08 完成。实现:`src/agents/notification.ts`(双受众草稿,zod 强制标题与正文含「模拟演练」——漏标即坏输出走降级)、`src/simulation/delivery-rules.ts`(通道成败 15% + 人数/送达/失败统计,种子^受众^尝试独立随机流,最多发布 2 次)、`src/graph/notification.ts`(草稿图:两受众串行生成、落库 draft→pending_confirmation、⚑ 节点含全文)、运行器 stepNotification/confirmNotification/retryNotification。通知为独立第五阶段(处置段末直接流入);⚑ 节点按 GLOSSARY 例外追加确认耗时与逐次发布结果(publishes 数组)。失败重试:auto 自动一次;人工模式段末由 CLI 询问(retryNotification 不改变演练状态,可在 paused 下调用)。缝 1×3 + 缝 2×5 + 规则×5 共 13 个新测试,全量 82 绿;CLI 三路冒烟(auto/四确认点人工/失败+重试)通过。seed 7 家长通道天然首败→重试成功,seed 42 双受众干净发布(演示用)。
- 2026-11-08 code-review 两轴审查后的修复与裁定:① 受众标签收敛复用 delivery-rules#AUDIENCE_LABELS(CLI/prompts 4 处重复);② 发布记录建 PublishRecord 强类型,auto 重试与操作员重试的同形块抽为 republishNotification;③ failed 通知不再写 published_sim_time;④ **补中断恢复路径**(规格轴关键发现:草稿落库与快照写入之间崩溃会永卡 running)——通知图幂等(既有受众复用行内容不重复调模型),运行器从 ⚑ 节点重建快照(尝试计数从 publishes 重建),新增恢复测试;⑤ GLOSSARY 补记:⚑ 例外涵盖通知节点发布/重试结果,「通知」词条注明 auto 模式例外。裁定不改:⚑ 三段中「决策依据」由 drafts[].source 承担(通知输出无理由字段);dispatch 段同类崩溃窗口(图完成与快照写入之间)为 03 既有,与段末暂停重复节点一并留给 06 恢复语义工单。
