import { RateLimiterPostgres, RateLimiterMemory } from 'rate-limiter-flexible';
import type { Pool } from 'pg';
import { RateLimitedError } from './errors.js';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

export const RATE_CLASSES = [
  'lookup',
  'auth',
  'contact',
  'correction',
  'mutation',
  'admin',
  'alert_send',
  'test_notification',
] as const;

export type RateClass = (typeof RATE_CLASSES)[number];

export interface RateLimitResult {
  retryAfterSeconds: number;
}

export interface RateGate {
  consume(rateClass: RateClass, key: string): Promise<void>;
}

const WINDOWS: Record<RateClass, { points: number; duration: number }> = {
  lookup: { points: 30, duration: 600 },
  auth: { points: 20, duration: 600 },
  contact: { points: 5, duration: 3600 },
  correction: { points: 10, duration: 86400 },
  mutation: { points: 60, duration: 60 },
  admin: { points: 300, duration: 60 },
  alert_send: { points: 10, duration: 3600 },
  test_notification: { points: 3, duration: 3600 },
};

/** GraphQL operations and REST routes that carry a Rate value in docs/05. */
export const OPERATION_RATES: Record<string, RateClass> = {
  resolveLocation: 'lookup',
  confirmLocationCandidate: 'lookup',
  reverseGeocode: 'lookup',
  submitContactMessage: 'contact',
  acceptTerms: 'mutation',
  updateProfile: 'mutation',
  signOut: 'mutation',
  requestAccountDeletion: 'mutation',
  restoreAccount: 'mutation',
  saveLocation: 'mutation',
  updateSavedLocation: 'mutation',
  setDefaultLocation: 'mutation',
  deleteSavedLocation: 'mutation',
  follow: 'mutation',
  unfollow: 'mutation',
  markNotificationsRead: 'mutation',
  deleteNotification: 'mutation',
  updateNotificationPreference: 'mutation',
  registerPushSubscription: 'mutation',
  removePushSubscription: 'mutation',
  sendTestNotification: 'test_notification',
  submitCorrection: 'correction',
  createCheckoutSession: 'mutation',
  createPortalSession: 'mutation',
  adminMe: 'admin',
  adminSignOut: 'admin',
  adminUsers: 'admin',
  inviteAdmin: 'admin',
  updateAdminRole: 'admin',
  setAdminStatus: 'admin',
  adminDashboardCounts: 'admin',
  adminJurisdictions: 'admin',
  adminJurisdiction: 'admin',
  upsertJurisdiction: 'admin',
  retireJurisdiction: 'admin',
  restoreJurisdiction: 'admin',
  adminOffices: 'admin',
  adminOffice: 'admin',
  upsertOffice: 'admin',
  retireOffice: 'admin',
  restoreOffice: 'admin',
  adminOfficials: 'admin',
  adminOfficial: 'admin',
  upsertOfficial: 'admin',
  setOfficeTerm: 'admin',
  endOfficeTerm: 'admin',
  retireOfficial: 'admin',
  restoreOfficial: 'admin',
  adminServices: 'admin',
  adminService: 'admin',
  upsertService: 'admin',
  retireService: 'admin',
  restoreService: 'admin',
  upsertServiceCategory: 'admin',
  adminSources: 'admin',
  adminSource: 'admin',
  upsertSource: 'admin',
  triggerSourceRefresh: 'admin',
  pendingSourceChanges: 'admin',
  decideSourceChange: 'admin',
  changeLog: 'admin',
  exportCsv: 'admin',
  adminCorrections: 'admin',
  adminCorrection: 'admin',
  assignCorrection: 'admin',
  markCorrectionInReview: 'admin',
  applyCorrection: 'admin',
  dismissCorrection: 'admin',
  addCorrectionNote: 'admin',
  adminAlerts: 'admin',
  adminAlert: 'admin',
  saveAlertDraft: 'admin',
  deleteAlertDraft: 'admin',
  previewAlert: 'admin',
  sendTestAlert: 'admin',
  sendAlert: 'alert_send',
  'GET /auth/:provider/start': 'auth',
  'GET /auth/google/callback': 'auth',
  'POST /auth/apple/callback': 'auth',
  'POST /auth/refresh': 'auth',
  'GET /admin-auth/google/start': 'auth',
  'GET /admin-auth/google/callback': 'auth',
};

export class MemoryRateGate implements RateGate {
  private readonly buckets = new Map<string, { points: number; resetAt: number }>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly limits: Record<RateClass, { points: number; duration: number }> = WINDOWS,
  ) {}

  consume(rateClass: RateClass, key: string): Promise<void> {
    const limit = this.limits[rateClass];
    const now = this.clock.now().getTime();
    const bucketKey = `${rateClass}:${key}`;
    const current = this.buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      this.buckets.set(bucketKey, { points: 1, resetAt: now + limit.duration * 1000 });
      return Promise.resolve();
    }
    if (current.points >= limit.points) {
      return Promise.reject(new RateLimitedError(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
    }
    current.points += 1;
    return Promise.resolve();
  }
}

export function createPostgresRateGate(pool: Pool): RateGate {
  const limiters = new Map<RateClass, RateLimiterPostgres>();
  for (const rateClass of RATE_CLASSES) {
    const window = WINDOWS[rateClass];
    limiters.set(
      rateClass,
      new RateLimiterPostgres({
        storeClient: pool,
        tableName: 'rate_limits',
        tableCreated: true,
        keyPrefix: rateClass,
        points: window.points,
        duration: window.duration,
      }),
    );
  }
  return {
    async consume(rateClass, key) {
      const limiter = limiters.get(rateClass);
      if (!limiter) return;
      try {
        await limiter.consume(key);
      } catch (error) {
        const ms =
          error && typeof error === 'object' && 'msBeforeNext' in error
            ? (error as { msBeforeNext: number }).msBeforeNext
            : 1000;
        throw new RateLimitedError(Math.max(1, Math.ceil(ms / 1000)));
      }
    },
  };
}

export async function cleanupRateLimits(pool: Pool, now = Date.now()): Promise<void> {
  await pool.query('DELETE FROM rate_limits WHERE expire IS NOT NULL AND expire < $1', [now]);
}

export { RateLimiterMemory };
