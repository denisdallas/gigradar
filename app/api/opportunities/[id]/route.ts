import { NextResponse } from "next/server";
import { z } from "zod";
import { updateOpportunityStatus } from "@/lib/repository";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.object({ status: z.enum(["new", "saved", "applied", "ignored"]) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid opportunity ID." }, { status: 400 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Status must be new, saved, applied, or ignored." }, { status: 400 });
  try {
    const opportunity = await updateOpportunityStatus(id, parsed.data.status);
    return NextResponse.json({ opportunity });
  } catch {
    return NextResponse.json({ error: "Could not update this opportunity." }, { status: 404 });
  }
}

