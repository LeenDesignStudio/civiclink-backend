# API reference

Generated from the GraphQL schema. Do not edit by hand — run `pnpm docs:api`.

## Query

### `adminAlert`

- Arguments: `id: UUID!`
- Returns: `AdminAlert`
- Scope: `{"permission":"admin.alert:read"}`

### `adminAlerts`

- Arguments: `after: String, filter: AdminAlertFilter, first: Int`
- Returns: `AlertConnection`
- Scope: `{"permission":"admin.alert:read"}`

### `adminCorrection`

- Arguments: `id: UUID!`
- Returns: `AdminCorrection`
- Scope: `{"permission":"admin.correction:read"}`

### `adminCorrections`

- Arguments: `after: String, filter: AdminCorrectionFilter, first: Int`
- Returns: `AdminCorrectionConnection`
- Scope: `{"permission":"admin.correction:read"}`

### `adminDashboardCounts`

- Arguments: `none`
- Returns: `AdminDashboardCounts`
- Scope: `{"permission":"admin.dashboard:read"}`

### `adminJurisdiction`

- Arguments: `id: ID!`
- Returns: `AdminJurisdiction`
- Scope: `{"permission":"admin.civic:read"}`

### `adminJurisdictions`

- Arguments: `after: String, filter: AdminJurisdictionFilter, first: Int, sort: AdminCivicSort`
- Returns: `AdminJurisdictionConnection`
- Scope: `{"permission":"admin.civic:read"}`

### `adminMe`

- Arguments: `none`
- Returns: `AdminMe`
- Scope: `{"permission":"admin.dashboard:read"}`

### `adminOffice`

- Arguments: `id: ID!`
- Returns: `AdminOffice`
- Scope: `{"permission":"admin.civic:read"}`

### `adminOffices`

- Arguments: `after: String, filter: AdminOfficeFilter, first: Int, sort: AdminCivicSort`
- Returns: `AdminOfficeConnection`
- Scope: `{"permission":"admin.civic:read"}`

### `adminOfficial`

- Arguments: `id: ID!`
- Returns: `AdminOfficial`
- Scope: `{"permission":"admin.civic:read"}`

### `adminOfficials`

- Arguments: `after: String, filter: AdminOfficialFilter, first: Int, sort: AdminCivicSort`
- Returns: `AdminOfficialConnection`
- Scope: `{"permission":"admin.civic:read"}`

### `adminService`

- Arguments: `id: ID!`
- Returns: `AdminService`
- Scope: `{"permission":"admin.civic:read"}`

### `adminServices`

- Arguments: `after: String, filter: AdminServiceFilter, first: Int, sort: AdminCivicSort`
- Returns: `AdminServiceConnection`
- Scope: `{"permission":"admin.civic:read"}`

### `adminSource`

- Arguments: `id: UUID!`
- Returns: `AdminSource`
- Scope: `{"permission":"admin.civic:read"}`

### `adminSources`

- Arguments: `after: String, first: Int`
- Returns: `SourceConnection`
- Scope: `{"permission":"admin.civic:read"}`

### `adminUsers`

- Arguments: `after: String, filter: AdminUserFilter, first: Int`
- Returns: `AdminUserConnection`
- Scope: `{"permission":"admin.users:read"}`

### `changeLog`

- Arguments: `after: String, entityId: UUID!, entityType: String!, first: Int`
- Returns: `ChangeLogConnection`
- Scope: `{"permission":"admin.changelog:read"}`

### `civicCard`

- Arguments: `token: String!`
- Returns: `CivicCard`
- Scope: `{"public":true}`

### `confirmLocationCandidate`

- Arguments: `candidateToken: String!`
- Returns: `ResolveLocationResult`
- Scope: `{"public":true}`

### `follows`

- Arguments: `after: String, first: Int`
- Returns: `FollowConnection`
- Scope: `{"residentActive":true}`

### `health`

- Arguments: `none`
- Returns: `String`
- Scope: `{"public":true}`

### `invoices`

- Arguments: `after: String, first: Int`
- Returns: `InvoiceConnection`
- Scope: `{"residentActive":true,"permission":"self.billing:manage"}`

### `legalVersions`

- Arguments: `none`
- Returns: `[LegalVersion!]`
- Scope: `{"public":true}`

### `me`

- Arguments: `none`
- Returns: `Me`
- Scope: `{"resident":true,"permission":"self.profile:read"}`

### `myCorrections`

- Arguments: `after: String, first: Int`
- Returns: `MyCorrectionConnection`
- Scope: `{"residentActive":true}`

### `notificationPreferences`

- Arguments: `none`
- Returns: `[NotificationPreference!]`
- Scope: `{"residentActive":true}`

### `notifications`

- Arguments: `after: String, filter: NotificationFilter, first: Int`
- Returns: `NotificationConnection`
- Scope: `{"residentActive":true}`

### `office`

- Arguments: `lookupToken: String, slug: String!`
- Returns: `Office`
- Scope: `{"public":true}`

### `official`

