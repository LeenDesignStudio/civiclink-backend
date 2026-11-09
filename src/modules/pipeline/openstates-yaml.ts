export interface PersonRole {
  type: string | null;
  district: string | null;
  start: string | null;
  end: string | null;
}

export interface PersonFile {
  id: string;
  roles: PersonRole[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function unquote(value: string): string {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function assign(role: PersonRole, key: string, raw: string): void {
  const value = unquote(raw);
  if (key === 'type') role.type = value || null;
  if (key === 'district') role.district = value || null;
  if (key === 'start_date') role.start = ISO_DATE.test(value) ? value : null;
  if (key === 'end_date') role.end = ISO_DATE.test(value) ? value : null;
}

/** Reads one Open States person file. Dates that are not YYYY-MM-DD are left null. */
export function parsePersonYaml(text: string): PersonFile | null {
  let id: string | null = null;
  let inRoles = false;
  let role: PersonRole | null = null;
  const roles: PersonRole[] = [];
  const flush = () => {
    if (role) roles.push(role);
    role = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!raw.startsWith(' ') && !raw.startsWith('\t') && !raw.startsWith('-')) {
      flush();
      inRoles = false;
      const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(raw.trim());
      const topKey = top?.[1];
      if (!top || !topKey) continue;
      if (topKey === 'id') id = unquote(top[2] ?? '');
      if (topKey === 'roles') inRoles = true;
      continue;
    }
    if (!inRoles) continue;
    const item = /^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    const itemKey = item?.[1];
    if (item && itemKey) {
      flush();
      role = { type: null, district: null, start: null, end: null };
      assign(role, itemKey, item[2] ?? '');
      continue;
    }
    const field = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    const fieldKey = field?.[1];
    if (field && fieldKey && role) assign(role, fieldKey, field[2] ?? '');
  }
  flush();
  if (!id) return null;
  return { id, roles };
}

function districtKey(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim().toUpperCase();
  if (/^AT-?LARGE$/.test(text)) return '0';
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}

export function rolesForSeat(
  person: PersonFile | undefined,
  chamber: string | null,
  district: string | null,
): { current: PersonRole | null; earlier: PersonRole[] } {
  if (!person || !chamber) return { current: null, earlier: [] };
  const wantDistrict = districtKey(district);
  const matched = person.roles.filter((role) => {
    if (!role.start) return false;
    if ((role.type ?? '').toLowerCase() !== chamber.toLowerCase()) return false;
    return districtKey(role.district) === wantDistrict;
  });
  matched.sort((left, right) => (left.start ?? '').localeCompare(right.start ?? ''));
  const current = matched[matched.length - 1] ?? null;
  return { current, earlier: current ? matched.slice(0, -1) : [] };
}

export interface PeopleEnvelope {
  csv: string;
  people: PersonFile[];
}

export function encodePeopleEnvelope(csv: string, people: PersonFile[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ csv, people }));
}

export function readPeopleEnvelope(body: Uint8Array): PeopleEnvelope {
  const text = new TextDecoder().decode(body);
  if (!text.trimStart().startsWith('{')) return { csv: text, people: [] };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !('csv' in parsed)) return { csv: text, people: [] };
    const row = parsed as { csv?: unknown; people?: unknown };
    if (typeof row.csv !== 'string' || !Array.isArray(row.people)) return { csv: text, people: [] };
    const people: PersonFile[] = [];
    for (const item of row.people) {
      if (!item || typeof item !== 'object') continue;
      const person = item as { id?: unknown; roles?: unknown };
      if (typeof person.id !== 'string' || !Array.isArray(person.roles)) continue;
      const roles: PersonRole[] = [];
      for (const role of person.roles) {
        if (!role || typeof role !== 'object') continue;
        const fields = role as PersonRole;
        roles.push({
          type: typeof fields.type === 'string' ? fields.type : null,
          district: typeof fields.district === 'string' ? fields.district : null,
          start: typeof fields.start === 'string' ? fields.start : null,
          end: typeof fields.end === 'string' ? fields.end : null,
        });
      }
      people.push({ id: person.id, roles });
    }
    return { csv: row.csv, people };
  } catch {
    return { csv: text, people: [] };
  }
}

export function personById(people: PersonFile[]): Map<string, PersonFile> {
  return new Map(people.map((person) => [person.id, person]));
}
