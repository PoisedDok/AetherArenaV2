import { useMemo } from "react";

export function Footer() {
  const year = useMemo(() => new Date().getFullYear(), []);
  return (
    <footer className="container-md mx-auto mt-32 flex flex-col items-center justify-center">
      <hr className="from-border/0 to-border/0 m-0 h-px w-full border-none bg-linear-to-r via-white/20" />
      <div className="text-muted-foreground container mb-8 flex flex-col items-center justify-center gap-1 py-8 text-xs">
        <p className="font-medium text-foreground/60">AetherArena</p>
        <p>Your private, personalised AI — running on your terms.</p>
        <p className="mt-2">&copy; {year} · MIT License</p>
      </div>
    </footer>
  );
}
