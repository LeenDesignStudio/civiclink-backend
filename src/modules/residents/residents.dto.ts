import type { AuthProvider, DeletionReason, UserStatus } from '../../generated/prisma/enums.js';

export interface SubscriptionSummary {
  status: string;
  planName: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface ResidentRecord {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  termsVersion: string | null;
  privacyVersion: string | null;
  acceptedAt: Date | null;
  marketingOptIn: boolean;
  provider: AuthProvider;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface MeDto {
  id: string;
  displayName: string;
  email: string;
  provider: AuthProvider;
  status: UserStatus;
  termsAccepted: boolean;
  currentTermsVersion: string;
  currentPrivacyVersion: string;
  marketingOptIn: boolean;
  subscription: SubscriptionSummary | null;
  unreadCount: number;
  activeSessionCount: number;
}

export interface DeletionResult {
  status: 'PENDING_DELETION';
  purgeAfter: Date;
}

export interface ProviderAssertion {
  provider: AuthProvider;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

export interface LegalVersions {
  termsVersion: string;
  privacyVersion: string;
}

export interface DeletionDraft {
  userId: string;
  reason: DeletionReason | null;
  reasonText: string | null;
  purgeAfter: Date;
  requestedAt: Date;
}
