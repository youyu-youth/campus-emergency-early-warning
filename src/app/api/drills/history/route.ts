import { NextResponse } from "next/server";

import { drillServiceApi } from "@/server/drill-service";

/** GET /api/drills/history:演练列表(指挥台历史表格,时间倒序) */
export async function GET() {
  const api = drillServiceApi();
  return NextResponse.json({ drills: api.history() });
}
