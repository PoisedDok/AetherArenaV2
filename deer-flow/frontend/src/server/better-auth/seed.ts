import { auth } from ".";

// Track per-process seed state. In Next.js production each worker runs this
// independently against its own memoryAdapter instance.
let seeded = false;

export async function seedAuthUser() {
  if (seeded) return;

  const username = process.env.APP_USERNAME ?? "admin";
  const password = process.env.APP_PASSWORD;
  // better-auth requires valid email format (Zod z.email() — needs a TLD)
  const email = username.includes("@") ? username : `${username}@local.app`;

  if (!password) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[auth] APP_PASSWORD not set — login will be disabled.");
    }
    return;
  }

  try {
    await auth.api.signUpEmail({
      body: { email, password, name: username },
    });
    console.log(`[auth] User seeded: ${username}`);
  } catch {
    // User already exists in this process's memory store — fine.
  }

  // Mark seeded regardless so we don't retry on every request
  seeded = true;
}
