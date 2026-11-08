// 演练推演 CLI(运行器之上的薄打印层,不含业务规则)
// 用法:pnpm drill:run --scenario fire_alarm --seed 42 [--speed 60] [--model deepseek|fake]
//       [--location 地点] [--intensity low|medium|high] [--auto]

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ScriptedModel, wrapLangChain } from "../src/agents/model";
import { getDb } from "../src/db/client";
import {
  getGraphRunByDrillId,
  getReportByDrillId,
  listNotificationsByDrill,
  listSignalsByDrill,
  listTasksByDrill,
  listTimelineByDrill,
  getDrill,
  getEventByDrillId,
} from "../src/db/queries";
import { formatSimClock } from "../src/simulation/clock";
import type { DrillMetrics } from "../src/simulation/score-rules";
import { SCENARIOS } from "../src/simulation/scenarios";
import { DrillRunner } from "../src/runner/drill-runner";
import { AUDIENCE_LABELS, type DeliveryStats } from "../src/simulation/delivery-rules";
import type { TaskPlanItem } from "../src/simulation/task-rules";
import {
  ROLE_LABELS,
  SEVERITY_LABELS,
  type DrillStatus,
  type EventSeverity,
} from "../src/simulation/state-machines";
import type { TimelineNodeRow } from "../src/db/types";
import { DEMO_SCRIPTS } from "./demo-scripts";

// —— 参数解析 ——

interface CliArgs {
  scenario: string;
  seed: number;
  speed: number;
  model: "deepseek" | "fake";
  /** 全自动模式:跳过关键节点人工确认 */
  auto: boolean;
  location?: string;
  intensity?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const scenario = get("scenario");
  const seed = get("seed");
  if (!scenario || !(scenario in SCENARIOS)) {
    console.error(`用法:pnpm drill:run --scenario <${Object.keys(SCENARIOS).join("|")}> --seed <数字> [选项]`);
    process.exit(1);
  }
  if (!seed || !/^\d+$/.test(seed)) {
    console.error("--seed 必须是非负整数(同一种子得到一致推演结果)");
    process.exit(1);
  }
  const intensity = get("intensity");
  if (intensity && !["low", "medium", "high"].includes(intensity)) {
    console.error("--intensity 只能是 low | medium | high");
    process.exit(1);
  }
  const model = get("model") ?? "deepseek";
  if (model !== "deepseek" && model !== "fake") {
    console.error("--model 只能是 deepseek | fake");
    process.exit(1);
  }
  const speed = Number(get("speed") ?? 60);
  if (!Number.isFinite(speed) || speed <= 0) {
    console.error("--speed 必须是正数");
    process.exit(1);
  }
  return {
    scenario,
    seed: Number(seed),
    speed,
    model,
    auto: process.argv.includes("--auto"),
    location: get("location"),
    intensity,
  };
}

/** CLI 为独立进程,需手动加载 .env.local(不入 Git) */
function loadEnvLocal(): void {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}

// —— 打印 ——

const NODE_ICONS: Record<string, string> = {
  signal: "📡",
  grading: "⚑",
  dispatch: "📋",
  feedback: "✅",
  notification: "📢",
  anomaly: "⚠️ ",
  status_change: "⏸️ ",
  operator_action: "👤",
};

function printNode(node: TimelineNodeRow, simOriginMs: number): void {
  const sim = formatSimClock(Date.parse(node.sim_time) - simOriginMs);
  const real = new Date(node.real_time).toLocaleTimeString("zh-CN", { hour12: false });
  const icon = NODE_ICONS[node.node_type] ?? "•";
  console.log(`[模拟 ${sim} | 真实 ${real}] ${icon} ${node.title}`);
}

