"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FlaskConical, LibraryBig, Loader2, Play } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { DrillTag } from "@/components/status/drill-tag";
import type { DrillSummaryDTO, ScenarioCardDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { SimulationConsole } from "./simulation-console";

const INTENSITY_LABELS: Record<ScenarioCardDTO["intensity"], string> = {
  low: "轻度",
  medium: "中等",
  high: "高强度",
};

/** /simulation 两态切换(docs/design.md §4.3):空闲=场景配置与发起;有活跃演练=整页运行态控制台
 * 场景列表来自事件库(/api/scenarios,内置+自定义),支持事件库页增删后回到本页即时可选 */
export function SimulationLauncher() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<ScenarioCardDTO[] | null>(null);
  const [selected, setSelected] = useState("");
  const [seed, setSeed] = useState("");
  const [speed, setSpeed] = useState(4);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDrill, setActiveDrill] = useState<DrillSummaryDTO | null>(null);

  const refreshActive = useCallback(async () => {
    try {
      const res = await fetch("/api/drills", { cache: "no-store" });
      const data = (await res.json()) as { drill: DrillSummaryDTO | null };
      setActiveDrill(data.drill);
    } catch {
      /* 忽略,提交时兜底 */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/scenarios", { cache: "no-store" });
        const data = (await res.json()) as { scenarios: ScenarioCardDTO[] };
        if (!cancelled) setScenarios(data.scenarios);
      } catch {
        if (!cancelled) setScenarios([]);
      }
      if (!cancelled) await refreshActive();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshActive]);

  // 场景列表到达时默认选中第一项(选中项被删后同样回到首项)
  const [prevKeys, setPrevKeys] = useState("");
  const keys = scenarios?.map((s) => s.key).join(",") ?? "";
  if (keys !== prevKeys) {
    setPrevKeys(keys);
    if (scenarios && !scenarios.some((s) => s.key === selected)) {
      setSelected(scenarios[0]?.key ?? "");
    }
  }

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

  // 运行态:整页切换为控制台(场景配置与发起入口退场,终止/完成后经 onExited 回到本表单)
  if (activeDrill && scenarios) {
    return <SimulationConsole drillId={activeDrill.id} scenarios={scenarios} onExited={() => void refreshActive()} />;
  }

  if (!scenarios) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20" role="status" aria-label="加载事件库">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="flex flex-none items-center justify-between">
        <h2 className="text-sm font-bold">选择事件场景</h2>
        <Link
          href="/scenarios"
          className="flex h-8 items-center gap-1.5 rounded-sm border border-input px-3 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
        >
          <LibraryBig className="size-3.5" aria-hidden />
          管理事件库
        </Link>
      </div>

      {scenarios.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="事件库为空"
          description="还没有可选的模拟事件。到事件库管理页创建第一个自定义事件,或恢复内置场景。"
          action={
            <Link
              href="/scenarios"
              className="h-9 rounded-sm bg-primary px-4 text-sm font-medium leading-9 text-primary-foreground hover:brightness-110"
            >
              前往事件库管理
            </Link>
          }
          className="mt-4"
        />
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {scenarios.map((scenario) => {
            const active = selected === scenario.key;
            return (
              <button
                key={scenario.key}
                type="button"
                onClick={() => setSelected(scenario.key)}
                aria-pressed={active}
                className={cn(
                  "rounded-md border bg-card p-5 text-left transition-colors",
                  active ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <FlaskConical className={cn("size-5 flex-none", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <span className="truncate font-heading text-base font-bold">{scenario.name}</span>
                  <span
                    className={cn(
                      "ml-auto flex-none rounded-sm border px-1.5 py-px text-[10px]",
                      scenario.isBuiltin
                        ? "border-border text-muted-foreground"
                        : "border-[oklch(0.75_0.14_50)] text-[oklch(0.6_0.14_50)]",
                    )}
                  >
                    {scenario.isBuiltin ? "内置" : "自定义"}
                  </span>
                  {active && <DrillTag variant="canvas" />}
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{scenario.description}</p>
                <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground/80">
                  <span>地点:{scenario.location}</span>
                  <span>强度:{INTENSITY_LABELS[scenario.intensity]}</span>
                  <span className="font-mono tabular-nums">
                    信号 {scenario.signalCount} / 演变 {scenario.evolutionCount}
                  </span>
                </p>
              </button>
            );
          })}
        </div>
      )}

      {scenarios.length > 0 && (
        <>
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
              disabled={submitting}
              className="flex h-10 items-center gap-2 rounded-sm bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {submitting ? "正在发起…" : "发起演练"}
            </button>
            <span className="text-xs text-muted-foreground">所有事件均为演练数据,不涉及真实警情</span>
          </div>
        </>
      )}
    </div>
  );
}
