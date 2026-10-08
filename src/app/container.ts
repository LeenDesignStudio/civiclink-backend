import { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma, withTx } from '../db/prisma.js';
import { SpatialRepo } from '../db/spatial.repo.js';
import { systemClock } from '../lib/clock.js';
import { systemRandom } from '../lib/random.js';
import { AuditRepo } from '../modules/audit/audit.repo.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { BillingRepo } from '../modules/billing/billing.repo.js';
import { BillingService } from '../modules/billing/billing.service.js';
import { EntitlementsService } from '../modules/billing/entitlements.service.js';
import { StripeBillingProvider } from '../modules/billing/stripe.provider.js';
import { CivicRepo } from '../modules/civic/civic.repo.js';
import { CivicService } from '../modules/civic/civic.service.js';
import { ContactRepo } from '../modules/contact/contact.repo.js';
import { ContactService } from '../modules/contact/contact.service.js';
import { CorrectionsRepo } from '../modules/corrections/corrections.repo.js';
import { CorrectionsService } from '../modules/corrections/corrections.service.js';
import { FollowsRepo } from '../modules/follows/follows.repo.js';
import { FollowsService } from '../modules/follows/follows.service.js';
import { LocationsRepo } from '../modules/locations/locations.repo.js';
import { LocationsService } from '../modules/locations/locations.service.js';
import { LookupRepo } from '../modules/lookup/lookup.repo.js';
import { LookupService } from '../modules/lookup/lookup.service.js';
import { GoogleGeocoder } from '../modules/lookup/clients/geocoder.js';
import { PostHogAnalytics } from '../modules/analytics/analytics.js';
import { NotificationsRepo } from '../modules/notifications/notifications.repo.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';
import { ConsoleEmailSender, SesEmailSender } from '../modules/notifications/email.js';
import { ConsolePushSender, FcmPushSender } from '../modules/notifications/push.js';
import { AlertsRepo } from '../modules/alerts/alerts.repo.js';
import { AlertsService } from '../modules/alerts/alerts.service.js';
import { ResidentsRepo } from '../modules/residents/residents.repo.js';
import { ResidentsService } from '../modules/residents/residents.service.js';
import { defaultNotificationPreferences } from '../modules/residents/residents.prefs.js';
import { AdminUsersRepo } from '../modules/admin-users/admin-users.repo.js';
import { AdminUsersService } from '../modules/admin-users/admin-users.service.js';
import { SourcesService } from '../modules/sources/sources.service.js';
import { DashboardRepo } from '../modules/sources/dashboard.repo.js';
import { DashboardService } from '../modules/sources/dashboard.js';
import { ExportService } from '../modules/sources/export.js';
import { MemoryExportStore, PrismaExportReader, S3ExportStore } from '../modules/sources/export.store.js';
import { PipelineRepo } from '../modules/pipeline/pipeline.repo.js';
import { SessionRepo } from '../auth/sessions.repo.js';
import { SessionService } from '../auth/sessions.js';
import { AdminAuthRepo } from '../auth/admin-auth.repo.js';
import { AdminAuthService } from '../auth/admin-auth.js';
import { AdminPrincipalCache } from '../auth/admin-principal-cache.js';
import { startBoss, type Boss } from '../jobs/boss.js';
import type { AppServices } from './services.js';
import type { TxRunner } from '../modules/locations/locations.ports.js';

const runTx: TxRunner = (fn, options) =>
  withTx((tx) => fn(tx), {
    isolation:
      options?.isolation === 'Serializable'
        ? Prisma.TransactionIsolationLevel.Serializable
        : Prisma.TransactionIsolationLevel.ReadCommitted,
  });

export interface AppContainer {
  services: AppServices;
  sessions: SessionService;
  adminAuth: AdminAuthService;
  devExports?: MemoryExportStore;
  stopJobs: () => Promise<void>;
}

