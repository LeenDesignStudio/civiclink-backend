import type { AlertsService } from '../modules/alerts/alerts.service.js';
import type { AdminUsersService } from '../modules/admin-users/admin-users.service.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { BillingService } from '../modules/billing/billing.service.js';
import type { CivicService } from '../modules/civic/civic.service.js';
import type { ContactService } from '../modules/contact/contact.service.js';
import type { CorrectionsService } from '../modules/corrections/corrections.service.js';
import type { FollowsService } from '../modules/follows/follows.service.js';
import type { LocationsService } from '../modules/locations/locations.service.js';
import type { LookupService } from '../modules/lookup/lookup.service.js';
import type { NotificationsService } from '../modules/notifications/notifications.service.js';
import type { ResidentsService } from '../modules/residents/residents.service.js';
import type { ExportService } from '../modules/sources/export.js';
import type { SourcesService } from '../modules/sources/sources.service.js';

export interface AppServices {
  civic: CivicService;
  lookup: LookupService;
  residents: ResidentsService;
  locations: LocationsService;
  follows: FollowsService;
  corrections: CorrectionsService;
  notifications: NotificationsService;
  alerts: AlertsService;
  billing: BillingService;
  adminUsers: AdminUsersService;
  audit: AuditService;
  contact: ContactService;
  sources: SourcesService;
  exports: ExportService;
}
