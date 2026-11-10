"use client";

// 事件库管理(docs/design.md 事件库):左侧场景列表 + 右侧编辑表单
// 内置场景锁定只读(可复制为新事件);自定义场景增删改;删除=软删(历史演练名保留)

import { useCallback, useEffect, useState } from "react";
import { Copy, FlaskConical, Loader2, Lock, Plus, Save, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import type { ScenarioDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { INTENSITY_LABELS } from "./scenario-meta";
import {
  draftFromScenario,
  draftToBody,
  emptyDraft,
  ScenarioForm,
  validateDraft,
  type ScenarioFormDraft,
} from "./scenario-form";

/** 新建草稿的伪选中键 */
const NEW_KEY = "__new__";

export function ScenariosConsole({ className }: { className?: string }) {
  const [scenarios, setScenarios] = useState<ScenarioDTO[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScenarioFormDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTip, setSavedTip] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScenarioDTO | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  const load = useCallback(async (selectKey?: string) => {
    try {
      const res = await fetch("/api/scenarios", { cache: "no-store" });
      const data = (await res.json()) as { scenarios: ScenarioDTO[] };
      setScenarios(data.scenarios);
      if (selectKey) {
        setSelectedKey(selectKey);
        const found = data.scenarios.find((s) => s.key === selectKey);
        if (found) {
          setDraft(draftFromScenario(found));
          setDirty(false);
        }
      }
    } catch {
      setError("事件库加载失败,请刷新重试");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const selected = scenarios?.find((s) => s.key === selectedKey) ?? null;
  const isBuiltin = selected?.isBuiltin ?? false;
  const editingNew = selectedKey === NEW_KEY;

  /** 实际执行切换(选中项表单载入) */
  const doSelect = (key: string) => {
    setSelectedKey(key);
    const found = scenarios?.find((s) => s.key === key);
    setDraft(found ? draftFromScenario(found) : key === NEW_KEY ? emptyDraft() : null);
    setError(null);
    setSavedTip(null);
  };

  const selectScenario = (key: string) => {
    if (dirty) {
      setPendingSelect(key);
      setDiscardOpen(true);
      return;
    }
    doSelect(key);
  };

  const startNew = () => {
    if (dirty) {
      setPendingSelect(NEW_KEY);
      setDiscardOpen(true);
      return;
    }
    doSelect(NEW_KEY);
    setDirty(false);
  };

  /** 内置/自定义均可复制:预填草稿为新建(名称加「副本」后缀) */
  const startCopy = () => {
    if (!draft || !selected) return;
    setSelectedKey(NEW_KEY);
    setDraft({ ...draft, name: `${draft.name}副本` });
    setDirty(true);
    setError(null);
    setSavedTip(null);
  };

  const save = async () => {
    if (!draft) return;
    const invalid = validateDraft(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = draftToBody(draft);
      const res = editingNew
        ? await fetch("/api/scenarios", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/scenarios/${selectedKey}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = (await res.json()) as { scenario?: ScenarioDTO; error?: string };
      if (!res.ok || !data.scenario) {
        setError(data.error ?? `保存失败(${res.status})`);
        return;
      }
      await load(data.scenario.key);
      setSavedTip("已保存");
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误,请重试");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/scenarios/${deleteTarget.key}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `删除失败(${res.status})`);
    setDeleteTarget(null);
    await load();
    if (selectedKey === deleteTarget.key) {
      setSelectedKey(null);
      setDraft(null);
      setDirty(false);
    }
  };

  if (!scenarios) {
    return (
      <div className={cn("flex flex-1 items-center justify-center px-6 py-20", className)} role="status" aria-label="加载事件库">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 gap-4 px-6 py-6", className)}>
      {/* 左:场景列表 */}
      <section aria-label="场景列表" className="flex w-64 flex-none flex-col overflow-hidden rounded-md border border-border bg-card">
        <div className="flex h-9 flex-none items-center justify-between border-b border-border px-3 text-xs font-bold">
          事件库
          <span className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
            {scenarios.filter((s) => !s.isBuiltin).length} 个自定义
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul>
            {scenarios.map((scenario) => {
              const active = selectedKey === scenario.key;
              return (
                <li key={scenario.key} className="border-b border-border/60 last:border-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectScenario(scenario.key)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50",
                      active && "bg-primary/10",
                    )}
                  >
                    <FlaskConical className={cn("mt-0.5 size-4 flex-none", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{scenario.name}</span>
                        {scenario.isBuiltin && <Lock className="size-3 flex-none text-muted-foreground/60" aria-label="内置锁定" />}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {INTENSITY_LABELS[scenario.intensity]} · 信号 {scenario.signals.length} · 演变 {scenario.evolution.length}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex-none border-t border-border p-2.5">
          <button
            type="button"
            onClick={startNew}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm bg-primary text-xs font-medium text-primary-foreground transition-colors hover:brightness-110"
          >
            <Plus className="size-3.5" aria-hidden />
            新建事件
          </button>
        </div>
      </section>

      {/* 右:编辑表单 */}
      <section
        aria-label="场景编辑"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card"
      >
        {!draft ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <FlaskConical className="size-8 text-muted-foreground/40" aria-hidden />
            <p className="text-sm text-muted-foreground">选择左侧事件查看模板,或新建一个自定义模拟事件</p>
            <p className="text-xs text-muted-foreground/70">内置事件锁定不可改;复制为新事件后可自由编辑信号与演变</p>
          </div>
        ) : (
          <>
            <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3">
              <h2 className="font-heading text-base font-bold">{editingNew ? "新建事件" : draft.name}</h2>
              {isBuiltin && !editingNew && (
                <span className="flex items-center gap-1 rounded-sm border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                  <Lock className="size-2.5" aria-hidden />
                  内置锁定 · 只读
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {savedTip && <span className="text-[11px] text-[oklch(0.55_0.15_150)]">{savedTip}</span>}
                <button
                  type="button"
                  onClick={startCopy}
                  className="flex h-8 items-center gap-1.5 rounded-sm border border-input px-3 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
                >
                  <Copy className="size-3.5" aria-hidden />
                  复制为新事件
                </button>
                {!isBuiltin || editingNew ? (
                  <>
                    {!editingNew && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(selected)}
                        className="flex h-8 items-center gap-1.5 rounded-sm border border-destructive/40 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        删除
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={saving || !dirty}
                      className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                      {saving ? "保存中…" : "保存"}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {error && (
              <p role="alert" className="flex-none border-b border-border bg-destructive/5 px-5 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <ScenarioForm draft={draft} readOnly={isBuiltin && !editingNew} onChange={(next) => { setDraft(next); setDirty(true); setSavedTip(null); }} />
          </>
        )}
      </section>

      {/* 删除确认(软删;有活跃演练引用时服务端拒绝并显示原因) */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除事件「${deleteTarget?.name ?? ""}」`}
        description="删除后该事件不再出现在发起页可选列表;历史演练记录与场景名展示不受影响。"
        confirmLabel="确认删除"
        onConfirm={doDelete}
        onClose={() => setDeleteTarget(null)}
      />
      {/* 切换前丢弃未保存草稿确认(确认后继续执行原本的切换) */}
      <ConfirmDialog
        open={discardOpen}
        title="放弃未保存的修改?"
        description="当前表单有未保存的修改,切换后将丢失。"
        confirmLabel="放弃修改"
        onConfirm={async () => {
          setDiscardOpen(false);
          setDirty(false);
          const next = pendingSelect;
          setPendingSelect(null);
          if (next !== null) doSelect(next);
        }}
        onClose={() => {
          setDiscardOpen(false);
          setPendingSelect(null);
        }}
      />
    </div>
  );
}
