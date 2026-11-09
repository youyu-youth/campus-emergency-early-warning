# 06: 推演控制与恢复（暂停/恢复/调速/终止/重启恢复）

**What to build:** 操作员可对运行中的演练执行暂停、恢复、调速与终止（终止需二次确认），CLI 提供对应交互；运行器保证同一时间至多一场运行中演练；进程意外重启后，原 running 演练恢复为 paused 态，由操作员手动恢复，模拟时钟从落库状态续算，不丢失进度。规格见 `../spec.md`、docs/adr/0001。

**Blocked by:** 01（运行器骨架）

**Status:** ready-for-agent

- [x] 暂停/恢复：演练状态与模拟时钟正确流转（running ↔ paused），时间线不丢节点
- [x] 调速：运行中变速即时生效，已累计模拟时间不受影响（复用时钟纯函数）
- [x] 终止：二次确认后演练进入 aborted 终态，落库完整保留
- [x] 发起第二场演练时，若已有 running 演练则拒绝并提示
- [x] 重启恢复：进程重启后原 running 演练恢复为 paused，操作员手动恢复后时钟从落库状态续算
- [x] 缝 1 测试：暂停/恢复/调速/终止的状态机断言与重启恢复断言（时钟注入真实时刻，测试保持确定性）

## Comments

- 2026-11-09 完成。实现:运行器四个控制方法 `pause/resume/setSpeed/abort`(状态机校验+时钟纯函数流转;abort 复用三态来源 running/paused/awaiting_confirmation,写 ended_at、operator_action 留痕、不评分)与 `recoverInterruptedDrills()`(进程启动时调用:running→paused,时钟冻结点取时间线最大 real_time=最后落库动作时刻,不丢已推进模拟时间、停机真实时间不计入;恢复场绑定到实例可继续操控;幂等)。CLI:启动横幅提示命令;推演全程可用 p 暂停/继续、数字设定倍速、x 终止(二次确认,其他输入取消);LineReader 增加 onLine/onClose(命令与确认提示互斥,EOF 唤醒挂起等待);主循环重构为 running/awaiting_confirmation/paused/终态四态分派,重启恢复在 start 之前(有中断场则接续跳过新建);aborted 演练跳过通知重试提示。新增缝 1×4(暂停恢复/调速/终止含终态后新场可发起/重启恢复含幂等与续跑完成),全量 13 文件 101 绿;CLI 四路冒烟:暂停恢复调速(x→取消)、二次 x 终止(aborted+留痕+无报告)、杀进程后第二进程自动恢复 paused→p 续跑→completed 出报告。「发起第二场拒绝」为 01 既有 getActiveDrills 逻辑,本工单补终态后可发起新场断言。
- 2026-11-09 code-review 两轴审查后的修复:① **确认等待中崩溃的死锁**(两轴共同发现:recover 只认 running,而 awaiting_confirmation 被 start 的 active 检查拒绝→既不能恢复也不能新开)——recover 扩展接续确认等待中的演练(保持原状绑定实例,时钟已停无需转态);② 内联 SQL 下沉 queries.ts(getRunningDrill/getAwaitingConfirmationDrillId/getLastTimelineActivityMs);③ abort 收敛两次 readRunState、sim_time 改用冻结后时钟;④ recover 手写 JSON.parse 改用 readRunState;⑤ CLI 死分支清理、通知确认提示补空行校验(其他输入不再被吞成确认)。新增确认点崩溃接续测试,全量 13 文件 102 绿。冒烟勘误:早期复现的 UNIQUE seq 冲突系 Git Bash timeout -s KILL 杀不掉 Windows 进程树、两活进程并发推演同一库所致(复现方法缺陷,非代码缺陷);用 PowerShell Stop-Process 真杀后双进程重启恢复链路完整通过(P1 死于 running→P2 恢复 paused→p 续跑→completed 出报告)。
