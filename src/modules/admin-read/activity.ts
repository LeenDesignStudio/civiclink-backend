import { isAppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const ACTIVITY_KINDS = [
  'CORRECTION_SUBMITTED',
  'SOURCE_REFRESH_FAILED',
  'ALERT_DELIVERY_FAILED',
  'INVITE_ACCEPTED',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityAudience = 'ALL' | 'SUPER_ADMIN';

export interface ActivityEvent {
  kind: ActivityKind;
  audience: ActivityAudience;
  title: string;
  preview: string;
  entityType: string;
  entityId: string;
}

export interface ActivityRecorder {
  record(event: ActivityEvent): Promise<void>;
}

/** The saved record stands. A missed bell item must not fail or retry that write. */
export async function recordActivity(recorder: ActivityRecorder | undefined, event: ActivityEvent): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.record(event);
  } catch (error) {
    logger.warn({ code: isAppError(error) ? error.code : 'INTERNAL' }, 'admin activity was not recorded');
  }
}
