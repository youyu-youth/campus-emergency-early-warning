import { NextResponse } from "next/server";

import { drillServiceApi } from "@/server/drill-service";

/** GET /api/drills/[id]:演练详情(工作区轮询源:事件/时间线/任务/编队/待确认) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = drillServiceApi().detail(id);
  if (!detail) {
    return NextResponse.json({ error: `演练 ${id} 不存在` }, { status: 404 });
  }
  return NextResponse.json(detail);
}
