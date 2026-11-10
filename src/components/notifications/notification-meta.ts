// 通知域展示语言:受众/状态标签映射(消费 notifications 表数据,均为模拟分发)
export const AUDIENCE_LABELS: Record<string, string> = {
  staff_students: "师生",
  parents: "家长",
};

export const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_confirmation: "待确认",
  published_sim: "已发布·模拟",
  failed: "模拟失败",
};

/** 通知状态色点(仅作辅助,始终与文字标签搭配出现) */
export const NOTIFICATION_STATUS_DOTS: Record<string, string> = {
  draft: "bg-muted-foreground/40",
  pending_confirmation: "bg-primary",
  published_sim: "bg-[oklch(0.55_0.15_150)]",
  failed: "bg-severity-i",
};

/** 草稿来源标签(⚑ 通知节点 drafts[].source) */
export const SOURCE_LABELS: Record<string, string> = {
  model: "模型生成",
  degraded: "规则默认文案(降级)",
  restored: "恢复复用",
};

/** ISO 模拟时间 → HH:mm:ss(与监测/工作区/态势侧栏同一展示口径) */
export function simTimeLabel(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** 送达统计短文案:已送达 x/y;未发布或无统计返回 null */
export function deliveryLabel(delivery: { total?: number; delivered?: number } | null): string | null {
  if (delivery?.total === undefined || delivery.total === 0) return null;
  return `已送达 ${delivery.delivered ?? 0}/${delivery.total}`;
}
