"use client";

// 事件库编辑表单(docs/design.md 事件库管理):基本信息 + 信号模板表格行 + 演变里程碑表格行
// 内置场景只读(锁定,经「复制为新事件」编辑);自定义场景可保存;全部留痕均为模拟数据

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ScenarioBody, ScenarioDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { INTENSITY_LABELS, msToSecondsInput, READING_FIELDS, secondsToMs, SOURCE_OPTIONS } from "./scenario-meta";

/** 表单草稿(输入态全部字符串化,提交时组装与校验) */
interface SignalDraft {
  offsetSeconds: string;
  kind: "sensor" | "camera";
  sourceRef: string;
  location: string;
  signalType: string;
  confidenceMin: string;
  confidenceMax: string;
  reading: Record<string, string>;
}

interface EvolutionDraft {
  offsetSeconds: string;
  milestone: string;
  note: string;
}

export interface ScenarioFormDraft {
  name: string;
  description: string;
  eventTypeLabel: string;
  defaultSimStart: string;
  location: string;
  intensity: "low" | "medium" | "high";
  signals: SignalDraft[];
  evolution: EvolutionDraft[];
}

export function draftFromScenario(scenario: ScenarioDTO): ScenarioFormDraft {
  return {
    name: scenario.name,
    description: scenario.description,
    eventTypeLabel: scenario.eventTypeLabel,
    defaultSimStart: scenario.defaultSimStart,
    location: scenario.location,
    intensity: scenario.intensity,
    signals: scenario.signals.map((s) => ({
      offsetSeconds: msToSecondsInput(s.offsetMs),
      kind: s.kind,
      sourceRef: s.sourceRef,
      location: s.location,
      signalType: s.signalType,
      confidenceMin: String(s.confidence[0]),
      confidenceMax: String(s.confidence[1]),
      reading: Object.fromEntries(Object.entries(s.reading).map(([k, v]) => [k, String(v)])),
    })),
    evolution: scenario.evolution.map((e) => ({
      offsetSeconds: msToSecondsInput(e.offsetMs),
      milestone: e.milestone,
      note: e.note,
    })),
  };
}

export function emptyDraft(): ScenarioFormDraft {
  return {
    name: "",
    description: "",
    eventTypeLabel: "",
    defaultSimStart: "09:00",
    location: "",
    intensity: "medium",
    signals: [emptySignal()],
    evolution: [],
  };
}

function emptySignal(): SignalDraft {
  return {
    offsetSeconds: "0",
    kind: "sensor",
    sourceRef: "",
    location: "",
    signalType: "",
    confidenceMin: "0.8",
    confidenceMax: "0.95",
    reading: {},
  };
}

/** 草稿 → 提交体(数值转换;reading 只带非空键并按字段类型转数值) */
export function draftToBody(draft: ScenarioFormDraft): ScenarioBody {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    eventTypeLabel: draft.eventTypeLabel.trim(),
    defaultSimStart: draft.defaultSimStart,
    location: draft.location.trim(),
    intensity: draft.intensity,
    signals: draft.signals.map((s) => {
      const reading: Record<string, string | number> = {};
      for (const field of READING_FIELDS) {
        const raw = s.reading[field.key]?.trim();
        if (raw === undefined || raw === "") continue;
        reading[field.key] = field.type === "number" ? Number(raw) : raw;
      }
      return {
        offsetMs: secondsToMs(s.offsetSeconds),
        kind: s.kind,
        sourceRef: s.sourceRef.trim(),
        location: s.location.trim(),
        signalType: s.signalType.trim(),
        confidence: [Number(s.confidenceMin), Number(s.confidenceMax)],
        reading,
      };
    }),
    evolution: draft.evolution.map((e) => ({
      offsetMs: secondsToMs(e.offsetSeconds),
      milestone: e.milestone.trim(),
      note: e.note.trim(),
    })),
  };
}

