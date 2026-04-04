import { betterAuth } from "better-auth";

// Build trusted origins: always include the base URL origin, plus any extras
// from BETTER_AUTH_TRUSTED_ORIGINS (comma-separated). This ensures both the
// local/docker origin and any public reverse-proxy domain are accepted.
function buildTrustedOrigins(): string[] {
  const origins = new Set<string>();
  const base = process.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_BASE_URL;
  if (base) {
    try { origins.add(new URL(base).origin); } catch { /* ignore invalid URL */ }
  }
  const extra = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (extra) {
    extra.split(",").map((s) => s.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  return [...origins];
}

const trustedOrigins = buildTrustedOrigins();

export const auth = betterAuth({
  // No database set — better-auth uses an in-memory store automatically.
  // Data does not persist across restarts, which is fine for single-user local use.
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET,
  ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),
});

export type Session = typeof auth.$Infer.Session;
