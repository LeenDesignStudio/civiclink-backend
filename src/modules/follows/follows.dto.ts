export type GovLevel = 'FEDERAL' | 'STATE' | 'COUNTY' | 'MUNICIPAL' | 'EDUCATION' | 'SPECIAL';

export interface FollowOffice {
  id: string;
  name: string;
  level: GovLevel;
  lastUpdatedAt: Date;
}

export interface FollowHolder {
  id: string;
  fullName: string;
  displayName: string | null;
}

export interface FollowDto {
  id: string;
  officeId: string;
  officialId: string | null;
  createdAt: Date;
  office: FollowOffice;
  holder: FollowHolder | null;
}
