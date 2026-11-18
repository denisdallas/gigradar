import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: isSupabaseConfigured() ? "ready" : "needs_setup",
    integrations: {
      supabase: isSupabaseConfigured(),
      groq: Boolean(process.env.GROQ_API_KEY),
      ntfy: Boolean(process.env.NTFY_TOPIC),
      scheduledDiscovery: Boolean(process.env.CRON_SECRET),
    },
  });
}

