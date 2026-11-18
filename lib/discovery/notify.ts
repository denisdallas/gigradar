import "server-only";
import { listUnnotifiedMatches, markNotified } from "@/lib/repository";

export async function sendOpportunityNotifications() {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return { sent: 0, skipped: "NTFY_TOPIC is not configured." };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) throw new Error("NTFY_TOPIC must be a simple ntfy topic name.");
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const serverUrl = new URL(server);
  if (serverUrl.protocol !== "https:") throw new Error("NTFY_SERVER must use HTTPS.");
  const threshold = Math.min(100, Math.max(0, Number(process.env.NTFY_MIN_SCORE ?? 70)));
  const matches = await listUnnotifiedMatches(threshold, 20);
  if (!matches.length) return { sent: 0 };
  const sendMatches = matches.slice(0, 8);
  const message = sendMatches.map((match) => {
    const type = match.kind === "active_gig" ? "PAID GIG" : "POTENTIAL PROSPECT";
    const place = match.country_name ? ` · ${match.country_name}` : "";
    return `${type} · ${match.match_score}/100 · ${match.title}${place}\n${match.source_url}`;
  }).join("\n\n");
  const response = await fetch(`${serverUrl.origin}/${topic}`, {
    method: "POST",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      title: "GigRadar found a new match",
      priority: "default",
      ...(process.env.NTFY_TOKEN ? { authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {}),
    },
    body: message,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}.`);
  await markNotified(sendMatches.map((match) => match.id));
  return { sent: sendMatches.length };
}

