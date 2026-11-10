// 监测域信号展示语言:来源/状态/类型标签映射(消费 signals 表数据,均为模拟设备)
import { Radio, Video, type LucideIcon } from "lucide-react";

/** 信号来源图标(PRODUCT.md:模拟传感器/摄像头,不得伪装真实设备) */
export const SOURCE_ICONS: Record<string, LucideIcon> = {
  sensor: Radio,
  camera: Video,
};

export const SOURCE_LABELS: Record<string, string> = {
  sensor: "传感器",
  camera: "摄像头",
};

export const SIGNAL_STATUS_LABELS: Record<string, string> = {
  new: "新信号",
  processing: "解读中",
  reported: "已上报",
  ignored: "已忽略",
};

/** 信号状态色点(仅作辅助,始终与文字标签搭配出现) */
export const SIGNAL_STATUS_DOTS: Record<string, string> = {
  new: "bg-primary",
  processing: "bg-primary/50",
  reported: "bg-[oklch(0.55_0.15_150)]",
  ignored: "bg-muted-foreground/40",
};

/** 信号类型中文标签(scenarios.ts 定义的五种;未知类型回退原值) */
export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  smoke_density: "烟雾浓度",
  visual_smoke: "视觉烟雾",
  temperature_rise: "温度上升",
  heart_rate_abnormal: "心率异常",
  fall_detected: "倒地检测",
};

/** 事件类型中文标签(感知输出 eventType;未知类型回退原值) */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  fire_alarm: "消防警报",
  medical_emergency: "突发疾病",
};

/** 原始读数键的中文标签(未知键回退原值) */
export const PAYLOAD_KEY_LABELS: Record<string, string> = {
  metric: "指标",
  value: "读数",
  unit: "单位",
  threshold: "阈值",
  baseline: "基线",
  detection: "检测结果",
  region: "区域",
  simulated: "模拟标记",
};

/** ISO 模拟时间 → HH:mm:ss(与工作区时间线/态势侧栏同一展示口径) */
export function simTimeLabel(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
