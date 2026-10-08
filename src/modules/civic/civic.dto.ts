export const GOV_LEVELS = ['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL'] as const;
export type GovLevel = (typeof GOV_LEVELS)[number];

export const JURISDICTION_TYPES = [
  'NATION',
  'STATE',
  'CONGRESSIONAL_DISTRICT',
  'STATE_SENATE_DISTRICT',
  'STATE_HOUSE_DISTRICT',
  'COUNTY',
  'COUNTY_COUNCIL_DISTRICT',
  'MUNICIPALITY',
  'WARD',
  'SCHOOL_DISTRICT',
  'SCHOOL_BOARD_DISTRICT',
  'COMMUNITY_COLLEGE_DISTRICT',
  'SPECIAL_DISTRICT',
  'ZCTA',
] as const;
export type JurisdictionType = (typeof JURISDICTION_TYPES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'RETIRED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const FRESHNESS_OVERRIDES = ['NONE', 'FORCE_CURRENT', 'FORCE_OUTDATED'] as const;
export type FreshnessOverride = (typeof FRESHNESS_OVERRIDES)[number];

export const FRESHNESS_VALUES = ['CURRENT', 'MAY_BE_OUTDATED'] as const;
export type Freshness = (typeof FRESHNESS_VALUES)[number];

export const SELECTION_METHODS = ['ELECTED', 'APPOINTED'] as const;
export type SelectionMethod = (typeof SELECTION_METHODS)[number];

export const TERM_STATUSES = ['ELECTED', 'APPOINTED', 'ACTING'] as const;
export type TermStatus = (typeof TERM_STATUSES)[number];

export const COVERAGE_VALUES = ['COVERED', 'PARTIAL', 'NONE'] as const;
export type Coverage = (typeof COVERAGE_VALUES)[number];

export interface SourceRef {
  name: string;
  url: string;
}

export interface OfficeAddressDto {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  hours: string | null;
}

export interface CurrentHolderDto {
  id: string;
  slug: string;
  fullName: string;
  displayName: string | null;
  party: string | null;
  photoUrl: string | null;
}

export interface JurisdictionRef {
  id: string;
  name: string;
  level: GovLevel;
  type: JurisdictionType;
  districtCode: string | null;
  state: string | null;
}

export interface OfficeProfile {
  id: string;
  slug: string;
  name: string;
  seatLabel: string | null;
  selectionMethod: SelectionMethod;
  displayOrder: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactUrl: string | null;
  holderUnknown: boolean;
  vacant: boolean;
  currentHolder: CurrentHolderDto | null;
  termStatus: TermStatus | null;
  addresses: OfficeAddressDto[];
  jurisdiction: JurisdictionRef;
  source: SourceRef;
  lastUpdatedAt: Date;
  freshness: Freshness;
  whyItApplies: string | null;
  isFollowed: boolean | null;
}

export interface OfficialProfile {
  id: string;
  slug: string;
  fullName: string;
  displayName: string | null;
  party: string | null;
  photoUrl: string | null;
  website: string | null;
  source: SourceRef;
  lastUpdatedAt: Date;
  freshness: Freshness;
  redirectOfficeSlug: string | null;
  whyItApplies: string | null;
}

export interface ServiceCategoryDto {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ServiceDto {
  id: string;
  title: string;
  description: string;
  url: string | null;
  phoneContact: string | null;
  category: ServiceCategoryDto;
  createdAt: Date;
}

export interface ServicePreview {
  id: string;
  title: string;
  description: string;
  url: string | null;
  phoneContact: string | null;
  category: { id: string; name: string };
}

export interface PlanDto {
  id: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: string;
  features: string[];
}

export interface LegalVersionDto {
  kind: 'TERMS' | 'PRIVACY';
  version: string;
  effectiveAt: Date;
}

export interface JurisdictionBrief {
  id: string;
  name: string;
  level: GovLevel;
  type: JurisdictionType;
}

export interface OfficeRecord {
  id: string;
  slug: string;
  name: string;
  seatLabel: string | null;
  selectionMethod: SelectionMethod;
  displayOrder: number;
  whyTemplate: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactUrl: string | null;
  holderUnknown: boolean;
  status: RecordStatus;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  source: SourceRef & { freshnessDays: number };
  jurisdiction: JurisdictionRef;
  addresses: OfficeAddressDto[];
  currentTerm: {
    status: TermStatus;
    official: CurrentHolderDto & { status: RecordStatus };
  } | null;
}

export interface OfficialTermLink {
  isCurrent: boolean;
  termEnd: Date | null;
  office: {
    id: string;
    slug: string;
    name: string;
    status: RecordStatus;
    whyTemplate: string | null;
    jurisdiction: JurisdictionRef;
  };
}

export interface OfficialRecord {
  id: string;
  slug: string;
  fullName: string;
  displayName: string | null;
  party: string | null;
  photoUrl: string | null;
  website: string | null;
  status: RecordStatus;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  source: SourceRef & { freshnessDays: number };
  terms: OfficialTermLink[];
}

export interface ServiceRecord {
  id: string;
  title: string;
  description: string;
  url: string | null;
  phoneContact: string | null;
  category: ServiceCategoryDto;
  createdAt: Date;
  status: RecordStatus;
}

export interface JurisdictionRecord {
  id: string;
  name: string;
  level: GovLevel;
  type: JurisdictionType;
  subtype: string | null;
  parentId: string | null;
  districtCode: string | null;
  geoid: string | null;
  state: string | null;
  boundaryVintage: string | null;
  website: string | null;
  sourceId: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  status: RecordStatus;
}

export interface AdminJurisdictionNode extends JurisdictionRecord {
  createdAt: Date;
  hasBoundary: boolean;
}

export interface AdminOfficeRecord {
  id: string;
  slug: string;
  jurisdictionId: string;
  name: string;
  seatLabel: string | null;
  selectionMethod: SelectionMethod;
  displayOrder: number;
  whyTemplate: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactUrl: string | null;
  holderUnknown: boolean;
  sourceId: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  status: RecordStatus;
  followerCount: number;
  addresses: OfficeAddressDto[];
}

export interface OfficeTermRecord {
  id: string;
  officeId: string;
  officialId: string;
  status: TermStatus;
  termStart: Date | null;
  termEnd: Date | null;
  isCurrent: boolean;
}

export interface OfficeTermPayload {
  term: OfficeTermRecord;
  office: AdminOfficeRecord;
}

export interface AdminOfficialTerm {
  id: string;
  officeId: string;
  status: TermStatus;
  termStart: Date | null;
  termEnd: Date | null;
  isCurrent: boolean;
  office: { id: string; slug: string; name: string; status: RecordStatus };
}

export interface AdminOfficialRecord {
  id: string;
  slug: string;
  fullName: string;
  displayName: string | null;
  party: string | null;
  photoUrl: string | null;
  website: string | null;
  sourceId: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  status: RecordStatus;
  terms: AdminOfficialTerm[];
}

export interface AdminServiceLink {
  id: string;
  jurisdictionId: string | null;
  officeId: string | null;
}

export interface AdminServiceRecord {
  id: string;
  title: string;
  categoryId: string;
  description: string;
  url: string | null;
  phoneContact: string | null;
  lastValidatedAt: Date;
  sourceId: string;
  status: RecordStatus;
  links: AdminServiceLink[];
  jurisdictionIds: string[];
  officeIds: string[];
}

export interface ServiceCategoryRecord {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface CardOffice extends OfficeProfile {
  isFollowed: boolean | null;
}
