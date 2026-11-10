import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { createScenarioApi, listScenarioApi, ScenarioBodySchema } from "@/server/scenario-api";

/** GET /api/scenarios:事件库列表(不含已删;内置在前) */
export async function GET() {
  return NextResponse.json({ scenarios: listScenarioApi(getDb()) });
}

/** POST /api/scenarios:新建自定义场景(key 自动生成 custom_ 前缀) */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = ScenarioBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `参数无效:${parsed.error.issues[0]?.message ?? ""}` }, { status: 400 });
  }
  try {
    const scenario = createScenarioApi(getDb(), parsed.data);
    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
