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
  const [pauseResume, setPauseResumeState] = useState<(() => Promise<void>) | null>(null);
  // useState 的 setter 会把函数参数当更新器调用:直接传 togglePause(async)会存进其返回的 Promise,
  // 进而以 object 落到暂停按钮的 onClick 上导致状态条渲染崩溃——必须用 () => fn 装箱存值
  const setPauseResume = useCallback((fn: (() => Promise<void>) | null) => {
    if (fn !== null && typeof fn !== "function") {
      console.warn("setPauseResume 收到非函数,已忽略:", typeof fn);
      setPauseResumeState(null);
      return;
    }
    setPauseResumeState(() => fn);
  }, []);
  const setDrill = useCallback((next: DrillSummary | null) => setDrillState(next), []);
  const value = useMemo(
    () => ({ drill, setDrill, pauseResume, setPauseResume }),
    [drill, setDrill, pauseResume, setPauseResume],
  );
  return <ShellDrillContext.Provider value={value}>{children}</ShellDrillContext.Provider>;
}

/** 页面侧读写当前演练摘要;推演页/工作区在数据接入时调用 */
export function useShellDrill() {
  return useContext(ShellDrillContext);
}