// —— 主流程 ——

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnvLocal();
  const scenarioKey = args.scenario as keyof typeof SCENARIOS;
  const scenario = SCENARIOS[scenarioKey];

  const model =
    args.model === "fake"
      ? new ScriptedModel(DEMO_SCRIPTS[scenarioKey])
      : wrapLangChain(createDeepSeek());

  console.log("⚠ 校园突发事件预警平台 · 模拟演练推演(所有事件与通知均为演练数据,非真实警情)");
  console.log(
    `▶ 发起演练:${scenario.name} · 种子 ${args.seed} · 倍速 ${args.speed}x · 模型 ${args.model === "fake" ? "假模型(演示剧本)" : "DeepSeek"} · ${args.auto ? "全自动模式(跳过确认)" : "人工确认模式"}`,
  );

  const db = getDb();
  let simOriginMs = 0;
  const runner = new DrillRunner({
    db,
    model,
    now: () => Date.now(),
    onTimelineNode: (node) => printNode(node, simOriginMs),
  });

  const { drillId } = await runner.start({
    scenarioKey,
    seed: args.seed,
    speed: args.speed,
    autoConfirm: args.auto,
    params: {
      ...(args.location ? { location: args.location } : {}),
      ...(args.intensity ? { intensity: args.intensity } : {}),
    },
  });
  simOriginMs = JSON.parse(getDrill(db, drillId)!.clock_state).simOrigin as number;

  // tick 循环:关键节点暂停等待操作员确认(定级/任务方案/加派/通知),确认后继续;复盘收尾达终态后 CLI 打印摘要
  const reader = new LineReader();
  try {
    let point = await runUntilDecisionPoint(runner);
    while (point === "awaiting_confirmation") {
      const pending = readPendingConfirmation(db, drillId);
      if (pending === "grading") {
        await runner.confirmGrading(await promptGradingConfirmation(reader, db, drillId));
      } else if (pending === "dispatch") {
        await runner.confirmDispatch(await promptDispatchConfirmation(reader, db, drillId));
      } else {
        await promptNotificationConfirmation(reader, db, drillId);
        await runner.confirmNotification();
      }
      point = await runUntilDecisionPoint(runner);
    }
    await promptNotificationRetryIfNeeded(reader, runner, db, drillId);
  } finally {
    reader.close();
  }
  printSummary(db, drillId);
}

/**
 * 行缓冲输入读取器:始终监听输入行(避免闲置期丢行),提示时优先消费缓冲;
 * 输入结束(EOF)时以空行应答等待中的提示,保证管道/交互两种模式都稳定。
 */
class LineReader {
  private readonly rl = readline.createInterface({ input: process.stdin });
  private readonly waiters: Array<(line: string) => void> = [];
  private readonly buffered: string[] = [];
  private closed = false;

  constructor() {
    this.rl.on("line", (line) => {
      const resolve = this.waiters.shift();
      if (resolve) resolve(line);
      else this.buffered.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      for (const resolve of this.waiters.splice(0)) resolve("");
    });
  }

  question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(prompt);
      const buffered = this.buffered.shift();
      if (buffered !== undefined) {
        resolve(buffered);
      } else if (this.closed) {
        resolve("");
      } else {
        this.waiters.push(resolve);
      }
    });
  }

  close(): void {
    this.rl.close();
  }
}

/** 当前等待确认的关键节点类型(薄读取层:从 graph_runs 快照判断) */
function readPendingConfirmation(
  db: ReturnType<typeof getDb>,
  drillId: string,
): "grading" | "dispatch" | "notification" {
  const state = JSON.parse(getGraphRunByDrillId(db, drillId)!.state) as {
    grading?: { status?: string };
    dispatch?: { status?: string };
    notification?: { status?: string };
  };
  if (state.grading?.status === "awaiting_confirmation") return "grading";
  return state.dispatch?.status === "awaiting_confirmation" ? "dispatch" : "notification";
}

/** 决策坞(CLI 版):展示双受众通知全文,确认发布 */
async function promptNotificationConfirmation(
  reader: LineReader,
  db: ReturnType<typeof getDb>,
  drillId: string,
): Promise<void> {
  const notifications = listNotificationsByDrill(db, drillId).filter((n) => n.status === "pending_confirmation");
  console.log("");
  console.log("⚑ 决策坞 · 通知发布确认(演练已暂停,模拟时钟停走)");
  for (const n of notifications) {
    console.log(`  ── [${AUDIENCE_LABELS[n.audience as keyof typeof AUDIENCE_LABELS]}] ${n.title}`);
    for (const line of n.content.split(/(?=。)/)) {
      if (line.trim()) console.log(`     ${line.trim()}`);
    }
  }
  await reader.question("请操作:直接回车 = 确认发布(模拟分发):");
}

/** 段末如有失败通知:提供重试入口(模拟分发失败只影响通知自身) */
async function promptNotificationRetryIfNeeded(
  reader: LineReader,
  runner: DrillRunner,
  db: ReturnType<typeof getDb>,
  drillId: string,
): Promise<void> {
  for (;;) {
    const failed = listNotificationsByDrill(db, drillId).filter((n) => n.status === "failed");
    if (failed.length === 0) return;
    const names = failed.map((n) => AUDIENCE_LABELS[n.audience as keyof typeof AUDIENCE_LABELS]).join("、");
    console.log("");
    const answer = (await reader.question(`⚠ ${failed.length} 份通知模拟分发失败(${names})。输入 r 重试发布,直接回车跳过:`)).trim().toLowerCase();
    if (answer !== "r") return;
    const result = await runner.retryNotification();
    console.log(`  重试完成:发布 ${result.published} 份,仍失败 ${result.failed} 份`);
  }
}

