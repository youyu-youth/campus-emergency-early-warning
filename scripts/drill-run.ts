// 演练推演 CLI(运行器之上的薄打印层,不含业务规则)
// 用法:pnpm drill:run --scenario fire_alarm --seed 42 [--speed 60] [--model deepseek|fake]
//       [--location 地点] [--intensity low|medium|high]

import fs from "node:fs";
import path from "node:path";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ScriptedModel, wrapLangChain } from "../src/agents/model";
import { getDb } from "../src/db/client";
import { listSignalsByDrill, listTimelineByDrill, getDrill, getEventByDrillId } from "../src/db/queries";
import { formatSimClock } from "../src/simulation/clock";
import { SCENARIOS } from "../src/simulation/scenarios";
import { DrillRunner } from "../src/runner/drill-runner";
import type { TimelineNodeRow } from "../src/db/types";
import { DEMO_SCRIPTS } from "./demo-scripts";

// —— 参数解析 ——

interface CliArgs {
  scenario: string;
  seed: number;
  speed: number;
  model: "deepseek" | "fake";
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
  anomaly: "⚠️ ",
  status_change: "⏸️ ",
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
    `▶ 发起演练:${scenario.name} · 种子 ${args.seed} · 倍速 ${args.speed}x · 模型 ${args.model === "fake" ? "假模型(演示剧本)" : "DeepSeek"}`,
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
    params: {
      ...(args.location ? { location: args.location } : {}),
      ...(args.intensity ? { intensity: args.intensity } : {}),
    },
  });
  simOriginMs = JSON.parse(getDrill(db, drillId)!.clock_state).simOrigin as number;

  // tick 循环:感知段完成后运行器自动暂停,CLI 随之收尾
  const TICK_INTERVAL_MS = 200;
  const timer = setInterval(() => {
    void runner.tick().catch((error) => {
      console.error("推演出错,已终止:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
    if (runner.status !== "running") {
      clearInterval(timer);
      setTimeout(() => printSummary(db, drillId), 50);
    }
  }, TICK_INTERVAL_MS);
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
  console.log("");
  console.log("── 推演摘要(模拟演练)────────────────");
  console.log(`演练 ID:${drillId}`);
  if (event) {
    console.log(`事件:${event.title}(status=${event.status},等级${event.severity ?? "未定"})`);
  }
  console.log(`信号:${signals.length} 条,时间线节点:${nodes.length} 个`);
  console.log(`下一步:指挥调度智能体接入后,恢复演练进入研判阶段(路线下一 ticket)`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
