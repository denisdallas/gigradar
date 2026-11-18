import "server-only";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import type { Opportunity } from "@/lib/countries";
import { appendOpportunityEvidence } from "@/lib/repository";
import { cleanText } from "./normalization.mjs";

const MAX_BYTES = 300_000;
const REQUEST_TIMEOUT_MS = 6_000;

function isPublicIpv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  const c = parts[2];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 2 || b === 168 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

function isPublicAddress(value: string) {
  const family = isIP(value);
  if (family === 4) return isPublicIpv4(value);
  if (family !== 6) return false;
  const ip = value.toLowerCase();
  return ip !== "::" && ip !== "::1" && !ip.startsWith("fc") && !ip.startsWith("fd")
    && !/^fe[89ab]/.test(ip) && !ip.startsWith("ff") && !ip.startsWith("::ffff:");
}

async function readPublicWebsite(urlValue: string, format: "html" | "robots" = "html") {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.port || !url.hostname || isIP(url.hostname)) {
    throw new Error("Website is not an eligible public HTTPS host.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local hostnames cannot be researched.");
  }
  const addresses = await resolve4(hostname).catch(() => []);
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("Website host did not resolve only to public addresses.");
  }

  return new Promise<{ title: string | null; description: string | null; text: string }>((resolveResult, reject) => {
    const lookup: https.RequestOptions["lookup"] = (_host, options, callback) => {
      const family = typeof options === "object" && options ? options.family : 0;
      const candidates = addresses.filter((address) => !family || isIP(address) === family);
      if (!candidates.length) return callback(new Error("No public address for requested IP family."), "", 0);
      if (typeof options === "object" && options && options.all) {
        return (callback as (error: Error | null, addresses: Array<{ address: string; family: number }>) => void)(
          null,
          candidates.map((address) => ({ address, family: isIP(address) })),
        );
      }
      const address = candidates[0];
      callback(null, address, isIP(address));
    };
    const request = https.get(url, {
      headers: {
        accept: format === "robots" ? "text/plain, */*;q=0.5" : "text/html,application/xhtml+xml;q=0.9",
        "user-agent": "GigRadar/2.0 (+https://github.com/denisdallas/gigradar)",
      },
      lookup,
      servername: hostname,
      rejectUnauthorized: true,
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.destroy();
        reject(new Error("Redirects are not followed during website research."));
        return;
      }
      if (response.statusCode === 404 && format === "robots") {
        response.resume();
        resolveResult({ title: null, description: null, text: "" });
        return;
      }
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      const expectedType = format === "robots" ? contentType.includes("text/plain") : /text\/(html|xhtml\+xml)/.test(contentType);
      if (response.statusCode !== 200 || !expectedType) {
        response.destroy();
        reject(new Error("Website did not return an HTML page."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > (format === "robots" ? 100_000 : MAX_BYTES)) {
          response.destroy(new Error("Website page exceeded the 300 KB limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        if (format === "robots") {
          resolveResult({ title: null, description: null, text: html.slice(0, 100_000) });
          return;
        }
        const withoutNoise = html.replace(/<(script|style|noscript|svg|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ");
        const title = cleanText(withoutNoise.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "", 240) || null;
        const description = cleanText(withoutNoise.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)?.[1] ?? "", 400) || null;
        const text = cleanText(withoutNoise.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"), 3500);
        resolveResult({ title, description, text });
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Website research timed out.")));
    request.on("error", reject);
  });
}

function isAllowedByRobots(robots: string, target: URL) {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((name === "allow" || name === "disallow") && current && value) {
      current.rules.push({ allow: name === "allow", path: value });
    }
  }
  const path = `${target.pathname}${target.search}`;
  const specific = groups.filter((group) => group.agents.some((agent) => agent.includes("gigradar")));
  const applicable = specific.length ? specific : groups.filter((group) => group.agents.includes("*"));
  const rules = applicable.flatMap((group) => group.rules)
    .filter((rule) => {
      const escaped = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}${rule.path.endsWith("$") ? "$" : ""}`).test(path);
    })
    .sort((a, b) => b.path.replace(/[\*$]/g, "").length - a.path.replace(/[\*$]/g, "").length);
  if (!rules.length) return true;
  const longest = rules[0].path.replace(/[\*$]/g, "").length;
  return rules.filter((rule) => rule.path.replace(/[\*$]/g, "").length === longest).some((rule) => rule.allow);
}

export async function researchBusinessWebsites(opportunities: Opportunity[], limit = 12) {
  let researched = 0;
  const errors: Array<Record<string, unknown>> = [];
  for (const opportunity of opportunities.slice(0, limit)) {
    if (!opportunity.website_url) continue;
    try {
      const target = new URL(opportunity.website_url);
      const robotsUrl = new URL("/robots.txt", target.origin);
      const robots = await readPublicWebsite(robotsUrl.toString(), "robots");
      if (!isAllowedByRobots(robots.text, target)) {
        await appendOpportunityEvidence(opportunity.id, {
          source: "Business website research attempt",
          source_url: robotsUrl.toString(),
          observed_at: new Date().toISOString(),
          result: "Blocked by the website's robots.txt rules; page not fetched.",
        });
        continue;
      }
      const page = await readPublicWebsite(opportunity.website_url);
      const host = new URL(opportunity.website_url).hostname;
      await appendOpportunityEvidence(opportunity.id, {
        source: "Business website",
        source_url: opportunity.website_url,
        observed_at: new Date().toISOString(),
        page_title: page.title,
        meta_description: page.description,
        visible_text: page.text,
        note: `Fetched from ${host} over public HTTPS. Redirects and non-HTML pages are not followed.`,
      });
      researched += 1;
    } catch (error) {
      await appendOpportunityEvidence(opportunity.id, {
        source: "Business website research attempt",
        source_url: opportunity.website_url,
        observed_at: new Date().toISOString(),
        result: "Website research could not be completed.",
        detail: error instanceof Error ? error.message.slice(0, 180) : "Unknown error.",
      }).catch(() => undefined);
      errors.push({
        source: "Business website",
        opportunityId: opportunity.id,
        message: error instanceof Error ? error.message : "Unknown website research error.",
      });
    }
  }
  return { researched, attempted: Math.min(opportunities.length, limit), errors };
}

