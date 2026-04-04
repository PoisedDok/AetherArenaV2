import { NextResponse } from "next/server";

import { auth } from "@/server/better-auth";

// Called once on app startup (via layout or middleware) to ensure the
// configured APP_USERNAME / APP_PASSWORD user exists in the memory store.
export async function POST() {
  const username = process.env.APP_USERNAME ?? "admin";
  const password = process.env.APP_PASSWORD;

  if (!password) {
    return NextResponse.json(
      { error: "APP_PASSWORD not configured" },
      { status: 503 },
    );
  }

  try {
    await auth.api.signUpEmail({
      body: {
        email: username,
        password,
        name: username,
      },
    });
  } catch {
    // User already exists — that's fine, ignore the error
  }

  return NextResponse.json({ ok: true });
}
