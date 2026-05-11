"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocale } from "@/lib/i18n/locale-context";

export function SyncTerminalDrawer({
  open,
  onOpenChange,
  text,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
}) {
  const { t } = useLocale();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-lg [&>button]:text-foreground"
      >
        <SheetHeader className="border-b border-border pb-3">
          <SheetTitle>{t("fleet.syncTerminal.title")}</SheetTitle>
        </SheetHeader>
        <ScrollArea className="mt-4 h-[calc(100vh-6rem)] rounded-md border border-border bg-muted p-3 text-xs text-foreground">
          <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
