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

export type DismissReason = 'ALREADY_CORRECT' | 'INSUFFICIENT_EVIDENCE' | 'OUT_OF_SCOPE' | 'DUPLICATE' | 'OTHER';

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
  currentValueSnapshot: { value: string | null } | null;
  assigneeId: string | null;
  submitterDisplayName: string | null;
  lookupToken: string | null;
  resolvedAt: Date | null;
  notes: CorrectionNoteDto[];
}
