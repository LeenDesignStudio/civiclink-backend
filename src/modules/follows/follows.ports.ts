import type { FollowDto } from './follows.dto.js';

/** See Locations `TxRunner`. Production `withTx` uses Serializable isolation. */
export type TxRunner = <T>(
  fn: (tx: unknown) => Promise<T>,
  options?: { isolation?: 'Serializable' | 'ReadCommitted' },
) => Promise<T>;

export interface NewFollow {
  userId: string;
  officeId: string;
  officialId: string | null;
}

export interface FollowPage {
  limit: number;
  after?: { createdAt: Date; id: string };
}

export interface FollowsRepo {
  findActiveOffice(officeId: string): Promise<FollowDto['office'] | null>;
  officialHasTerm(officialId: string, officeId: string): Promise<boolean>;
  findByUserOffice(userId: string, officeId: string, tx?: unknown): Promise<FollowDto | null>;
  countOwned(userId: string, tx?: unknown): Promise<number>;
  insert(row: NewFollow, tx?: unknown): Promise<FollowDto>;
  deleteByUserOffice(userId: string, officeId: string): Promise<boolean>;
  listOwned(userId: string, page: FollowPage): Promise<FollowDto[]>;
}
