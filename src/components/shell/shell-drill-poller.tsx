"use client";

import { useEffect } from "react";

import { useShellDrill } from "./drill-context";
import type { DrillSummary } from "./drill-status-bar";

const POLL_INTERVAL_MS = 1500;

/**
 * 壳层演练轮询:每拍拉取活跃演练摘要注入状态条,并提供暂停/恢复控制。
 * 断线容忍:请求失败静默重试(不清空已有内容,配合「数据可能滞后」横幅由各页自行提示)。
 */
export function ShellDrillPoller() {
  const { setDrill, setPauseResume } = useShellDrill();

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/drills", { cache: "no-store" });
        const data = (await res.json()) as { drill: DrillSummary | null };
        if (!cancelled) setDrill(data.drill ?? null);
      } catch {
        // 断线:保留上一拍内容,等待下一拍
      }
    };

    const togglePause = async () => {
      const res = await fetch("/api/drills", { cache: "no-store" });
      const data = (await res.json()) as { drill: DrillSummary | null };
      const current = data.drill;
      if (!current) return;
      await fetch(`/api/drills/${current.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: current.status === "paused" ? "resume" : "pause" }),
      });
      await poll();
    };

    queueMicrotask(() => void poll());
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    setPauseResume(togglePause);
    return () => {
      cancelled = true;
      clearInterval(timer);
      // 归零让任何 HMR/重挂载周期重注干净函数,自愈历史残留的脏状态
      setPauseResume(null);
    };
  }, [setDrill, setPauseResume]);

  return null;
}
