/**
 * Resolve relative purchase dates using a fixed "today" (server date).
 * Never invent absolute dates without textual evidence.
 */

export function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveRelativeDate(
  text: string,
  today: Date = new Date(),
): { date: string | null; uncertain: boolean } {
  const t = text.toLowerCase();
  const base = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );

  // Absolute YYYY-MM-DD
  const abs = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (abs) {
    return { date: `${abs[1]}-${abs[2]}-${abs[3]}`, uncertain: false };
  }

  // US style M/D/YYYY or M/D/YY
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    const month = String(Number(us[1])).padStart(2, "0");
    const day = String(Number(us[2])).padStart(2, "0");
    return { date: `${year}-${month}-${day}`, uncertain: false };
  }

  if (/\btoday\b/.test(t)) {
    return { date: toIsoDate(base), uncertain: false };
  }
  if (/\byesterday\b/.test(t)) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - 1);
    return { date: toIsoDate(d), uncertain: false };
  }
  if (/\bday\s+before\s+yesterday\b/.test(t)) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - 2);
    return { date: toIsoDate(d), uncertain: true };
  }

  const daysAgo = t.match(/\b(\d{1,2})\s+days?\s+ago\b/);
  if (daysAgo) {
    const n = Number(daysAgo[1]);
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - n);
    return { date: toIsoDate(d), uncertain: n > 7 };
  }

  if (/\blast\s+week\b/.test(t)) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - 7);
    return { date: toIsoDate(d), uncertain: true };
  }

  // Month name + day, optional year
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const md = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i,
  );
  if (md) {
    const month = months[md[1]!.toLowerCase()]!;
    const day = Number(md[2]);
    const year = md[3] ? Number(md[3]) : base.getUTCFullYear();
    return {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      uncertain: !md[3],
    };
  }

  return { date: null, uncertain: false };
}
