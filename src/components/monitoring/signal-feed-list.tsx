"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { SignalDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { SIGNAL_STATUS_DOTS, SIGNAL_STATUS_LABELS, SIGNAL_TYPE_LABELS, SOURCE_ICONS, SOURCE_LABELS, simTimeLabel } from "./signal-meta";

/** 筛选维度:来源/类型/状态(类型选项从当前信号流动态提取,场景扩展无需改此处) */
type SourceFilter = "all" | "sensor" | "camera";
type StatusFilter = "all" | "new" | "processing" | "reported" | "ignored";

const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "sensor", label: "传感器" },
  { value: "camera", label: "摄像头" },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "new", label: "新信号" },
  { value: "processing", label: "解读中" },
  { value: "reported", label: "已上报" },
  { value: "ignored", label: "已忽略" },
];

/** 筛选按钮组(小号,监测页筛选条专用) */
function FilterGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-sm border px-2.5 text-[11px] transition-colors",
            value === option.value
              ? "border-primary bg-primary/10 font-medium text-primary"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 实时信号流(docs/design.md §4.2):行式列表 + 顶部筛选条,按模拟时间正序、自动跟随最新 */
export function SignalFeedList({
  signals,
  selectedId,
  onSelect,
  className,
}: {
  signals: SignalDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<string>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of signals) seen.set(s.signalType, SIGNAL_TYPE_LABELS[s.signalType] ?? s.signalType);
    return [{ value: "all", label: "全部类型" }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [signals]);

  const visible = signals.filter(
    (s) =>
      (source === "all" || s.sourceKind === source) &&
      (status === "all" || s.status === status) &&
      (type === "all" || s.signalType === type),
  );

  // 新信号到达时跟随滚动到底部(用户手动上翻时打扰最小:仅在滚动已接近底部时跟随)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)} aria-label="信号流">
      <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">
        信号流
        <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
          {visible.length}/{signals.length} 条
        </span>
      </div>
      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
        <FilterGroup label="按来源筛选" options={SOURCE_FILTERS} value={source} onChange={setSource} />
        <FilterGroup label="按类型筛选" options={typeOptions} value={type} onChange={setType} />
        <FilterGroup label="按状态筛选" options={STATUS_FILTERS} value={status} onChange={setStatus} />
      </div>
      {visible.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px] text-muted-foreground">
          {signals.length === 0 ? "等待信号到达…" : "当前筛选条件下没有信号。"}
        </p>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <ul>
            {visible.map((signal) => {
              const Icon = SOURCE_ICONS[signal.sourceKind];
              const selected = signal.id === selectedId;
              return (
                <li key={signal.id} className="border-b border-border/60 last:border-0">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(signal.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50",
                      selected && "bg-primary/10",
                    )}
                  >
                    <span className={cn("h-8 w-0.5 flex-none rounded-full", selected ? "bg-primary" : "bg-transparent")} aria-hidden />
                    <time className="w-16 flex-none font-mono text-[11px] text-muted-foreground tabular-nums">
                      {simTimeLabel(signal.simTime)}
                    </time>
                    {Icon ? (
                      <Icon className="size-3.5 flex-none text-muted-foreground" aria-hidden />
                    ) : null}
                    <span className="w-[7.5rem] flex-none truncate text-xs font-medium" title={`${signal.location} · ${SOURCE_LABELS[signal.sourceKind] ?? signal.sourceKind} ${signal.sourceRef}`}>
                      {signal.location}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {SIGNAL_TYPE_LABELS[signal.signalType] ?? signal.signalType}
                    </span>
                    <span className="flex-none font-mono text-[11px] text-muted-foreground tabular-nums">
                      {Math.round(signal.confidence * 100)}%
                    </span>
                    <span className="flex w-[4.5rem] flex-none items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
                      <span className={cn("size-1.5 flex-none rounded-full", SIGNAL_STATUS_DOTS[signal.status] ?? "bg-muted-foreground/40")} aria-hidden />
                      {SIGNAL_STATUS_LABELS[signal.status] ?? signal.status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
