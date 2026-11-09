import type { Metadata } from "next";

import { AppNavRail } from "@/components/shell/app-nav-rail";
import { DrillStatusBar } from "@/components/shell/drill-status-bar";
import { ShellDrillProvider } from "@/components/shell/drill-context";
import { ShellDrillPoller } from "@/components/shell/shell-drill-poller";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "校园突发事件预警平台",
    template: "%s · 校园突发事件预警平台",
  },
  description: "校园突发事件模拟预警与多智能体协同应急推演平台（模拟演练，非真实警情）",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        {/* 全局骨架:左侧导航(深藏青石墨) + 顶部演练状态条 + 浅冷灰画布(docs/design.md §2.1) */}
        <ShellDrillProvider>
          <ShellDrillPoller />
          <div className="flex min-h-screen">
            <AppNavRail />
            <div className="flex min-w-0 flex-1 flex-col">
              {/* 默认空闲;推演页/工作区经 useShellDrill 注入运行态 DrillSummary */}
              <DrillStatusBar />
              <main className="flex min-h-0 flex-1 flex-col">{children}</main>
            </div>
          </div>
        </ShellDrillProvider>
      </body>
    </html>
  );
}