- Arguments: `lookupToken: String, slug: String!`
- Returns: `Official`
- Scope: `{"public":true}`

### `pendingSourceChanges`

- Arguments: `decision: ChangeDecision, first: Int, sourceId: UUID`
- Returns: `[PendingSourceChange!]`
- Scope: `{"permission":"admin.civic:read"}`

### `plans`

- Arguments: `none`
- Returns: `[Plan!]`
- Scope: `{"public":true}`

### `previewAlert`

- Arguments: `id: UUID!`
- Returns: `AlertPreview`
- Scope: `{"permission":"admin.alert:write"}`

### `resolveLocation`

- Arguments: `input: ResolveLocationInput!`
- Returns: `ResolveLocationResult`
- Scope: `{"public":true}`

### `reverseGeocode`

- Arguments: `lat: Float!, lng: Float!`
- Returns: `ReverseGeocodeResult`
- Scope: `{"public":true}`

### `savedLocations`

- Arguments: `none`
- Returns: `[SavedLocation!]`
- Scope: `{"residentActive":true}`

### `serviceCategories`

- Arguments: `none`
- Returns: `[ServiceCategory!]`
- Scope: `{"public":true}`

### `services`

- Arguments: `after: String, categoryId: ID, first: Int, jurisdictionId: ID, lookupToken: String, officeId: ID`
- Returns: `ServiceConnection`
- Scope: `{"public":true}`

### `subscription`

- Arguments: `none`
- Returns: `Subscription`
- Scope: `{"residentActive":true,"permission":"self.billing:manage"}`

### `unreadNotificationCount`

- Arguments: `none`
- Returns: `Int`
- Scope: `{"residentActive":true}`

## Mutation

### `acceptTerms`

- Arguments: `input: AcceptTermsInput!`
- Returns: `MePayload`
- Scope: `{"resident":true,"permission":"self.profile:update"}`

### `addCorrectionNote`

- Arguments: `input: AddCorrectionNoteInput!`
- Returns: `AdminCorrectionPayload`
- Scope: `{"permission":"admin.correction:resolve"}`

### `adminSignOut`

- Arguments: `none`
- Returns: `AdminSignOutPayload`
- Scope: `{"permission":"admin.dashboard:read"}`

### `applyCorrection`

- Arguments: `input: ApplyCorrectionInput!`
- Returns: `AdminCorrectionPayload`
- Scope: `{"permission":"admin.correction:resolve"}`

### `assignCorrection`

- Arguments: `input: AssignCorrectionInput!`
- Returns: `AdminCorrectionPayload`
- Scope: `{"permission":"admin.correction:resolve"}`

### `createCheckoutSession`

- Arguments: `input: CreateCheckoutSessionInput!`
- Returns: `CheckoutSessionPayload`
- Scope: `{"residentActive":true,"permission":"self.billing:manage"}`

### `createPortalSession`

- Arguments: `none`
- Returns: `PortalSessionPayload`
- Scope: `{"residentActive":true,"permission":"self.billing:manage"}`

### `decideSourceChange`

- Arguments: `input: DecideSourceChangeInput!`
- Returns: `DecideSourceChangePayload`
- Scope: `{"permission":"admin.source:decide"}`

### `deleteAlertDraft`

- Arguments: `input: AlertIdInput!`
- Returns: `DeleteAlertDraftPayload`
- Scope: `{"permission":"admin.alert:write"}`

### `deleteNotification`

- Arguments: `input: DeleteNotificationInput!`
- Returns: `DeleteNotificationPayload`
- Scope: `{"residentActive":true}`

### `deleteSavedLocation`

- Arguments: `input: SavedLocationIdInput!`
- Returns: `DeleteSavedLocationPayload`
- Scope: `{"residentActive":true}`

### `dismissCorrection`

- Arguments: `input: DismissCorrectionInput!`
- Returns: `AdminCorrectionPayload`
- Scope: `{"permission":"admin.correction:resolve"}`

### `endOfficeTerm`

- Arguments: `input: EndOfficeTermInput!`
- Returns: `OfficeTermPayload`
- Scope: `{"permission":"admin.civic:write"}`

### `exportCsv`

- Arguments: `input: ExportCsvInput!`
- Returns: `ExportCsvPayload`
- Scope: `{"permission":"admin.export:csv"}`

### `follow`

- Arguments: `input: FollowInput!`
- Returns: `FollowPayload`
- Scope: `{"residentActive":true}`

### `inviteAdmin`

- Arguments: `input: InviteAdminInput!`
- Returns: `AdminUserPayload`
- Scope: `{"permission":"admin.users:manage"}`

### `markCorrectionInReview`

- Arguments: `input: CorrectionIdInput!`
- Returns: `AdminCorrectionPayload`
- Scope: `{"permission":"admin.correction:resolve"}`

### `markNotificationsRead`

- Arguments: `input: MarkNotificationsReadInput!`
- Returns: `MarkNotificationsReadPayload`
- Scope: `{"residentActive":true}`

### `registerPushSubscription`

- Arguments: `input: RegisterPushSubscriptionInput!`
- Returns: `RegisterPushSubscriptionPayload`
- Scope: `{"residentActive":true}`

