"use client";

import { Loader2Icon, LockIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { authClient } from "@/server/better-auth/client";
import type { AetherArenaDesktopBridge } from "@/types/aether-arena-desktop";

const CREDENTIAL_KEY = "aether_arena_credentials";

interface StoredCredentials {
  username: string;
  rememberMe: boolean; // flag only — no password stored
}

/**
 * Electron safeStorage helpers — fall back to plain localStorage when not in
 * the desktop app (browser dev, CI, etc).
 * Detected lazily so `window.aetherArenaDesktop` (set by preload) is available.
 */
function getBridge(): AetherArenaDesktopBridge | undefined {
  return typeof window !== "undefined"
    ? window.aetherArenaDesktop
    : undefined;
}

async function encryptValue(value: string): Promise<string> {
  const bridge = getBridge();
  if (bridge?.safeStorage) {
    return bridge.safeStorage.encrypt(value);
  }
  // Fallback: btoa is not encryption but obscures the plaintext enough to
  // signal intent. In a browser this never leaves the machine anyway.
  return `plaintext:${btoa(unescape(encodeURIComponent(value)))}`;
}

async function decryptValue(encoded: string): Promise<string | null> {
  if (!encoded) return null;
  const bridge = getBridge();
  if (bridge?.safeStorage) {
    try {
      return await bridge.safeStorage.decrypt(encoded);
    } catch {
      return null; // decryption may fail on keychain changes
    }
  }
  // Fallback path
  if (encoded.startsWith("plaintext:")) {
    try {
      return decodeURIComponent(escape(atob(encoded.slice(10))));
    } catch {
      return null;
    }
  }
  return null;
}

async function loadCredentials(): Promise<StoredCredentials | null> {
  const raw = localStorage.getItem(CREDENTIAL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { encrypted?: string; rememberMe?: boolean };
    if (!parsed.encrypted) return null;
    const username = await decryptValue(parsed.encrypted);
    if (!username) return null;
    const rememberFlag = parsed.rememberMe ?? true;
    return { username, rememberMe: Boolean(rememberFlag) };
  } catch {
    return null;
  }
}

async function saveCredentials(
  username: string,
  rememberMe: boolean,
): Promise<void> {
  if (rememberMe) {
    const encrypted = await encryptValue(username);
    localStorage.setItem(
      CREDENTIAL_KEY,
      JSON.stringify({ encrypted, rememberMe: true }),
    );
  } else {
    localStorage.removeItem(CREDENTIAL_KEY);
  }
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/workspace";

  const [ username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadCredentials().then((creds) => {
      if (creds) {
        setUsername(creds.username);
        setRememberMe(creds.rememberMe);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // better-auth requires valid email (Zod z.email() needs a TLD); username@local.app is the internal convention
    const email = username.includes("@")
      ? username
      : `${username}@local.app`;

    await saveCredentials(username, rememberMe);

    const { error: authError } = await authClient.signIn.email({
      email,
      password,
      rememberMe,
    });

    if (authError) {
      setError("Invalid username or password.");
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl border border-border/40 bg-primary/10">
            <LockIcon className="size-5 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold">AetherArena</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Sign in to continue
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="username"
              className="text-xs font-medium text-muted-foreground"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="text-xs font-medium text-muted-foreground"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(v) => setRememberMe(!!v)}
            />
            <label
              htmlFor="remember"
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Remember me
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
