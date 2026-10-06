import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type Permission, type RoleName } from '../src/authz/permissions.js';

const ROLES: RoleName[] = ['Resident', 'VIEWER', 'EDITOR', 'COMMUNICATIONS', 'SUPER_ADMIN', 'System'];

function parseMatrix(): Map<Permission, Record<RoleName, boolean>> {
  const doc = readFileSync(new URL('../docs/02-RBAC-PERMISSIONS.md', import.meta.url), 'utf8');
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => line.startsWith('| Permission | Resident |'));
  const map = new Map<Permission, Record<RoleName, boolean>>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('| `')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const permission = cells[0]?.replaceAll('`', '') as Permission;
    const flags = cells.slice(1);
    const record = {} as Record<RoleName, boolean>;
    ROLES.forEach((role, index) => {
      record[role] = flags[index] === '●';
    });
    map.set(permission, record);
  }
  return map;
}

describe('authz matrix', () => {
  it('matches docs/02 section 3 cell for cell', () => {
    const matrix = parseMatrix();
    expect(matrix.size).toBeGreaterThan(0);
    for (const [permission, flags] of matrix) {
      for (const role of ROLES) {
        expect(ROLE_PERMISSIONS[role].includes(permission), `${role} ${permission}`).toBe(flags[role]);
      }
    }
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(matrix.get(permission)?.[role], `extra ${role} ${permission}`).toBe(true);
      }
    }
  });
});
