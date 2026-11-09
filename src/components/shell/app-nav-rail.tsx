"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import {
  ClipboardList,
  FlaskConical,
  HardDrive,
  LayoutDashboard,
  Megaphone,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RadioTower,
  ShieldAlert,
  Siren,
} from "lucide-react";

import { DrillTag } from "@/components/status/drill-tag";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cewp.nav-collapsed";
const CHANGE_EVENT = "cewp-nav-collapsed-change";

/** 折叠态外部存储:localStorage 偏好优先;无偏好时按视口宽度(1024–1279 折叠) */
function useNavCollapsed(): [boolean, () => void] {
  const subscribe = useCallback((notify: () => void) => {
    const handler = () => notify();
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "1";
    return window.innerWidth < 1280;
  }, []);

  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const toggle = useCallback(() => {
    const current = window.localStorage.getItem(STORAGE_KEY);
    const effective =
      current !== null ? current === "1" : window.innerWidth < 1280;
    window.localStorage.setItem(STORAGE_KEY, effective ? "0" : "1");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [collapsed, toggle];
}

const NAV_GROUPS = [
  {
    label: "态势",
    items: [
      { href: "/", label: "综合指挥台", icon: LayoutDashboard },
      { href: "/monitoring", label: "事件监测中心", icon: RadioTower },
    ],
  },
  {
    label: "推演",
    items: [
      { href: "/simulation", label: "事件模拟推演", icon: FlaskConical },
      { href: "/command", label: "事件详情工作区", icon: Siren },
      { href: "/agents", label: "智能体协作调度", icon: Network },
      { href: "/notifications", label: "通知发布中心", icon: Megaphone },
    ],
  },
  {
    label: "复盘",
    items: [{ href: "/reports", label: "事件复盘报告", icon: ClipboardList }],
  },
] as const;

/** 左侧导航栏:深藏青石墨骨架,220px 可折叠为 64px 图标栏(docs/design.md §2.1) */
export function AppNavRail() {
  const pathname = usePathname();
  const [collapsed, toggleCollapsed] = useNavCollapsed();

  return (
    <nav
      aria-label="主导航"
      className={cn(
        "flex h-screen flex-none flex-col bg-shell text-shell-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-55",
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-shell-border px-4 py-4">
        <ShieldAlert className="size-5 flex-none text-shell-accent-bright" aria-hidden />
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="font-heading text-[15px] leading-snug font-bold tracking-wide">校园突发事件预警平台</h1>
            <DrillTag variant="shell" className="mt-1.5" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-4" {...(collapsed ? { "aria-label": "导航已折叠" } : {})}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            {!collapsed && (
              <p className="px-4 pb-1.5 text-[10px] tracking-[0.3em] text-shell-muted">{group.label}</p>
            )}
            {collapsed && <div className="mx-3 mb-3 h-px bg-shell-foreground/15" aria-hidden />}
            <ul>
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-2.5 text-[13px] transition-colors",
                        collapsed ? "justify-center px-0" : "px-4",
                        active
                          ? "bg-shell-accent-soft font-semibold text-white"
                          : "text-shell-foreground/70 hover:bg-shell-accent-soft/60 hover:text-shell-foreground",
                      )}
                    >
                      <Icon className={cn("size-4 flex-none", active && "text-shell-accent-bright")} aria-hidden />
                      {!collapsed && item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-shell-border px-4 pt-3 pb-4">
        <div
          className={cn(
            "flex items-center gap-2 text-[10px] tracking-widest text-shell-muted",
            collapsed && "justify-center px-0",
          )}
          title={collapsed ? "本地单机模式" : undefined}
        >
          <HardDrive className="size-3.5 flex-none" aria-hidden />
          {!collapsed && "本地单机模式"}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "展开导航栏" : "折叠导航栏"}
          aria-expanded={!collapsed}
          className={cn(
            "mt-3 flex h-8 items-center gap-2 rounded-sm border border-shell-border text-xs text-shell-foreground/80 transition-colors hover:border-shell-accent-bright hover:text-shell-foreground",
            collapsed ? "w-full justify-center px-0" : "w-full px-3",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="size-4" aria-hidden />
              折叠导航
            </>
          )}
        </button>
      </div>
    </nav>
  );
}
