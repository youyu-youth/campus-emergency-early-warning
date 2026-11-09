"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FlaskConical, Loader2, Play } from "lucide-react";

import { DrillTag } from "@/components/status/drill-tag";
import type { DrillSummaryDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import type { ScenarioKey } from "@/simulation/scenarios";

interface ScenarioCard {
  key: ScenarioKey;
  name: string;
  description: string;
  location: string;
  intensity: "low" | "medium" | "high";
}

const INTENSITY_LABELS: Record<ScenarioCard["intensity"], string> = {
  low: "轻度",
  medium: "中等",
  high: "高强度",
};

/** 场景配置与发起(docs/design.md §4.3 空闲态):横向场景选择 + 参数表单,发起后直达工作区 */
export function SimulationLauncher({ scenarios }: { scenarios: ScenarioCard[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ScenarioKey>(scenarios[0]?.key ?? "fire_alarm");
  const [seed, setSeed] = useState("");
  const [speed, setSpeed] = useState(4);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDrill, setActiveDrill] = useState<DrillSummaryDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/drills", { cache: "no-store" });
        const data = (await res.json()) as { drill: DrillSummaryDTO | null };
        if (!cancelled) setActiveDrill(data.drill);
      } catch {
        /* 忽略,提交时兜底 */
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const launch = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { scenarioKey: selected, speed };
      // 表单勾选「人工确认」= 保持 runner 默认(关闭全自动);取消勾选才显式传全自动
      if (!autoConfirm) body.autoConfirm = true;
      const parsed = Number.parseInt(seed, 10);
      if (Number.isInteger(parsed) && parsed > 0) body.seed = parsed;
      const res = await fetch("/api/drills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { drillId?: string; error?: string };
      if (!res.ok || !data.drillId) {
        setError(data.error ?? `发起失败(${res.status})`);
        return;
      }
      router.push(`/command?drill=${data.drillId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误,请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      {activeDrill && (
        <div className="mb-5 flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-[13px]">
          <span className="size-2 rounded-full bg-primary" aria-hidden />
          <span>
            已有进行中的演练:<b className="font-semibold">{activeDrill.name}</b>(同一时间至多一场)
          </span>
          <a
            href="/command"
            className="ml-auto rounded-sm bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:brightness-110"
          >
            进入工作区
          </a>
        </div>
      )}

      <div className="flex gap-5">
        {scenarios.map((scenario) => {
          const active = selected === scenario.key;
          return (
            <button
              key={scenario.key}
              type="button"
              onClick={() => setSelected(scenario.key)}
              aria-pressed={active}
              className={cn(
                "flex-1 rounded-md border bg-card p-5 text-left transition-colors",
                active ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50",
              )}
            >
              <div className="flex items-center gap-2.5">
                <FlaskConical className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                <span className="font-heading text-base font-bold">{scenario.name}</span>
                {active && <DrillTag variant="canvas" />}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{scenario.description}</p>
              <p className="mt-2 text-xs text-muted-foreground/80">
                默认地点:{scenario.location} · 默认强度:{INTENSITY_LABELS[scenario.intensity]}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid max-w-xl grid-cols-[auto_1fr] items-center gap-x-5 gap-y-4 rounded-md border border-border bg-card p-5 text-[13px]">
        <label htmlFor="seed" className="text-muted-foreground">
          随机种子
        </label>
        <input
          id="seed"
          type="number"
          min={1}
          placeholder="留空随机(固定种子可复现同一推演)"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          className="h-9 w-64 rounded-sm border border-input bg-background px-3 outline-none focus-visible:border-primary"
        />

        <label htmlFor="speed" className="text-muted-foreground">
          模拟时钟倍速
        </label>
        <select
          id="speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="h-9 w-64 rounded-sm border border-input bg-background px-3 outline-none focus-visible:border-primary"
        >
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
          <option value={8}>8×</option>
        </select>

        <span className="text-muted-foreground">关键节点人工确认</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(e) => setAutoConfirm(e.target.checked)}
            className="size-4 accent-[oklch(0.545_0.185_264)]"
          />
          <span className="text-muted-foreground">定级 / 任务方案 / 通知发布 三处暂停等待确认(课堂演示推荐)</span>
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-4 max-w-xl rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={launch}
          disabled={submitting || !!activeDrill}
          className="flex h-10 items-center gap-2 rounded-sm bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {submitting ? "正在发起…" : "发起演练"}
        </button>
        <span className="text-xs text-muted-foreground">所有事件均为演练数据,不涉及真实警情</span>
      </div>
    </div>
  );
}
