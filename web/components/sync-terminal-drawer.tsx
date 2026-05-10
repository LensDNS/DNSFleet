"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SyncTerminalDrawer({
  open,
  onOpenChange,
  text,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-lg [&>button]:text-foreground"
      >
        <SheetHeader className="border-b border-border pb-3">
          <SheetTitle>同步终端</SheetTitle>
        </SheetHeader>
        <ScrollArea className="mt-4 h-[calc(100vh-6rem)] rounded-md border border-border bg-zinc-950 p-3 text-xs text-zinc-100">
          <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
