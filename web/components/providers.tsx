"use client";

import { LocaleProvider } from "@/lib/i18n/locale-context";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <LocaleProvider>
        {children}
      </LocaleProvider>
      <Toaster richColors closeButton />
    </ThemeProvider>
  );
}
