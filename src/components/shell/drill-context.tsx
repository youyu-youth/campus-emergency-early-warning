"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { DrillSummary } from "./drill-status-bar";

const ShellDrillContext = createContext<{
  drill: DrillSummary | null;
  setDrill: (drill: DrillSummary | null) => void;
  /** 暂停/恢复切换(经 /api/drills 控制端点;由轮询组件注入) */
  pauseResume: (() => Promise<void>) | null;
  setPauseResume: (fn: (() => Promise<void>) | null) => void;
}>({
  drill: null,
  setDrill: () => {},
  pauseResume: null,
  setPauseResume: () => {},
});

/** 壳层演练状态通道:页面(client)经 useShellDrill 更新状态条,layout 默认空闲 */
export function ShellDrillProvider({ children }: { children: ReactNode }) {
  const [drill, setDrillState] = useState<DrillSummary | null>(null);
  const [pauseResume, setPauseResume] = useState<(() => Promise<void>) | null>(null);
  const setDrill = useCallback((next: DrillSummary | null) => setDrillState(next), []);
  const value = useMemo(
    () => ({ drill, setDrill, pauseResume, setPauseResume }),
    [drill, setDrill, pauseResume],
  );
  return <ShellDrillContext.Provider value={value}>{children}</ShellDrillContext.Provider>;
}

/** 页面侧读写当前演练摘要;推演页/工作区在数据接入时调用 */
export function useShellDrill() {
  return useContext(ShellDrillContext);
}
