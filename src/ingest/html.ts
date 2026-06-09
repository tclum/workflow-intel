// HTML/entity stripping — a TS port of bus-finance's src/news_scan.py _strip_html:
// unescape entities, drop tags, collapse whitespace. Kept pure (no I/O) so it is
// unit-testable offline.

const HTML_TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number(dec)),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => {
      const decoded = NAMED_ENTITIES[name.toLowerCase()];
      return decoded ?? match;
    });
}

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  // Order matches bus-finance (_strip_html): DECODE entities first, THEN strip
  // tags. Consequence: HTML that was entity-escaped in a feed body (e.g.
  // "&lt;p&gt;...") decodes to real markup and is then stripped — which is the
  // desired cleaning behavior for escaped-HTML descriptions.
  const decoded = decodeEntities(input);
  return decoded.replace(HTML_TAG, "").replace(WHITESPACE, " ").trim();
}
