export interface AnalyticsEvent {
  name: string;
  properties: Record<string, string | number | boolean>;
}

export function signupCompleted(input: { provider: string }): AnalyticsEvent {
  return event('signup_completed', { provider: input.provider });
}

export function login(input: { provider: string }): AnalyticsEvent {
  return event('login', { provider: input.provider });
}

export function locationSaved(input: { label: string; confidence: string }): AnalyticsEvent {
  return event('location_saved', { label: input.label, confidence: input.confidence });
}

export function locationDeleted(): AnalyticsEvent {
  return event('location_deleted', {});
}

export function follow(input: { officeId: string; level: string }): AnalyticsEvent {
  return event('follow', { officeId: input.officeId, level: input.level });
}

export function unfollow(input: { officeId: string }): AnalyticsEvent {
  return event('unfollow', { officeId: input.officeId });
}

export function notificationPrefChanged(input: {
  category: string;
  channel: string;
  enabled: boolean;
}): AnalyticsEvent {
  return event('notification_pref_changed', input);
}

export function notificationSent(input: { channel: string; type: string }): AnalyticsEvent {
  return event('notification_sent', input);
}

export function notificationDelivered(input: { channel: string; type: string }): AnalyticsEvent {
  return event('notification_delivered', input);
}

export function notificationFailed(input: { channel: string; type: string }): AnalyticsEvent {
  return event('notification_failed', input);
}

export function notificationOpened(input: { channel: string; type: string }): AnalyticsEvent {
  return event('notification_opened', input);
}

export function notificationClicked(input: { channel: string; type: string }): AnalyticsEvent {
  return event('notification_clicked', input);
}

export function correctionSubmitted(input: { entityType: string; field: string }): AnalyticsEvent {
  return event('correction_submitted', input);
}

export function correctionResolved(input: { status: string }): AnalyticsEvent {
  return event('correction_resolved', input);
}

export function checkoutStarted(input: { planId: string }): AnalyticsEvent {
  return event('checkout_started', { planId: input.planId });
}

export function subscriptionStatusChanged(input: { status: string }): AnalyticsEvent {
  return event('subscription_status_changed', { status: input.status });
}

export function outboundClick(input: { path: string }): AnalyticsEvent {
  return event('outbound_click', { path: input.path });
}

export function lookupStarted(input: { method: string }): AnalyticsEvent {
  return event('lookup_started', { method: input.method });
}

export function lookupCompleted(input: {
  method: string;
  confidence: string;
  latencyMs: number;
  zip?: string;
  countyId?: string;
}): AnalyticsEvent {
  return event('lookup_completed', {
    method: input.method,
    confidence: input.confidence,
    latencyMs: input.latencyMs,
    ...(input.zip !== undefined ? { zip: input.zip } : {}),
    ...(input.countyId !== undefined ? { countyId: input.countyId } : {}),
  });
}

export function lookupFailed(input: { method: string }): AnalyticsEvent {
  return event('lookup_failed', { method: input.method });
}

export const ANALYTICS_EVENTS = [
  signupCompleted({ provider: 'GOOGLE' }),
  login({ provider: 'APPLE' }),
  locationSaved({ label: 'HOME', confidence: 'EXACT' }),
  locationDeleted(),
  follow({ officeId: 'office', level: 'MUNICIPAL' }),
  unfollow({ officeId: 'office' }),
  notificationPrefChanged({ category: 'ALERTS', channel: 'EMAIL', enabled: false }),
  notificationSent({ channel: 'EMAIL', type: 'ALERT' }),
  notificationDelivered({ channel: 'PUSH', type: 'RECORD_UPDATE' }),
  notificationFailed({ channel: 'PUSH', type: 'ALERT' }),
  notificationOpened({ channel: 'EMAIL', type: 'ALERT' }),
  notificationClicked({ channel: 'EMAIL', type: 'ALERT' }),
  correctionSubmitted({ entityType: 'OFFICE', field: 'PHONE' }),
  correctionResolved({ status: 'APPLIED' }),
  checkoutStarted({ planId: 'plan' }),
  subscriptionStatusChanged({ status: 'ACTIVE' }),
  outboundClick({ path: '/offices/mayor' }),
  lookupStarted({ method: 'ZIP' }),
  lookupCompleted({ method: 'ZIP', confidence: 'EXACT', latencyMs: 12, zip: '10001' }),
  lookupFailed({ method: 'ADDRESS' }),
] as const;

function event(name: string, properties: Record<string, string | number | boolean>): AnalyticsEvent {
  return { name, properties };
}
