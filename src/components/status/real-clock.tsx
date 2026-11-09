"use client";

import { useEffect, useState } from "react";

/** 真实系统时钟:与模拟时钟并列展示并注明来源(docs/design.md §7) */
export function RealClock({ className }: { className?: string }) {
  const [label, setLabel] = useState("--:--:--");

  useEffect(() => {
    const update = () => setLabel(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time aria-label={`真实时间 ${label}`} className={className}>
      {label}
    </time>
  );
}
