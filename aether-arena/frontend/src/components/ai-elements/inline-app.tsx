"use client";

import { cn } from "@/lib/utils";

type InlineAppProps = {
  url: string;
  title?: string;
  className?: string;
};

export function InlineApp({ url, title, className }: InlineAppProps) {
  const isValid = url.startsWith("https://") || url.startsWith("/");

  if (!isValid) return null;

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border bg-card",
        className,
      )}
    >
      {title && (
        <div className="flex items-center border-b px-3 py-1.5">
          <span className="text-muted-foreground text-xs">{title}</span>
        </div>
      )}
      <iframe
        src={url}
        title={title ?? "Interactive panel"}
        sandbox="allow-scripts allow-forms allow-popups allow-presentation"
        className="h-80 w-full flex-1"
        loading="lazy"
      />
    </div>
  );
}
