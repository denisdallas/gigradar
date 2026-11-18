export function htmlToText(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number(code);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWebsite(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  const candidate = value.trim();
  if (!candidate || /^(mailto:|tel:|javascript:|data:)/i.test(candidate)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".local")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanText(value, maxLength = 1200) {
  const cleaned = htmlToText(value ?? "");
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trim()}…` : cleaned;
}

export function classifyOsmCategory(tags = {}) {
  const mapping = [
    ["tourism", "Hospitality and tourism"],
    ["healthcare", "Healthcare"],
    ["amenity", "Food, education, or local services"],
    ["office", "Professional services"],
    ["craft", "Local services and trades"],
    ["shop", "Retail"],
  ];
  for (const [key, category] of mapping) {
    if (tags[key]) return category;
  }
  return "Local business";
}

export function normalizeOsmBusiness(element, country) {
  const tags = element?.tags ?? {};
  const name = cleanText(tags.name, 180);
  if (!name) return null;
  const type = String(element.type ?? "");
  const osmId = String(element.id ?? "");
  if (!/^(node|way|relation)$/.test(type) || !/^\d+$/.test(osmId)) return null;

  const websiteUrl = normalizeWebsite(tags.website ?? tags["contact:website"]);
  const city = cleanText(tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"], 100);
  const address = [
    cleanText(tags["addr:street"], 100),
    cleanText(tags["addr:housenumber"], 20),
    city,
    cleanText(tags["addr:postcode"], 20),
  ].filter(Boolean).join(", ");
  const category = classifyOsmCategory(tags);
  const coordinates = element.center ?? element;
  const sourceKey = `${type}/${osmId}`;
  const sourceUrl = `https://www.openstreetmap.org/${type}/${osmId}`;
  const details = [category, city, address].filter(Boolean).join(" · ");
  const evidence = [{
    source: "OpenStreetMap",
    source_url: sourceUrl,
    observed_name: name,
    observed_category: category,
    website_listed_in_source: Boolean(websiteUrl),
    website_url: websiteUrl,
    address: address || null,
    coordinates: Number.isFinite(coordinates?.lat) && Number.isFinite(coordinates?.lon)
      ? { latitude: coordinates.lat, longitude: coordinates.lon }
      : null,
    tags: Object.fromEntries(Object.entries(tags).filter(([key]) =>
      ["shop", "office", "craft", "tourism", "amenity", "healthcare", "website", "contact:website", "name"].includes(key),
    )),
  }];

  return {
    kind: "business_prospect",
    country_code: country.code,
    country_name: country.name,
    title: name,
    organization: name,
    summary: details || "Public business listing; technical need not yet verified.",
    category,
    website_url: websiteUrl,
    source_name: "OpenStreetMap",
    source_key: sourceKey,
    source_url: sourceUrl,
    source_published_at: null,
    evidence,
  };
}

export function opportunityDedupeKey(sourceName, sourceKey) {
  return `${String(sourceName).toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${String(sourceKey)}`;
}

