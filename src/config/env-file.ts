/** Quote a value so a later process restart can read it from `.env`. */
export function formatEnvAssignment(key: string, value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  return `${key}="${escaped}"`;
}

/** Replace listed keys and keep every other line, including comments. */
export function upsertEnvLines(contents: string, updates: Record<string, string>): string {
  const lines = contents.length > 0 ? contents.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (!key || !(key in updates)) return line;
    seen.add(key);
    return formatEnvAssignment(key, updates[key] ?? '');
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(formatEnvAssignment(key, value));
  }
  while (next.length > 0 && next[next.length - 1] === '') next.pop();
  return `${next.join('\n')}\n`;
}
