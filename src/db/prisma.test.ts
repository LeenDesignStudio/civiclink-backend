import { afterAll, describe, expect, it } from 'vitest';
import { mapDbError, prisma } from './prisma.js';

function uniqueViolation(index: string) {
  return {
    code: 'P2002',
    message: 'Unique constraint failed',
    meta: {
      modelName: 'SavedLocation',
      driverAdapterError: {
        cause: {
          originalCode: '23505',
          originalMessage: `duplicate key value violates unique constraint "${index}"`,
          kind: 'UniqueConstraintViolation',
          constraint: { index },
        },
      },
    },
  };
}

describe('mapDbError', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('maps the adapter unique-index object to the domain code', () => {
    expect(mapDbError(uniqueViolation('saved_locations_home_work_once')).code).toBe('LOCATION_LABEL_TAKEN');
    expect(mapDbError(uniqueViolation('corrections_one_open_per_user_field')).code).toBe('DUPLICATE_CORRECTION');
    expect(mapDbError(uniqueViolation('saved_locations_one_default_per_user')).code).toBe('CONFLICT');
  });

  it('reads a constraint name quoted in the driver message', () => {
    const err = {
      code: 'P2002',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23505',
            originalMessage: 'duplicate key value violates unique constraint "corrections_one_open_per_user_field"',
          },
        },
      },
    };
    expect(mapDbError(err).code).toBe('DUPLICATE_CORRECTION');
  });

  it('keeps a string constraint name', () => {
    const err = { code: '23505', constraint: 'saved_locations_home_work_once' };
    expect(mapDbError(err).code).toBe('LOCATION_LABEL_TAKEN');
  });

  it('uses CONFLICT when the unique index is unknown', () => {
    expect(mapDbError(uniqueViolation('some_other_unique')).code).toBe('CONFLICT');
  });
});
