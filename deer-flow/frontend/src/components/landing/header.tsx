import Link from "next/link";

export function Header() {
  return (
    <header className="container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center px-4 backdrop-blur-xs">
      <Link href="/workspace" className="font-serif text-xl">
        Workspace
      </Link>
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}
