# 05: 复盘报告、规则评分、演练终态与全链路降级回归

**What to build:** 演练完整收束：事件关闭、演练转入 completed；复盘评估智能体仅基于留存的时间线与动作日志生成报告（时间线归纳、指标、问题分析、改进建议），落库到新增的 reports 表；总评分由规则加权计算（总时长、发现→上报、定级耗时、任务完成率、资源消耗）写入 drills.score；CLI 在结束时打印复盘摘要与评分。收尾补齐全链路降级编排回归：任一智能体坏输出/超时降级时，其余智能体与主线不受阻。规格见 `../spec.md`。

**Blocked by:** 04（通知发布）

**Status:** ready-for-agent

- [x] 追加式迁移 0002_reports 建 reports 表，不破坏既有数据
- [x] 事件 controlled → closed，演练进入 completed 终态（含全部时间线节点齐备）
- [x] 复盘报告只基于留存日志生成，落 reports 表，时间线归纳可对应到具体节点
- [x] 评分由规则 + 种子计算写入 drills.score；模型不参与算分
- [x] CLI 结束时打印复盘摘要（指标条数据 + 问题 + 建议）与总评分
- [x] 复盘智能体坏输出/超时降级：规则默认报告骨架 + anomaly 节点（缝 2 测试）
- [x] 全链路降级回归（缝 1）：分别注入调度/处置/通知/复盘失败剧本，断言其余环节照常推进、演练仍达终态
- [x] 固定种子全链路测试断言两次运行结果一致（可复现性）

## Comments

- 2026-11-08 完成。实现:`src/db/migrations.ts`(追加 0002_reports,含 timeline_summary/metrics/problems/improvements/source)、`src/simulation/score-rules.ts`(五指标加权纯函数:总时长 25%/发现→上报 15%/定级 20%/完成率 25%/资源 15%,基准=达标 100 分、两倍基准 0 分线性截断)、`src/agents/review.ts` + `reviewPrompt`(输入=留存日志只读汇总+规则指标,zod 协议;降级=规则骨架:归纳直引主轴节点、问题由失败任务/失败通知/降级次数确定性推导)、`src/graph/review.ts`(幂等:既有报告复用;落库前净化无效 nodeSeq 引用,保证可溯源)、运行器 `stepReview`/`collectReviewInput`(事件 controlled→closed 补 resolved_sim_time→复盘图→finishDrill 写 score/ended_at→completed,时钟停走;指标口径:发现=首信号检测、上报=首 signal 节点、定级=grading 节点、关闭=收尾时刻)、CLI `printReviewSummary`(总评分+指标条+问题+建议)。通知段末不再暂停,直接流入复盘;处置段段末守卫放宽接受 closed(收尾中断恢复路径)。demo 剧本补 review 响应(两场景各自问题与建议)。新增测试:评分规则×5(手算样例)、缝2×4(复盘智能体)、缝1×5(全链路收尾/复盘降级/全链路降级回归/双种子可复现/收尾中断恢复两窗口),既有终态断言 paused→completed、controlled→closed 同步更新;全量 13 文件 97 绿;CLI 冒烟:两场景 auto + 人工三确认点管道模式均达 completed 并打印复盘摘要。
- 2026-11-08 code-review 两轴审查后的修复:① **「发现→上报」恒 0 指标缺陷**(规格轴关键发现:事件 detected_sim_time 与首 signal 节点 sim_time 同源恒等)——感知图 State 增加 offsetMs,signal/anomaly 节点 sim_time 改记感知完成时刻(动作发生时刻),信号检测时刻保留在 signals.sim_time 与 detail.input;② 复盘报告节点弃用 node_type "notification"(与通知⚑节点语义冲突且恢复路径 find 有碰撞风险),改用 status_change 并补 detail 三段式(input=指标/reasoning=溯源说明/output=reportId 与计数);③ 测试去除对 ScriptedModel 私有字段的直接改写,fullAutoModel 增加剧本覆盖参数;④ 删除无消费者的 ReviewGraphResult.created;⑤ CLI printReviewSummary 复用 DrillMetrics 类型。修复后指标真实化(fire_alarm seed42 冒烟:发现→上报 125s、定级 121s,总分 67→47),全量 97 绿 + typecheck/lint/build 通过。