function jobSender(): { send: (name: string, data: object, singletonKey?: string) => Promise<void>; stop: () => Promise<void> } {
  let pending: Promise<Boss> | undefined;
  return {
    async send(name, data, singletonKey) {
      pending ??= startBoss(env.DATABASE_URL);
      const boss = await pending;
      await boss.send(name, data, singletonKey ? { singletonKey } : {});
    },
    async stop() {
      if (!pending) return;
      const boss = await pending;
      await boss.stop({ graceful: true, timeout: 5_000 });
    },
  };
}

export function buildContainer(): AppContainer {
  const jobs = jobSender();
  const audit = new AuditService(new AuditRepo(prisma));
  const sessions = new SessionService({ store: new SessionRepo(prisma), clock: systemClock, random: systemRandom });
  const entitlements = new EntitlementsService(new BillingRepo(prisma));
  const email =
    env.EMAIL_PROVIDER === 'ses'
      ? new SesEmailSender({
          fetchFn: fetch,
          endpoint: `https://email.${env.AWS_REGION}.amazonaws.com/v2/email/outbound-emails`,
          from: env.EMAIL_FROM,
        })
      : new ConsoleEmailSender();
  const push =
    env.PUSH_PROVIDER === 'fcm'
      ? new FcmPushSender({
          fetchFn: fetch,
          endpoint: 'https://fcm.googleapis.com/v1/projects/civiclink/messages:send',
          authorization: `Bearer ${env.FCM_SERVICE_ACCOUNT_JSON ?? ''}`,
        })
      : new ConsolePushSender();
  const notifications = new NotificationsService({
    repo: new NotificationsRepo(prisma),
    email,
    push,
    clock: systemClock,
    links: { secret: env.LINK_SIGNING_SECRET, webUrl: env.PUBLIC_WEB_URL },
  });
  const civicRepo = new CivicRepo(prisma);
  const civic = new CivicService({
    repo: civicRepo,
    lookups: { findActive: (token, now) => new LookupRepo(prisma).findActive(token, now) },
    clock: systemClock,
    audit,
    enqueue: (job, payload) => jobs.send(job, payload),
  });
  const analytics = new PostHogAnalytics({
    fetchFn: fetch,
    apiKey: env.POSTHOG_API_KEY ?? '',
    host: env.POSTHOG_HOST,
  });
  const lookup = new LookupService({
    repo: new LookupRepo(prisma),
    spatial: new SpatialRepo(prisma),
    geocoder: new GoogleGeocoder({
      apiKey: env.GOOGLE_MAPS_API_KEY,
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        return {
          ok: response.ok,
          status: response.status,
          json: () => response.json(),
          headers: response.headers,
        };
      },
    }),
    civic: civicRepo,
    follows: async (userId, officeId) => {
      const row = await prisma.follow.findFirst({ where: { userId, officeId }, select: { id: true } });
      return row !== null;
    },
    analytics: {
      track: (name, props) => {
        const properties: Record<string, unknown> = { ...props };
        void analytics.track('lookup', name, properties);
      },
    },
    clock: systemClock,
    random: systemRandom,
    signingSecret: env.LINK_SIGNING_SECRET,
    anonTtlDays: env.ANON_LOOKUP_TTL_DAYS,
  });
  const residents = new ResidentsService({
    store: new ResidentsRepo(prisma),
    sessions,
    clock: systemClock,
    random: systemRandom,
    prefs: {
      async ensureDefaults(userId) {
        await prisma.notificationPreference.createMany({
          data: defaultNotificationPreferences().map((row) => ({
            userId,
            category: row.category,
            channel: row.channel,
            enabled: row.enabled,
          })),
          skipDuplicates: true,
        });
      },
    },
    runTx,
    purgeDays: env.ACCOUNT_PURGE_DAYS,
    billing: {
      async cancelAtPeriodEnd(userId) {
        await prisma.subscription.updateMany({
          where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          data: { cancelAtPeriodEnd: true },
        });
      },
    },
  });
  const locations = new LocationsService({
    repo: new LocationsRepo(prisma),
    lookups: {
      async findByToken(token) {
        const row = await new LookupRepo(prisma).findByToken(token);
        if (!row) return null;
        return {
          token: row.token,
          method: row.method,
          displayLabel: row.displayLabel,
          jurisdictionIds: row.jurisdictionIds,
          confidence: row.confidence,
          expiresAt: row.expiresAt,
          hasPoint: row.method === 'ADDRESS' || row.method === 'DEVICE',
          hasArea: row.method === 'ZIP' || row.method === 'CITY_STATE',
          geocodePrecision: null,
          createdAt: row.expiresAt ?? new Date(0),
        };
      },
    },
    geometry: {
      async copyPoint(savedLocationId, lookupToken) {
        await prisma.$executeRaw`
          UPDATE saved_locations AS s
          SET point = CASE
            WHEN l.geom IS NULL THEN s.point
            ELSE ST_Centroid(l.geom)
          END
          FROM lookups AS l
          WHERE s.id = ${savedLocationId}::uuid AND l.token = ${lookupToken}
        `;
      },
    },
    entitlements,
    withTx: runTx,
    clock: systemClock,
  });
  const follows = new FollowsService({ repo: new FollowsRepo(prisma), entitlements, withTx: runTx });
  const corrections = new CorrectionsService({
    repo: new CorrectionsRepo(prisma),
    audit,
    withTx: runTx,
    clock: systemClock,
    queue: {
      enqueue: (name, payload) => jobs.send(name, payload, payload.entityId),
    },
  });
  const billing = new BillingService({
    repo: new BillingRepo(prisma),
    provider: StripeBillingProvider.fromApiKey(env.STRIPE_SECRET_KEY),
    publicWebUrl: env.PUBLIC_WEB_URL,
  });
  const contact = new ContactService({
    repo: new ContactRepo(prisma),
    clock: systemClock,
    queue: { enqueue: (name, payload) => jobs.send(name, payload, payload.contactMessageId) },
    turnstile: {
      async verify(token, _ipHash) {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { success?: boolean };
        return body.success === true;
      },
    },
  });
  const alerts = new AlertsService({
    repo: new AlertsRepo(prisma),
    email,
    enqueue: { enqueue: (name, data, options) => jobs.send(name, data, options?.singletonKey) },
    audit,
    webUrl: env.PUBLIC_WEB_URL,
  });
  const pipelineStore = new PipelineRepo(prisma);
  const sources = new SourcesService({
    store: pipelineStore,
    audit,
    enqueue: { enqueue: (name, data, options) => jobs.send(name, data, options?.singletonKey) },
    dashboard: new DashboardService(new DashboardRepo(prisma), systemClock),
  });
  const adminAuth = new AdminAuthService({
    store: new AdminAuthRepo(prisma),
    clock: systemClock,
    random: systemRandom,
    hostedDomain: env.ADMIN_GOOGLE_HD,
  });
  const adminUsers = new AdminUsersService({
    store: new AdminUsersRepo(prisma),
    audit,
    sessions: {
      revokeSession: (sessionId) => adminAuth.revokeSession(sessionId),
      revokeAll: (adminId) => adminAuth.revokeAll(adminId),
    },
    clock: systemClock,
    random: systemRandom,
    runTx,
    hostedDomain: env.ADMIN_GOOGLE_HD,
    cache: new AdminPrincipalCache(),
  });
  const devExports =
    env.APP_ENV === 'development' || env.APP_ENV === 'test' ? new MemoryExportStore() : undefined;
  const exportsService = new ExportService({
    reader: new PrismaExportReader(prisma),
    store: devExports ?? new S3ExportStore(env.S3_BUCKET_EXPORTS, env.AWS_REGION),
    audit,
    withTx: runTx,
  });
  return {
    sessions,
    adminAuth,
    ...(devExports ? { devExports } : {}),
    services: {
      civic,
      lookup,
      residents,
      locations,
      follows,
      corrections,
      notifications,
      alerts,
      billing,
      adminUsers,
      audit,
      contact,
      sources,
      exports: exportsService,
    },
    stopJobs: () => jobs.stop(),
  };
}
