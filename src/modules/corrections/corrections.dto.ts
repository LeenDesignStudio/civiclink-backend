export type CivicEntityType = 'JURISDICTION' | 'OFFICE' | 'OFFICIAL' | 'SERVICE';

export type CorrectionField =
  | 'OFFICEHOLDER_NAME'
  | 'TITLE'
  | 'PARTY'
  | 'PHONE'
  | 'EMAIL'
  | 'WEBSITE'
  | 'OFFICE_ADDRESS'
  | 'DISTRICT'
  | 'DOES_NOT_APPLY'
  | 'SERVICE_DETAILS'
  | 'OTHER';

export type CorrectionStatus = 'SUBMITTED' | 'IN_REVIEW' | 'APPLIED' | 'DISMISSED';

export type DismissReason = 'CANT_VERIFY' | 'SOURCE_CORRECT' | 'DUPLICATE' | 'OUT_OF_SCOPE' | 'OTHER';

export interface CorrectionRecordBrief {
  id: string;
  displayId: string | null;
  name: string | null;
}

export interface OpenCorrectionBrief {
  id: string;
  displayId?: string;
  status: CorrectionStatus;
}

export type GovLevel = 'FEDERAL' | 'STATE' | 'COUNTY' | 'MUNICIPAL' | 'EDUCATION' | 'SPECIAL';

export interface ResidentCorrection {
  id: string;
  entityType: CivicEntityType;
  entityId: string;
  field: CorrectionField;
  proposedValue: string | null;
  details: string | null;
  evidenceUrl: string | null;
  status: CorrectionStatus;
  dismissReason: DismissReason | null;
  dismissNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CorrectionNoteDto {
  id: string;
  adminId: string;
  body: string;
  createdAt: Date;
}

export interface AdminCorrection extends ResidentCorrection {
  displayId?: string;
  userId?: string | null;
  currentValueSnapshot: { value: string | null } | null;
  assigneeId: string | null;
  submitterDisplayName: string | null;
  lookupToken: string | null;
  resolvedAt: Date | null;
  resolvedBy?: string | null;
  decidedByName?: string | null;
  recordName?: string | null;
  recordDisplayId?: string | null;
  recordRetired?: boolean;
  recordChangedSinceSubmission?: boolean;
  otherOpenCorrections?: OpenCorrectionBrief[];
  notes: CorrectionNoteDto[];
}

export interface CorrectionTiles {
  pending: number;
  inReview: number;
  applied30d: number;
  dismissed30d: number;
}
