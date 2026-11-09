import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 空态:图标 + 标题 + 行动指引(docs/design.md §5 通用反馈),配足够的呼吸空间 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-20 text-center", className)}>
      {Icon && (
        <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-secondary">
          <Icon className="size-6 text-muted-foreground" aria-hidden />
        </div>
      )}
      <h3 className="font-heading text-base font-bold">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-pretty text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}
