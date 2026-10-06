import { z } from 'zod';
import {
  GOV_LEVELS,
  JURISDICTION_TYPES,
  type CardOffice,
  type Coverage,
  type GovLevel,
  type JurisdictionType,
  type ServicePreview,
} from '../civic/civic.dto.js';

export const CONFIDENCE_VALUES = ['EXACT', 'LIKELY', 'MULTIPLE', 'UNRESOLVED'] as const;
export type Confidence = (typeof CONFIDENCE_VALUES)[number];

export const LOOKUP_METHODS = ['ADDRESS', 'ZIP', 'CITY_STATE', 'DEVICE'] as const;
export type LookupMethod = (typeof LOOKUP_METHODS)[number];

export interface LevelMember {
  id: string;
  name: string;
  type: JurisdictionType;
}

export interface LevelSnapshot {
  level: GovLevel;
  confidence: Confidence;
  members: LevelMember[];
}

export interface LevelDetail {
  levels: LevelSnapshot[];
}

export const levelDetailSchema = z
  .object({
    levels: z.array(
      z
        .object({
          level: z.enum(GOV_LEVELS),
          confidence: z.enum(CONFIDENCE_VALUES),
          members: z.array(
            z
              .object({
                id: z.string().min(1),
                name: z.string().min(1),
                type: z.enum(JURISDICTION_TYPES),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export function parseLevelDetail(value: unknown): LevelDetail | null {
  const parsed = levelDetailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface LookupContext {
  token: string;
  method: LookupMethod;
  displayLabel: string;
  zip: string | null;
  confidence: Confidence;
  jurisdictionIds: string[];
  partialLevels: GovLevel[];
  levels: LevelSnapshot[];
  expiresAt: Date | null;
}

export interface SavedLookup {
  id: string;
  token: string;
  userId: string | null;
  method: LookupMethod;
  displayLabel: string;
  zip: string | null;
  jurisdictionIds: string[];
  confidence: Confidence;
  partialLevels: GovLevel[];
  levelDetail: unknown;
  latencyMs: number;
  expiresAt: Date | null;
}

export interface LocationCandidateDto {
  displayLabel: string;
  candidateToken: string;
}

export interface ResolveLocationResult {
  status: 'RESOLVED' | 'NEEDS_CONFIRMATION';
  token: string | null;
  confidence: Confidence | null;
  candidates: LocationCandidateDto[];
}

export interface ReverseGeocodeResult {
  displayLabel: string;
  candidateToken: string;
}

export interface CivicCardLevel {
  level: GovLevel;
  confidence: Confidence;
  coverage: Coverage;
  notice: string | null;
  offices: CardOffice[];
}

export interface CivicCard {
  token: string;
  displayLabel: string;
  method: LookupMethod;
  confidence: Confidence;
  levels: CivicCardLevel[];
  servicesPreview: ServicePreview[];
}

export interface AnalyticsEventProps {
  method?: string;
  confidence?: string;
  latencyMs?: number;
  zip?: string;
  countyId?: string;
}

export interface Analytics {
  track(name: string, props: AnalyticsEventProps): void;
}
