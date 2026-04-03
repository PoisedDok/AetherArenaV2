"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  const pathname = usePathname();
  const isDark = pathname === "/" || pathname.startsWith("/workspace");
  return (
    <NextThemesProvider
      {...props}
      forcedTheme={isDark ? "dark" : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