/** tick 循环推进到决策点:返回离开 running 时的演练状态(等待确认 / 段末暂停 / 终态) */
function runUntilDecisionPoint(runner: DrillRunner): Promise<DrillStatus | null> {
  const TICK_INTERVAL_MS = 200;
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      void runner.tick().catch((error) => {
        clearInterval(timer);
        console.error("推演出错,已终止:", error instanceof Error ? error.message : error);
        process.exit(1);
      });
      if (runner.status !== "running") {
        clearInterval(timer);
        setTimeout(() => resolve(runner.status), 50);
      }
    }, TICK_INTERVAL_MS);
  });
}

/** 决策坞(CLI 版):展示建议等级与理由,回车确认或输入 I/II/III/IV 调整 */
async function promptGradingConfirmation(
  reader: LineReader,
  db: ReturnType<typeof getDb>,
  drillId: string,
): Promise<{ severity?: EventSeverity }> {
  const gradingNode = listTimelineByDrill(db, drillId)
    .reverse()
    .find((n) => n.node_type === "grading")!;
  const detail = JSON.parse(gradingNode.detail);
  const suggested = detail.output.suggestedSeverity as EventSeverity;

  console.log("");
  console.log(`⚑ 决策坞 · 事件定级确认(演练已暂停,模拟时钟停走)`);
  console.log(`  指挥调度建议:${SEVERITY_LABELS[suggested]}`);
  console.log(`  理由:${detail.output.reasoning}`);
  console.log("");

  for (;;) {
    const answer = (
      await reader.question("请操作:直接回车 = 确认建议等级;或输入 I / II / III / IV 调整等级后继续:")
    ).trim()
      .toUpperCase()
      .replace("Ⅰ", "I")
      .replace("Ⅱ", "II")
      .replace("Ⅲ", "III")
      .replace("Ⅳ", "IV");
    if (answer === "") return {};
    if (["I", "II", "III", "IV"].includes(answer)) {
      return { severity: answer as EventSeverity };
    }
    console.log("无效输入:请直接回车,或输入 I / II / III / IV");
  }
}

const ROLE_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_LABELS).map(([key, label]) => [label, key]),
);

/** 决策坞(CLI 版):展示任务方案/加派清单,支持就地增删改派后确认 */
async function promptDispatchConfirmation(
  reader: LineReader,
  db: ReturnType<typeof getDb>,
  drillId: string,
): Promise<{ tasks?: TaskPlanItem[] }> {
  const state = JSON.parse(getGraphRunByDrillId(db, drillId)!.state) as {
    dispatch: { kind: "initial" | "redispatch"; proposedTasks: TaskPlanItem[] };
  };
  const dispatch = state.dispatch;
  const kindLabel = dispatch.kind === "initial" ? "任务方案确认" : "重新调度 · 加派确认";
  const tasks: TaskPlanItem[] = dispatch.proposedTasks.map((t) => ({ ...t }));

  for (;;) {
    console.log("");
    console.log(`⚑ 决策坞 · ${kindLabel}(演练已暂停,模拟时钟停走)`);
    tasks.forEach((t, i) => {
      console.log(`  ${i + 1}. [${ROLE_LABELS[t.role] ?? t.role}] ${t.title} —— ${t.description}`);
    });
    if (tasks.length === 0) console.log("  (清单为空)");
    if (dispatch.kind === "redispatch") {
      console.log("  说明:回车确认当前清单;清单为空时回车 = 拒绝加派,维持原任务");
    }
    const answer = (
      await reader.question("回车 = 确认执行;-<序号> 删除 / r<序号> <保安|医务|后勤> 改派 / t<序号> <新标题> / d<序号> <新说明>:")
    ).trim();
    if (answer === "") {
      if (dispatch.kind === "initial" && tasks.length === 0) {
        console.log("初始任务方案至少需要 1 项任务,不能为空");
        continue;
      }
      break;
    }
    const m = answer.match(/^(?:-(\d+)|r(\d+)\s+(\S+)|t(\d+)\s+(.+)|d(\d+)\s+(.+))$/);
    if (!m) {
      console.log("无法识别的指令,示例:-2 / r2 医务 / t3 新标题 / d1 新说明");
      continue;
    }
    const idx = Number(m[1] ?? m[2] ?? m[4] ?? m[6]) - 1;
    if (idx < 0 || idx >= tasks.length) {
      console.log("序号越界");
      continue;
    }
    if (m[1] !== undefined) {
      tasks.splice(idx, 1);
    } else if (m[3] !== undefined) {
      const role = ROLE_KEYS[m[3]] ?? (m[3] in ROLE_LABELS ? m[3] : undefined);
      if (!role) {
        console.log("角色只能是 保安 / 医务 / 后勤");
        continue;
      }
      tasks[idx].role = role as TaskPlanItem["role"];
    } else if (m[5] !== undefined) {
      tasks[idx].title = m[5];
    } else {
      tasks[idx].description = m[7]!;
    }
  }
  const unchanged = JSON.stringify(tasks) === JSON.stringify(dispatch.proposedTasks);
  return unchanged ? {} : { tasks };
}

