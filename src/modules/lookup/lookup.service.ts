import type { ServiceContext } from '../../graphql/context.js';
import type { Clock } from '../../lib/clock.js';
import { signLink, verifyLink } from '../../lib/crypto.js';
import {
  CandidateExpiredError,
  GeocoderUnavailableError,
  LocationNotFoundError,
  LocationOutsideUsError,
  LookupNotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import type { RandomSource } from '../../lib/random.js';
import { GOV_LEVELS, type GovLevel, type JurisdictionType } from '../civic/civic.dto.js';
import { toPublicOffice, toServicePreview, type CivicReadPort } from '../civic/civic.service.js';
import type { CardOffice, Coverage } from '../civic/civic.dto.js';
import { classifyLocation } from './classify.js';
import {
  PRECISIONS,
  type Candidate,
  type Geocoder,
  type Precision,
} from './clients/geocoder.js';
import type {
  Analytics,
  AnalyticsEventProps,
  CivicCard,
  CivicCardLevel,
  Confidence,
  LevelDetail,
  LevelMember,
  LevelSnapshot,
  LookupContext,
  LookupMethod,
  ResolveLocationResult,
  ReverseGeocodeResult,
} from './lookup.dto.js';
import { parseLevelDetail } from './lookup.dto.js';
import {
  parseCivicCardToken,
  parseConfirmCandidate,
  parseResolveLocation,
  parseReverseGeocode,
  type ResolveLocationInput,
} from './lookup.inputs.js';
import type { CreateLookupInput, LookupStore } from './lookup.repo.js';
import { LOOKUP_METHODS } from './lookup.dto.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CANDIDATE_TTL_MS = 10 * 60 * 1000;
const CONFIDENCE_RANK: Record<Confidence, number> = {
  UNRESOLVED: 0,
  MULTIPLE: 1,
  LIKELY: 2,
  EXACT: 3,
};

export interface ContainingJurisdiction {
  id: string;
  level: GovLevel;
  type: JurisdictionType;
  name: string;
}

export interface IntersectingJurisdiction {
  id: string;
  level: GovLevel;
  type: JurisdictionType;
  share: number;
}

/** Structural match for SpatialRepo in src/db/spatial.repo.ts. */
export interface SpatialPort {
  jurisdictionsContainingPoint(lng: number, lat: number): Promise<ContainingJurisdiction[]>;
  jurisdictionsIntersectingArea(
    areaJurisdictionId: string,
    minShare?: number,
  ): Promise<IntersectingJurisdiction[]>;
  nearBoundary(jurisdictionId: string, lng: number, lat: number, meters?: number): Promise<boolean>;
  zctaByZip(zip: string): Promise<string | undefined>;
  placeByNameState(name: string, state: string): Promise<string | undefined>;
  setLookupGeom(id: string, geojson: string): Promise<number>;
}

export type FollowsChecker = (userId: string, officeId: string) => Promise<boolean> | boolean;

export interface LookupServiceDeps {
  repo: LookupStore;
  spatial: SpatialPort;
  geocoder: Geocoder;
  civic: CivicReadPort;
  follows: FollowsChecker;
  analytics: Analytics;
  clock: Clock;
  random: RandomSource;
  signingSecret: string;
  anonTtlDays: number;
}

interface Located {
  id: string;
  level: GovLevel;
  type: JurisdictionType;
  name: string;
  near: boolean;
}

interface ResolvedMatch {
  levelDetail: LevelDetail;
  jurisdictionIds: string[];
  confidence: Confidence;
  partialLevels: GovLevel[];
  countyId: string | null;
  zip: string | null;
}

export class LookupService {
  constructor(private readonly deps: LookupServiceDeps) {}

  async resolveLocation(ctx: ServiceContext, input: unknown): Promise<ResolveLocationResult> {
    ctx.authz.require('public.lookup:create');
    const parsed = parseResolveLocation(input);
    const method = classifyLocation(parsed);
    if (parsed.method && parsed.method !== method) {
      throw new ValidationError('That method does not match the search.', [
        { path: 'input.method', code: 'custom', message: 'That method does not match the search.' },
      ]);
    }
    const started = this.deps.clock.now().getTime();
    this.track('lookup_started', { method });
    try {
      const usable = this.usable(await this.geocodeCandidates(method, parsed));
      if (usable.length > 1) {
        this.track('lookup_completed', { method, latencyMs: this.latency(started) });
        return {
          status: 'NEEDS_CONFIRMATION',
          token: null,
          confidence: null,
          candidates: usable.slice(0, 5).map((candidate) => ({
            displayLabel: candidate.displayLabel.slice(0, 200),
            candidateToken: this.signCandidate(candidate, method),
          })),
        };
      }
      const candidate = usable[0];
      if (!candidate) throw new LocationNotFoundError();
      const saved = await this.resolveCandidate(ctx, method, candidate, started);
      return { status: 'RESOLVED', token: saved.token, confidence: saved.confidence, candidates: [] };
    } catch (err) {
      this.track('lookup_failed', { method, latencyMs: this.latency(started) });
      throw err;
    }
  }

  async confirmLocationCandidate(ctx: ServiceContext, input: unknown): Promise<ResolveLocationResult> {
    ctx.authz.require('public.lookup:create');
    const { candidateToken } = parseConfirmCandidate(input);
    const chosen = this.readCandidate(candidateToken);
    const started = this.deps.clock.now().getTime();
    this.track('lookup_started', { method: chosen.method });
    try {
      if (chosen.candidate.country.toUpperCase() !== 'US') throw new LocationOutsideUsError();
      const saved = await this.resolveCandidate(ctx, chosen.method, chosen.candidate, started);
      return { status: 'RESOLVED', token: saved.token, confidence: saved.confidence, candidates: [] };
    } catch (err) {
      this.track('lookup_failed', { method: chosen.method, latencyMs: this.latency(started) });
      throw err;
    }
  }

  async reverseGeocode(ctx: ServiceContext, input: unknown): Promise<ReverseGeocodeResult> {
    ctx.authz.require('public.lookup:create');
    const point = parseReverseGeocode(input);
    const started = this.deps.clock.now().getTime();
    this.track('lookup_started', { method: 'DEVICE' });
    try {
      const usable = this.usable(await this.geocodeCandidates('DEVICE', point));
      const candidate = usable[0];
      if (!candidate) throw new LocationNotFoundError();
      this.track('lookup_completed', { method: 'DEVICE', latencyMs: this.latency(started) });
      return {
        displayLabel: candidate.displayLabel.slice(0, 200),
        candidateToken: this.signCandidate(candidate, 'DEVICE'),
      };
    } catch (err) {
      this.track('lookup_failed', { method: 'DEVICE', latencyMs: this.latency(started) });
      throw err;
    }
  }

  async civicCard(ctx: ServiceContext, input: unknown): Promise<CivicCard> {
    ctx.authz.require('public.civic:read');
    const token = typeof input === 'string' ? parseCivicCardToken({ token: input }) : parseCivicCardToken(input);
    const row = await this.deps.repo.findByToken(token);
    const now = this.deps.clock.now();
    if (!row || (row.expiresAt && row.expiresAt.getTime() <= now.getTime())) throw new LookupNotFoundError();
    const detail = parseLevelDetail(row.levelDetail);
    if (!detail) throw new LookupNotFoundError();
    const context: LookupContext = {
      token: row.token,
      method: row.method,
      displayLabel: row.displayLabel,
      zip: row.zip,
      confidence: row.confidence,
      jurisdictionIds: row.jurisdictionIds,
      partialLevels: row.partialLevels,
      levels: detail.levels,
      expiresAt: row.expiresAt,
    };
    const offices = (await this.deps.civic.officesForJurisdictions(row.jurisdictionIds)).slice().sort(compareOffices);
    const officeIds = offices.map((office) => office.id);
    const preview = (
      await this.deps.civic.servicesForLinks(row.jurisdictionIds, officeIds, 5)
    )
      .slice(0, 5)
      .map(toServicePreview);
    const levels: CivicCardLevel[] = [];
    for (const level of GOV_LEVELS) {
      levels.push(await this.cardLevel(level, context, offices, ctx, now));
    }
    return {
      token: row.token,
      displayLabel: row.displayLabel,
      method: row.method,
      confidence: row.confidence,
      levels,
      servicesPreview: preview,
    };
  }

  private async resolveCandidate(
    ctx: ServiceContext,
    method: LookupMethod,
    candidate: Candidate,
    started: number,
  ): Promise<{ token: string; confidence: Confidence }> {
    const match = await this.match(method, candidate);
    const userId = ctx.principal.kind === 'resident' ? ctx.principal.userId : null;
    const expiresAt = userId
      ? null
      : new Date(this.deps.clock.now().getTime() + this.deps.anonTtlDays * MS_PER_DAY);
    const zip = fiveDigitZip(candidate.zip);
    const createdInput: CreateLookupInput = {
      token: this.lookupToken(),
      userId,
      method,
      displayLabel: candidate.displayLabel.slice(0, 200),
      zip,
      jurisdictionIds: match.jurisdictionIds,
      confidence: match.confidence,
      partialLevels: match.partialLevels,
      levelDetail: match.levelDetail,
      latencyMs: this.latency(started),
      expiresAt,
    };
    const saved = await this.deps.repo.create(createdInput);
    if (method === 'ADDRESS' || method === 'DEVICE') {
      await this.deps.spatial.setLookupGeom(
        saved.id,
        JSON.stringify({ type: 'Point', coordinates: [candidate.lng, candidate.lat] }),
      );
    }
    const completed: AnalyticsEventProps = {
      method,
      confidence: saved.confidence,
      latencyMs: this.latency(started),
    };
    if (zip) completed.zip = zip;
    if (match.countyId) completed.countyId = match.countyId;
    this.track('lookup_completed', completed);
    return { token: saved.token, confidence: saved.confidence };
  }

  private async match(method: LookupMethod, candidate: Candidate): Promise<ResolvedMatch> {
    if (method === 'ADDRESS' || method === 'DEVICE') return this.matchPoint(candidate);
    if (method === 'ZIP') {
      const zip = fiveDigitZip(candidate.zip);
      if (!zip) throw new LocationNotFoundError();
      const areaId = await this.deps.spatial.zctaByZip(zip);
      if (!areaId) throw new LocationNotFoundError();
      return this.matchArea(areaId, zip);
    }
    if (!candidate.city || !candidate.state) throw new LocationNotFoundError();
    const areaId = await this.deps.spatial.placeByNameState(candidate.city, candidate.state);
    if (!areaId) throw new LocationNotFoundError();
    return this.matchArea(areaId, fiveDigitZip(candidate.zip));
  }

  private async matchPoint(candidate: Candidate): Promise<ResolvedMatch> {
    const contained = await this.deps.spatial.jurisdictionsContainingPoint(candidate.lng, candidate.lat);
    if (contained.length === 0) throw new LocationNotFoundError();
    const precise = candidate.precision === 'ROOFTOP' || candidate.precision === 'RANGE_INTERPOLATED';
    const located: Located[] = [];
    for (const jurisdiction of contained) {
      const near = precise
        ? await this.deps.spatial.nearBoundary(jurisdiction.id, candidate.lng, candidate.lat)
        : false;
      located.push({ ...jurisdiction, near });
    }
    return this.summarize(located, (members) => pointConfidence(members, precise), fiveDigitZip(candidate.zip));
  }

  private async matchArea(areaId: string, zip: string | null): Promise<ResolvedMatch> {
    const hits = await this.deps.spatial.jurisdictionsIntersectingArea(areaId);
    if (hits.length === 0) throw new LocationNotFoundError();
    const located: Located[] = hits.map((hit) => ({
      id: hit.id,
      level: hit.level,
      type: hit.type,
      name: '',
      near: false,
    }));
    return this.summarize(located, areaConfidence, zip);
  }

  private async summarize(
    located: Located[],
    confidenceFor: (members: Located[]) => Confidence,
    zip: string | null,
  ): Promise<ResolvedMatch> {
    const briefs = await this.deps.civic.jurisdictionBriefs(located.map((item) => item.id));
    const names = new Map(briefs.map((brief) => [brief.id, brief.name]));
    const grouped = new Map<GovLevel, Located[]>();
    for (const item of located) {
      const named: Located = {
        ...item,
        name: names.get(item.id) ?? (item.name || 'Unnamed jurisdiction'),
      };
      const list = grouped.get(named.level) ?? [];
      list.push(named);
      grouped.set(named.level, list);
    }
    const levels: LevelSnapshot[] = GOV_LEVELS.map((level) => {
      const members = grouped.get(level) ?? [];
      return {
        level,
        confidence: members.length === 0 ? 'UNRESOLVED' : confidenceFor(members),
        members: members.map((member) => ({ id: member.id, name: member.name, type: member.type })),
      };
    });
    const jurisdictionIds = located.map((item) => item.id);
    const offices = await this.deps.civic.officesForJurisdictions(jurisdictionIds);
    const levelsWithOffice = new Set(offices.map((office) => office.jurisdiction.level));
    const partialLevels = GOV_LEVELS.filter((level) => {
      const members = grouped.get(level) ?? [];
      if (members.length === 0) return true;
      return !levelsWithOffice.has(level);
    });
    const matched = levels
      .filter((level) => level.members.length > 0)
      .map((level) => level.confidence);
    const confidence = worst(matched);
    if (confidence === 'UNRESOLVED') throw new LocationNotFoundError();
    const county = located.find((item) => item.type === 'COUNTY');
    return {
      levelDetail: { levels },
      jurisdictionIds,
      confidence,
      partialLevels,
      countyId: county?.id ?? null,
      zip,
    };
  }

  private async cardLevel(
    level: GovLevel,
    context: LookupContext,
    offices: Awaited<ReturnType<CivicReadPort['officesForJurisdictions']>>,
    ctx: ServiceContext,
    now: Date,
  ): Promise<CivicCardLevel> {
    const snapshot = context.levels.find((entry) => entry.level === level);
    const members = snapshot?.members ?? [];
    const confidence = snapshot?.confidence ?? 'UNRESOLVED';
    const levelOffices = offices.filter((office) => office.jurisdiction.level === level);
    const coverage: Coverage = members.length === 0 ? 'NONE' : levelOffices.length === 0 ? 'PARTIAL' : 'COVERED';
    const cards: CardOffice[] = [];
    for (const office of levelOffices) {
      const profile = toPublicOffice(office, now, context);
      let isFollowed: boolean | null = null;
      if (ctx.principal.kind === 'resident') {
        isFollowed = await this.deps.follows(ctx.principal.userId, office.id);
      }
      cards.push({ ...profile, isFollowed });
    }
    return {
      level,
      confidence,
      coverage,
      notice: levelNotice(coverage, confidence, members),
      offices: cards,
    };
  }

  private async geocodeCandidates(method: LookupMethod, input: ResolveLocationInput): Promise<Candidate[]> {
    try {
      if (method === 'DEVICE') {
        if (input.lat === undefined || input.lng === undefined) {
          throw new ValidationError('Latitude and longitude are both required.', [
            { path: 'input.lat', code: 'custom', message: 'Latitude and longitude are both required.' },
          ]);
        }
        return await this.deps.geocoder.reverse(input.lat, input.lng);
      }
      if (!input.query) {
        throw new ValidationError('Enter a place to search.', [
          { path: 'input.query', code: 'custom', message: 'Enter a place to search.' },
        ]);
      }
      return await this.deps.geocoder.geocode(input.query);
    } catch (err) {
      if (
        err instanceof GeocoderUnavailableError ||
        err instanceof ValidationError ||
        err instanceof LocationNotFoundError ||
        err instanceof LocationOutsideUsError
      ) {
        throw err;
      }
      throw new GeocoderUnavailableError({ cause: err });
    }
  }

  private usable(candidates: Candidate[]): Candidate[] {
    if (candidates.length === 0) throw new LocationNotFoundError();
    const domestic = candidates.filter(
      (candidate) =>
        candidate.country.toUpperCase() === 'US' &&
        candidate.lat >= -90 &&
        candidate.lat <= 90 &&
        candidate.lng >= -180 &&
        candidate.lng <= 180,
    );
    if (domestic.length === 0) throw new LocationOutsideUsError();
    return domestic;
  }

  private signCandidate(candidate: Candidate, method: LookupMethod): string {
    const payload: Record<string, string> = {
      v: '1',
      method,
      displayLabel: candidate.displayLabel.slice(0, 200),
      lat: String(candidate.lat),
      lng: String(candidate.lng),
      country: candidate.country,
      precision: candidate.precision,
    };
    if (candidate.zip) payload.zip = candidate.zip;
    if (candidate.city) payload.city = candidate.city;
    if (candidate.state) payload.state = candidate.state;
    return signLink(
      this.deps.signingSecret,
      payload,
      new Date(this.deps.clock.now().getTime() + CANDIDATE_TTL_MS),
    );
  }

  private readCandidate(token: string): { method: LookupMethod; candidate: Candidate } {
    const payload = verifyLink(this.deps.signingSecret, token, this.deps.clock.now());
    if (!payload || payload.v !== '1' || !isLookupMethod(payload.method)) throw new CandidateExpiredError();
    if (typeof payload.displayLabel !== 'string' || typeof payload.lat !== 'string' || typeof payload.lng !== 'string') {
      throw new CandidateExpiredError();
    }
    const lat = Number(payload.lat);
    const lng = Number(payload.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new CandidateExpiredError();
    const precision: Precision = isPrecision(payload.precision) ? payload.precision : 'APPROXIMATE';
    const country = typeof payload.country === 'string' ? payload.country : '';
    const candidate: Candidate = { displayLabel: payload.displayLabel, lat, lng, country, precision };
    if (typeof payload.zip === 'string' && payload.zip.length > 0) candidate.zip = payload.zip;
    if (typeof payload.city === 'string' && payload.city.length > 0) candidate.city = payload.city;
    if (typeof payload.state === 'string' && payload.state.length > 0) candidate.state = payload.state;
    return { method: payload.method, candidate };
  }

  private lookupToken(): string {
    return this.deps.random.token(16).padEnd(22, '0').slice(0, 22);
  }

  private latency(started: number): number {
    return Math.max(0, this.deps.clock.now().getTime() - started);
  }

  private track(name: string, props: AnalyticsEventProps): void {
    this.deps.analytics.track(name, props);
  }
}

function isLookupMethod(value: unknown): value is LookupMethod {
  return typeof value === 'string' && (LOOKUP_METHODS as readonly string[]).includes(value);
}

function isPrecision(value: unknown): value is Precision {
  return typeof value === 'string' && (PRECISIONS as readonly string[]).includes(value);
}

function fiveDigitZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const digits = zip.slice(0, 5);
  return /^\d{5}$/.test(digits) ? digits : null;
}

function hasMultipleType(members: Array<{ type: string }>): boolean {
  const counts = new Map<string, number>();
  for (const member of members) counts.set(member.type, (counts.get(member.type) ?? 0) + 1);
  return [...counts.values()].some((count) => count > 1);
}

function pointConfidence(members: Located[], precise: boolean): Confidence {
  if (hasMultipleType(members)) return 'MULTIPLE';
  if (!precise || members.some((member) => member.near)) return 'LIKELY';
  return 'EXACT';
}

function areaConfidence(members: Located[]): Confidence {
  return hasMultipleType(members) ? 'MULTIPLE' : 'EXACT';
}

function worst(values: Confidence[]): Confidence {
  if (values.length === 0) return 'UNRESOLVED';
  return values.reduce((min, value) => (CONFIDENCE_RANK[value] < CONFIDENCE_RANK[min] ? value : min));
}

function compareOffices(
  left: { displayOrder: number; name: string; id: string },
  right: { displayOrder: number; name: string; id: string },
): number {
  return left.displayOrder - right.displayOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function levelNotice(coverage: Coverage, confidence: Confidence, members: LevelMember[]): string | null {
  if (confidence === 'MULTIPLE') {
    const groups = new Map<string, string[]>();
    for (const member of members) {
      const list = groups.get(member.type) ?? [];
      list.push(member.name);
      groups.set(member.type, list);
    }
    const names = [...groups.values()].filter((list) => list.length > 1).flat();
    if (names.length > 1) return `Your ZIP code overlaps ${formatOverlap(names)}.`;
  }
  if (coverage === 'NONE') return 'We do not have records for this level yet.';
  if (coverage === 'PARTIAL') return 'Coverage at this level is incomplete.';
  return null;
}

function formatOverlap(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0] ?? ''} and ${names[1] ?? ''}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1] ?? ''}`;
}