/** 客户端校验(与服务端 zod 同口径,提前拦截常见错误) */
export function validateDraft(draft: ScenarioFormDraft): string | null {
  if (!draft.name.trim()) return "请填写事件名称";
  if (!draft.eventTypeLabel.trim()) return "请填写事件类型中文名";
  if (!/^\d{2}:\d{2}$/.test(draft.defaultSimStart)) return "模拟开始时刻格式须为 HH:mm";
  if (!draft.location.trim()) return "请填写默认地点";
  if (draft.signals.length === 0) return "至少配置一条信号";
  for (let i = 0; i < draft.signals.length; i++) {
    const s = draft.signals[i];
    const label = `信号 ${i + 1}`;
    if (!s.sourceRef.trim() || !s.location.trim() || !s.signalType.trim()) return `${label}:设备编号、位置、信号类型均为必填`;
    const min = Number(s.confidenceMin);
    const max = Number(s.confidenceMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 1 || min > max) {
      return `${label}:置信度须为 0~1 区间且下限不大于上限`;
    }
  }
  for (let i = 0; i < draft.evolution.length; i++) {
    if (!draft.evolution[i].milestone.trim()) return `演变 ${i + 1}:里程碑名称必填`;
  }
  return null;
}

const inputClass =
  "h-9 w-full rounded-sm border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:border-primary";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground/70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** 事件库编辑表单:readOnly=内置只读态(字段禁用,仍可浏览全部模板) */
