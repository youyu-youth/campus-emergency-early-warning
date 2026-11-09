import type { ReactNode } from "react";

/** 画布内页面头:标题 + 职责一句 + 右侧操作区 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-15 flex-none items-center justify-between gap-4 border-b border-border bg-card px-6 py-3">
      <div className="min-w-0">
        <h2 className="font-heading text-lg font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-none items-center gap-2.5">{actions}</div>}
    </div>
  );
}
