import type { NextRequest } from "next/server";

import { auth } from "@/server/better-auth";
import { seedAuthUser } from "@/server/better-auth/seed";

// Ensure the configured user exists in this worker's memory store before
// handling any auth request (sign-in, get-session, etc.)
async function withSeed(req: NextRequest) {
  await seedAuthUser();
  return auth.handler(req);
}

export const GET = withSeed;
export const POST = withSeed;
