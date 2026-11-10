import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db/client";
import { listScenarioItems } from "@/simulation/scenario-store";
import { drillServiceApi } from "@/server/drill-service";

/** GET /api/drills:当前活跃演练摘要(壳层状态条轮询源) */
export async function GET() {
  const api = drillServiceApi();
  return NextResponse.json({
    drill: api.activeSummary(),
    modelLabel: api.modelLabel,
    offline: api.offline,
  });
}

const StartBodySchema = z.object({
  scenarioKey: z.string().min(1),
  seed: z.number().int().positive().optional(),
  speed: z.number().positive().max(10).optional(),
  autoConfirm: z.boolean().optional(),
});

/** POST /api/drills:发起一场演练 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = StartBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `参数无效:${parsed.error.issues[0]?.message ?? ""}` }, { status: 400 });
  }
  // 场景存在性校验(须存在且未删除;软删除的场景不可再发起)
  const available = listScenarioItems(getDb()).some((item) => item.scenario.key === parsed.data.scenarioKey);
  if (!available) {
    return NextResponse.json({ error: "场景不存在或已被删除" }, { status: 400 });
  }
  const api = drillServiceApi();
  try {
    const input = {
      scenarioKey: parsed.data.scenarioKey,
      seed: parsed.data.seed ?? Math.floor(Math.random() * 1_000_000),
      ...(parsed.data.speed !== undefined ? { speed: parsed.data.speed } : {}),
      ...(parsed.data.autoConfirm !== undefined ? { autoConfirm: parsed.data.autoConfirm } : {}),
    };
    const result = await api.start(input);
    return NextResponse.json({ drillId: result.drillId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const conflict = message.includes("至多一场");
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
