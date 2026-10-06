import type { Tx } from '../../auth/tx.js';
import type { AuthProvider, DeletionReason, UserStatus } from '../../generated/prisma/enums.js';
import type {
  DeletionDraft,
  LegalVersions,
  ResidentRecord,
  SubscriptionSummary,
} from './residents.dto.js';

export interface NewResident {
  id: string;
  email: string;
  displayName: string;
  provider: AuthProvider;
  createdAt: Date;
}

export interface NewIdentity {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
}

export interface ResidentsStore {
  findIdentity(
    provider: AuthProvider,
    providerSubject: string,
  ): Promise<{ user: ResidentRecord } | null>;
  findVerifiedEmailOwner(email: string): Promise<ResidentRecord | null>;
  createUser(tx: Tx, input: NewResident): Promise<ResidentRecord>;
  insertIdentity(tx: Tx, input: NewIdentity): Promise<void>;
  touchIdentity(
    tx: Tx,
    provider: AuthProvider,
    providerSubject: string,
    email: string,
    emailVerified: boolean,
  ): Promise<void>;
  touchLogin(tx: Tx, userId: string, at: Date): Promise<void>;
  updateDisplayName(tx: Tx, userId: string, displayName: string): Promise<void>;
  getById(tx: Tx, userId: string): Promise<ResidentRecord | null>;
  currentLegal(): Promise<LegalVersions | null>;
  acceptTerms(
    tx: Tx,
    userId: string,
    input: { termsVersion: string; privacyVersion: string; displayName: string; marketingOptIn: boolean; acceptedAt: Date },
  ): Promise<ResidentRecord>;
  updateProfile(
    tx: Tx,
    userId: string,
    patch: { displayName?: string; marketingOptIn?: boolean },
  ): Promise<ResidentRecord>;
  hasNotificationPreferences(userId: string): Promise<boolean>;
  markPendingDeletion(tx: Tx, userId: string): Promise<void>;
  insertDeletion(tx: Tx, draft: DeletionDraft): Promise<void>;
  restore(tx: Tx, userId: string, restoredAt: Date): Promise<ResidentRecord>;
  subscriptionSummary(userId: string): Promise<SubscriptionSummary | null>;
  unreadCount(userId: string): Promise<number>;
}

export type { UserStatus, DeletionReason };
