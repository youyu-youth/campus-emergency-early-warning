import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { isBuiltinScenario } from "@/simulation/scenario-store";
import { deleteScenarioApi, ScenarioLockedError, ScenarioBodySchema, updateScenarioApi } from "@/server/scenario-api";

/** PUT /api/scenarios/[key]:更新自定义场景(内置锁定 403,先于参数校验) */
export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (isBuiltinScenario(getDb(), key)) {
    return NextResponse.json({ error: "内置场景为标准模板,不可修改或删除;可复制为新事件后编辑" }, { status: 403 });
  }
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
    const scenario = updateScenarioApi(getDb(), key, parsed.data);
    return NextResponse.json({ scenario });
  } catch (error) {
    if (error instanceof ScenarioLockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

/** DELETE /api/scenarios/[key]:软删除自定义场景(内置 403;活跃演练引用 409) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    deleteScenarioApi(getDb(), key);
    return NextResponse.json({ deleted: key });
  } catch (error) {
    if (error instanceof ScenarioLockedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : String(error);
    const conflict = message.includes("进行中的演练");
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 404 });
  }
}
