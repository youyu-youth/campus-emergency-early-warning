import { NextResponse } from "next/server";
import { z } from "zod";

import { drillServiceApi } from "@/server/drill-service";

const ControlBodySchema = z.object({
  action: z.enum(["pause", "resume", "abort"]),
});

/** POST /api/drills/[id]/control:推演控制(暂停/恢复/终止;终止的二次确认由前端负责) */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = ControlBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "action 只能是 pause / resume / abort" }, { status: 400 });
  }

  const api = drillServiceApi();
  // 归属校验用详情(paused 不在「活跃」集合但可被恢复/终止;终态不可控)
  const detail = api.detail(id);
  const controllable = ["running", "paused", "awaiting_confirmation"];
  if (!detail || !controllable.includes(detail.drill.status)) {
    return NextResponse.json({ error: `演练 ${id} 不在可控制状态(可能已结束或不存在)` }, { status: 409 });
  }
  try {
    if (parsed.data.action === "pause") await api.pause();
    else if (parsed.data.action === "resume") await api.resume();
    else await api.abort();
    return NextResponse.json({ drill: api.activeSummary(), status: detail.drill.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
