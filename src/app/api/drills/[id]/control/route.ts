import { NextResponse } from "next/server";
import { z } from "zod";

import { drillServiceApi } from "@/server/drill-service";

const ControlBodySchema = z.object({
  action: z.enum(["pause", "resume", "abort", "set_speed", "restart"]),
  speed: z.number().positive().max(10).optional(),
});

/** POST /api/drills/[id]/control:推演控制(暂停/恢复/终止/调速/重置;终止与重置的二次确认由前端负责) */
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
    return NextResponse.json(
      { error: "action 只能是 pause / resume / abort / set_speed / restart" },
      { status: 400 },
    );
  }
  const { action, speed } = parsed.data;
  if (action === "set_speed" && speed === undefined) {
    return NextResponse.json({ error: "set_speed 需要携带 speed 字段(正数,至多 10)" }, { status: 400 });
  }

  const api = drillServiceApi();
  // 归属校验用详情(终态不可控;paused/awaiting 可被恢复、调速、重置、终止)
  const detail = api.detail(id);
  const controllable = ["running", "paused", "awaiting_confirmation"];
  if (!detail || !controllable.includes(detail.drill.status)) {
    return NextResponse.json({ error: `演练 ${id} 不在可控制状态(可能已结束或不存在)` }, { status: 409 });
  }
  try {
    if (action === "set_speed") {
      await api.setSpeed(speed as number);
      return NextResponse.json({ drill: api.activeSummary(), status: detail.drill.status });
    }
    if (action === "restart") {
      const { drillId } = await api.restart();
      return NextResponse.json({ drill: api.activeSummary(), drillId });
    }
    if (action === "pause") await api.pause();
    else if (action === "resume") await api.resume();
    else await api.abort();
    return NextResponse.json({ drill: api.activeSummary(), status: detail.drill.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
