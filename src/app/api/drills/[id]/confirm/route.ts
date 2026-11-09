import { NextResponse } from "next/server";
import { z } from "zod";

import { drillServiceApi } from "@/server/drill-service";

const TaskItemSchema = z.object({
  role: z.enum(["security", "medical", "logistics"]),
  title: z.string().min(1),
  description: z.string().min(1),
});

const ConfirmBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grading"), severity: z.enum(["I", "II", "III", "IV"]).optional() }),
  z.object({ kind: z.literal("dispatch"), tasks: z.array(TaskItemSchema).optional() }),
  z.object({ kind: z.literal("notification") }),
]);

/** POST /api/drills/[id]/confirm:关键节点人工确认(定级/任务方案/通知发布,决策坞提交口) */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = ConfirmBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `确认参数无效:${parsed.error.issues[0]?.message ?? ""}` }, { status: 400 });
  }

  const api = drillServiceApi();
  const summary = api.activeSummary();
  if (!summary || summary.id !== id) {
    return NextResponse.json({ error: `演练 ${id} 不在等待确认状态` }, { status: 409 });
  }
  try {
    const data = parsed.data;
    const result =
      data.kind === "grading"
        ? await api.confirmGrading(data.severity)
        : data.kind === "dispatch"
          ? await api.confirmDispatch(data.tasks)
          : await api.confirmNotification();
    return NextResponse.json({ result, drill: api.activeSummary() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
