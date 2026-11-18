import "server-only";
import { cleanText } from "./normalization.mjs";

const SEARCH_TERMS = [
  "freelance developer",
  "contract developer",
  "looking for a developer",
  "web developer project",
  "mobile app developer",
  "cybersecurity consultant",
  "data analyst contract",
];

type HnHit = {
  objectID?: string;
  created_at?: string;
  title?: string | null;
  story_title?: string | null;
  story_url?: string | null;
  url?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  author?: string | null;
  _tags?: string[];
};

export async function discoverHackerNewsGigs(now = new Date()) {
  const since = Math.floor((now.getTime() - 14 * 24 * 60 * 60 * 1000) / 1000);
  const byId = new Map<string, Record<string, unknown>>();
  const errors: Array<Record<string, unknown>> = [];

  // Keep requests sequential and use the public HN Search API rather than scraping pages.
  for (const searchTerm of SEARCH_TERMS) {
    const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
    url.searchParams.set("query", searchTerm);
    url.searchParams.set("tags", "(story,comment)");
    url.searchParams.set("numericFilters", `created_at_i>${since}`);
    url.searchParams.set("hitsPerPage", "60");

    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "GigRadar/2.0 (+https://github.com/denisdallas/gigradar)" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Hacker News Search returned HTTP ${response.status}.`);
      const payload = await response.json() as { hits?: HnHit[] };
      for (const hit of payload.hits ?? []) {
        const id = String(hit.objectID ?? "");
        if (!/^\d+$/.test(id) || byId.has(id)) continue;
        const title = cleanText(hit.title ?? hit.story_title ?? "", 300);
        const postText = cleanText(hit.comment_text ?? hit.story_text ?? "", 2400);
        if ((!title && postText.length < 60) || postText.length < 30) continue;
        const sourceUrl = `https://news.ycombinator.com/item?id=${id}`;
        const publishedAt = hit.created_at ? new Date(hit.created_at).toISOString() : null;
        byId.set(id, {
          kind: "active_gig",
          country_code: null,
          country_name: null,
          title: title || `Hacker News discussion by ${cleanText(hit.author ?? "member", 80)}`,
          organization: null,
          summary: postText,
          category: "Technical project request",
          website_url: null,
          source_name: "Hacker News",
          source_key: id,
          source_url: sourceUrl,
          source_published_at: publishedAt,
          evidence: [{
            source: "Hacker News",
            source_url: sourceUrl,
            parent_title: cleanText(hit.story_title ?? "", 300) || null,
            parent_url: hit.story_url ?? hit.url ?? null,
            author: cleanText(hit.author ?? "", 80) || null,
            text: postText,
            search_term: searchTerm,
            tags: hit._tags ?? [],
          }],
          status: "new",
          assessment_status: "pending",
        });
      }
    } catch (error) {
      errors.push({
        source: "Hacker News",
        searchTerm,
        message: error instanceof Error ? error.message : "Unknown Hacker News Search error.",
      });
    }
  }

  return { records: Array.from(byId.values()), errors, queries: SEARCH_TERMS.length };
}

