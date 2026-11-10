// 事件库域展示语言:强度/来源标签、结构化读数字段定义、秒↔毫秒换算(表单与列表共用)
import type { ScenarioSignalTemplateDTO } from "@/lib/drill-types";

export const INTENSITY_LABELS: Record<"low" | "medium" | "high", string> = {
  low: "轻度",
  medium: "中等",
  high: "高强度",
};

export const SOURCE_OPTIONS: Array<{ value: "sensor" | "camera"; label: string }> = [
  { value: "sensor", label: "传感器" },
  { value: "camera", label: "摄像头" },
];

export const SOURCE_LABELS: Record<string, string> = {
  sensor: "传感器",
  camera: "摄像头",
};

/** 结构化读数的可选字段(键即 payload 键;覆盖内置场景全部用法,留空不写入) */
export const READING_FIELDS: Array<{
  key: string;
  label: string;
  type: "text" | "number";
  placeholder?: string;
}> = [
  { key: "metric", label: "指标", type: "text", placeholder: "如 smoke_density" },
  { key: "value", label: "数值", type: "number" },
  { key: "unit", label: "单位", type: "text", placeholder: "如 %/m" },
  { key: "threshold", label: "阈值", type: "number" },
  { key: "baseline", label: "基线", type: "number" },
  { key: "detection", label: "检测结果", type: "text", placeholder: "如 fall_detected" },
  { key: "region", label: "区域", type: "text" },
  { key: "subjectRef", label: "对象编号", type: "text" },
];

/** 毫秒 → 秒(表单展示;整数秒) */
export function msToSecondsInput(offsetMs: number): string {
  return String(Math.round(offsetMs / 1000));
}

/** 秒输入 → 毫秒(非法回落 0) */
export function secondsToMs(input: string): number {
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) : 0;
}

/** 信号行摘要(列表/确认弹层展示) */
export function signalSummary(signal: ScenarioSignalTemplateDTO): string {
  return `${SOURCE_LABELS[signal.kind] ?? signal.kind} ${signal.sourceRef} · ${signal.location} · ${Math.round(signal.offsetMs / 1000)}s`;
}
