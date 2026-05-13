"use client";

import { memo, type RefCallback } from "react";
import { EllipsisVertical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  formatDisplayTime,
  formatResponseSummaryLine,
  resultKindAriaLabel,
  resultKindBorderClass,
  resultKindRowClass,
  resultKindShortLabel,
  slowQueryRowAccentClass,
} from "@/lib/query-log-display";
import type { AppLocale } from "@/lib/i18n/resolve-message";
import { cn } from "@/lib/utils";

import type { LogRow } from "./log-row-model";

export type LogTableRowProps = {
  row: LogRow;
  locale: AppLocale;
  virtualIndex: number;
  measureElement: (el: Element | null) => void;
  rowHeightPx: number;
  detailAriaLabel: string;
  slowQueryLabel: string;
  slowQueryTitle: string;
  rowAriaSlowSuffix: string;
};

export const LogTableRow = memo(function LogTableRow({
  row,
  locale,
  virtualIndex,
  measureElement,
  rowHeightPx,
  detailAriaLabel,
  slowQueryLabel,
  slowQueryTitle,
  rowAriaSlowSuffix,
}: LogTableRowProps) {
  const timeStr = formatDisplayTime(row.entry.time, row.receivedAt, locale);
  const summaryLine = formatResponseSummaryLine(row.normalized);
  return (
    <tr
      ref={measureElement as RefCallback<HTMLTableRowElement>}
      data-index={virtualIndex}
      style={{ height: `${rowHeightPx}px` }}
      className={cn(
        "border-b border-border/60",
        resultKindRowClass(row.resultKind),
        resultKindBorderClass(row.resultKind),
        slowQueryRowAccentClass(row.slowQuery),
      )}
      aria-label={`${resultKindAriaLabel(row.resultKind, locale)}${row.slowQuery ? rowAriaSlowSuffix : ""}`}
    >
      <td className="whitespace-nowrap px-2 py-1.5 align-top font-mono text-[11px] text-muted-foreground">
        {timeStr}
      </td>
      <td
        className="max-w-[120px] truncate px-2 py-1.5 align-top text-muted-foreground hover:text-foreground"
        title={row.nodeName}
      >
        {row.nodeName}
        <span className="sr-only"> node id {row.nodeId}</span>
      </td>
      <td className="max-w-[220px] px-2 py-1.5 align-top">
        <div className="truncate font-medium text-foreground" title={row.normalized.requestLine}>
          {row.normalized.requestLine}
        </div>
      </td>
      <td className="max-w-[260px] px-2 py-1.5 align-top">
        <div className="truncate text-foreground" title={summaryLine}>
          {summaryLine}
        </div>
        <div className="mt-0.5 flex max-w-full flex-nowrap items-center gap-1 overflow-hidden">
          {row.resultKind !== "neutral" ? (
            <Badge
              variant="outline"
              className="max-w-[min(100%,12rem)] shrink-0 truncate whitespace-nowrap border-border/80 font-normal text-[10px] text-foreground"
              title={resultKindAriaLabel(row.resultKind, locale)}
            >
              {resultKindShortLabel(row.resultKind, locale)}
            </Badge>
          ) : null}
          {row.slowQuery ? (
            <Badge
              variant="outline"
              className="shrink-0 whitespace-nowrap border-amber-500/40 font-normal text-[10px] text-foreground"
              title={slowQueryTitle}
            >
              {slowQueryLabel}
            </Badge>
          ) : null}
        </div>
      </td>
      <td
        className="max-w-[180px] px-2 py-1.5 align-top text-left"
        title={[row.normalized.clientPrimary, row.normalized.clientSecondary].filter(Boolean).join(" · ")}
      >
        <div className="truncate text-sm font-medium text-foreground" title={row.normalized.clientPrimary}>
          {row.normalized.clientPrimary}
        </div>
        {row.normalized.clientSecondary ? (
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={row.normalized.clientSecondary}>
            {row.normalized.clientSecondary}
          </div>
        ) : null}
      </td>
      <td className="px-1 py-1 align-top text-center">
        <button
          type="button"
          data-action="detail"
          data-row-key={row.key}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={detailAriaLabel}
        >
          <EllipsisVertical className="size-4" />
        </button>
      </td>
    </tr>
  );
});

LogTableRow.displayName = "LogTableRow";
