import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';
import type { CivicEntityType, CorrectionField } from './corrections.dto.js';

const ALL_FIELDS = [
  'OFFICEHOLDER_NAME',
  'TITLE',
  'PARTY',
  'PHONE',
  'EMAIL',
  'WEBSITE',
  'OFFICE_ADDRESS',
  'DISTRICT',
  'DOES_NOT_APPLY',
  'SERVICE_DETAILS',
  'OTHER',
] as const satisfies readonly CorrectionField[];

const ALLOWED: Record<CivicEntityType, readonly CorrectionField[]> = {
  OFFICE: ALL_FIELDS.filter((field) => field !== 'SERVICE_DETAILS'),
  SERVICE: ['SERVICE_DETAILS', 'OTHER', 'PHONE', 'EMAIL', 'WEBSITE'],
  OFFICIAL: ['OFFICEHOLDER_NAME', 'TITLE', 'PARTY', 'PHONE', 'EMAIL', 'WEBSITE', 'OTHER'],
  JURISDICTION: ['DISTRICT', 'DOES_NOT_APPLY', 'OTHER'],
};

export function fieldAllowed(entityType: CivicEntityType, field: CorrectionField): boolean {
  return ALLOWED[entityType].includes(field);
}

export function normalizeProposed(
  entityType: CivicEntityType,
  field: CorrectionField,
  value: string | undefined,
  path: string,
): string | null {
  if (!fieldAllowed(entityType, field)) {
    throw new ValidationError('That field does not apply to this record.', [
      { path: 'field', code: 'custom', message: 'That field does not apply to this record.' },
    ]);
  }
  if (field === 'DOES_NOT_APPLY') {
    if (value === undefined) return null;
    return bounded(value, 500, path);
  }
  if (value === undefined || value.length === 0) {
    throw new ValidationError('A proposed value is required.', [
      { path, code: 'custom', message: 'A proposed value is required.' },
    ]);
  }
  if (field === 'EMAIL') return email(value, path);
  if (field === 'WEBSITE') return httpUrl(value, path);
  if (field === 'PHONE') return phone(value, path);
  return bounded(value, maxLength(entityType, field), path);
}

export function httpUrl(value: string, path: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalid(path, 'Enter a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid(path, 'Enter a valid URL.');
  if (trimmed.length > 2048) throw invalid(path, 'Enter a valid URL.');
  return trimmed;
}

function email(value: string, path: string): string {
  const parsed = z.email().max(254).safeParse(value.trim());
  if (!parsed.success) throw invalid(path, 'Enter a valid email address.');
  return parsed.data.toLowerCase();
}

function phone(value: string, path: string): string {
  const parsed = parsePhoneNumberFromString(value.trim(), 'US');
  if (!parsed?.isValid()) throw invalid(path, 'Enter a valid US phone number.');
  const e164 = parsed.format('E.164');
  if (e164.length > 20) throw invalid(path, 'Enter a valid US phone number.');
  return e164;
}

function bounded(value: string, max: number, path: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw invalid(path, `Use between 1 and ${max} characters.`);
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) throw invalid(path, 'Contains unsupported characters.');
  return trimmed;
}

function maxLength(entityType: CivicEntityType, field: CorrectionField): number {
  if (field === 'PARTY') return 60;
  if (field === 'DISTRICT') return 40;
  if (field === 'SERVICE_DETAILS') return 400;
  if (field === 'OFFICE_ADDRESS') return 200;
  if (field === 'OFFICEHOLDER_NAME') return 120;
  if (field === 'TITLE') return entityType === 'OFFICE' ? 150 : 120;
  return 500;
}

function invalid(path: string, message: string): ValidationError {
  return new ValidationError(message, [{ path, code: 'custom', message }]);
}
