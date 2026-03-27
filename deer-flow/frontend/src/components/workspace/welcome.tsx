"use client";

import { useMemo, useState, useEffect } from "react";

import { useResolvedDisplayName } from "@/core/settings";
import { cn } from "@/lib/utils";

function useCurrentHour(): number {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const interval = setInterval(() => setHour(new Date().getHours()), 60000);
    return () => clearInterval(interval);
  }, []);
  return hour;
}

function getGreeting(hour: number, name: string): string {
  const timeGreeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${timeGreeting}, ${name}` : `${timeGreeting}!`;
}

export function Welcome({
  className,
}: {
  className?: string;
}) {
  const displayName = useResolvedDisplayName();
  const hour = useCurrentHour();
  const greetingText = useMemo(
    () => getGreeting(hour, displayName),
    [hour, displayName],
  );

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center px-8 py-4 text-center",
        className,
      )}
    >
      <h1 className="text-xl font-semibold">{greetingText}</h1>
    </div>
  );
}
