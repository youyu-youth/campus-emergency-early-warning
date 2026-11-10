"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/** 危险操作二次确认(docs/design.md §6.3):终止/重置等不可逆动作的前置闸门。
 *  onConfirm 抛错时停留在卡片上显示错误,正常返回后自动关闭。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const headingId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // 重开时清掉上一轮的提交/错误状态,焦点落在取消钮上(危险动作不应回车直达)
    queueMicrotask(() => {
      setError(null);
      setSubmitting(false);
      cancelRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败,请重试");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[oklch(0.23_0.05_264/0.55)] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md border border-border bg-card p-5">
        <h3 id={headingId} className="text-sm font-bold text-foreground">
          {title}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-sm border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            ref={cancelRef}
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-9 rounded-sm border border-input bg-background px-4 text-sm transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void confirm()}
            className="flex h-9 items-center gap-2 rounded-sm bg-destructive px-4 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
