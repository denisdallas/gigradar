import { NextResponse } from "next/server";
import { COUNTRIES, type OpportunityStatus } from "@/lib/countries";
import { listOpportunities } from "@/lib/repository";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses: OpportunityStatus[] = ["new", "saved", "applied", "ignored"];

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  if (kind && kind !== "active_gig" && kind !== "business_prospect") {
    return NextResponse.json({ error: "Unknown opportunity type." }, { status: 400 });
  }
  const country = query.get("country")?.toUpperCase();
  if (country && !COUNTRIES.some((entry) => entry.code === country)) {
    return NextResponse.json({ error: "Unknown target market." }, { status: 400 });
  }
  const requestedStatus = query.get("status");
  if (requestedStatus && !statuses.includes(requestedStatus as OpportunityStatus)) {
    return NextResponse.json({ error: "Unknown opportunity status." }, { status: 400 });
  }
  try {
    const opportunities = await listOpportunities({
      kind: kind as "active_gig" | "business_prospect" | undefined,
      country,
      status: requestedStatus as OpportunityStatus | undefined,
      limit: Number(query.get("limit") ?? 60),
    });
    return NextResponse.json({ opportunities });
  } catch {
    return NextResponse.json({ error: "Could not load opportunities. Check the database setup." }, { status: 503 });
  }
}

