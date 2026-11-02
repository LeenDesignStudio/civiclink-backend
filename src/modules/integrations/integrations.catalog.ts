import type { Env } from '../../config/env.js';

export interface IntegrationField {
  key: keyof Env;
  label: string;
  group: string;
  secret: boolean;
  multiline: boolean;
}

/** Provider keys a Super Admin may change. Database and session keys are not here. */
export const INTEGRATION_FIELDS = [
  { key: 'PUBLIC_WEB_URL', label: 'Public site URL', group: 'Site', secret: false, multiline: false },
  { key: 'GOOGLE_CLIENT_ID', label: 'Google client ID', group: 'Google sign-in', secret: false, multiline: false },
  { key: 'GOOGLE_CLIENT_SECRET', label: 'Google client secret', group: 'Google sign-in', secret: true, multiline: false },
  { key: 'APPLE_CLIENT_ID', label: 'Apple client ID', group: 'Apple sign-in', secret: false, multiline: false },
  { key: 'APPLE_TEAM_ID', label: 'Apple team ID', group: 'Apple sign-in', secret: false, multiline: false },
  { key: 'APPLE_KEY_ID', label: 'Apple key ID', group: 'Apple sign-in', secret: false, multiline: false },
  { key: 'APPLE_PRIVATE_KEY', label: 'Apple private key', group: 'Apple sign-in', secret: true, multiline: true },
  { key: 'GOOGLE_MAPS_API_KEY', label: 'Google Maps API key', group: 'Maps', secret: true, multiline: false },
  { key: 'STRIPE_SECRET_KEY', label: 'Stripe secret key', group: 'Stripe', secret: true, multiline: false },
  { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook secret', group: 'Stripe', secret: true, multiline: false },
  { key: 'TURNSTILE_SITE_KEY', label: 'Turnstile site key', group: 'Contact form', secret: false, multiline: false },
  { key: 'TURNSTILE_SECRET_KEY', label: 'Turnstile secret key', group: 'Contact form', secret: true, multiline: false },
  { key: 'POSTHOG_API_KEY', label: 'PostHog project key', group: 'Analytics', secret: true, multiline: false },
  { key: 'POSTHOG_HOST', label: 'PostHog host', group: 'Analytics', secret: false, multiline: false },
  { key: 'SENTRY_DSN', label: 'Sentry DSN', group: 'Errors', secret: true, multiline: false },
  { key: 'FCM_SERVICE_ACCOUNT_JSON', label: 'Firebase service account JSON', group: 'Push', secret: true, multiline: true },
  { key: 'VAPID_PUBLIC_KEY', label: 'Browser push public key', group: 'Push', secret: false, multiline: false },
  { key: 'VAPID_PRIVATE_KEY', label: 'Browser push private key', group: 'Push', secret: true, multiline: false },
  { key: 'VAPID_SUBJECT', label: 'Browser push contact', group: 'Push', secret: false, multiline: false },
] as const satisfies readonly IntegrationField[];

export type IntegrationKey = (typeof INTEGRATION_FIELDS)[number]['key'];

const FIELD_BY_KEY = new Map<string, IntegrationField>(INTEGRATION_FIELDS.map((field) => [field.key, field]));

export function integrationField(key: string): IntegrationField | undefined {
  return FIELD_BY_KEY.get(key);
}

export function integrationValues(source: Env): Record<IntegrationKey, string> {
  return {
    PUBLIC_WEB_URL: source.PUBLIC_WEB_URL,
    GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: source.APPLE_CLIENT_ID,
    APPLE_TEAM_ID: source.APPLE_TEAM_ID,
    APPLE_KEY_ID: source.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: source.APPLE_PRIVATE_KEY,
    GOOGLE_MAPS_API_KEY: source.GOOGLE_MAPS_API_KEY,
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
    TURNSTILE_SITE_KEY: source.TURNSTILE_SITE_KEY ?? '',
    TURNSTILE_SECRET_KEY: source.TURNSTILE_SECRET_KEY,
    POSTHOG_API_KEY: source.POSTHOG_API_KEY ?? '',
    POSTHOG_HOST: source.POSTHOG_HOST,
    SENTRY_DSN: source.SENTRY_DSN ?? '',
    FCM_SERVICE_ACCOUNT_JSON: source.FCM_SERVICE_ACCOUNT_JSON ?? '',
    VAPID_PUBLIC_KEY: source.VAPID_PUBLIC_KEY ?? '',
    VAPID_PRIVATE_KEY: source.VAPID_PRIVATE_KEY ?? '',
    VAPID_SUBJECT: source.VAPID_SUBJECT,
  };
}

export const INTEGRATION_ENTITY_ID = '11111111-1111-4111-8111-111111111111';

const HINTS: Partial<Record<IntegrationKey, string>> = {
  STRIPE_SECRET_KEY: 'Stripe secret keys start with sk_.',
  STRIPE_WEBHOOK_SECRET: 'Stripe webhook secrets start with whsec_.',
  PUBLIC_WEB_URL: 'Enter a full URL, including https://.',
  POSTHOG_HOST: 'Enter a full URL, including https://.',
  SENTRY_DSN: 'Enter a full URL, or leave this blank.',
  APPLE_PRIVATE_KEY: 'Paste the Apple private key, including the BEGIN line.',
};

export function hintForKey(key: string): string {
  if (key in HINTS) return HINTS[key as IntegrationKey] ?? 'This value is not valid.';
  return 'This value is not valid.';
}