function createDeepSeek(): ChatDeepSeek {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("缺少 DEEPSEEK_API_KEY:请在 .env.local 中配置,或使用 --model fake 离线演示");
    process.exit(1);
  }
  return new ChatDeepSeek({ model: "deepseek-chat", apiKey, temperature: 0, timeout: 30_000 });
}

function printSummary(db: ReturnType<typeof getDb>, drillId: string): void {
  const signals = listSignalsByDrill(db, drillId);
  const event = getEventByDrillId(db, drillId);
  const nodes = listTimelineByDrill(db, drillId);
  const tasks = listTasksByDrill(db, drillId);
  console.log("");
  console.log("── 推演摘要(模拟演练)────────────────");
  console.log(`演练 ID:${drillId}`);
  if (event) {
    const severityLabel = event.severity
      ? SEVERITY_LABELS[event.severity as EventSeverity]
      : "未定";
    console.log(`事件:${event.title}(status=${event.status},等级 ${severityLabel})`);
  }
  const byStatus = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const taskSummary = Object.entries(byStatus).map(([s, n]) => `${s}×${n}`).join(" ");
  const notifications = listNotificationsByDrill(db, drillId);
  const notifySummary = notifications.length
    ? `,通知:${notifications.length} 份(${notifications.map((n) => n.status).join("/")})`
    : "";
  console.log(`信号:${signals.length} 条,任务:${tasks.length} 项(${taskSummary})${notifySummary},时间线节点:${nodes.length} 个`);
  for (const n of notifications) {
    if (n.delivery) {
      const delivery = JSON.parse(n.delivery) as DeliveryStats;
      const label = AUDIENCE_LABELS[n.audience as keyof typeof AUDIENCE_LABELS];
      console.log(`  通知[${label}] ${n.title}:送达 ${delivery.delivered}/${delivery.total}(失败 ${delivery.failed})`);
    }
  }
  printReviewSummary(db, drillId);
  process.exitCode = 0; // 不用 process.exit:非 TTY 下会截断异步 stdout 缓冲
}

/** 复盘摘要:总评分 + 指标条数据 + 问题分析 + 改进建议(全部来自落库报告,薄打印层) */
function printReviewSummary(db: ReturnType<typeof getDb>, drillId: string): void {
  const drill = getDrill(db, drillId);
  const report = getReportByDrillId(db, drillId);
  if (!report) {
    console.log(`演练状态:${drill?.status}(无复盘报告)`);
    return;
  }
  const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;
  const metrics = JSON.parse(report.metrics) as DrillMetrics;
  const problems = JSON.parse(report.problems) as Array<{ title: string; detail: string }>;
  const improvements = JSON.parse(report.improvements) as Array<{ title: string; detail: string }>;
  console.log("");
  console.log("── 复盘报告(模拟演练)────────────────");
  console.log(`总评分:${drill?.score ?? "?"} / 100(${report.source === "model" ? "复盘智能体生成" : "降级规则骨架"})`);
  console.log(
    `指标条:总时长 ${seconds(metrics.totalDurationMs)} · 发现→上报 ${seconds(metrics.reportDurationMs)} · 定级 ${seconds(metrics.gradingDurationMs)} · 任务完成 ${metrics.taskDone}/${metrics.taskTotal} · 资源消耗 ${metrics.resourceTotal} 单位`,
  );
  if (problems.length > 0) {
    console.log("问题分析:");
    for (const p of problems) console.log(`  ⚠ ${p.title} —— ${p.detail}`);
  } else {
    console.log("问题分析:无(全程未发现明显问题)");
  }
  console.log("改进建议:");
  for (const i of improvements) console.log(`  ▸ ${i.title} —— ${i.detail}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
