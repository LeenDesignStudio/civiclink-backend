import type { ServiceContext } from '../../graphql/context.js';
import { FollowLimitError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor, type Connection } from '../../lib/pagination.js';
import type { Entitlements } from '../billing/entitlements.service.js';
import { parseInput } from '../locations/locations.service.js';
import type { FollowDto } from './follows.dto.js';
import { followSchema, followsQuerySchema, unfollowSchema } from './follows.inputs.js';
import type { FollowsRepo, TxRunner } from './follows.ports.js';

export interface FollowsDeps {
  repo: FollowsRepo;
  entitlements: Entitlements;
  withTx: TxRunner;
}

export class FollowsService {
  constructor(private readonly deps: FollowsDeps) {}

  async follows(ctx: ServiceContext, input: unknown): Promise<Connection<FollowDto>> {
    ctx.authz.require('self.follows:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(followsQuerySchema, input);
    const first = clampFirst(parsed.first, 100, 20);
    const decoded = parsed.after ? decodeCursor(parsed.after) : undefined;
    if (parsed.after && !decoded) {
      throw new ValidationError('Invalid cursor.', [
        { path: 'after', code: 'custom', message: 'Invalid cursor.' },
      ]);
    }
    const rows = await this.deps.repo.listOwned(userId, {
      limit: first + 1,
      ...(decoded ? { after: decoded } : {}),
    });
    return buildConnection(rows, first);
  }

  async follow(ctx: ServiceContext, input: unknown): Promise<{ follow: FollowDto }> {
    ctx.authz.require('self.follows:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(followSchema, input);
    const office = await this.deps.repo.findActiveOffice(parsed.officeId);
    if (!office) throw new NotFoundError();
    if (parsed.officialId) {
      const holds = await this.deps.repo.officialHasTerm(parsed.officialId, parsed.officeId);
      if (!holds) throw new NotFoundError();
    }
    const existing = await this.deps.repo.findByUserOffice(userId, parsed.officeId);
    if (existing) return { follow: existing };
    const limits = await this.deps.entitlements.limits(userId);
    const follow = await this.deps.withTx(
      async (tx) => {
        const again = await this.deps.repo.findByUserOffice(userId, parsed.officeId, tx);
        if (again) return again;
        const count = await this.deps.repo.countOwned(userId, tx);
        if (count >= limits.maxFollows) throw new FollowLimitError(limits.maxFollows);
        return this.deps.repo.insert(
          { userId, officeId: parsed.officeId, officialId: parsed.officialId ?? null },
          tx,
        );
      },
      { isolation: 'Serializable' },
    );
    return { follow };
  }

  async unfollow(ctx: ServiceContext, input: unknown): Promise<{ officeId: string }> {
    ctx.authz.require('self.follows:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(unfollowSchema, input);
    await this.deps.repo.deleteByUserOffice(userId, parsed.officeId);
    return { officeId: parsed.officeId };
  }
}
