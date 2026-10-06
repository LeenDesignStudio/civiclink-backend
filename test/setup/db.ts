import { PrismaPg } from '@prisma/adapter-pg';
import { inject } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';

export function appDb(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject('databaseUrl'), max: 2 }) });
}

export function ownerDb(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject('ownerUrl'), max: 2 }) });
}

export async function truncateAll(owner: PrismaClient): Promise<void> {
  await owner.$executeRaw`
    TRUNCATE TABLE
      contact_messages,
      rate_limits,
      stripe_events,
      invoices,
      subscriptions,
      stripe_customers,
      plans,
      push_subscriptions,
      notification_preferences,
      notification_deliveries,
      notifications,
      alerts,
      correction_notes,
      corrections,
      change_log,
      service_links,
      services,
      office_terms,
      office_addresses,
      officials,
      offices,
      pending_source_changes,
      source_runs,
      follows,
      lookups,
      saved_locations,
      deletion_requests,
      user_sessions,
      auth_identities,
      users,
      admin_sessions,
      admin_users,
      jurisdictions,
      sources
    RESTART IDENTITY CASCADE
  `;
}