### `removePushSubscription`

- Arguments: `input: RemovePushSubscriptionInput!`
- Returns: `RemovePushSubscriptionPayload`
- Scope: `{"residentActive":true}`

### `requestAccountDeletion`

- Arguments: `input: RequestAccountDeletionInput!`
- Returns: `RequestAccountDeletionPayload`
- Scope: `{"residentActive":true,"permission":"self.account:delete"}`

### `restoreAccount`

- Arguments: `none`
- Returns: `MePayload`
- Scope: `{"resident":true,"permission":"self.account:delete"}`

### `restoreJurisdiction`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `restoreOffice`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `restoreOfficial`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `restoreService`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `retireJurisdiction`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `retireOffice`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `retireOfficial`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `retireService`

- Arguments: `id: ID!, retireActiveOffices: Boolean`
- Returns: `RecordStatusPayload`
- Scope: `{"permission":"admin.civic:retire"}`

### `saveAlertDraft`

- Arguments: `input: SaveAlertDraftInput!`
- Returns: `AlertPayload`
- Scope: `{"permission":"admin.alert:write"}`

### `saveLocation`

- Arguments: `input: SaveLocationInput!`
- Returns: `SaveLocationPayload`
- Scope: `{"residentActive":true}`

### `sendAlert`

- Arguments: `input: SendAlertInput!`
- Returns: `AlertPayload`
- Scope: `{"permission":"admin.alert:send"}`

### `sendTestAlert`

- Arguments: `input: AlertIdInput!`
- Returns: `SendTestAlertPayload`
- Scope: `{"permission":"admin.alert:write"}`

### `sendTestNotification`

- Arguments: `none`
- Returns: `SendTestNotificationPayload`
- Scope: `{"residentActive":true}`

### `setAdminStatus`

- Arguments: `input: SetAdminStatusInput!`
- Returns: `AdminUserPayload`
- Scope: `{"permission":"admin.users:manage"}`

### `setDefaultLocation`

- Arguments: `input: SavedLocationIdInput!`
- Returns: `SaveLocationPayload`
- Scope: `{"residentActive":true}`

### `setOfficeTerm`

- Arguments: `input: SetOfficeTermInput!`
- Returns: `OfficeTermPayload`
- Scope: `{"permission":"admin.civic:write"}`

### `signOut`

- Arguments: `input: SignOutInput`
- Returns: `SignOutPayload`
- Scope: `{"resident":true,"permission":"self.session:manage"}`

### `submitContactMessage`

- Arguments: `input: SubmitContactMessageInput!`
- Returns: `SubmitContactMessagePayload`
- Scope: `{"public":true}`

### `submitCorrection`

- Arguments: `input: SubmitCorrectionInput!`
- Returns: `SubmitCorrectionPayload`
- Scope: `{"residentActive":true}`

### `triggerSourceRefresh`

- Arguments: `input: TriggerSourceRefreshInput!`
- Returns: `TriggerSourceRefreshPayload`
- Scope: `{"permission":"admin.source:run"}`

### `unfollow`

- Arguments: `input: UnfollowInput!`
- Returns: `UnfollowPayload`
- Scope: `{"residentActive":true}`

### `updateAdminRole`

- Arguments: `input: UpdateAdminRoleInput!`
- Returns: `AdminUserPayload`
- Scope: `{"permission":"admin.users:manage"}`

### `updateNotificationPreference`

- Arguments: `input: UpdateNotificationPreferenceInput!`
- Returns: `UpdateNotificationPreferencePayload`
- Scope: `{"residentActive":true}`

### `updateProfile`

- Arguments: `input: UpdateProfileInput!`
- Returns: `MePayload`
- Scope: `{"residentActive":true,"permission":"self.profile:update"}`

### `updateSavedLocation`

- Arguments: `input: UpdateSavedLocationInput!`
- Returns: `SaveLocationPayload`
- Scope: `{"residentActive":true}`

### `upsertJurisdiction`

- Arguments: `input: UpsertJurisdictionInput!`
- Returns: `AdminJurisdiction`
- Scope: `{"permission":"admin.civic:write"}`

### `upsertOffice`

- Arguments: `input: UpsertOfficeInput!`
- Returns: `AdminOffice`
- Scope: `{"permission":"admin.civic:write"}`

### `upsertOfficial`

- Arguments: `input: UpsertOfficialInput!`
- Returns: `AdminOfficial`
- Scope: `{"permission":"admin.civic:write"}`

### `upsertService`

- Arguments: `input: UpsertServiceInput!`
- Returns: `AdminService`
- Scope: `{"permission":"admin.civic:write"}`

### `upsertServiceCategory`

- Arguments: `input: UpsertServiceCategoryInput!`
- Returns: `AdminServiceCategory`
- Scope: `{"permission":"admin.civic:write"}`

### `upsertSource`

- Arguments: `input: UpsertSourceInput!`
- Returns: `SourcePayload`
- Scope: `{"permission":"admin.source:write"}`

