export type LocationLabel = 'HOME' | 'WORK' | 'OTHER';

export type Confidence = 'EXACT' | 'LIKELY' | 'MULTIPLE' | 'UNRESOLVED';

export interface SavedLocationDto {
  id: string;
  label: LocationLabel;
  customName: string | null;
  displayAddress: string;
  normalizedAddress: string;
  geocodePrecision: string | null;
  isDefault: boolean;
  jurisdictionIds: string[];
  confidence: Confidence;
  resolvedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
