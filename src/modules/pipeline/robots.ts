interface Rule {
  allow: boolean;
  path: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export function robotsDisallows(robotsTxt: string, path: string, agent = 'civiclinkbot'): boolean {
  const groups = parseGroups(robotsTxt);
  const specific = groups.filter((group) => group.agents.some((name) => name !== '*' && agent.includes(name)));
  const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes('*'));
  let winner: { allow: boolean; length: number } | undefined;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (!path.startsWith(rule.path)) continue;
      if (!winner || rule.path.length > winner.length || (rule.path.length === winner.length && rule.allow)) {
        winner = { allow: rule.allow, length: rule.path.length };
      }
    }
  }
  return winner ? !winner.allow : false;
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group = { agents: [], rules: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (!line) {
      if (current.agents.length > 0 || current.rules.length > 0) groups.push(current);
      current = { agents: [], rules: [] };
      continue;
    }
    const split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === 'user-agent') current.agents.push(value.toLowerCase());
    if (key === 'disallow' && value) current.rules.push({ allow: false, path: value });
    if (key === 'allow' && value) current.rules.push({ allow: true, path: value });
  }
  if (current.agents.length > 0 || current.rules.length > 0) groups.push(current);
  return groups;
}
