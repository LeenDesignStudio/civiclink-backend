const OFFICE_MAILBOX =
  /^(info|contact|office|hello|council|mayor|clerk|district|senator|representative|rep|comments|media|press|webmaster)$/i;

/** Publish an email when it belongs to this person or to the office. Anything else waits for review. */
export function reviewEmail(
  email: string | null,
  fullName: string,
): { publish: string | null; review: string | null } {
  const text = email?.trim() ?? '';
  if (!text.includes('@') || text.length > 254) return { publish: null, review: null };
  const local = text.split('@')[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  const tokens = fullName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((part) => part.length >= 3);
  if (tokens.some((token) => local.includes(token))) return { publish: text, review: null };
  const rawLocal = text.split('@')[0] ?? '';
  if (OFFICE_MAILBOX.test(rawLocal)) return { publish: text, review: null };
  return { publish: null, review: text };
}

export function parsePublishedAddress(
  value: string | null,
  fallbackState: string | null,
): { street: string; city: string; state: string; zip: string } | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return null;
  const match = /^(.*)\s+([A-Za-z][A-Za-z .'-]{1,40}),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(text);
  if (match?.[1] && match[2] && match[3] && match[4]) {
    return {
      street: match[1].replace(/,\s*$/, '').slice(0, 200),
      city: match[2].trim().slice(0, 100),
      state: match[3],
      zip: match[4],
    };
  }
  const state = (fallbackState ?? '').toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(state)) return { street: text.slice(0, 200), city: 'Office', state: 'DC', zip: '00000' };
  return { street: text.slice(0, 200), city: 'Office', state, zip: '00000' };
}

export function clipPhone(value: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text) return null;
  const compact = text.replace(/[^\d+().\-\s]/g, '').trim();
  return compact.length > 0 ? compact.slice(0, 20) : null;
}

export function firstHttps(value: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text) return null;
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') {
            const found = firstHttps(item);
            if (found) return found;
          } else if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'string') {
            const found = firstHttps(item.url);
            if (found) return found;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }
  const match = /https:\/\/[^\s"',]+/.exec(text);
  const url = match?.[0];
  return url && url.length <= 2048 ? url : null;
}
