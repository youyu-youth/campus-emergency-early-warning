"use client";

import { useEffect, useRef, useState } from "react";

import { ConfirmStamp } from "@/components/status/confirm-stamp";
import {
  NODE_META,
  simTimeLabel,
  waitedLabel,
} from "@/components/workspace/timeline-panel";
import type { TimelineNodeDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";

const HIGHLIGHT_MS = 2400;

/** 回放态时间线(docs/design.md §3.2/§4.6):只读,无自动跟随、无"当前时刻"游标;
 *  ⚑ 关键节点带确认戳与确认耗时;anchorSeq 变化时滚动定位该节点并展开+高亮(结论溯源落点) */
export function PlaybackTimeline({
  timeline,
  anchorSeq,
  onAnchored,
  className,
}: {
  timeline: TimelineNodeDTO[];
  /** 待定位的节点 seq;定位完成后经 onAnchored 归零,以便再次点击同一结论可重新触发 */
  anchorSeq: number | null;
  onAnchored: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const nodeRefs = useRef(new Map<number, HTMLLIElement>());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (anchorSeq === null) return;
    const node = timeline.find((n) => n.seq === anchorSeq);
    const el = nodeRefs.current.get(anchorSeq);
    if (!node || !el) {
      onAnchored();
      return;
    }
    // 瞬时滚动:平滑动画在部分嵌入/后台渲染环境不执行,溯源定位必须可靠
    el.scrollIntoView({ block: "center" });
    setExpanded(node.id);
    setHighlightSeq(anchorSeq);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightSeq(null), HIGHLIGHT_MS);
    onAnchored();
  }, [anchorSeq, timeline, onAnchored]);

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, []);

  return (
    <section className={cn("overflow-hidden rounded-md border border-border bg-card", className)}>
      <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs font-bold">
        时间线回放
        <span className="font-normal text-muted-foreground/70">{timeline.length} 个节点</span>
        <span className="ml-auto font-normal text-muted-foreground/70">点击节点查看决策依据</span>
      </div>
      <div className="px-4 py-3">
        <ol className="border-l border-border pl-5">
          {timeline.map((node) => {
            const meta = NODE_META[node.nodeType] ?? { dot: "bg-muted-foreground/60", label: node.nodeType };
            const isFlag = node.requiresConfirmation;
            const open = expanded === node.id;
            const highlighted = highlightSeq === node.seq;
            return (
              <li
                key={node.id}
                ref={(el) => {
                  if (el) nodeRefs.current.set(node.seq, el);
                  else nodeRefs.current.delete(node.seq);
                }}
                className={cn(
                  "relative -ml-1 rounded-sm px-1 pb-4 transition-colors last:pb-1",
                  highlighted && "bg-primary/8 ring-1 ring-primary/40",
                )}
              >
                <span
                  className={cn("absolute top-1 -left-[21px] size-2.5 rounded-full", meta.dot)}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <time className="font-mono text-xs text-muted-foreground tabular-nums">{simTimeLabel(node.simTime)}</time>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : node.id)}
                    aria-expanded={open}
                    className="text-left text-[13px] font-semibold hover:text-primary"
                  >
                    {node.title}
                  </button>
                  <span className="text-[10px] text-muted-foreground/70">{meta.label}</span>
                  {node.confirmation && <ConfirmStamp />}
                  {node.confirmation?.waitedMs !== undefined && (
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      确认耗时 {waitedLabel(node.confirmation.waitedMs)}
                    </span>
                  )}
                  {!node.confirmation && isFlag && (
                    <span className="text-[11px] text-muted-foreground">⚑ 需人工确认</span>
                  )}
                </div>
                {open && (node.reasoning || node.confirmation) && (
                  <div className="mt-1.5 rounded-sm border border-border bg-secondary/50 px-3 py-2 text-[13px] leading-relaxed">
                    {node.reasoning && (
                      <p>
                        <span className="font-semibold">决策依据:</span>
                        {node.reasoning}
                      </p>
                    )}
                    {node.confirmation?.final && (
                      <p className="mt-1 text-muted-foreground">最终等级:{node.confirmation.final}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          <li className="relative -ml-5 pl-0">
            <span className="text-[11px] font-bold text-muted-foreground">—— 演练结束 ——</span>
          </li>
        </ol>
      </div>
    </section>
  );
}