export function ScenarioForm({
  draft,
  onChange,
  readOnly,
}: {
  draft: ScenarioFormDraft;
  onChange: (next: ScenarioFormDraft) => void;
  readOnly: boolean;
}) {
  const [expandedSignal, setExpandedSignal] = useState(0);
  const disabledCls = readOnly ? "cursor-not-allowed opacity-70" : "";

  const patch = (partial: Partial<ScenarioFormDraft>) => onChange({ ...draft, ...partial });

  const patchSignal = (index: number, partial: Partial<SignalDraft>) => {
    const signals = draft.signals.map((s, i) => (i === index ? { ...s, ...partial } : s));
    patch({ signals });
  };

  const patchEvolution = (index: number, partial: Partial<EvolutionDraft>) => {
    const evolution = draft.evolution.map((e, i) => (i === index ? { ...e, ...partial } : e));
    patch({ evolution });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
      <section aria-label="基本信息">
        <h3 className="text-xs font-bold tracking-widest text-muted-foreground">基本信息</h3>
        <div className="mt-3 grid grid-cols-2 gap-4 xl:grid-cols-3">
          <Field label="事件名称">
            <input
              className={cn(inputClass, disabledCls)}
              value={draft.name}
              disabled={readOnly}
              placeholder="如 实验室化学品泄漏"
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="事件类型" hint="监测中心展示的中文名">
            <input
              className={cn(inputClass, disabledCls)}
              value={draft.eventTypeLabel}
              disabled={readOnly}
              placeholder="如 化学品泄漏"
              onChange={(e) => patch({ eventTypeLabel: e.target.value })}
            />
          </Field>
          <Field label="默认模拟开始" hint="HH:mm">
            <input
              className={cn(inputClass, disabledCls)}
              value={draft.defaultSimStart}
              disabled={readOnly}
              placeholder="09:00"
              onChange={(e) => patch({ defaultSimStart: e.target.value })}
            />
          </Field>
          <Field label="默认地点">
            <input
              className={cn(inputClass, disabledCls)}
              value={draft.location}
              disabled={readOnly}
              placeholder="如 实验楼 B201"
              onChange={(e) => patch({ location: e.target.value })}
            />
          </Field>
          <Field label="默认强度" hint="降级定级映射:高→Ⅱ 中→Ⅲ 低→Ⅳ">
            <select
              className={cn(inputClass, disabledCls)}
              value={draft.intensity}
              disabled={readOnly}
              onChange={(e) => patch({ intensity: e.target.value as ScenarioFormDraft["intensity"] })}
            >
              {(Object.keys(INTENSITY_LABELS) as Array<keyof typeof INTENSITY_LABELS>).map((key) => (
                <option key={key} value={key}>
                  {INTENSITY_LABELS[key]}
                </option>
              ))}
            </select>
          </Field>
          <div className="col-span-2 xl:col-span-3">
            <Field label="描述">
              <textarea
                className={cn("min-h-16 w-full resize-y rounded-sm border border-input bg-background px-2.5 py-2 text-[13px] outline-none focus-visible:border-primary", disabledCls)}
                value={draft.description}
                disabled={readOnly}
                placeholder="一句话描述事件演化背景(展示在发起页场景卡)"
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </section>

      <section aria-label="信号模板">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold tracking-widest text-muted-foreground">
            信号模板
            <span className="ml-2 font-normal">按发生顺序触发感知上报(时刻单位:秒)</span>
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={() => patch({ signals: [...draft.signals, emptySignal()] })}
              className="flex h-7 items-center gap-1 rounded-sm border border-input px-2.5 text-[11px] font-medium transition-colors hover:border-primary hover:text-primary"
            >
              <Plus className="size-3" aria-hidden />
              添加信号
            </button>
          )}
        </div>
        <ul className="mt-2 space-y-1.5">
          {draft.signals.map((signal, index) => {
            const expanded = expandedSignal === index;
            return (
              <li key={index} className="rounded-sm border border-border bg-background/40">
                <div className="grid grid-cols-[64px_96px_140px_minmax(0,1fr)_140px_72px_72px_32px] items-center gap-2 p-2">
                  <input
                    type="number"
                    min={0}
                    aria-label={`信号 ${index + 1} 发生时刻(秒)`}
                    className={cn(inputClass, "px-2 font-mono tabular-nums", disabledCls)}
                    value={signal.offsetSeconds}
                    disabled={readOnly}
                    onChange={(e) => patchSignal(index, { offsetSeconds: e.target.value })}
                  />
                  <select
                    aria-label={`信号 ${index + 1} 来源`}
                    className={cn(inputClass, disabledCls)}
                    value={signal.kind}
                    disabled={readOnly}
                    onChange={(e) => patchSignal(index, { kind: e.target.value as SignalDraft["kind"] })}
                  >
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`信号 ${index + 1} 设备编号`}
                    className={cn(inputClass, "font-mono text-xs", disabledCls)}
                    value={signal.sourceRef}
                    disabled={readOnly}
                    placeholder="LAB-B201-CHEM-01"
                    onChange={(e) => patchSignal(index, { sourceRef: e.target.value })}
                  />
                  <input
                    aria-label={`信号 ${index + 1} 位置`}
                    className={cn(inputClass, disabledCls)}
                    value={signal.location}
                    disabled={readOnly}
                    placeholder="实验楼 B201"
                    onChange={(e) => patchSignal(index, { location: e.target.value })}
                  />
                  <input
                    aria-label={`信号 ${index + 1} 信号类型`}
                    className={cn(inputClass, "font-mono text-xs", disabledCls)}
                    value={signal.signalType}
                    disabled={readOnly}
                    placeholder="gas_leak"
                    onChange={(e) => patchSignal(index, { signalType: e.target.value })}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    aria-label={`信号 ${index + 1} 置信度下限`}
                    className={cn(inputClass, "px-2 font-mono tabular-nums", disabledCls)}
                    value={signal.confidenceMin}
                    disabled={readOnly}
                    onChange={(e) => patchSignal(index, { confidenceMin: e.target.value })}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    aria-label={`信号 ${index + 1} 置信度上限`}
                    className={cn(inputClass, "px-2 font-mono tabular-nums", disabledCls)}
                    value={signal.confidenceMax}
                    disabled={readOnly}
                    onChange={(e) => patchSignal(index, { confidenceMax: e.target.value })}
                  />
                  <div className="flex items-center justify-end gap-1">
                    {!readOnly && draft.signals.length > 1 && (
                      <button
                        type="button"
                        aria-label={`删除信号 ${index + 1}`}
                        onClick={() => patch({ signals: draft.signals.filter((_, i) => i !== index) })}
                        className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:border hover:border-destructive/50 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedSignal(expanded ? -1 : index)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 border-t border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  原始读数
                  <span className="text-muted-foreground/60">
                    {Object.keys(signal.reading).length > 0
                      ? Object.entries(signal.reading)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")
                      : "未填写(可留空)"}
                  </span>
                  <span className="ml-auto">{expanded ? "收起" : "展开"}</span>
                </button>
                {expanded && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 p-2.5 md:grid-cols-4">
                    {READING_FIELDS.map((field) => (
                      <label key={field.key} className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {field.label}
                          <span className="ml-1 font-mono text-muted-foreground/60">{field.key}</span>
                        </span>
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          step={field.type === "number" ? "any" : undefined}
                          className={cn(inputClass, "h-8 text-xs", disabledCls)}
                          value={signal.reading[field.key] ?? ""}
                          disabled={readOnly}
                          placeholder={field.placeholder}
                          onChange={(e) =>
                            patchSignal(index, {
                              reading: { ...signal.reading, [field.key]: e.target.value },
                            })
                          }
                        />
                      </label>
                    ))}
                    <p className="col-span-2 text-[10px] leading-4 text-muted-foreground/70 md:col-span-4">
                      读数将随信号展示在监测中心;系统自动附加 simulated: true 模拟标记,不得伪装真实设备数据。留空字段不写入。
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="演变里程碑">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold tracking-widest text-muted-foreground">
            演变里程碑
            <span className="ml-2 font-normal">到期触发场景演变与重新调度评估(可留空)</span>
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={() => patch({ evolution: [...draft.evolution, { offsetSeconds: "120", milestone: "", note: "" }] })}
              className="flex h-7 items-center gap-1 rounded-sm border border-input px-2.5 text-[11px] font-medium transition-colors hover:border-primary hover:text-primary"
            >
              <Plus className="size-3" aria-hidden />
              添加里程碑
            </button>
          )}
        </div>
        {draft.evolution.length === 0 ? (
          <p className="mt-2 rounded-sm border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
            未配置演变——演练将在任务全部终态后直接进入通知段
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {draft.evolution.map((item, index) => (
              <li
                key={index}
                className="grid grid-cols-[72px_150px_minmax(0,1fr)_32px] items-center gap-2 rounded-sm border border-border bg-background/40 p-2"
              >
                <input
                  type="number"
                  min={0}
                  aria-label={`演变 ${index + 1} 时刻(秒)`}
                  className={cn(inputClass, "px-2 font-mono tabular-nums", disabledCls)}
                  value={item.offsetSeconds}
                  disabled={readOnly}
                  onChange={(e) => patchEvolution(index, { offsetSeconds: e.target.value })}
                />
                <input
                  aria-label={`演变 ${index + 1} 里程碑名称`}
                  className={cn(inputClass, disabledCls)}
                  value={item.milestone}
                  disabled={readOnly}
                  placeholder="如 泄漏扩散"
                  onChange={(e) => patchEvolution(index, { milestone: e.target.value })}
                />
                <input
                  aria-label={`演变 ${index + 1} 说明`}
                  className={cn(inputClass, disabledCls)}
                  value={item.note}
                  disabled={readOnly}
                  placeholder="一句演变说明"
                  onChange={(e) => patchEvolution(index, { note: e.target.value })}
                />
                <div className="flex justify-end">
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`删除演变 ${index + 1}`}
                      onClick={() => patch({ evolution: draft.evolution.filter((_, i) => i !== index) })}
                      className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
