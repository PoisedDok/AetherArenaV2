import "@/styles/globals.css";
import "katex/dist/katex.min.css";

import { type Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/core/i18n/context";
import { detectLocaleServer } from "@/core/i18n/server";

export const metadata: Metadata = {
  title: "AetherArena v2",
  description:
    "AetherArena v2 — chat, skills, sandboxed tools, and long-running agent work.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await detectLocaleServer();
  return (
    <html lang={locale} suppressContentEditableWarning suppressHydrationWarning>
      <head>
        {/* Detect Electron on macOS before first paint — sets class used by traffic-light / drag CSS */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=window.deerflowDesktop;if(d&&d.isElectron&&d.platform==='darwin'){document.documentElement.classList.add('electron-darwin')}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
          <I18nProvider initialLocale={locale}>{children}</I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
