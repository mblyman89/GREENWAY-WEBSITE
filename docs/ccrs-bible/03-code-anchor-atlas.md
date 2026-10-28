# 03 — Code Anchor Atlas (generated from the tree)

Generated 2026-10-21 15:33Z at commit `52cacbbf23778b8a13d0368a8113f45894a4a504` by `build_atlas_part.py`.

**Rules for using this part**

1. Every `L####` here was read from the file at the commit above. Before editing, run `git diff 52cacbb -- <file>`; if the file changed, re-run the generator and re-pin.
2. Snippets are verbatim. If a snippet here disagrees with the file, the FILE wins and this part must be regenerated — never 'fix' the atlas by hand.
3. Anchors are grouped by the flow they belong to: (A) batch builders, (B) core/pure helpers, (C) identifiers, (D) week/ledger, (E) triage/gate, (F) adjustments & corrections, (G) returns/disposition, (H) intake & Cultivera identity, (I) routes/pages/components, (J) schema.

## 0. Module inventory (line counts + every `export` with its line)

### `src/lib/compliance/ccrs-batch.ts` (1621 L)

- L107: `export type CcrsFile = {`
- L119: `export type CcrsSyncIssue = {`
- L136: `export type CcrsBatch = {`
- L1021: `export async function buildCcrsBatch(`

### `src/lib/compliance/ccrs-batch-core.ts` (1554 L)

- L27: `export type CcrsRetailerFileType =`
- L37: `export const CCRS_COLUMNS: Record<CcrsRetailerFileType, readonly string[]> = {`
- L139: `export const CCRS_SALE_TYPES = [`
- L144: `export type CcrsSaleType = (typeof CCRS_SALE_TYPES)[number];`
- L152: `export function saleTypeForOrder(isMedical: boolean): CcrsSaleType {`
- L160: `export const CCRS_STRAIN_TYPES = ["Indica", "Sativa", "Hybrid"] as const;`
- L161: `export type CcrsStrainType = (typeof CCRS_STRAIN_TYPES)[number];`
- L173: `export function normalizeStrainType(`
- L212: `export const CCRS_INVENTORY_CATEGORIES = [`
- L218: `export type CcrsInventoryCategory = (typeof CCRS_INVENTORY_CATEGORIES)[number];`
- L225: `export const CCRS_INVENTORY_TYPES: Record<CcrsInventoryCategory, readonly string[]> = {`
- L284: `export const CCRS_LEGACY_TYPE_ALIASES: Record<string, { category: CcrsInventoryCategory; type: string }> = {`
- L307: `export type ProductClassificationResult =`
- L331: `export function validateProductClassification(`
- L430: `export function deriveCcrsClassificationFromType(`
- L497: `export function clampText(`
- L507: `export const CCRS_PRODUCT_NAME_MAX = 75;`
- L508: `export const CCRS_PRODUCT_DESCRIPTION_MAX = 250;`
- L521: `export type CcrsIssueSeverity = "error" | "warning";`
- L544: `export function classifyWarning(message: string | null | undefined): CcrsIssueSeverity {`
- L560: `export const CCRS_UPLOAD_GROUPS: readonly CcrsRetailerFileType[][] = [`
- L567: `export const CCRS_UPLOAD_ORDER: readonly CcrsRetailerFileType[] = CCRS_UPLOAD_GROUPS.flat();`
- L570: `export function uploadGroupOf(type: CcrsRetailerFileType): number {`
- L582: `export class CcrsEncodeError extends Error {`
- L590: `export function ccrsHasLineBreak(v: unknown): boolean {`
- L615: `export type CcrsUnencodableReason = "line break" | "comma";`
- L618: `export function ccrsUnencodableReason(v: unknown): CcrsUnencodableReason | null {`
- L635: `export const CCRS_FREE_TEXT_COLUMNS: Partial<Record<CcrsRetailerFileType, readonly string[]>> = {`
- L641: `export function ccrsFreeText(v: string): string {`
- L645: `export type CcrsWithheldRow = { label: string; column: string; value: string; reason: CcrsUnencodableReason };`
- L646: `export type CcrsRewrittenCell = { label: string; column: string; before: string; after: string };`
- L659: `export function withholdUnencodableRows(`
- L699: `export const CCRS_UNENCODABLE_CODE = {`
- L713: `export function unencodableMessage(fileType: string, withheld: { label: string; column: string; reason?: CcrsUnencodableReason }[]): string {`
- L728: `export function freeTextRewriteMessage(fileType: string, rewritten: CcrsRewrittenCell[]): string {`
- L747: `export function ccrsCell(v: unknown): string {`
- L763: `export function ccrsReaderSplit(line: string): string[] {`
- L774: `export function ccrsDate(iso: string | Date): string {`
- L796: `export function ccrsFileStamp(now: Date = new Date()): string {`
- L809: `export function ccrsFileName(`
- L826: `export function assembleCcrsFile(opts: {`
- L869: `export function padHeaderRowsForTemplates(`
- L907: `export function verifySaleNumericColumns(rows: ReadonlyArray<readonly string[]>): CcrsBatchProblem[] {`
- L945: `export const SALE_TYPES_ZERO_EXCISE_ALLOWED: readonly string[] = ["RecreationalMedical", "Wholesale"];`
- L947: `export function verifySaleExciseRule(rows: ReadonlyArray<readonly string[]>): CcrsBatchProblem[] {`
- L977: `export type CcrsBatchProblem = {`
- L983: `export type CcrsBatchVerification = {`
- L994: `export function splitCsvLine(line: string): string[] {`
- L1040: `export function verifyCcrsFile(`
- L1185: `export function verifyCcrsBatch(`
- L1202: `export function __runCcrsBatchCoreTests(): void {`

### `src/lib/compliance/ccrs-sales.ts` (535 L)

- L49: `export type CcrsLicenseSettings = {`
- L54: `export type CcrsBuildResult = {`
- L93: `export async function getCcrsLicenseSettings(): Promise<CcrsLicenseSettings> {`
- L192: `export async function buildCcrsSaleCsv(fromISO: string, toISO: string): Promise<CcrsBuildResult> {`

### `src/lib/compliance/ccrs-identifiers.ts` (456 L)

- L39: `export const CCRS_EXTERNAL_ID_MAX = 100;`
- L51: `export function mintExternalId(raw: string): string {`
- L63: `export const sanitizeExternalId = mintExternalId;`
- L69: `export function passThroughExternalId(raw: string | null | undefined): string {`
- L82: `export function validatePassThroughExternalId(value: string | null | undefined): string[] {`
- L99: `export function validateExternalId(value: string | null | undefined): string[] {`
- L121: `export function validateLicenseNumber(`
- L146: `export type ExternalIdCollision = {`
- L161: `export function findExternalIdCollisions(`
- L178: `export type SaleIdProblem = {`
- L192: `export function checkSaleIdentifierIntegrity(`
- L244: `export type LotIdentitySource = {`
- L264: `export function assignedInventoryExternalId(`
- L283: `export function deriveInventoryExternalId(src: LotIdentitySource): string | null {`
- L294: `export function mintInventoryExternalId(src: LotIdentitySource): string | null {`
- L315: `export function resolveSaleInventoryExternalId(opts: {`
- L336: `export function __runCcrsIdentifierTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-week-core.ts` (555 L)

- L48: `export function addDaysIso(iso: string, days: number): string {`
- L55: `export function isoWeekday(iso: string): number {`
- L61: `export function isoDayDiff(aIso: string, bIso: string): number {`
- L71: `export type CcrsWeek = {`
- L83: `export function weekStartFor(dateIso: string): string {`
- L88: `export function weekFromStart(startIso: string): CcrsWeek {`
- L95: `export function weekContaining(dateIso: string): CcrsWeek {`
- L104: `export function lastCompletedWeek(todayIso: string): CcrsWeek {`
- L109: `export function weekFromKey(key: string): CcrsWeek | null {`
- L123: `export type WeekResolution = "submitted" | "nothing_to_report";`
- L125: `export type WeekStatus =`
- L135: `export type WeekDeadline = {`
- L149: `export function weekDeadline(`
- L170: `export type WeeklyOverview = {`
- L190: `export function weeklyDeadlineOverview(`
- L247: `export type ReminderStage = "thursday_heads_up" | "saturday_wrap" | "sunday_due" | "overdue_daily";`
- L249: `export type PlannedReminder = {`
- L266: `export function planWeeklyReminders(`
- L342: `export function __runCcrsWeekTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-week-store.ts` (161 L)

- L25: `export type WeekSubmissionRow = {`
- L47: `export async function listWeekSubmissions(limit = 12): Promise<WeekSubmissionRow[]> {`
- L63: `export async function getWeekResolutions(lookbackWeeks = 8): Promise<Map<string, WeekResolution>> {`
- L71: `export async function getWeeklyOverview(opts?: { lookbackWeeks?: number }): Promise<WeeklyOverview> {`
- L84: `export async function resolveWeek(opts: {`
- L128: `export async function unresolveWeek(weekKey: string): Promise<{ ok: boolean; error?: string }> {`
- L142: `export async function setWeekErrorStatus(opts: {`

### `src/lib/compliance/ccrs-error-triage-core.ts` (366 L)

- L15: `export type TriageSeverity = "benign" | "fixable" | "escalate";`
- L17: `export type TriageFinding = {`
- L29: `export type TriageResult = {`
- L164: `export function triageCcrsErrorEmail(pasted: string): TriageResult {`
- L226: `export const LCB_CONTACTS = {`
- L234: `export type ExaminerDraft = {`
- L245: `export function buildExaminerDraft(opts: {`
- L280: `export function __runCcrsErrorTriageTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-submit-gate-core.ts` (294 L)

- L27: `export type GateSeverity = "error" | "warning";`
- L30: `export type GateIssueInput = {`
- L44: `export type GateFileInput = {`
- L51: `export type GateIssue = {`
- L64: `export type CcrsSubmitVerdict = {`
- L81: `export function toGateInput(s: {`
- L107: `export function defaultClassifyWarning(message: string | null | undefined): GateSeverity {`
- L116: `export function assertCcrsBatchSubmittable(input: {`
- L189: `export function verdictSummary(v: CcrsSubmitVerdict): string {`
- L200: `export function __runCcrsSubmitGateTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-inventory-adjustment-core.ts` (423 L)

- L26: `export type CcrsLicenseLike = {`
- L36: `export const CCRS_ADJUSTMENT_REASONS = [`
- L45: `export type CcrsAdjustmentReason = (typeof CCRS_ADJUSTMENT_REASONS)[number];`
- L62: `export function mapAdjustmentReason(internal: string): CcrsAdjustmentReason {`
- L101: `export function isReportableAdjustment(internal: string, qtyDelta: number): boolean {`
- L113: `export function mmddyyyy(iso: string | Date): string {`
- L121: `export function cell(v: unknown): string {`
- L126: `export function adjustmentQuantity(qtyDelta: number): string {`
- L132: `export function adjustmentDetail(note: string | null | undefined): string {`
- L140: `export const ADJUSTMENT_COLUMNS = [`
- L159: `export type AdjustmentSourceRow = {`
- L174: `export type AdjustmentMapResult = {`
- L180: `export function mapAdjustmentRow(`
- L242: `export function buildAdjustmentFile(rows: string[][], license: CcrsLicenseLike): string {`
- L251: `export function makeAdjustmentFileName(licenseNumber: string): string {`
- L259: `export function __runCcrsAdjustmentTests(): void {`

### `src/lib/compliance/ccrs-inventory-adjustment.ts` (139 L)

- L30: `export {`
- L39: `export type {`
- L45: `export type CcrsAdjustmentBuildResult = {`
- L58: `export async function buildCcrsInventoryAdjustmentCsv(`

### `src/lib/compliance/ccrs-sale-correction-core.ts` (244 L)

- L30: `export type SaleCorrectionSource = {`
- L52: `export type SaleCorrectionRowResult = { row: string[] | null; skipReason?: string };`
- L65: `export function ccrsDateLoose(v: string): string {`
- L78: `export function prorateLineMinor(lineMinor: number, remainingQty: number, originalQty: number): number {`
- L85: `export function mapSaleCorrectionRow(`
- L139: `export function buildSaleCorrectionFile(`
- L146: `export function makeSaleCorrectionFileName(licenseNumber: string): string {`
- L154: `export function __runSaleCorrectionTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-filing-status.ts` (121 L)

- L39: `export type CcrsFilingOverview = {`
- L69: `export async function getCcrsFilingOverview(`

### `src/lib/compliance/ccrs-product-name-core.ts` (319 L)

- L46: `export type CcrsNameSource = {`
- L63: `export type ComposedCcrsName = {`
- L80: `export function containsTokens(haystack: string, needle: string): boolean {`
- L109: `export function composeCcrsProductName(src: CcrsNameSource): ComposedCcrsName {`
- L167: `export function disambiguateCcrsName(`
- L191: `export function __runCcrsProductNameCoreTests(): void {`

### `src/lib/compliance/ccrs-deadline-core.ts` (534 L)

- L39: `export type ReportingPeriod = {`
- L46: `export type DeadlineStatus =`
- L55: `export type PeriodDeadline = {`
- L96: `export function dueDateForPeriod(period: ReportingPeriod, holidays: ReadonlySet<string> = new Set()): string {`
- L121: `export function periodDeadline(`
- L154: `export function isSettled(status: DeadlineStatus): boolean {`
- L159: `export function periodKey(p: ReportingPeriod): string {`
- L164: `export function keyToPeriod(key: string): ReportingPeriod {`
- L182: `export function monthsFullyCoveredByRange(fromIso: string, toIso: string): Set<string> {`
- L209: `export function priorPeriod(todayIso: string, monthsBack: number): ReportingPeriod {`
- L223: `export function reportingDeadlineOverview(`
- L253: `export type MonthlyReminderStage = "liq_due_soon" | "liq_due_today" | "liq_overdue_daily";`
- L255: `export type PlannedMonthlyReminder = {`
- L275: `export function planMonthlyReminders(`
- L323: `export function __runCcrsDeadlineTests(): { passed: number; failed: number } {`

### `src/lib/inventory/disposition.ts` (1185 L)

- L51: `export const DESTRUCTION_QUARANTINE_HOURS = HOLD_HOURS_DEFAULT;`
- L58: `export {`
- L63: `export type VendorReturn = {`
- L81: `export type CustomerReturn = {`
- L113: `export type DestructionEvent = {`
- L141: `export type VendorReturnWithLot = VendorReturn & WithLot;`
- L142: `export type DestructionEventWithLot = DestructionEvent & WithLot & { hold_elapsed: boolean };`
- L148: `export type DispositionSettings = { holdHours: number };`
- L149: `export const DEFAULT_DISPOSITION_SETTINGS: DispositionSettings = { holdHours: HOLD_HOURS_DEFAULT };`
- L151: `export async function getDispositionSettings(): Promise<DispositionSettings> {`
- L167: `export async function updateDispositionSettings(`
- L193: `export async function getSampleSettings(): Promise<SampleSettings> {`
- L209: `export async function updateSampleSettings(`
- L329: `export type ReturnableOrderLine = {`
- L349: `export async function findReturnableOrderLines(search: string, limit = 8): Promise<ReturnableOrderLine[]> {`
- L440: `export async function listCustomerReturns(limit = 50): Promise<CustomerReturn[]> {`
- L466: `export async function createCustomerReturn(`
- L766: `export async function markCorrectionsExported(ids: string[]): Promise<void> {`
- L783: `export async function listVendorReturns(limit = 100): Promise<VendorReturnWithLot[]> {`
- L798: `export async function createVendorReturn(`
- L868: `export async function updateVendorReturnManifest(`
- L899: `export async function listDestructionEvents(limit = 100): Promise<DestructionEventWithLot[]> {`
- L914: `export async function getDestructionEvent(id: string): Promise<DestructionEvent | null> {`
- L928: `export async function scheduleDestruction(`
- L988: `export async function completeDestruction(`
- L1089: `export async function cancelDestruction(`
- L1107: `export type DispositionSummary = {`
- L1115: `export async function dispositionSummary(): Promise<DispositionSummary> {`

### `src/lib/inventory/disposition-core.ts` (529 L)

- L32: `export const HOLD_HOURS_DEFAULT = 72;`
- L33: `export const HOLD_HOURS_MIN = 0;`
- L34: `export const HOLD_HOURS_MAX = 336; // 14 days`
- L37: `export function clampHoldHours(v: unknown): number {`
- L44: `export function computeEarliestDestroyAt(startISO: string, holdHours: number): string {`
- L50: `export function holdElapsed(earliestDestroyAtISO: string | null, nowMs: number): boolean {`
- L59: `export const CUSTOMER_RETURN_REASONS = [`
- L67: `export type CustomerReturnReason = (typeof CUSTOMER_RETURN_REASONS)[number];`
- L69: `export type CustomerReturnDisposition = "restock" | "destroy";`
- L71: `export type CustomerReturnDraft = {`
- L94: `export type CustomerReturnValidation =`
- L102: `export function validateCustomerReturn(d: CustomerReturnDraft): CustomerReturnValidation {`
- L157: `export function buildCustomerReturnAdjustmentNote(opts: {`
- L180: `export const RENDERING_METHODS = [`
- L185: `export type RenderingMethod = (typeof RENDERING_METHODS)[number];`
- L187: `export const RENDERING_METHOD_LABELS: Record<RenderingMethod, string> = {`
- L194: `export const MIX_MATERIAL_EXAMPLES: Record<Exclude<RenderingMethod, "lcb_approved_other">, string[]> = {`
- L199: `export type DestructionCompletionDraft = {`
- L219: `export type DestructionValidation = { ok: true } | { ok: false; error: string };`
- L226: `export function validateDestructionCompletion(d: DestructionCompletionDraft): DestructionValidation {`
- L274: `export function buildDestructionAdjustmentNote(opts: {`
- L304: `export const MANIFEST_STATUSES = [`
- L311: `export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];`
- L313: `export const MANIFEST_STATUS_LABELS: Record<ManifestStatus, string> = {`
- L322: `export function nextManifestStatuses(current: string): ManifestStatus[] {`
- L344: `export const VENDOR_RETURN_MANIFEST_STEPS: readonly string[] = [`
- L355: `export function __runDispositionCoreTests(): { passed: number; failed: number } {`

### `src/lib/inventory/intake-store.ts` (2682 L)

- L176: `export async function listManifests(opts?: {`
- L220: `export async function countManifestsByStatus(): Promise<StageCounts> {`
- L275: `export async function resolveOrCreateVendor(`
- L511: `export async function resolveBrandId(`
- L523: `export async function resolveBrandIdDetailed(`
- L596: `export async function stageManifest(`
- L970: `export async function rejectManifest(`
- L1043: `export async function setLotDisposition(`
- L1100: `export async function preflightManifestSampleCap(`
- L1238: `export async function gatherSampleCapNotice(manifestId: string): Promise<`
- L1301: `export async function finalizeManifestDispositions(`
- L1843: `export async function seedIncomingSampleEvents(`
- L1944: `export async function rememberVendorUsualTransport(`
- L1992: `export async function listManifestLots(manifestId: string) {`
- L2051: `export async function listLabFactsByIds(`
- L2119: `export type ManifestLotExportRow = {`
- L2147: `export async function listAllManifestLotsForExport(`
- L2205: `export type ManifestLifecycleStatus =`
- L2220: `export async function logManifestEvent(`
- L2245: `export async function setManifestLifecycle(`
- L2271: `export async function updateManifestTransport(`
- L2332: `export async function setManifestInvoiceOverride(`
- L2368: `export async function recordInvoiceNumberDetected(`
- L2424: `export async function seedTransportFromParsed(`
- L2469: `export async function backfillManifestTransport(`
- L2519: `export async function listManifestEvents(manifestId: string) {`
- L2544: `export async function dismissDuplicateManifest(`
- L2585: `export async function findDuplicateTwinsFor(`
- L2625: `export async function listLotVendorIds(`
- L2650: `export async function setLotVendorInventoryId(`

### `src/lib/inventory/intake-parser.ts` (821 L)

- L22: `export type ParsedLab = {`
- L51: `export type ParsedLine = {`
- L101: `export type ParsedTransport = {`
- L117: `export function emptyTransport(): ParsedTransport {`
- L134: `export function transportHasData(t: ParsedTransport | null | undefined): t is ParsedTransport {`
- L145: `export function combineDateAndTime(dateIso: string | null, timeRaw: string | null): string | null {`
- L158: `export type ParsedManifest = {`
- L175: `export type ParseResult =`
- L248: `export function cleanUrl(v: unknown): string | null {`
- L280: `export function looksLikeWciaTransferStrict(root: unknown): boolean {`
- L298: `export function wciaJsonUrl(item: Obj): string | null {`
- L715: `export function parseVendorJson(jsonText: string): ParseResult {`
- L749: `export type CoaLink = {`
- L764: `export function extractCoaLinks(m: ParsedManifest): CoaLink[] {`
- L784: `export function summarizeManifest(m: ParsedManifest): {`

### `src/lib/inventory/ccrs-manifest-csv-core.ts` (743 L)

- L35: `export function splitCsvRows(text: string): string[][] {`
- L75: `export const CCRS_ITEM_COLUMNS = [`
- L109: `export type CcrsHeader = {`
- L133: `export type CcrsItem = {`
- L147: `export type CcrsManifestParse =`
- L219: `export function parseCcrsManifestCsv(text: string): CcrsManifestParse {`
- L335: `export function ccrsDateToIso(value: string | null | undefined): string | null {`
- L363: `export type CcrsParsedLine = {`
- L423: `export function ccrsTransportToParsed(t: CcrsParsedManifest["transport"]): {`
- L451: `export type CcrsParsedManifest = {`
- L478: `export function ccrsToParsedManifest(parse: {`
- L578: `export function __runCcrsManifestCsvTests(): { passed: number; failed: number } {`

### `src/lib/inventory/sale-decrement.ts` (273 L)

- L51: `export async function decrementInventoryForOrder(orderId: string): Promise<void> {`

### `src/lib/pos/import-lot-core.ts` (970 L)

- L44: `export type ImportLotSource = {`
- L89: `export type PlannedImportLot = {`
- L142: `export type ImportLotDiagnostic = {`
- L149: `export type ImportLotPlan = {`
- L168: `export function costToMinorUnits(raw: string | null | undefined): number | null {`
- L178: `export function parseUsDate(raw: string | null | undefined): string | null {`
- L210: `export function coaFlagToBool(raw: string | null | undefined): boolean {`
- L260: `export function resolveLotCreatedAt(plannedIso: string | null, fallbackIso: string): string {`
- L273: `export function insertKeySignature(row: Record<string, unknown>): string {`
- L284: `export function findNonUniformInsertRow(`
- L304: `export function assertUniformInsertKeys(rows: readonly Record<string, unknown>[], label: string): void {`
- L342: `export const POS_POTENCY_COLUMNS = ["pos_thc", "pos_thca", "pos_cbd", "pos_cbda", "pos_potency_unit", "pos_potency_set_at"] as const;`
- L350: `export function receivedOnForDb(receivedOn: string | null, pacificToday: string): string | null {`
- L357: `export function potencyColumns(p: LotPotency | null, nowIso: string): Record<string, unknown> {`
- L368: `export type ExistingLotFacts = {`
- L379: `export type LotFactFillPlan = {`
- L393: `export function planLotFactFill(`
- L443: `export function planImportLots(sources: readonly ImportLotSource[]): ImportLotPlan {`
- L671: `export function __runImportLotCoreTests(): void {`
- L950: `export function __runImportLotFactFillTests(): { passed: number } {`

### `src/lib/pos/import-service.ts` (978 L)

- L66: `export function sha256(buffer: Buffer | Uint8Array): string {`
- L70: `export type CreateImportInput = {`
- L80: `export type CreateImportResult = {`
- L87: `export async function findDuplicateImport(`
- L107: `export async function runImport(input: CreateImportInput): Promise<CreateImportResult> {`
- L363: `export type PublishMenuVersionOptions = {`
- L375: `export type PublishMenuVersionResult = {`
- L380: `export async function publishMenuVersion(`
- L749: `export async function fillImportLotFacts(`
- L846: `export async function countTestData(): Promise<{ imports: number; versions: number }> {`
- L860: `export async function cleanSlateTestData(): Promise<{`
- L908: `export async function backfillImportLots(`

### `src/lib/pos/returns-core.ts` (396 L)

- L49: `export const RETURN_WINDOW_DAYS = 15;`
- L65: `export function defaultReturnPolicyText(): string {`
- L86: `export function normalizeReceiptNumber(raw: unknown): string | null {`
- L97: `export function clientUuidMatchesReceipt(clientUuid: string, receiptNumber8: string): boolean {`
- L108: `export function receiptLookupSuffix(raw: unknown): string | null {`
- L122: `export function pacificDaysBetween(earlierIso: string, laterIso: string): number {`
- L130: `export type ReturnWindowVerdict =`
- L140: `export function returnWindowVerdict(purchasedAtIso: string, nowIso: string): ReturnWindowVerdict {`
- L163: `export type ReturnEligibilityInput = {`
- L174: `export type ReturnEligibilityVerdict =`
- L184: `export function evaluateReturnEligibility(input: ReturnEligibilityInput): ReturnEligibilityVerdict {`
- L212: `export type RefundLineInput = {`
- L221: `export type RefundLineVerdict = { ok: true; refundMinor: number } | { ok: false; error: string };`
- L229: `export function refundForLine(input: RefundLineInput): RefundLineVerdict {`
- L249: `export function refundForLines(lines: RefundLineInput[]): RefundLineVerdict {`
- L264: `export type PointsClawbackInput = {`
- L280: `export function pointsClawback(input: PointsClawbackInput): number {`
- L297: `export function __runPosReturnsCoreTests(): void {`

### `src/lib/pos/returns-store.ts` (365 L)

- L60: `export type CounterReturnLine = {`
- L71: `export type CounterReturnSale = {`
- L84: `export type CounterReturnLookup =`
- L99: `export async function lookupSaleByReceipt(rawReceipt: string): Promise<CounterReturnLookup> {`
- L222: `export type ProcessCounterReturnInput = {`
- L233: `export type ProcessCounterReturnResult =`
- L252: `export async function processCounterReturn(`
- L364: `export { receiptNumber };`

### `src/lib/pos/variant-lot-core.ts` (145 L)

- L33: `export const ONBOARDED_VARIANT_SUFFIX = "-onboarded";`
- L41: `export function lotKeyFromVariantId(variantId: string | null | undefined): string | null {`
- L54: `export function lotKeyForSaleLine(line: {`
- L68: `export function lotKeysForLines(`
- L86: `export function __runVariantLotCoreTests(): void {`

### `src/app/admin/compliance/ccrs/page.tsx` (1033 L)

- L86: `export const dynamic = "force-dynamic";`
- L185: `export default async function CcrsCommandCenterPage({`

### `src/app/admin/compliance/ccrs/actions.ts` (651 L)

- L59: `export async function resolveWeekAction(formData: FormData): Promise<void> {`
- L114: `export async function unresolveWeekAction(formData: FormData): Promise<void> {`
- L136: `export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {`
- L177: `export async function assignProductIdsAction(formData: FormData): Promise<void> {`
- L257: `export async function markUploadedAction(formData: FormData): Promise<void> {`
- L287: `export async function recordSuccessAction(formData: FormData): Promise<void> {`
- L353: `export async function recordErrorAction(formData: FormData): Promise<void> {`
- L391: `export async function recordNoEmailAction(formData: FormData): Promise<void> {`
- L417: `export async function abandonFileAction(formData: FormData): Promise<void> {`
- L442: `export async function startPreprodLedgerAction(formData: FormData): Promise<void> {`
- L486: `export async function settlePreprodDuplicatesAction(formData: FormData): Promise<void> {`
- L513: `export async function assignPreprodProductIdsAction(formData: FormData): Promise<void> {`
- L562: `export async function setObligationStartAction(formData: FormData): Promise<void> {`
- L586: `export async function setHandoverFactsAction(formData: FormData): Promise<void> {`
- L609: `export async function dismissPeriodAction(formData: FormData): Promise<void> {`
- L632: `export async function undoDismissalAction(formData: FormData): Promise<void> {`

### `src/app/admin/reports/compliance/page.tsx` (478 L)

- L28: `export const dynamic = "force-dynamic";`
- L42: `export default async function CompliancePage({`

### `src/app/admin/reports/compliance/batch-export/route.ts` (263 L)

- L55: `export const dynamic = "force-dynamic";`
- L56: `export const runtime = "nodejs";`
- L58: `export const maxDuration = 300;`
- L62: `export async function GET(request: Request) {`

### `src/app/admin/reports/compliance/adjustment-export/route.ts` (61 L)

- L15: `export const dynamic = "force-dynamic";`
- L16: `export const runtime = "nodejs";`
- L18: `export async function GET(request: Request) {`

### `src/app/admin/reports/compliance/advisor-action.ts` (41 L)

- L14: `export type CcrsAdvisorResult = { ok: true; advice: CcrsAdvice } | { ok: false; error: string };`
- L16: `export async function generateCcrsAdviceAction(sp: {`

### `src/app/admin/inventory/disposition/sale-correction-export/route.ts` (117 L)

- L39: `export const dynamic = "force-dynamic";`
- L40: `export const runtime = "nodejs";`
- L45: `export async function GET() {`

### `src/components/admin/compliance/UploadWalkthrough.tsx` (345 L)

- L95: `export function UploadWalkthrough({ weekKey, files, batchZipHref, submittable, portalUrl }: Props) {`

### `src/components/admin/compliance/ErrorTriagePanel.tsx` (167 L)

- L39: `export function ErrorTriagePanel({ licenseNumber, licenseeName, weekStart, weekEnd, fileTypes }: Props) {`

### `src/components/admin/compliance/PushRemindersPanel.tsx` (176 L)

- L37: `export function PushRemindersPanel() {`

### `src/components/admin/reports/CcrsAdvisorPanel.tsx` (114 L)

- L50: `export function CcrsAdvisorPanel({ aiEnabled, sp }: Props) {`

### `src/components/admin/reports/LicenseSettingsForm.tsx` (89 L)

- L7: `export function LicenseSettingsForm({`

### `src/components/admin/reports/ReportTabs.tsx` (78 L)

- L13: `export type ReportTab = { href: string; label: string; icon: string };`
- L15: `export const REPORT_TABS: ReportTab[] = [`
- L45: `export const ACH_REPORT_TAB: ReportTab = { href: "/admin/reports/ach-payments", label: "ACH Payments", icon: "🏦" };`
- L47: `export function reportTabsFor(showAchTab: boolean): ReportTab[] {`
- L51: `export function ReportTabs({ showAchTab = false }: { showAchTab?: boolean }) {`

### `src/components/admin/admin-nav-data.ts` (254 L)

- L4: `export type AdminNavItem = {`
- L47: `export const adminNav: AdminNavItem[] = [`
- L217: `export const navGroups: AdminNavItem["group"][] = [`

## A. Batch builders — `src/lib/compliance/ccrs-batch.ts`

`src/lib/compliance/ccrs-batch.ts` L160-L193 — buildStrainFile — NOTE: no guard for Unknown/THC/Other (guide p.12 L358: 'Strain name is invalid, cannot be Unknown, THC, or Other'). Defaults StrainType to Hybrid.

```ts
 160|      * the export never assigns on its own (D-01a: ids are minted deliberately).
 161|      */
 162|     unassignedProductKeys: string[];
 163|   };
 164|   /**
 165|    * R5-1: customer-return Sale corrections carried in this batch's Sale file.
 166|    * `exportReturnIds` is filled ONLY for a production emission (preprod never
 167|    * marks the shared correction_status); the route marks them after emit.
 168|    */
 169|   corrections: {
 170|     exportReturnIds: string[];
 171|     emitted: number;
 172|     withheld: number;
 173|     invalid: number;
 174|     reflected: number;
 175|   };
 176| };
 177| 
 178| // ---------------------------------------------------------------------------
 179| // Helpers to read the published menu snapshot + inventory lots
 180| // ---------------------------------------------------------------------------
 181| 
 182| type Admin = ReturnType<typeof createSupabaseAdminClient>;
 183| 
 184| async function getPublishedVersionId(admin: Admin): Promise<string | null> {
 185|   const { data } = await admin
 186|     .from("menu_versions")
 187|     .select("id")
 188|     .eq("status", "published")
 189|     .order("published_at", { ascending: false })
 190|     .limit(1)
 191|     .maybeSingle();
 192|   return (data as { id: string } | null)?.id ?? null;
 193| }
```

`src/lib/compliance/ccrs-batch.ts` L201-L213 — buildAreaFile — emits Area 'Quarantine' IsQuarantine=TRUE whenever hasQuarantine. FAQ (Data Reporting, IsQuarantine Q): 'There are no quarantine requirements for cannabis products. You will have an entry as FALSE.' → compliance question, Part 04 flag N-01.

```ts
 201|  * delivery facts an InventoryTransfer row needs. The retailer is the
 202|  * RECEIVING licensee and files the transfer [G L0124-L0128, G L0143-L0144].
 203|  * `absent` = migration 0285 (the vendor-id columns) is not applied. Any other
 204|  * read error THROWS: a silently missing lot is a missing weekly filing.
 205|  */
 206| const TRANSFER_LOT_COLUMNS =
 207|   "id, lot_code, manifest_id, notes, vendor_id, ccrs_inventory_external_id, received_qty, received_on, disposition, vendor_inventory_external_id, vendor_inventory_externa
 208| type TransferLotRow = {
 209|   id: string;
 210|   lot_code: string | null;
 211|   manifest_id: string | null;
 212|   notes: string | null;
 213|   vendor_id: string | null;
```

`src/lib/compliance/ccrs-batch.ts` L215-L260 — buildProductFile (part 1) — weightByKey from lots; grams may be '' when no lot weight.

```ts
 215|   received_qty: number | string | null;
 216|   received_on: string | null;
 217|   disposition: string | null;
 218|   vendor_inventory_external_id: string | null;
 219|   vendor_inventory_external_id_source: string | null;
 220| };
 221| type TransferManifestRow = LineageManifestRow & {
 222|   vendor_id: string | null;
 223|   from_license_number?: string | null;
 224|   vendor_license?: string | null;
 225| };
 226| async function readTransferLots(admin: Admin, toDay: string): Promise<{ kind: "absent" } | { kind: "loaded"; lots: TransferLot[] }> {
 227|   let missing = false;
 228|   let failed: string | null = null;
 229|   const rows = await pagedAll<TransferLotRow>(async (from, to) => {
 230|     if (missing || failed) return [];
 231|     const { data, error } = await admin
 232|       .from("inventory_lots")
 233|       .select(TRANSFER_LOT_COLUMNS)
 234|       .not("manifest_id", "is", null)
 235|       .eq("disposition", "accepted")
 236|       .lte("received_on", toDay)
 237|       .order("id", { ascending: true })
 238|       .range(from, to);
 239|     if (error) {
 240|       if (isMissingColumnError(error)) missing = true;
 241|       else failed = error.message;
 242|       return [];
 243|     }
 244|     return (data as TransferLotRow[] | null) ?? [];
 245|   });
 246|   if (missing) return { kind: "absent" };
 247|   if (failed) throw new Error(`R6-2: reading received lots for InventoryTransfer failed: ${failed}`);
 248|   const manifestIds = [...new Set(rows.map((r) => (r.manifest_id ?? "").trim()).filter(Boolean))];
 249|   let mFailed: string | null = null;
 250|   const manifests = await chunkedIn<string, TransferManifestRow>(manifestIds, async (chunk, from, to) => {
 251|     const { data, error } = await admin
 252|       .from("inbound_manifests")
 253|       .select(`${LINEAGE_MANIFEST_SELECT}, vendor_id, from_license_number:raw_payload->>from_license_number, vendor_license:raw_payload->>vendor_license`)
 254|       .in("id", chunk)
 255|       .order("id", { ascending: true })
 256|       .range(from, to);
 257|     if (error) mFailed = error.message;
 258|     return (data as TransferManifestRow[] | null) ?? [];
 259|   });
 260|   if (mFailed) throw new Error(`R6-2: reading delivery manifests for InventoryTransfer failed: ${mFailed}`);
```

`src/lib/compliance/ccrs-batch.ts` L280-L349 — buildProductFile (part 2) — classification via deriveCcrsClassificationFromType; E4 error message; clamps; warnings.slice(0,30).

```ts
 280|     const qty = r.received_qty === null ? null : Number(r.received_qty);
 281|     return {
 282|       lotId: r.id,
 283|       manifestId: r.manifest_id,
 284|       label: r.lot_code ?? r.id,
 285|       ourId: assignedInventoryExternalId(r),
 286|       vendorId: r.vendor_inventory_external_id,
 287|       vendorIdSource: r.vendor_inventory_external_id_source,
 288|       vendorLicense: fromDoc || vendorRecord || null,
 289|       receivedQty: qty,
 290|       receivedOn: r.received_on,
 291|       disposition: r.disposition,
 292|       isCultivera: lotFlaggedCultivera(r, migration),
 293|     };
 294|   });
 295|   return { kind: "loaded", lots };
 296| }
 297| 
 298| const TRANSFER_ISSUE_TEXT: Record<TransferIssueCode, (n: number) => string> = {
 299|   E14_TRANSFER_FIELD_MISSING: (n) => `${n} received lot(s) are missing a field InventoryTransfer.csv requires (vendor license, our lot id, or received date). Fix each del
 300|   E14_TRANSFER_VENDOR_ID_UNKNOWN: (n) =>
 301|     `${n} received lot(s) have no confirmed vendor inventory id. CCRS needs "the original ... InventoryExternalIdentifier from the producer" [FAQ L0058-L0059]. Open the d
 302|   E14_TRANSFER_SAME_LICENSE: (n) => `${n} received lot(s) name our own license as the vendor. A transfer to the same license is an error [G L1205]; fix the vendor on the 
 303|   E14_TRANSFER_QUANTITY: (n) => `${n} received lot(s) have a received quantity that is not positive ("No negative entries allowed" [G L1238]).`,
 304|   E14_TRANSFER_LEDGER_WITHHELD: (n) => `${n} transfer(s) were left out because an earlier file naming them is not answered yet. Record that file's CCRS result, then rebui
 305|   E14_TRANSFER_LOT_NOT_REPORTED: (n) =>
 306|     `${n} transfer(s) were left out because their lot is not in Inventory.csv and CCRS does not hold it yet ("ensure the inventory has been reported through the inventory
 307| };
 308| 
 309| /**
 310|  * R5-1: the DESTROYED lots that this batch's event rows name (by CCRS id).
 311|  * Live lots are read with `.neq("status", "destroyed")`; a lot destroyed to 0
 312|  * still needs its Inventory row (QoH 0) in the emission that carries its
 313|  * Destruction adjustment [G L1302-L1304, EXAM L0430]. A read error THROWS:
 314|  * silently dropping the lot would send an adjustment CCRS rejects.
 315|  */
 316| async function readDestroyedLots(admin: Admin, refs: readonly string[]): Promise<LotRow[]> {
 317|   if (refs.length === 0) return [];
 318|   let failed: string | null = null;
 319|   const rows = await chunkedIn<string, LotRow>(refs, async (chunk, from, to) => {
 320|     const { data, error } = await admin
 321|       .from("inventory_lots")
 322|       .select(LOT_COLUMNS)
 323|       .eq("status", "destroyed")
 324|       .in("ccrs_inventory_external_id", chunk)
 325|       .order("id", { ascending: true })
 326|       .range(from, to);
 327|     if (error) failed = error.message;
 328|     return (data as LotRow[] | null) ?? [];
 329|   });
 330|   if (failed) throw new Error(`R5-1: could not read destroyed lots named by this batch: ${failed}`);
 331|   // The stored id may carry surrounding spaces; assignedInventoryExternalId
 332|   // trims, so match on what the event row printed.
 333|   const wanted = new Set(refs);
 334|   const seen = new Set<string>();
 335|   return rows.filter((l) => {
 336|     const assigned = assignedInventoryExternalId(l);
 337|     if (!assigned || !wanted.has(assigned) || seen.has(l.id)) return false;
 338|     seen.add(l.id);
 339|     return true;
 340|   });
 341| }
 342| 
 343| const RETURN_COLUMNS =
 344|   "id, sale_external_id, sale_detail_external_id, inventory_external_id, sale_type, sale_date, unit_price_minor, discount_minor, sales_tax_minor, excise_minor, quantity, 
 345| 
 346| /** customer_returns missing (pre-0115) reads as "no returns"; any other error throws. */
 347| function isMissingTable(error: { code?: string; message?: string } | null): boolean {
 348|   if (!error) return false;
 349|   const msg = (error.message ?? "").toLowerCase();
```

`src/lib/compliance/ccrs-batch.ts` L351-L417 — buildInventoryFile — ext id derive; Area choice; TotalCost = unit_cost_minor_units*received_qty (0 when cost missing → guide p.17 L614 'TotalCost cannot equal 0'); IsMedical hard 'FALSE'; Operation Insert.

```ts
 351| }
 352| 
 353| /**
 354|  * R5-1: the returns a batch must consider for Sale corrections: every PENDING
 355|  * return, every return made (created_at) inside the batch range, and every
 356|  * other return of those sale lines (the correction states the line after ALL
 357|  * its returns: rule 1). Same rule in both envs.
 358|  *   - `correction_status` is ONE flag that only a PROD emission sets
 359|  *     (correctionExportIds), so it cannot say what PREprod has seen, nor
 360|  *     whether CCRS accepted a prod correction. The env's own ledger decides
 361|  *     that (reflected = already applied, in flight = wait).
 362|  *   - The range part lets a correction whose file was rejected or abandoned
 363|  *     be planned again by rebuilding that week; the ledger stops re-sends.
 364|  */
 365| async function readReturnsForCorrections(
 366|   admin: Admin,
 367|   fromISO: string,
 368|   toISO: string,
 369| ): Promise<{ records: ReturnRecord[]; tableMissing: boolean }> {
 370|   const seeds = await pagedAll<CustomerReturnRowLike>(async (from, to) => {
 371|     const { data, error } = await admin
 372|       .from("customer_returns")
 373|       .select(RETURN_COLUMNS)
 374|       .or(`correction_status.eq.pending,and(created_at.gte.${fromISO},created_at.lte.${toISO})`)
 375|       .order("id", { ascending: true })
 376|       .range(from, to);
 377|     if (error) {
 378|       if (isMissingTable(error)) throw new MissingReturnsTable();
 379|       throw new Error(`R5-1: could not read customer_returns: ${error.message}`);
 380|     }
 381|     return (data as CustomerReturnRowLike[] | null) ?? [];
 382|   }).catch((e) => {
 383|     if (e instanceof MissingReturnsTable) return null;
 384|     throw e;
 385|   });
 386|   if (seeds === null) return { records: [], tableMissing: true };
 387|   const lineIds = [...new Set(seeds.map((r) => (r.sale_detail_external_id ?? "").trim()).filter(Boolean))];
 388|   let failed: string | null = null;
 389|   const siblings = await chunkedIn<string, CustomerReturnRowLike>(lineIds, async (chunk, from, to) => {
 390|     const { data, error } = await admin
 391|       .from("customer_returns")
 392|       .select(RETURN_COLUMNS)
 393|       .in("sale_detail_external_id", chunk)
 394|       .order("id", { ascending: true })
 395|       .range(from, to);
 396|     if (error) failed = error.message;
 397|     return (data as CustomerReturnRowLike[] | null) ?? [];
 398|   });
 399|   if (failed) throw new Error(`R5-1: could not read the other returns of these sale lines: ${failed}`);
 400|   const byId = new Map<string, CustomerReturnRowLike>();
 401|   for (const r of [...seeds, ...siblings]) byId.set(r.id, r);
 402|   return { records: [...byId.values()].map(returnRecordFromRow), tableMissing: false };
 403| }
 404| class MissingReturnsTable extends Error {}
 405| 
 406| /**
 407|  * S-17b: for product keys that lots name but the published menu does not show,
 408|  * read whether each is HIDDEN in the published version (with its reason) or
 409|  * present only in a STAGED version. Any read error → `readable: false` (the
 410|  * lot is still withheld; only the explanation is lost, and that is said).
 411|  */
 412| async function readMenuPresence(
 413|   admin: Admin,
 414|   publishedVersionId: string | null,
 415|   visiblePublishedKeys: Iterable<string>,
 416|   keys: readonly string[],
 417| ): Promise<MenuPresence> {
```

`src/lib/compliance/ccrs-batch.ts` L424-L500 — buildCcrsBatch (part 1) — license/Supabase guards E1/E2; published menu; lots pagedAll excluding status=destroyed.

```ts
 424|       const { data, error } = await admin
 425|         .from("menu_items")
 426|         .select("source_item_id, hidden_reason")
 427|         .eq("menu_version_id", publishedVersionId)
 428|         .eq("hidden", true)
 429|         .in("source_item_id", chunk)
 430|         .order("id", { ascending: true })
 431|         .range(from, to);
 432|       if (error) failed = error.message;
 433|       return (data as { source_item_id: string | null; hidden_reason: string | null }[] | null) ?? [];
 434|     });
 435|     const { data: stagedVersions, error: sErr } = await admin.from("menu_versions").select("id").eq("status", "staged");
 436|     if (sErr) failed = sErr.message;
 437|     const stagedIds = ((stagedVersions as { id: string }[] | null) ?? []).map((v) => v.id);
 438|     const staged =
 439|       stagedIds.length === 0
 440|         ? []
 441|         : await chunkedIn<string, { source_item_id: string | null }>(keys, async (chunk, from, to) => {
 442|             const { data, error } = await admin
 443|               .from("menu_items")
 444|               .select("source_item_id")
 445|               .in("menu_version_id", stagedIds)
 446|               .in("source_item_id", chunk)
 447|               .order("id", { ascending: true })
 448|               .range(from, to);
 449|             if (error) failed = error.message;
 450|             return (data as { source_item_id: string | null }[] | null) ?? [];
 451|           });
 452|     if (failed) return { readable: false, error: failed };
 453|     return menuPresenceFromRows(true, visiblePublishedKeys, hidden, staged);
 454|   } catch (e) {
 455|     return { readable: false, error: e instanceof Error ? e.message : String(e) };
 456|   }
 457| }
 458| 
 459| type MenuItemRow = {
 460|   source_item_id: string;
 461|   name: string;
 462|   strain_name: string | null;
 463|   strain_type: string | null;
 464|   pos_inventory_type: string | null;
 465|   pos_inventory_category: string | null;
 466|   description: string | null;
 467|   // SLICE 53 (two-layer naming): fields the CCRS Product.Name composer uses.
 468|   brand_name: string | null;
 469|   vendor_name: string | null;
 470|   category: string | null;
 471|   total_thc_json: unknown;
 472|   total_cbd_json: unknown;
 473|   compounds_json: unknown;
 474| };
 475| 
 476| /** Parse a stored cannabinoid JSON blob (same shape live-menu.ts reads). */
 477| function jsonToCannabinoid(json: unknown): Cannabinoid | null {
 478|   if (!json || typeof json !== "object") return null;
 479|   const o = json as Record<string, unknown>;
 480|   if (typeof o.type !== "string" || typeof o.unit !== "string") return null;
 481|   return {
 482|     type: o.type as Cannabinoid["type"],
 483|     value: typeof o.value === "string" || typeof o.value === "number" ? o.value : null,
 484|     unit: o.unit as Cannabinoid["unit"],
 485|   };
 486| }
 487| 
 488| function jsonToCompounds(json: unknown): Cannabinoid[] {
 489|   if (!Array.isArray(json)) return [];
 490|   return json.map(jsonToCannabinoid).filter((c): c is Cannabinoid => c != null);
 491| }
 492| 
 493| type LotRow = {
 494|   id: string;
 495|   lot_code: string | null;
 496|   pos_product_key: string | null;
 497|   product_name: string | null;
 498|   ccrs_inventory_external_id: string | null;
 499|   received_qty: number;
 500|   on_hand_qty: number;
```

`src/lib/compliance/ccrs-batch.ts` L540-L652 — buildCcrsBatch (part 2) — InventoryTransfer emitted EMPTY with an explanatory note (guide p.33 L1162 says it 'is required weekly by any licensed facility that receives inventory'); sort; E3; orphan products; verifySaleNumericColumns; WARNING_CAP_PER_FILE.

```ts
 540|   createdDate: string,
 541|   plan: LedgerPlan,
 542| ): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[] } {
 543|   const warnings: string[] = [];
 544|   const seen = new Set<string>();
 545|   const rows: string[][] = [];
 546|   const defaulted: string[] = [];
 547|   const reserved: CcrsIssueRow[] = [];
 548|   for (const it of items) {
 549|     const raw = (it.strain_name ?? "").trim();
 550|     if (!raw) continue;
 551|     // S-11: the plan decides. A strain already on file in ANY casing is never
 552|     // re-sent (Strain has no Operation [G L0319-L0320]); a case variant of a
 553|     // filed or already-emitted strain is never sent at all [BRIAN A16].
 554|     const strain = plan.strainCanonical.get(raw) ?? raw;
 555|     if (!plan.strainEmit.has(strain)) continue;
 556|     if (seen.has(strain)) continue;
 557|     seen.add(strain);
 558|     // E11 [G L0358] "Strain name is invalid, cannot be Unknown, THC, or Other."
 559|     // Exact match only — "Other Kush" is a real strain and must still ship.
 560|     if (isReservedStrainName(strain)) {
 561|       reserved.push({
 562|         id: (it.source_item_id ?? strain).trim(),
 563|         label: strain,
 564|         detail: `"${strain}" is a reserved CCRS strain name`,
 565|       });
 566|       continue;
 567|     }
 568|     // B2: StrainType MUST be one of Indica/Sativa/Hybrid. Normalize the POS
 569|     // label; when it can't be resolved we default to Hybrid (safe superset) and
 570|     // flag the strain so an employee can correct it (drafts-only).
 571|     const st = normalizeStrainType(it.strain_type);
 572|     if (st.defaulted) defaulted.push(strain);
 573|     rows.push([license, strain, st.value, createdBy, createdDate]);
 574|   }
 575|   if (defaulted.length > 0) {
 576|     warnings.push(
 577|       `${defaulted.length} strain(s) had no recognizable Indica/Sativa/Hybrid type and were defaulted to "Hybrid" — set the correct StrainType before uploading: ${default
 578|         .slice(0, 15)
 579|         .join(", ")}${defaulted.length > 15 ? "…" : ""}.`,
 580|     );
 581|   }
 582|   if (rows.length === 0) warnings.push("No named strains found in the published menu.");
 583|   const issues: CcrsSyncIssue[] = [];
 584|   if (plan.strainCaseVariants.length > 0) {
 585|     issues.push({
 586|       severity: "warning",
 587|       file: "Strain",
 588|       code: "E39_STRAIN_CASE_VARIANT",
 589|       specPin: specPinFor("E39_STRAIN_CASE_VARIANT"),
 590|       count: plan.strainCaseVariants.length,
 591|       rows: plan.strainCaseVariants.map((v) => ({
 592|         id: v.ours,
 593|         label: v.ours,
 594|         detail: `written as "${v.value}" (${v.source === "ledger" ? "the spelling already filed in CCRS" : "the first spelling in this batch"})`,
 595|       })),
 596|       message: `${plan.strainCaseVariants.length} strain name(s) differ from another only by capital letters. CCRS must never receive the same strain with a different cap
 597|     });
 598|   }
 599|   if (reserved.length > 0) {
 600|     issues.push({
 601|       severity: "error",
 602|       file: "Strain",
 603|       code: "E11_STRAIN_NAME_RESERVED",
 604|       specPin: specPinFor("E11_STRAIN_NAME_RESERVED"),
 605|       count: reserved.length,
 606|       rows: reserved,
 607|       message: `${reserved.length} product(s) use a strain name CCRS reserves — "Strain name is invalid, cannot be Unknown, THC, or Other." [G L0358]. Set the real strain
 608|     });
 609|   }
 610|   return { rows, warnings, issues };
 611| }
 612| 
 613| /**
 614|  * Area.csv — S-13: planned over the CCRS ledger by the pure core
 615|  * (ccrs-area-core.ts, D-03, [BRIAN A11] [BRIAN A12], [G L0298-L0299]). The
 616|  * old literals (`AREA-SALES-FLOOR`, a `Quarantine`/TRUE area) are gone: a new
 617|  * "Sales Floor" record would silently become every lot's join target (E23),
 618|  * and IsQuarantine TRUE "only applies to imported CBD" [G L0298].
 619|  */
 620| function buildAreaFile(
 621|   env: LedgerEnv,
 622|   license: string,
 623|   createdBy: string,
 624|   createdDate: string,
 625|   ledger: LedgerView | null,
 626| ): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[]; inventoryAreaName: string } {
 627|   const plan = planAreaFile({ view: ledger, config: areaPlanFor(env), license, by: createdBy, date: createdDate });
 628|   const issues: CcrsSyncIssue[] = [];
 629|   for (const severity of ["error", "warning"] as const) {
 630|     const these = plan.problems.filter((p) => p.severity === severity);
 631|     if (these.length === 0) continue;
 632|     issues.push({
 633|       severity,
 634|       file: "Area",
 635|       code: "E46_AREA_LEDGER",
 636|       specPin: specPinFor("E46_AREA_LEDGER"),
 637|       count: these.length,
 638|       rows: these.map((p) => ({ id: p.id, label: p.id, detail: p.detail })),
 639|       message:
 640|         severity === "error"
 641|           ? `${these.length} Area record(s) the plan (D-03) relies on are not provably held by CCRS. An Update or Delete of a record CCRS does not hold is an error [G L02
 642|           : `${these.length} Area name(s) are held by more than one CCRS record; CCRS uses the most recently ingested one [BRIAN A12]. Advisory.`,
 643|     });
 644|   }
 645|   return { rows: plan.rows, warnings: [], issues, inventoryAreaName: plan.inventoryAreaName };
 646| }
 647| 
 648| function buildProductFile(
 649|   items: MenuItemRow[],
 650|   lots: LotRow[],
 651|   license: string,
 652|   createdBy: string,
```

## B. Core/pure helpers — `src/lib/compliance/ccrs-batch-core.ts`

`src/lib/compliance/ccrs-batch-core.ts` L37-L140 — CCRS_COLUMNS — must equal row 4 of each official template (Part 02 §8).

```ts
  37| export const CCRS_COLUMNS: Record<CcrsRetailerFileType, readonly string[]> = {
  38|   Strain: ["LicenseNumber", "Strain", "StrainType", "CreatedBy", "CreatedDate"],
  39|   Area: [
  40|     "LicenseNumber",
  41|     "Area",
  42|     "IsQuarantine",
  43|     "ExternalIdentifier",
  44|     "CreatedBy",
  45|     "CreatedDate",
  46|     "UpdatedBy",
  47|     "UpdatedDate",
  48|     "Operation",
  49|   ],
  50|   Product: [
  51|     "LicenseNumber",
  52|     "InventoryCategory",
  53|     "InventoryType",
  54|     "Name",
  55|     "Description",
  56|     "UnitWeightGrams",
  57|     "ExternalIdentifier",
  58|     "CreatedBy",
  59|     "CreatedDate",
  60|     "UpdatedBy",
  61|     "UpdatedDate",
  62|     "Operation",
  63|   ],
  64|   Inventory: [
  65|     "LicenseNumber",
  66|     "Strain",
  67|     "Area",
  68|     "Product",
  69|     "InitialQuantity",
  70|     "QuantityOnHand",
  71|     "TotalCost",
  72|     "IsMedical",
  73|     "ExternalIdentifier",
  74|     "CreatedBy",
  75|     "CreatedDate",
  76|     "UpdatedBy",
  77|     "UpdatedDate",
  78|     "Operation",
  79|   ],
  80|   InventoryAdjustment: [
  81|     "LicenseNumber",
  82|     "InventoryExternalIdentifier",
  83|     "AdjustmentReason",
  84|     "AdjustmentDetail",
  85|     "Quantity",
  86|     "AdjustmentDate",
  87|     "ExternalIdentifier",
  88|     "CreatedBy",
  89|     "CreatedDate",
  90|     "UpdatedBy",
  91|     "UpdatedDate",
  92|     "Operation",
  93|   ],
  94|   InventoryTransfer: [
  95|     "FromLicenseNumber",
  96|     "ToLicenseNumber",
  97|     "FromInventoryExternalIdentifier",
  98|     "ToInventoryExternalIdentifier",
  99|     "Quantity",
 100|     "TransferDate",
 101|     "ExternalIdentifier",
 102|     "CreatedBy",
 103|     "CreatedDate",
 104|     "UpdatedBy",
 105|     "UpdatedDate",
 106|     "Operation",
 107|   ],
 108|   Sale: [
 109|     "LicenseNumber",
 110|     "SoldToLicenseNumber",
 111|     "InventoryExternalIdentifier",
 112|     "PlantExternalIdentifier",
 113|     "SaleType",
 114|     "SaleDate",
 115|     "Quantity",
 116|     "UnitPrice",
 117|     "Discount",
 118|     // A1: the LIVE LCB Sales.csv template uses RetailSalesTax / CannabisExciseTax.
 119|     // (The older Data Model Manual field list calls them SalesTax / OtherTax, but
 120|     // the CSV is validated against the template header, so the template wins.)
 121|     "RetailSalesTax",
 122|     "CannabisExciseTax",
 123|     "SaleExternalIdentifier",
 124|     "SaleDetailExternalIdentifier",
 125|     "CreatedBy",
 126|     "CreatedDate",
 127|     "UpdatedBy",
 128|     "UpdatedDate",
 129|     "Operation",
 130|   ],
 131| };
 132| 
 133| /**
 134|  * Valid CCRS `SaleType` values (Data Model File Specifications Manual, verified).
 135|  * A retailer emits RecreationalRetail for standard sales and RecreationalMedical
 136|  * for qualifying medical (DOH-authorized, tax-exempt) sales. Wholesale is for
 137|  * producer/processor transactions, not retail.
 138|  */
 139| export const CCRS_SALE_TYPES = [
 140|   "RecreationalRetail",
```

`src/lib/compliance/ccrs-batch-core.ts` L139-L180 — CCRS_SALE_TYPES / saleTypeForOrder / CCRS_STRAIN_TYPES / normalizeStrainType

```ts
 139| export const CCRS_SALE_TYPES = [
 140|   "RecreationalRetail",
 141|   "RecreationalMedical",
 142|   "Wholesale",
 143| ] as const;
 144| export type CcrsSaleType = (typeof CCRS_SALE_TYPES)[number];
 145| 
 146| /**
 147|  * Resolve the CCRS SaleType for a RETAIL order (B1). PURE. A medical order
 148|  * (Greenway is DOH medical-endorsed; the sale is recorded against a qualifying
 149|  * patient) is `RecreationalMedical`; everything else is `RecreationalRetail`.
 150|  * Never returns an invalid enum value.
 151|  */
 152| export function saleTypeForOrder(isMedical: boolean): CcrsSaleType {
 153|   return isMedical ? "RecreationalMedical" : "RecreationalRetail";
 154| }
 155| 
 156| /**
 157|  * Valid CCRS `StrainType` values (Data Model Manual, verified): exactly these
 158|  * three. CCRS rejects any other token (including "NotApplicable").
 159|  */
 160| export const CCRS_STRAIN_TYPES = ["Indica", "Sativa", "Hybrid"] as const;
 161| export type CcrsStrainType = (typeof CCRS_STRAIN_TYPES)[number];
 162| 
 163| /**
 164|  * Normalize an arbitrary POS strain-type label to a valid CCRS StrainType (B2).
 165|  * PURE. Returns the normalized value plus whether it had to be defaulted (so the
 166|  * caller can warn — DRAFTS-ONLY, we never silently invent). Rules:
 167|  *   - exact/lowercase Indica|Sativa|Hybrid → itself
 168|  *   - anything containing both indica & sativa, a ratio (e.g. "60/40"), or
 169|  *     "indica-dominant"/"sativa-dominant"/"blend"/"cbd" → Hybrid
 170|  *   - pure "indica"/"sativa" substrings → that type
 171|  *   - unknown/empty → Hybrid (the safe superset) + defaulted=true
 172|  */
 173| export function normalizeStrainType(
 174|   raw: string | null | undefined,
 175| ): { value: CcrsStrainType; defaulted: boolean } {
 176|   const s = (raw ?? "").trim().toLowerCase();
 177|   if (!s) return { value: "Hybrid", defaulted: true };
 178|   if (s === "indica") return { value: "Indica", defaulted: false };
 179|   if (s === "sativa") return { value: "Sativa", defaulted: false };
 180|   if (s === "hybrid") return { value: "Hybrid", defaulted: false };
```

`src/lib/compliance/ccrs-batch-core.ts` L560-L660 — CCRS_UPLOAD_GROUPS, uploadGroupOf, ccrsCell, ccrsDate, ccrsFileStamp (UTC — FAQ says filename 'referenced in PST'), ccrsFileName, assembleCcrsFile (header rows NOT comma-padded; templates ARE).

```ts
 560| export const CCRS_UPLOAD_GROUPS: readonly CcrsRetailerFileType[][] = [
 561|   ["Strain", "Area", "Product"],
 562|   ["Inventory"],
 563|   ["InventoryAdjustment", "InventoryTransfer", "Sale"],
 564| ];
 565| 
 566| /** Flattened upload order (Group 1 → 2 → 3). */
 567| export const CCRS_UPLOAD_ORDER: readonly CcrsRetailerFileType[] = CCRS_UPLOAD_GROUPS.flat();
 568| 
 569| /** The upload group number (1-based) for a file type. */
 570| export function uploadGroupOf(type: CcrsRetailerFileType): number {
 571|   for (let i = 0; i < CCRS_UPLOAD_GROUPS.length; i += 1) {
 572|     if (CCRS_UPLOAD_GROUPS[i].includes(type)) return i + 1;
 573|   }
 574|   return 0;
 575| }
 576| 
 577| // ---------------------------------------------------------------------------
 578| // Formatting helpers (kept consistent with ccrs-sales.ts)
 579| // ---------------------------------------------------------------------------
 580| 
 581| /** Thrown when a value cannot be written into a CCRS cell losslessly. */
 582| export class CcrsEncodeError extends Error {
 583|   constructor(message: string) {
 584|     super(message);
 585|     this.name = "CcrsEncodeError";
 586|   }
 587| }
 588| 
 589| /** True when a value holds a CR or LF (pre-flight E38 withholds such rows). */
 590| export function ccrsHasLineBreak(v: unknown): boolean {
 591|   return v != null && /[\r\n]/.test(String(v));
 592| }
 593| 
 594| /**
 595|  * S-09b — WHAT CCRS'S UPLOAD READER ACTUALLY DOES (observed, PREprod run
 596|  * P20261005A, evidence docs/ccrs-bible/evidence/P20261005A/):
 597|  *
 598|  * We sent `"P20261005A Smith, Jane Fidelity - 1g"` (RFC 4180: comma inside a
 599|  * quoted cell). CCRS echoed the row back cut at that comma — `"P20261005A
 600|  * Smith` | ` Jane Fidelity - 1g"` — every later value one column to the right,
 601|  * and rejected it "Operation is invalid must be Insert, Update or Delete"
 602|  * (the Operation column received the shifted, blank UpdatedDate).
 603|  * Exactly the 3 rows with a comma failed (C1/C4 had one in Description, C7 in
 604|  * Name); the 5 rows without one raised no error. So the reader splits every
 605|  * line on EVERY comma and does not honour CSV quoting. Consequences:
 606|  *   - a comma can never be carried in any CCRS cell (E42);
 607|  *   - wrapping a cell in quotes does not protect anything and the quote marks
 608|  *     themselves would reach CCRS as data, so we never add quotes;
 609|  *   - a `"` that is part of the value is carried as-is: PREprod P20261006A
 610|  *     (P-04b, 28/28 files Success, evidence docs/ccrs-bible/evidence/
 611|  *     P20261006A/) accepted Product/Inventory rows whose names hold a `"`
 612|  *     and accepted Inventory rows that referenced those names, so the
 613|  *     former E43 hold is lifted (S-09c, U-44 CLOSED; stored bytes U-44b).
 614|  */
 615| export type CcrsUnencodableReason = "line break" | "comma";
 616| 
 617| /** Why a value cannot be written into a CCRS cell, or null when it can. */
 618| export function ccrsUnencodableReason(v: unknown): CcrsUnencodableReason | null {
 619|   if (v == null) return null;
 620|   const s = String(v);
 621|   if (/[\r\n]/.test(s)) return "line break";
 622|   if (s.includes(",")) return "comma";
 623|   return null;
 624| }
 625| 
 626| /**
 627|  * Free-text columns: never a join key (Inventory joins Product by Name, Strain
 628|  * by Strain, Area by Area [G L0550-L0583]; nothing joins on these), so a comma
 629|  * in them is REWRITTEN (`,` → `;`, same length, so
 630|  * the 250-character clamp is unaffected) and reported as a warning (E44),
 631|  * instead of holding back the whole product. Join keys, ids, names and dates
 632|  * are never rewritten — a row with a comma there is withheld. A `"` is sent
 633|  * unchanged everywhere (S-09c, PREprod P20261006A).
 634|  */
 635| export const CCRS_FREE_TEXT_COLUMNS: Partial<Record<CcrsRetailerFileType, readonly string[]>> = {
 636|   Product: ["Description"],
 637|   InventoryAdjustment: ["AdjustmentDetail"],
 638| };
 639| 
 640| /** The disclosed free-text rewrite: `,` → `;`. Nothing else changes (a `"` is kept, S-09c). */
 641| export function ccrsFreeText(v: string): string {
 642|   return v.replace(/,/g, ";");
 643| }
 644| 
 645| export type CcrsWithheldRow = { label: string; column: string; value: string; reason: CcrsUnencodableReason };
 646| export type CcrsRewrittenCell = { label: string; column: string; before: string; after: string };
 647| 
 648| /**
 649|  * S-09 E38 + S-09b E42/E44 (+ S-09c: E43 retired): make rows safe for CCRS's comma-split reader.
 650|  * PURE. Every builder calls this immediately before assembleCcrsFile, so the
 651|  * encoder's throw is a tripwire that production never reaches.
 652|  *   1. free-text columns (CCRS_FREE_TEXT_COLUMNS) get `,` rewritten and
 653|  *      each rewrite is reported (E44, warning);
 654|  *   2. a row still holding a line break or comma in ANY cell is
 655|  *      withheld and reported with the first offending column (E38/E42).
 656|  * Withheld rows are reported, never silently dropped (Part 05 D-12). `label`
 657|  * is the operator-facing handle for the fix-link.
 658|  */
 659| export function withholdUnencodableRows(
 660|   rows: string[][],
```

`src/lib/compliance/ccrs-batch-core.ts` L776-L830 — verifyCcrsFile header checks

```ts
 776|   const [yyyy, mm, dd] = key.split("-");
 777|   return `${mm}/${dd}/${yyyy}`;
 778| }
 779| 
 780| /**
 781|  * YYYYMMDDHHMMSS timestamp for the file name, in the **Pacific** wall clock.
 782|  *
 783|  * CCRS bible slice S-01 / gap N-05. The LCB FAQ is explicit:
 784|  *   "the file name should be referenced in PST"   [FAQ L0075]
 785|  * and the naming convention itself is
 786|  *   UploadType_LicenseNumber_YYYYMMDDHHMMSS       [G L0046]
 787|  *
 788|  * This used `getUTC*`. A batch generated after ~5 PM Pacific was therefore named
 789|  * with TOMORROW's date while the file's own `SubmittedDate` row (ccrsDate, which
 790|  * has always been Pacific) said today — two different days inside one upload,
 791|  * and a file name that disagrees with the week it belongs to.
 792|  *
 793|  * DST is handled by the shared Intl-based helper (`pacificParts`), so PST/PDT
 794|  * resolve correctly for any instant; no fixed offset is used anywhere.
 795|  */
 796| export function ccrsFileStamp(now: Date = new Date()): string {
 797|   const t = pacificParts(now); // America/Los_Angeles wall clock
 798|   const p = (n: number, w = 2) => String(n).padStart(w, "0");
 799|   return (
 800|     `${t.year}${p(t.month)}${p(t.day)}` + `${p(t.hour)}${p(t.minute)}${p(t.second)}`
 801|   );
 802| }
 803| 
 804| /**
 805|  * Build the CCRS file name.
 806|  *   Licensees:   UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv
 807|  * When the license number is blank we substitute LICENSE so the shape is clear.
 808|  */
 809| export function ccrsFileName(
 810|   type: CcrsRetailerFileType,
 811|   licenseNumber: string,
 812|   now: Date = new Date(),
 813| ): string {
 814|   const lic = (licenseNumber ?? "").trim() || "LICENSE";
 815|   return `${type}_${lic}_${ccrsFileStamp(now)}.csv`;
 816| }
 817| 
 818| /**
 819|  * Assemble a full CCRS file from data rows.
 820|  * Row 1: SubmittedBy,<value>
 821|  * Row 2: SubmittedDate,<MM/DD/YYYY>
 822|  * Row 3: NumberRecords,<count>   (MUST equal data-row count exactly)
 823|  * Row 4: the column header row
 824|  * Rows 5+: data rows
 825|  */
 826| export function assembleCcrsFile(opts: {
 827|   type: CcrsRetailerFileType;
 828|   submittedBy: string;
 829|   submittedDate?: Date;
 830|   rows: string[][];
```

## C. Identifiers — `src/lib/compliance/ccrs-identifiers.ts`

`src/lib/compliance/ccrs-identifiers.ts` L30-L60 — sanitizeExternalId — replaces every non-alphanumeric run with '-' (would alter a vendor-issued id containing '_' or '.'); validateExternalId

```ts
  30|  *    examiner: periods are "your choice" and ids are text up to 100 [G L0224].
  31|  *    Rewriting "." to "-" produces an id CCRS has never seen, and every Sale
  32|  *    row against it fails "Invalid InventoryExternalIdentifier".
  33|  *  • MINTING. Only a brand-new lot that has never been filed gets a minted id
  34|  *    (`mintExternalId`, Greenway's [A-Za-z0-9-] convention).
  35|  *
  36|  * Everything here is PURE (no I/O), so it's unit-testable and importable anywhere.
  37|  */
  38| 
  39| export const CCRS_EXTERNAL_ID_MAX = 100;
  40| 
  41| /**
  42|  * Sanitize an arbitrary string into a CCRS-safe external identifier:
  43|  *  • keep alphanumerics; map any other run to a single hyphen
  44|  *  • trim leading/trailing hyphens
  45|  *  • clamp to 100 chars
  46|  *
  47|  * CCRS says "alpha-numeric"; in practice hyphens are widely accepted and used by
  48|  * integrators for readable ids, so we allow a single hyphen as a separator but
  49|  * never anything else.
  50|  */
  51| export function mintExternalId(raw: string): string {
  52|   const cleaned = (raw ?? "")
  53|     .trim()
  54|     .replace(/[^A-Za-z0-9]+/g, "-")
  55|     .replace(/^-+|-+$/g, "");
  56|   return cleaned.slice(0, CCRS_EXTERNAL_ID_MAX);
  57| }
  58| 
  59| /**
  60|  * @deprecated S-10: use `mintExternalId` for NEW ids only. Never call this on an
```

`src/lib/compliance/ccrs-identifiers.ts` L215-L262 — deriveInventoryExternalId (explicit → lot_code → pos_product_key → LOT-<id>) and resolveSaleInventoryExternalId

```ts
 215|         problems.push({
 216|           code: "duplicate_sale_detail",
 217|           saleExternalId,
 218|           detail: `SaleDetailExternalIdentifier "${d}" appears more than once in this sale`,
 219|         });
 220|       }
 221|       seen.add(d);
 222|     }
 223|     // SaleType / SaleDate consistency across the sale.
 224|     const types = new Set(group.map((l) => (l.saleType ?? "").trim()).filter(Boolean));
 225|     if (types.size > 1) {
 226|       problems.push({
 227|         code: "sale_type_mismatch",
 228|         saleExternalId,
 229|         detail: `mixed SaleType values in one sale: ${Array.from(types).join(", ")}`,
 230|       });
 231|     }
 232|     const dates = new Set(group.map((l) => (l.saleDate ?? "").trim()).filter(Boolean));
 233|     if (dates.size > 1) {
 234|       problems.push({
 235|         code: "sale_date_mismatch",
 236|         saleExternalId,
 237|         detail: `mixed SaleDate values in one sale: ${Array.from(dates).join(", ")}`,
 238|       });
 239|     }
 240|   }
 241|   return problems;
 242| }
 243| 
 244| export type LotIdentitySource = {
 245|   /** Persisted canonical id, if we've already assigned one. Always preferred. */
 246|   ccrs_inventory_external_id?: string | null;
 247|   /** The POS product key (= menu_items.source_item_id = order_lines.product_id). */
 248|   pos_product_key?: string | null;
 249|   /** Vendor/manifest lot code. */
 250|   lot_code?: string | null;
 251|   /** Stable DB primary key as a last resort. */
 252|   id?: string | null;
 253| };
 254| 
 255| /**
 256|  * S-10: the id ASSIGNED to a lot, or null. Never mints.
 257|  *
 258|  * Every CCRS file that names an existing lot (Inventory.csv, Sale.csv,
 259|  * InventoryAdjustment.csv) must carry the id that lot was filed under, so an
 260|  * export may only READ the stored id. Returns null when none is stored; the
 261|  * caller withholds the row (E3_EXTERNAL_ID_UNASSIGNED) rather than inventing
 262|  * an id CCRS has never seen.
```

## D. Week / ledger

`src/lib/compliance/ccrs-week-core.ts` L78-L140 — weekFromStart (due = end+1), lastCompletedWeek, WeekStatus, weekDeadline

```ts
  78|   /** Stable key, `W-YYYY-MM-DD` of the week-start Sunday (calendar-compatible). */
  79|   key: string;
  80| };
  81| 
  82| /** The Sunday on/before the given date. PURE. */
  83| export function weekStartFor(dateIso: string): string {
  84|   return addDaysIso(dateIso, -isoWeekday(dateIso));
  85| }
  86| 
  87| /** Build the CcrsWeek whose start-Sunday is `startIso` (must be a Sunday). PURE. */
  88| export function weekFromStart(startIso: string): CcrsWeek {
  89|   const start = weekStartFor(startIso); // normalize defensively
  90|   const end = addDaysIso(start, 6);
  91|   return { start, end, due: addDaysIso(end, 1), key: `W-${start}` };
  92| }
  93| 
  94| /** The week CONTAINING `dateIso` (may still be in progress). PURE. */
  95| export function weekContaining(dateIso: string): CcrsWeek {
  96|   return weekFromStart(weekStartFor(dateIso));
  97| }
  98| 
  99| /**
 100|  * The most recently COMPLETED Sun–Sat week as of `todayIso` — the week whose
 101|  * report is currently owed. On a Sunday this is the week that ended yesterday
 102|  * (its report is due TODAY). PURE.
 103|  */
 104| export function lastCompletedWeek(todayIso: string): CcrsWeek {
 105|   return weekFromStart(addDaysIso(weekStartFor(todayIso), -7));
 106| }
 107| 
 108| /** `W-YYYY-MM-DD` key → CcrsWeek (null when malformed). PURE. */
 109| export function weekFromKey(key: string): CcrsWeek | null {
 110|   if (!/^W-\d{4}-\d{2}-\d{2}$/.test(key)) return null;
 111|   const start = key.slice(2);
 112|   if (parseIsoDate(start) === null || isoWeekday(start) !== 0) return null;
 113|   return weekFromStart(start);
 114| }
 115| 
 116| // ── Week status ─────────────────────────────────────────────────────────────
 117| 
 118| /**
 119|  * How a completed week was resolved. Per the LCB FAQ, a week with no new
 120|  * activity requires NO upload — but recording that someone VERIFIED there was
 121|  * nothing to report is what makes the ledger audit-defensible.
 122|  */
 123| export type WeekResolution = "submitted" | "nothing_to_report";
 124| 
 125| export type WeekStatus =
 126|   | "in_progress" // the week is still running (its report isn't owed yet)
 127|   | "open" // completed, before the due day (early submission window)
 128|   | "due_today" // today IS the due Sunday and the week is unresolved
 129|   | "overdue" // past the due Sunday and unresolved
 130|   | "submitted" // resolved: files uploaded to CCRS
 131|   | "nothing_to_report" // resolved: verified no new activity that week
 132|   | "before_start" // S-12d: ends before the owner's start date (not this system's to file)
 133|   | "dismissed"; // S-12d: checked off with a written reason (obligation_waivers)
 134| 
 135| export type WeekDeadline = {
 136|   week: CcrsWeek;
 137|   status: WeekStatus;
 138|   /** Signed days from today to the due date (negative once overdue). */
 139|   daysUntilDue: number;
 140|   resolution: WeekResolution | null;
```

`src/lib/compliance/ccrs-week-core.ts` L213-L260 — ReminderStage + planWeeklyReminders

```ts
 213|     (w) => w.status === "open" || w.status === "due_today" || w.status === "overdue",
 214|   );
 215|   // Oldest (most-negative daysUntilDue) first.
 216|   const mostUrgent =
 217|     unresolved.length > 0
 218|       ? unresolved.reduce((a, b) => (b.daysUntilDue < a.daysUntilDue ? b : a))
 219|       : null;
 220|   const overdueCount = weeks.filter((w) => w.status === "overdue").length;
 221| 
 222|   const beforeStartCount = weeks.filter((w) => w.status === "before_start").length;
 223|   const dismissedCount = weeks.filter((w) => w.status === "dismissed").length;
 224| 
 225|   return {
 226|     current,
 227|     weeks,
 228|     mostUrgent,
 229|     overdueCount,
 230|     allClear: unresolved.length === 0,
 231|     beforeStartCount,
 232|     dismissedCount,
 233|   };
 234| }
 235| 
 236| // ── Reminder planner ────────────────────────────────────────────────────────
 237| 
 238| /**
 239|  * The reminder cadence the owner asked for ("no way we could ever miss the
 240|  * upload deadlines"). Evaluated once per day (cron) against Pacific `todayIso`:
 241|  *   • thursday_heads_up — Thursday of the in-progress week: deadline preview.
 242|  *   • saturday_wrap     — Saturday: the reporting week closes tonight.
 243|  *   • sunday_due        — the due Sunday while the owed week is unresolved.
 244|  *   • overdue_daily     — EVERY day after the due date while unresolved.
 245|  * Each reminder carries a dedupe key so a re-run cron can never double-send.
 246|  */
 247| export type ReminderStage = "thursday_heads_up" | "saturday_wrap" | "sunday_due" | "overdue_daily";
 248| 
 249| export type PlannedReminder = {
 250|   stage: ReminderStage;
 251|   /** Week the reminder is about. */
 252|   weekKey: string;
 253|   /** Unique send-once key. overdue_daily includes the date so it repeats daily. */
 254|   dedupeKey: string;
 255|   /** Plain-language subject line seed. */
 256|   subject: string;
 257|   /** Plain-language body seed (the sender may add links/formatting). */
 258|   body: string;
 259|   urgency: "info" | "warning" | "critical";
 260| };
```

`src/lib/compliance/ccrs-week-store.ts` L40-L157 — listWeekSubmissions, getWeekResolutions, getWeeklyOverview, resolveWeek, unresolveWeek, setWeekErrorStatus

```ts
  40| };
  41| 
  42| const ROW_COLUMNS =
  43|   "id, week_key, week_start, week_end, due_date, resolution, resolved_at, " +
  44|   "resolved_by_email, on_time, files_json, total_records, error_status, error_notes, notes";
  45| 
  46| /** Recent ledger rows, newest week first. */
  47| export async function listWeekSubmissions(limit = 12): Promise<WeekSubmissionRow[]> {
  48|   if (!isSupabaseServiceConfigured) return [];
  49|   try {
  50|     const admin = createSupabaseAdminClient();
  51|     const { data } = await admin
  52|       .from("ccrs_week_submissions")
  53|       .select(ROW_COLUMNS)
  54|       .order("week_start", { ascending: false })
  55|       .limit(Math.min(Math.max(limit, 1), 60));
  56|     return (data as WeekSubmissionRow[] | null) ?? [];
  57|   } catch {
  58|     return [];
  59|   }
  60| }
  61| 
  62| /** week_key → resolution map for the deadline engine. */
  63| export async function getWeekResolutions(lookbackWeeks = 8): Promise<Map<string, WeekResolution>> {
  64|   const out = new Map<string, WeekResolution>();
  65|   const rows = await listWeekSubmissions(Math.max(lookbackWeeks, 8));
  66|   for (const r of rows) out.set(r.week_key, r.resolution);
  67|   return out;
  68| }
  69| 
  70| /** The full weekly deadline picture as of today (Pacific). */
  71| export async function getWeeklyOverview(opts?: { lookbackWeeks?: number }): Promise<WeeklyOverview> {
  72|   const lookbackWeeks = opts?.lookbackWeeks ?? 4;
  73|   // S-12d: the first day of sales + written dismissals (fails safe: an
  74|   // unreadable context nags as before).
  75|   const [resolutions, ctx] = await Promise.all([getWeekResolutions(lookbackWeeks), getObligationContext()]);
  76|   return weeklyDeadlineOverview(pacificToday(), resolutions, { lookbackWeeks, ctx });
  77| }
  78| 
  79| /**
  80|  * Resolve a week: record 'submitted' (with the generated files summary) or
  81|  * 'nothing_to_report'. Upserts on week_key so a correction overwrites the
  82|  * previous resolution rather than duplicating it.
  83|  */
  84| export async function resolveWeek(opts: {
  85|   weekKey: string;
  86|   resolution: WeekResolution;
  87|   byId: string | null;
  88|   byEmail: string | null;
  89|   files?: { type: string; fileName: string; recordCount: number }[];
  90|   totalRecords?: number;
  91|   notes?: string | null;
  92| }): Promise<{ ok: boolean; error?: string }> {
  93|   if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  94|   const week = weekFromKey(opts.weekKey);
  95|   if (!week) return { ok: false, error: "Invalid week key." };
  96|   // A week can only be resolved once it has COMPLETED (today past its end).
  97|   const today = pacificToday();
  98|   if (today <= week.end) {
  99|     return { ok: false, error: "This reporting week is still in progress — it can be resolved after Saturday." };
 100|   }
 101|   try {
 102|     const admin = createSupabaseAdminClient();
 103|     const { error } = await admin.from("ccrs_week_submissions").upsert(
 104|       {
 105|         week_key: week.key,
 106|         week_start: week.start,
 107|         week_end: week.end,
 108|         due_date: week.due,
 109|         resolution: opts.resolution,
 110|         resolved_at: new Date().toISOString(),
 111|         resolved_by: opts.byId,
 112|         resolved_by_email: opts.byEmail,
 113|         on_time: today <= week.due,
 114|         files_json: opts.resolution === "submitted" ? (opts.files ?? []) : null,
 115|         total_records: opts.resolution === "submitted" ? (opts.totalRecords ?? 0) : 0,
 116|         notes: opts.notes ?? null,
 117|       },
 118|       { onConflict: "week_key" },
 119|     );
 120|     if (error) return { ok: false, error: error.message };
 121|     return { ok: true };
 122|   } catch (e) {
 123|     return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
 124|   }
 125| }
 126| 
 127| /** Un-resolve a week (undo a mistaken sign-off). */
 128| export async function unresolveWeek(weekKey: string): Promise<{ ok: boolean; error?: string }> {
 129|   if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
 130|   if (!weekFromKey(weekKey)) return { ok: false, error: "Invalid week key." };
 131|   try {
 132|     const admin = createSupabaseAdminClient();
 133|     const { error } = await admin.from("ccrs_week_submissions").delete().eq("week_key", weekKey);
 134|     if (error) return { ok: false, error: error.message };
 135|     return { ok: true };
 136|   } catch (e) {
 137|     return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
 138|   }
 139| }
 140| 
 141| /** Flag / clear an error-email status on a submitted week. */
 142| export async function setWeekErrorStatus(opts: {
 143|   weekKey: string;
 144|   errorStatus: "clean" | "errors_reported" | "resolved";
 145|   errorNotes?: string | null;
 146| }): Promise<{ ok: boolean; error?: string }> {
 147|   if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
 148|   if (!weekFromKey(opts.weekKey)) return { ok: false, error: "Invalid week key." };
 149|   try {
 150|     const admin = createSupabaseAdminClient();
 151|     const { error } = await admin
 152|       .from("ccrs_week_submissions")
 153|       .update({ error_status: opts.errorStatus, error_notes: opts.errorNotes ?? null })
 154|       .eq("week_key", opts.weekKey);
 155|     if (error) return { ok: false, error: error.message };
 156|     return { ok: true };
 157|   } catch (e) {
```

## E. Triage / gate

`src/lib/compliance/ccrs-error-triage-core.ts` L40-L165 — Rule type + RULES table (needle substrings, first match wins) + ERROR_HINT + triageCcrsErrorEmail head

```ts
  40| 
  41| type Rule = {
  42|   id: string;
  43|   /** Lower-cased substrings; a line matches when it contains ANY of them. */
  44|   needles: string[];
  45|   severity: TriageSeverity;
  46|   meaning: string;
  47|   fixSteps: string[];
  48| };
  49| 
  50| /**
  51|  * Known CCRS error signatures (Upload User Guide + FAQ, verified in the Task W
  52|  * research doc). Order matters: first match wins per line.
  53|  */
  54| const RULES: Rule[] = [
  55|   {
  56|     id: "duplicate_strain",
  57|     needles: ["duplicate strain"],
  58|     severity: "benign",
  59|     meaning:
  60|       "The strain already exists in CCRS for this license. The LCB FAQ says this needs NO corrective action — the rest of the file still processes.",
  61|     fixSteps: [],
  62|   },
  63|   {
  64|     id: "duplicate_transfer",
  65|     needles: ["duplicate inventorytransfer"],
  66|     severity: "benign",
  67|     meaning:
  68|       "This transfer receipt was already recorded in CCRS (transfers are unique on insert). If the quantities matched what you meant to report, nothing further is needed.
  69|     fixSteps: [],
  70|   },
  71|   {
  72|     id: "strain_not_linked",
  73|     needles: ["strain name reported is not linked to the license"],
  74|     severity: "fixable",
  75|     meaning:
  76|       "An Inventory row references a strain CCRS doesn't have on file for license. Either the Strain.csv wasn't uploaded first (Group 1 before Group 2, ≥10 minutes apart)
  77|     fixSteps: [
  78|       "Check the strain spelling in Inventory.csv against Strain.csv — it must match character-for-character.",
  79|       "If the strain was never submitted, upload Strain.csv, wait 10+ minutes, then re-upload the corrected Inventory.csv.",
  80|       "Regenerate the batch here so NumberRecords matches the corrected row count.",
  81|     ],
  82|   },
  83|   {
  84|     id: "name_required",
  85|     needles: ["name is required"],
  86|     severity: "fixable",
  87|     meaning: "A required Name field (e.g. Area.Name) was blank in one or more rows.",
  88|     fixSteps: [
  89|       "Open the flagged file and fill in the missing Name value(s).",
  90|       "Re-upload the corrected file with the SAME external identifiers and a matching NumberRecords header.",
  91|     ],
  92|   },
  93|   {
  94|     id: "bad_category_type",
  95|     needles: ["invalid inventorycategory", "invalid inventory category", "inventorytype combination"],
  96|     severity: "fixable",
  97|     meaning:
  98|       "A Product row pairs an InventoryCategory with an InventoryType that isn't allowed (Table 2 of the Upload User Guide — e.g. EndProduct must use types like Usable Ca
  99|     fixSteps: [
 100|       "Fix the InventoryCategory/InventoryType pair on the flagged Product row(s) per Table 2.",
 101|       "Re-upload Product.csv, wait 10+ minutes, then re-upload any dependent Inventory.csv rows.",
 102|     ],
 103|   },
 104|   {
 105|     id: "from_inventory_invalid",
 106|     needles: ["invalid frominventoryexternalidentifier", "frominventoryexternalidentifier"],
 107|     severity: "fixable",
 108|     meaning:
 109|       "A transfer receipt references the SELLER's inventory identifier, but CCRS can't find it — usually the supplier hasn't filed their own Inventory/Sale report yet.",
 110|     fixSteps: [
 111|       "Verify the FromInventoryExternalIdentifier against the seller's manifest/paperwork.",
 112|       "Contact the supplier and ask when they filed their CCRS report; re-upload the transfer AFTER they have.",
 113|       "If the supplier confirms they filed and it still fails, escalate to examiner@lcb.wa.gov with the CSV + the error email.",
 114|     ],
 115|   },
 116|   {
 117|     id: "duplicate_sale",
 118|     needles: ["duplicate sale for licensee", "duplicate sale"],
 119|     severity: "fixable",
 120|     meaning:
 121|       "Rows share a SaleExternalIdentifier without unique SaleDetailExternalIdentifiers (or the ticket was already reported). One ticket = one SaleExternalIdentifier; eve
 122|     fixSteps: [
 123|       "Check whether this sale was already reported in a previous week — if so, no re-upload is needed.",
 124|       "Otherwise make every line's SaleDetailExternalIdentifier unique (keep the shared SaleExternalIdentifier) and re-upload.",
 125|     ],
 126|   },
 127|   {
 128|     id: "excise_zero_nonmedical",
 129|     needles: ["only medical sales can be 0", "only medical sales can be $0"],
 130|     severity: "fixable",
 131|     meaning:
 132|       "A non-medical sale row reported $0 cannabis excise tax. Excise must equal 37% of unit price for every retail sale; ONLY SaleType=RecreationalMedical rows (DOH-veri
 133|     fixSteps: [
 134|       "If the sale was NOT a verified medical exemption: correct the excise to 37% of the unit price and re-upload.",
 135|       "If it WAS a valid medical sale: set SaleType=RecreationalMedical (both tax columns $0.00) and confirm the inventory row was reported IsMedical=TRUE.",
 136|     ],
 137|   },
 138|   {
 139|     id: "number_records_mismatch",
 140|     needles: ["numberrecords", "number of records"],
 141|     severity: "fixable",
 142|     meaning:
 143|       "The NumberRecords value in the file's header doesn't equal the actual data-row count, so CCRS rejected the whole file.",
 144|     fixSteps: [
 145|       "Regenerate the file from the Command Center — the generator always writes a matching NumberRecords — rather than hand-editing.",
 146|       "If you hand-edited the CSV, recount the data rows (exclude the 3 header rows) and fix the header, then re-upload.",
 147|     ],
 148|   },
 149|   {
 150|     id: "quarantine",
 151|     needles: ["quarantine"],
 152|     severity: "fixable",
 153|     meaning:
 154|       "A sale references inventory sitting in a quarantine area. Cannabis products should never be in quarantine areas (IsQuarantine=TRUE is only for imported CBD awaitin
 155|     fixSteps: [
 156|       "Move the lot to a non-quarantine Area (Area.csv IsQuarantine=FALSE) and re-upload Inventory, wait 10+ minutes, then re-upload the Sale rows.",
 157|     ],
 158|   },
 159| ];
 160| 
 161| const ERROR_HINT = /error|invalid|required|duplicate|reject|fail|mismatch|cannot|not linked|can be 0/i;
 162| 
 163| /** Triage a pasted CCRS error email. PURE + deterministic. */
 164| export function triageCcrsErrorEmail(pasted: string): TriageResult {
 165|   const findings: TriageFinding[] = [];
```

`src/lib/compliance/ccrs-error-triage-core.ts` L226-L280 — LCB_CONTACTS + buildExaminerDraft

```ts
 226| export const LCB_CONTACTS = {
 227|   examiner: "examiner@lcb.wa.gov",
 228|   serviceDesk: "servicedesk@lcb.wa.gov",
 229|   taxes: "cannabistaxes@lcb.wa.gov",
 230|   enforcement: "cannabisenf@lcb.wa.gov",
 231|   endorsement: "cannabisendorsement@lcb.wa.gov",
 232| } as const;
 233| 
 234| export type ExaminerDraft = {
 235|   to: string;
 236|   subject: string;
 237|   body: string;
 238| };
 239| 
 240| /**
 241|  * Build the examiner escalation email as a DRAFT (never sent automatically —
 242|  * standing drafts-only rule). The owner attaches the CSV and forwards the
 243|  * original CCRS error email per the LCB workflow.
 244|  */
 245| export function buildExaminerDraft(opts: {
 246|   licenseNumber: string;
 247|   licenseeName: string;
 248|   weekStart: string; // ISO
 249|   weekEnd: string; // ISO
 250|   fileTypes: string[];
 251|   errorExcerpt: string;
 252|   contactEmail?: string;
 253| }): ExaminerDraft {
 254|   const files = opts.fileTypes.length > 0 ? opts.fileTypes.join(", ") : "(files not specified)";
 255|   const excerpt = opts.errorExcerpt.trim().slice(0, 1500);
 256|   const subject = `CCRS upload error assistance — license ${opts.licenseNumber} — week ${opts.weekStart} to ${opts.weekEnd}`;
 257|   const body = [
 258|     "Hello,",
 259|     "",
 260|     `We are ${opts.licenseeName} (license ${opts.licenseNumber}). We received an error notification after our weekly CCRS upload covering ${opts.weekStart} through ${opts
 261|     "",
 262|     "Error message received:",
 263|     "----------------------------------------",
 264|     excerpt || "(paste the CCRS error text here)",
 265|     "----------------------------------------",
 266|     "",
 267|     "The original CSV file(s) are attached, and the CCRS error email is forwarded with this message. Could you please advise how to correct and resubmit?",
 268|     "",
 269|     "Thank you,",
 270|     opts.licenseeName,
 271|     opts.contactEmail ? opts.contactEmail : "",
 272|   ]
 273|     .join("\n")
 274|     .trimEnd();
 275|   return { to: LCB_CONTACTS.examiner, subject, body };
 276| }
 277| 
 278| // ── Self-tests (tsx / vitest) ─────────────────────────────────────────────────
 279| 
 280| export function __runCcrsErrorTriageTests(): { passed: number; failed: number } {
```

`src/lib/compliance/ccrs-submit-gate-core.ts` L60-L148 — defaultClassifyWarning + assertCcrsBatchSubmittable + verdictSummary

```ts
  60|   /** where this issue came from, for the report. */
  61|   source: "sync" | "verifier" | "file-warning";
  62| };
  63| 
  64| export type CcrsSubmitVerdict = {
  65|   submittable: boolean;
  66|   errorCount: number;
  67|   warningCount: number;
  68|   errors: GateIssue[];
  69|   warnings: GateIssue[];
  70|   /** All issues (errors first) for a single ordered report. */
  71|   issues: GateIssue[];
  72| };
  73| 
  74| /**
  75|  * S-17a: the ONE mapping from a builder sync issue to gate input. Every caller
  76|  * (hub page, compliance report, batch-export route) uses this instead of a
  77|  * hand-written `{severity, file, message, count}` literal — that literal is
  78|  * exactly how the 2026-10-19 hub lost the rows of "17 lot(s) were left out"
  79|  * (Part 17 §C.4 defect 1). A source test pins that no caller maps by hand.
  80|  */
  81| export function toGateInput(s: {
  82|   severity: GateSeverity;
  83|   file: string;
  84|   message: string;
  85|   count?: number;
  86|   code?: string;
  87|   specPin?: string;
  88|   rows?: readonly DisplayRow[];
  89| }): GateIssueInput {
  90|   return {
  91|     severity: s.severity,
  92|     file: String(s.file),
  93|     message: s.message,
  94|     count: s.count,
  95|     code: s.code,
  96|     specPin: s.specPin,
  97|     rows: s.rows,
  98|   };
  99| }
 100| 
 101| /**
 102|  * The default warning classifier. A warning whose message begins with "ERROR"
 103|  * (case-insensitive) is BLOCKING; everything else is advisory. This mirrors the
 104|  * app's existing `classifyWarning` in ccrs-batch-core. Injectable for testing
 105|  * and so callers can pass the real one to stay perfectly in sync.
 106|  */
 107| export function defaultClassifyWarning(message: string | null | undefined): GateSeverity {
 108|   const m = (message ?? "").trim().toLowerCase();
 109|   return m.startsWith("error") ? "error" : "warning";
 110| }
 111| 
 112| /**
 113|  * Compute the submit verdict. PURE. Pass the real `classifyWarning` from
 114|  * ccrs-batch-core to keep classification identical to the rest of the app.
 115|  */
 116| export function assertCcrsBatchSubmittable(input: {
 117|   syncIssues: readonly GateIssueInput[];
 118|   verifierProblems: readonly GateIssueInput[];
 119|   files: readonly GateFileInput[];
 120|   classifyWarning?: (message: string | null | undefined) => GateSeverity;
 121| }): CcrsSubmitVerdict {
 122|   const classify = input.classifyWarning ?? defaultClassifyWarning;
 123|   const collected: GateIssue[] = [];
 124| 
 125|   for (const s of input.syncIssues) {
 126|     collected.push({
 127|       severity: s.severity,
 128|       file: String(s.file),
 129|       message: s.message,
 130|       count: s.count,
 131|       code: s.code,
 132|       specPin: s.specPin,
 133|       rows: s.rows ? [...s.rows] : undefined,
 134|       source: "sync",
 135|     });
 136|   }
 137|   for (const p of input.verifierProblems) {
 138|     collected.push({
 139|       severity: p.severity,
 140|       file: String(p.file),
 141|       message: p.message,
 142|       count: p.count,
 143|       code: p.code,
 144|       specPin: p.specPin,
 145|       rows: p.rows ? [...p.rows] : undefined,
 146|       source: "verifier",
 147|     });
 148|   }
```

## F. Adjustments & sale corrections

`src/lib/compliance/ccrs-inventory-adjustment-core.ts` L28-L135 — CCRS_ADJUSTMENT_REASONS, mapAdjustmentReason (return→Other; comment says detail REQUIRED), isReportableAdjustment, adjustmentDetail (returns '' for null — E13)

```ts
  28|   submittedBy: string;
  29| };
  30| 
  31| // ---------------------------------------------------------------------------
  32| // Reason mapping — internal reason → CCRS AdjustmentReason (valid values only)
  33| // ---------------------------------------------------------------------------
  34| 
  35| /** The exact set of AdjustmentReason values CCRS accepts. */
  36| export const CCRS_ADJUSTMENT_REASONS = [
  37|   "Destruction",
  38|   "Reconciliation",
  39|   "Lost",
  40|   "Seizure",
  41|   "Theft",
  42|   "ReturnedLabSample",
  43|   "Other",
  44| ] as const;
  45| export type CcrsAdjustmentReason = (typeof CCRS_ADJUSTMENT_REASONS)[number];
  46| 
  47| /**
  48|  * Map an internal adjustment reason to a valid CCRS AdjustmentReason.
  49|  *
  50|  *   receive       → (not exported — additions are reported via Inventory.csv)
  51|  *   destruction   → Destruction
  52|  *   count         → Reconciliation   (cycle-count variance correction)
  53|  *   shrink        → Lost
  54|  *   damage        → Lost
  55|  *   sample        → ReturnedLabSample (lab/QA sample pulled from sellable stock)
  56|  *   recall        → Destruction       (recalled product is destroyed)
  57|  *   return        → Other             (customer return add-back; detail REQUIRED)
  58|  *   theft         → Theft
  59|  *   seizure       → Seizure
  60|  *   other / *     → Other
  61|  */
  62| export function mapAdjustmentReason(internal: string): CcrsAdjustmentReason {
  63|   switch ((internal ?? "").trim().toLowerCase()) {
  64|     case "destruction":
  65|       return "Destruction";
  66|     case "count":
  67|       return "Reconciliation";
  68|     case "shrink":
  69|     case "damage":
  70|       return "Lost";
  71|     case "sample":
  72|       return "ReturnedLabSample";
  73|     // Task K: an EMPLOYEE trade sample (WAC 314-55-096) is reported to CCRS as
  74|     // an InventoryAdjustment with reason "Other" and a detail naming the
  75|     // employee (LCB-confirmed shape). It is NOT a returned lab sample.
  76|     case "employee_sample":
  77|       return "Other";
  78|     case "recall":
  79|       return "Destruction";
  80|     // Task Q: a CUSTOMER return (WAC 314-55-079(12)) adds quantity BACK to the
  81|     // inventory identifier. Per the LCB CCRS FAQ the sale identifier is deleted
  82|     // and the inventory identifier is "reported on an Inventory Adjustment as a
  83|     // return, with details" — 'Return' is not a valid AdjustmentReason, so the
  84|     // correct encoding is Other + a mandatory detail stating the ADD direction.
  85|     case "return":
  86|       return "Other";
  87|     case "theft":
  88|       return "Theft";
  89|     case "seizure":
  90|       return "Seizure";
  91|     default:
  92|       return "Other";
  93|   }
  94| }
  95| 
  96| /**
  97|  * Should this internal reason be exported to CCRS InventoryAdjustment at all?
  98|  * Positive deltas that represent RECEIVING are reported via Inventory.csv, not
  99|  * here, so we exclude `receive`. A zero-delta row is a no-op.
 100|  */
 101| export function isReportableAdjustment(internal: string, qtyDelta: number): boolean {
 102|   const r = (internal ?? "").trim().toLowerCase();
 103|   if (r === "receive") return false;
 104|   return qtyDelta !== 0;
 105| }
 106| 
 107| // ---------------------------------------------------------------------------
 108| // Formatting helpers
 109| // ---------------------------------------------------------------------------
 110| 
 111| /** MM/DD/YYYY for the Pacific calendar day (B3) — delegates to the shared,
 112|  * timezone-correct formatter so AdjustmentDate uses the WA business day. */
 113| export function mmddyyyy(iso: string | Date): string {
 114|   return ccrsDate(iso);
 115| }
 116| 
 117| /** S-09b: delegates to the shared CCRS encoder. CCRS splits on every comma
 118|  * and ignores quoting, so the encoder never adds quotes and throws on a comma
 119|  * or line break (the builder withholds/rewrites those first). A `"` is sent
 120|  * unchanged (S-09c, PREprod P20261006A). */
 121| export function cell(v: unknown): string {
 122|   return ccrsCell(v);
 123| }
 124| 
 125| /** Reported quantity is always the absolute magnitude of the change. */
 126| export function adjustmentQuantity(qtyDelta: number): string {
 127|   const n = Math.abs(Number(qtyDelta) || 0);
 128|   return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(4)));
 129| }
 130| 
 131| /** Clamp free-form detail to the CCRS 250-char limit. */
 132| export function adjustmentDetail(note: string | null | undefined): string {
 133|   return (note ?? "").replace(/\s+/g, " ").trim().slice(0, 250);
 134| }
 135| 
```

`src/lib/compliance/ccrs-inventory-adjustment-core.ts` L135-L235 — ADJUSTMENT_COLUMNS, mapAdjustmentRow, buildAdjustmentFile, makeAdjustmentFileName

```ts
 135| 
 136| // A5: the LIVE LCB InventoryAdjustment.csv template is 12 columns — the
 137| // per-adjustment unique `ExternalIdentifier` sits between AdjustmentDate and
 138| // CreatedBy and was previously missing (11 cols → CCRS rejection). This set now
 139| // matches ccrs-batch-core.CCRS_COLUMNS.InventoryAdjustment exactly.
 140| export const ADJUSTMENT_COLUMNS = [
 141|   "LicenseNumber",
 142|   "InventoryExternalIdentifier",
 143|   "AdjustmentReason",
 144|   "AdjustmentDetail",
 145|   "Quantity",
 146|   "AdjustmentDate",
 147|   "ExternalIdentifier",
 148|   "CreatedBy",
 149|   "CreatedDate",
 150|   "UpdatedBy",
 151|   "UpdatedDate",
 152|   "Operation",
 153| ] as const;
 154| 
 155| // ---------------------------------------------------------------------------
 156| // Row mapping (PURE)
 157| // ---------------------------------------------------------------------------
 158| 
 159| export type AdjustmentSourceRow = {
 160|   id: string;
 161|   qty_delta: number;
 162|   reason: string;
 163|   note: string | null;
 164|   created_at: string;
 165|   lot: {
 166|     id: string | null;
 167|     lot_code: string | null;
 168|     pos_product_key: string | null;
 169|     /** S-10: the id the lot was FILED under. Must be selected by the reader. */
 170|     ccrs_inventory_external_id?: string | null;
 171|   } | null;
 172| };
 173| 
 174| export type AdjustmentMapResult = {
 175|   row: string[] | null;
 176|   skipReason?: string;
 177| };
 178| 
 179| /** Map one internal adjustment row to a CCRS CSV row. PURE. */
 180| export function mapAdjustmentRow(
 181|   src: AdjustmentSourceRow,
 182|   license: CcrsLicenseLike,
 183| ): AdjustmentMapResult {
 184|   if (!isReportableAdjustment(src.reason, Number(src.qty_delta))) {
 185|     return { row: null, skipReason: `${src.reason} (not reportable)` };
 186|   }
 187| 
 188|   // S-10: the adjustment must reference the SAME id the Inventory row carries
 189|   // [G L1077-L1083] (Valid Values: Inventory.ExternalIdentifier) — the
 190|     // lot's assigned id first, byte-for-byte.
 191|   const externalId = deriveInventoryExternalId({
 192|     ccrs_inventory_external_id: src.lot?.ccrs_inventory_external_id ?? null,
 193|     lot_code: src.lot?.lot_code ?? null,
 194|     pos_product_key: src.lot?.pos_product_key ?? null,
 195|     id: src.lot?.id ?? null,
 196|   });
 197|   if (!externalId) {
 198|     return { row: null, skipReason: `adjustment ${src.id} has no resolvable inventory identifier` };
 199|   }
 200| 
 201|   // E13 [G L1111] "Inventory AdjustmentDetail missing". CCRS requires a
 202|   // free-text detail for reasons that carry no self-evident explanation
 203|   // (Other, Theft). Emitting the row without one gets the InventoryAdjustment
 204|   // file rejected, so withhold it behind the stable E13: prefix and let the
 205|   // I/O wrapper raise it as a CODED error instead of a generic skip (W16).
 206|   const ccrsReason = mapAdjustmentReason(src.reason);
 207|   const detail = adjustmentDetail(src.note);
 208|   if (adjustmentDetailRequired(ccrsReason) && !detail) {
 209|     return {
 210|       row: null,
 211|       skipReason: `${E13_SKIP_PREFIX} adjustment ${src.id} is reported as "${ccrsReason}" but has no detail note — CCRS requires one [G L1111]`,
 212|     };
 213|   }
 214| 
 215|   const date = mmddyyyy(src.created_at);
 216|   // A5: the per-adjustment ExternalIdentifier — unique + deterministic so
 217|   // re-generating the same range yields the same id (idempotent upload).
 218|   const adjustmentExternalId = sanitizeExternalId(`ADJ-${src.id}`);
 219|   const row = [
 220|     license.licenseNumber,
 221|     externalId,
 222|     ccrsReason,
 223|     detail,
 224|     adjustmentQuantity(Number(src.qty_delta)),
 225|     date,
 226|     adjustmentExternalId, // ExternalIdentifier (per-adjustment, unique)
 227|     license.submittedBy, // CreatedBy
 228|     date, // CreatedDate
 229|     license.submittedBy, // UpdatedBy
 230|     date, // UpdatedDate
 231|     "Insert", // Operation
 232|   ];
 233|   return { row };
 234| }
 235| 
```

`src/lib/compliance/ccrs-inventory-adjustment.ts` L45-L111 — buildCcrsInventoryAdjustmentCsv (DB read + skipReason warnings W16)

```ts
  45| export type CcrsAdjustmentBuildResult = {
  46|   csv: string;
  47|   fileName: string;
  48|   recordCount: number;
  49|   skipped: number;
  50|   warnings: string[];
  51|   licenseNumber: string;
  52| };
  53| 
  54| /**
  55|  * Build the InventoryAdjustment.csv for adjustments created in [fromISO, toISO].
  56|  * Joins each adjustment to its lot for the external identifier.
  57|  */
  58| export async function buildCcrsInventoryAdjustmentCsv(
  59|   fromISO: string,
  60|   toISO: string,
  61| ): Promise<CcrsAdjustmentBuildResult> {
  62|   const license = await getCcrsLicenseSettings();
  63|   const result: CcrsAdjustmentBuildResult = {
  64|     csv: "",
  65|     fileName: makeAdjustmentFileName(license.licenseNumber),
  66|     recordCount: 0,
  67|     skipped: 0,
  68|     warnings: [],
  69|     licenseNumber: license.licenseNumber,
  70|   };
  71| 
  72|   if (!license.licenseNumber) {
  73|     result.warnings.push("License number is not set — set it on the Compliance tab before uploading.");
  74|   }
  75| 
  76|   if (!isSupabaseServiceConfigured) {
  77|     result.csv = buildAdjustmentFile([], license);
  78|     return result;
  79|   }
  80| 
  81|   const admin = createSupabaseAdminClient();
  82|   const { data, error } = await admin
  83|     .from("inventory_adjustments")
  84|     .select(
  85|       "id, qty_delta, reason, note, created_at, lot:inventory_lots(id, lot_code, pos_product_key, ccrs_inventory_external_id)",
  86|     )
  87|     .gte("created_at", fromISO)
  88|     .lte("created_at", toISO)
  89|     .order("created_at", { ascending: true });
  90| 
  91|   if (error) {
  92|     result.warnings.push(`Could not load adjustments: ${error.message}`);
  93|     result.csv = buildAdjustmentFile([], license);
  94|     return result;
  95|   }
  96| 
  97|   const rows: string[][] = [];
  98|   for (const raw of (data ?? []) as unknown as AdjustmentSourceRow[]) {
  99|     const lotRel = (raw as { lot: unknown }).lot;
 100|     const lot = Array.isArray(lotRel) ? (lotRel[0] ?? null) : (lotRel ?? null);
 101|     const mapped = mapAdjustmentRow({ ...raw, lot: lot as AdjustmentSourceRow["lot"] }, license);
 102|     if (mapped.row) {
 103|       rows.push(mapped.row);
 104|     } else {
 105|       result.skipped += 1;
 106|       if (mapped.skipReason && !mapped.skipReason.includes("not reportable")) {
 107|         result.warnings.push(mapped.skipReason);
 108|       }
 109|     }
 110|   }
 111| 
```

`src/lib/compliance/ccrs-sale-correction-core.ts` L80-L160 — mapSaleCorrectionRow (Delete full / Update partial), buildSaleCorrectionFile, makeSaleCorrectionFileName

```ts
  80|   const r = Math.max(0, Math.min(remainingQty, originalQty));
  81|   return Math.round((lineMinor * r) / originalQty);
  82| }
  83| 
  84| /** Map one customer-return correction to a CCRS Sale.csv row. PURE. */
  85| export function mapSaleCorrectionRow(
  86|   src: SaleCorrectionSource,
  87|   license: { licenseNumber: string; submittedBy: string },
  88| ): SaleCorrectionRowResult {
  89|   if (!src.saleExternalId || !src.saleDetailExternalId) {
  90|     return { row: null, skipReason: "missing original sale identifiers (required on Update/Delete)" };
  91|   }
  92|   if (!src.inventoryExternalId) {
  93|     return { row: null, skipReason: "missing InventoryExternalIdentifier (required on Update/Delete)" };
  94|   }
  95|   if (!(src.originalQuantity > 0) || !(src.returnQuantity > 0)) {
  96|     return { row: null, skipReason: "quantities must be positive" };
  97|   }
  98|   if (src.returnQuantity > src.originalQuantity) {
  99|     return { row: null, skipReason: "return quantity exceeds original quantity" };
 100|   }
 101| 
 102|   const remaining = src.originalQuantity - src.returnQuantity;
 103|   const isDelete = src.correctionOperation === "Delete" || remaining <= 0;
 104|   const qty = isDelete ? src.originalQuantity : remaining;
 105|   const discount = isDelete ? src.discountMinor : prorateLineMinor(src.discountMinor, remaining, src.originalQuantity);
 106|   const salesTax = isDelete ? src.salesTaxMinor : prorateLineMinor(src.salesTaxMinor, remaining, src.originalQuantity);
 107|   const excise = isDelete ? src.exciseMinor : prorateLineMinor(src.exciseMinor, remaining, src.originalQuantity);
 108| 
 109|   const saleDate = ccrsDateLoose(src.saleDateISO);
 110|   // "Updated Date cannot be prior to Created Date" — clamp forward if needed
 111|   // (compared as Pacific calendar days, the granularity CCRS validates).
 112|   const returnedDate = ccrsDateLoose(src.returnedAtISO);
 113|   const updatedDate = dayNumber(returnedDate) < dayNumber(saleDate) ? saleDate : returnedDate;
 114| 
 115|   const row = [
 116|     license.licenseNumber, // LicenseNumber
 117|     "", // SoldToLicenseNumber (retail = blank)
 118|     src.inventoryExternalId, // InventoryExternalIdentifier
 119|     "", // PlantExternalIdentifier
 120|     src.saleType, // SaleType (must match the original Insert)
 121|     saleDate, // SaleDate (must match the original Insert)
 122|     String(qty), // Quantity (Delete: original; Update: REMAINING)
 123|     dollars(src.unitPriceMinor), // UnitPrice (unchanged per-unit)
 124|     dollars(discount), // Discount
 125|     dollars(salesTax), // RetailSalesTax
 126|     dollars(excise), // CannabisExciseTax
 127|     src.saleExternalId, // SaleExternalIdentifier (ORIGINAL)
 128|     src.saleDetailExternalId, // SaleDetailExternalIdentifier (ORIGINAL)
 129|     license.submittedBy, // CreatedBy
 130|     saleDate, // CreatedDate (original)
 131|     license.submittedBy, // UpdatedBy (required on corrections)
 132|     updatedDate, // UpdatedDate (>= CreatedDate)
 133|     isDelete ? "Delete" : "Update", // Operation
 134|   ];
 135|   return { row };
 136| }
 137| 
 138| /** Assemble the correction file (3-row header + Sale columns + rows). */
 139| export function buildSaleCorrectionFile(
 140|   rows: string[][],
 141|   license: { licenseNumber: string; submittedBy: string },
 142| ): string {
 143|   return assembleCcrsFile({ type: "Sale", submittedBy: license.submittedBy, rows });
 144| }
 145| 
 146| export function makeSaleCorrectionFileName(licenseNumber: string): string {
 147|   return ccrsFileName("Sale", licenseNumber);
 148| }
 149| 
 150| // ---------------------------------------------------------------------------
 151| // Self-tests (tsx/vitest-runnable — PURE module)
 152| // ---------------------------------------------------------------------------
 153| 
 154| export function __runSaleCorrectionTests(): { passed: number; failed: number } {
 155|   let passed = 0;
 156|   let failed = 0;
 157|   const ok = (cond: boolean, msg: string) => {
 158|     if (cond) passed += 1;
 159|     else {
 160|       failed += 1;
```

## G. Returns / disposition — `src/lib/inventory/disposition.ts`

`src/lib/inventory/disposition.ts` L458-L480 — createCustomerReturn contract (FAQ: 'sale identifier should be deleted … inventory identifier reported on an Inventory Adjustment as a return')

```ts
 455| 
 456| /**
 457|  * Accept a customer return end-to-end:
 458|  *  1. validates the WAC 314-55-079(12) attestations + quantities (pure core),
 459|  *  2. snapshots the CCRS Sale-row data (ids, taxes) needed for the correction
 460|  *     file (Delete for full-line return, Update for partial),
 461|  *  3. posts the POSITIVE add-back adjustment (internal 'return' → CCRS Other
 462|  *     with a mandatory detail stating the ADD direction),
 463|  *  4. if disposition = destroy, opens a destruction event for the returned
 464|  *     quantity (LCB coordination/waste record enforced at completion).
 465|  */
 466| export async function createCustomerReturn(
 467|   input: {
 468|     orderId: string;
 469|     orderLineId: string;
 470|     lotId?: string | null;
 471|     quantity: number;
 472|     disposition: CustomerReturnDisposition;
 473|     reason: string;
 474|     detail?: string | null;
 475|     refundMinor: number;
 476|     originalPackaging: boolean;
 477|     lotIdLegible: boolean;
 478|   },
 479|   actorId: string | null,
 480| ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
```

`src/lib/inventory/disposition.ts` L598-L630 — CCRS Sale-row snapshot + medical mirror

```ts
 595|             ccrs_inventory_external_id: string | null;
 596|             status: string;
 597|           }[]
 598|         | null) ?? [];
 599|     lotRow = candidates.find((c) => c.status !== "quarantine") ?? candidates[0] ?? null;
 600|     lotId = lotRow?.id ?? null;
 601|   }
 602|   if (!lotRow || !lotId) {
 603|     return {
 604|       ok: false,
 605|       error:
 606|         "No inventory lot matches this product — pick the lot manually so the add-back lands on the correct CCRS inventory identifier.",
 607|     };
 608|   }
 609| 
 610|   // ── Snapshot the CCRS Sale-row data for the correction file ───────────────
 611|   const inventoryExternalId = resolveSaleInventoryExternalId({
 612|     lineExplicit: l.ccrs_inventory_external_id,
 613|     // S-10: the correction must reference the id the lot was FILED under.
 614|     lotCanonical: deriveInventoryExternalId({
 615|       ccrs_inventory_external_id: lotRow.ccrs_inventory_external_id ?? null,
 616|       lot_code: lotRow.lot_code,
 617|       pos_product_key: lotRow.pos_product_key,
 618|       id: lotRow.id,
 619|     }),
 620|     posProductKey: lineLotKey,
 621|   }).value;
 622| 
 623|   const qty = Number(l.quantity) || 0;
 624|   const soldUnit = l.price_minor_units ?? 0; // tax-INCLUSIVE out-the-door unit
 625|   const regularUnit = l.regular_price_minor_units ?? soldUnit; // tax-INCLUSIVE
 626| 
 627|   // Medical + tax status mirror the Sale.csv builder (see ccrs-sales.ts).
 628|   let isMedical = false;
 629|   let salesExempt = false;
 630|   let exciseExempt = false;
```

`src/lib/inventory/disposition.ts` L678-L705 — postAddition 'return' + destroy branch

```ts
 675|     quantity: qty,
 676|     isCannabis,
 677|     salesExempt,
 678|     exciseExempt,
 679|     combinedSalesRateBps: combinedBps,
 680|     exciseRateBps: taxSettings.exciseRateBps,
 681|   });
 682|   const discountCents = Math.max(0, preTaxRegularUnit * qty - baseCents);
 683|   const salesTaxCents = salesExempt ? 0 : applyBps(baseCents, combinedBps);
 684|   const exciseCents = isCannabis && !exciseExempt ? applyBps(baseCents, taxSettings.exciseRateBps) : 0;
 685| 
 686|   const saleExternalId = o.order_number || o.id;
 687|   const saleDetailExternalId = `${saleExternalId}-${l.id.slice(0, 8)}`;
 688|   const saleDate = pacificDayKey(o.completed_at ?? o.placed_at); // YYYY-MM-DD
 689| 
 690|   // ── Post the POSITIVE add-back adjustment (internal 'return' → CCRS Other) ─
 691|   const note = buildCustomerReturnAdjustmentNote({
 692|     quantity: input.quantity,
 693|     unit: null,
 694|     reason: input.reason,
 695|     disposition: input.disposition,
 696|     saleExternalId,
 697|     detail: input.detail,
 698|   });
 699|   const posted = await postAddition(lotId, input.quantity, "return", note, actorId);
 700|   if (!posted.ok) return posted;
 701| 
 702|   // ── If destroying, open the destruction event for the returned quantity ───
 703|   let destructionEventId: string | null = null;
 704|   if (input.disposition === "destroy") {
 705|     const scheduled = await scheduleDestruction(
```

`src/lib/inventory/disposition.ts` L783-L800 — createVendorReturn (reducing 'other' adjustment)

```ts
 780| // Vendor returns
 781| // ---------------------------------------------------------------------------
 782| 
 783| export async function listVendorReturns(limit = 100): Promise<VendorReturnWithLot[]> {
 784|   if (!isSupabaseServiceConfigured) return [];
 785|   const admin = createSupabaseAdminClient();
 786|   const { data } = await admin
 787|     .from("vendor_returns")
 788|     .select("*, lot:inventory_lots(lot_code, product_name, unit)")
 789|     .order("created_at", { ascending: false })
 790|     .limit(limit);
 791|   return normaliseLot(data) as VendorReturnWithLot[];
 792| }
 793| 
 794| /**
 795|  * Create a vendor return: posts a reducing 'other' adjustment (CCRS maps 'other'
 796|  * → Other) and records the return. on-hand is reduced immediately.
 797|  */
 798| export async function createVendorReturn(
 799|   input: {
 800|     lotId: string;
```

`src/lib/inventory/disposition.ts` L971-L985 — completeDestruction head ('destruction')

```ts
 968|       detail: input.detail ?? null,
 969|       status: "pending_quarantine",
 970|       quarantine_start: now.toISOString(),
 971|       earliest_destroy_at: earliest.toISOString(),
 972|       created_by: actorId,
 973|     })
 974|     .select("id")
 975|     .single();
 976|   if (error || !data) return { ok: false, error: error?.message ?? "Could not schedule destruction." };
 977|   return { ok: true, id: (data as { id: string }).id };
 978| }
 979| 
 980| /**
 981|  * Complete a destruction after the hold window. Enforces the Task Q guardrails
 982|  * (recall LCB-coordination prohibition per WAC 314-55-225; rendering-unusable
 983|  * method + ≥50% mix and final-destination records per current WAC 314-55-097),
 984|  * posts a reducing 'destruction' adjustment (CCRS → Destruction), records the
 985|  * full waste record, and (if the lot is fully depleted) marks the lot
```

## H. Intake & Cultivera identity lineage

`src/lib/pos/import-lot-core.ts` L14-L30 — Cultivera CSV import — header comment: Barcode is the CCRS-filed inventory identifier; one lot per barcode

```ts
  14|  *
  15|  * Verified facts about the real Cultivera INVENTORIES export this planner is
  16|  * built against (3,917 rows inspected):
  17|  *   • Barcode is ALWAYS populated (e.g. "GF42802505795142") and is the
  18|  *     identifier Cultivera (a CCRS integrator) filed with CCRS — 3,870 unique
  19|  *     values; 47 barcodes appear twice (same product, two received dates).
  20|  *   • Cost is always populated ("$5.00" format) → unit_cost_minor_units.
  21|  *   • Received date is MM/DD/YYYY, blank on 247 rows.
  22|  *   • Expiration date is blank on ALL rows (kept supported; surfaced as an
  23|  *     enrichment worklist item, never invented).
  24|  *   • [COA Y/N] is "Y" on 3,520 rows / "N" on 397 — flagged for enrichment.
  25|  *   • Is Sample is always "False"; Is Cannabis always "True".
  26|  *
  27|  * Identity & idempotency: one planned lot per BARCODE. Duplicate-barcode rows
  28|  * are merged (units summed, earliest received date kept) because CCRS treats
  29|  * one identifier as ONE inventory record. The caller dedupes against existing
  30|  * inventory_lots by ccrs_inventory_external_id, so publishing twice — or
```

`src/lib/pos/import-lot-core.ts` L45-L50 — PlannedLot.barcode doc

```ts
  45|   /** menu_items.source_item_id of the card this row rolled into (`pos-…`). */
  46|   posProductKey: string;
  47|   /** Card display name (messages only). */
  48|   itemName: string;
  49|   /** Cultivera Barcode — the CCRS-filed inventory identifier. */
  50|   barcode: string;
```

`src/lib/pos/import-lot-core.ts` L78-L83 — lot_code = barcode; ccrsExternalId = sanitized barcode

```ts
  78|   /**
  79|    * R15a: raw potency columns for THIS row (Total / Thc / Thca / Cbd / Cbda).
  80|    * Optional so older callers/tests keep compiling; absent = unknown.
  81|    */
  82|   totalRaw?: number | null;
  83|   thcRaw?: number | null;
```

`src/lib/pos/import-lot-core.ts` L416-L426 — L420: ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode

```ts
 416|     if (opts.potencyColumnsPresent && unset && (p.thc !== null || p.cbd !== null || p.thca !== null || p.cbda !== null)) {
 417|       Object.assign(patch, potencyColumns(p, opts.nowIso));
 418|     }
 419|     const hasMinors = Array.isArray(lot.minor_cannabinoids_json) && (lot.minor_cannabinoids_json as unknown[]).length > 0;
 420|     if (!hasMinors && p.minors.length > 0) patch.minor_cannabinoids_json = p.minors;
 421|     if (Object.keys(patch).length > 0) potencyPatches.push({ id: lot.id, patch });
 422|   }
 423|   return { dateGroups, potencyPatches, matched };
 424| }
 425| 
 426| function lotNote(opts: { receivedOn: string | null; coaPresent: boolean; merged: number }): string {
```

`src/lib/pos/import-service.ts` L440-L460 — Dedupe by ccrs_inventory_external_id; why imported lots are 'active' (already reported by Cultivera as integrator)

```ts
 440|     const gate = evaluateCommitGate(buckets, {
 441|       observedItems: items.length,
 442|       recordedItemCount: (version as MenuVersion).item_count,
 443|       serverItemCount,
 444|       observedReviews: reviewsResult.reviews.length,
 445|       reviewsReadFailed: !reviewsResult.ok,
 446|     }, { acknowledgedPendingCount: options.acknowledgedPendingCount ?? null });
 447|     if (!gate.ready) throw new Error(gate.message);
 448|     openReviewsAcknowledged = gate.openReviewsAcknowledged;
 449|     // Persist the balanced equation so the audit trail shows exactly what
 450|     // this publish committed (idempotent by code+import via the review UI).
 451|     await persistDiagnostics(importId, [
 452|       {
 453|         severity: "info",
 454|         code: "import_commit_reconciled",
 455|         message: gate.message,
 456|         // R14a: the acknowledged count rides with the equation so the audit
 457|         // trail shows a "publish now, fix after" commit as exactly that.
 458|         context: { ...gate.reconciliation, openReviewsAcknowledged },
 459|       },
 460|     ]);
```

`src/lib/inventory/intake-store.ts` L650-L668 — Intake writes ccrs_inventory_external_id via deriveInventoryExternalId({pos_product_key, lot_code})

```ts
 650|       };
 651|     }
 652|   }
 653| 
 654|   // Snapshot the COA references so they're preserved in our KB even if the
 655|   // vendor's links later expire. De-duplicated by coa_url.
 656|   const coaLinks = extractCoaLinks(parsed);
 657| 
 658|   // 1) manifest (pending)
 659|   // R36 (migration 0255): dedupe_key is UNIQUE while the row is live, so two
 660|   // stagings of the same manifest racing each other (the owner's twin rows:
 661|   // a webhook retry arriving while the first delivery was still reading the
 662|   // PDFs) can no longer BOTH insert - the read-then-check above cannot close
 663|   // that window on its own. The loser gets 23505 and becomes the duplicate it
 664|   // is. Before 0255 is applied the column is missing: retry once without it
 665|   // (exactly the old behaviour).
 666|   const dedupeKey = dedupeKeyFor(identity);
 667|   const manifestRow: Record<string, unknown> = {
 668|     manifest_number: parsed.manifest_number,
```

`src/lib/inventory/intake-parser.ts` L368-L416 — WCIA JSON: lot_code ← item.inventory_id (the VENDOR's CCRS InventoryExternalIdentifier); pos_product_key ← sku ?? lot_code

```ts
 368|     thca_pct: thca,
 369|     cbda_pct: potency["cbda"] ?? null,
 370|     // R27: WAC 314-55-102(3)(a)(ii) - the lab's reported total-thc/total-cbd,
 371|     // else THC + 0.877 x THCA (CBD + 0.877 x CBDA). Never total-cannabinoids
 372|     // (that put THC + CBD in the THC column: Apple Cardamom showed 0.7045%).
 373|     total_thc_pct: waTotals.totalThcPct,
 374|     total_cbd_pct: waTotals.totalCbdPct,
 375|     total_cannabinoids_pct: total,
 376|     potency_json: Object.keys(potency).length > 0 ? potency : null,
 377|     terpenes_json: pick(data, ["terpenes", "terpene_profile"]) ?? null,
 378|     analytes_json: potArr ?? null,
 379|     passed: asBool(pick(data, ["lab_result_status"])) ?? passedTop,
 380|     coa_url: cleanUrl(pick(data, ["coa"])) ?? coaFromList,
 381|     coa_release_date: coaRelease,
 382|     coa_expire_date: coaExpire,
 383|     wcia_json_url: wciaJsonUrl(item),
 384|     raw: data,
 385|   };
 386| }
 387| 
 388| function parseWciaLine(item: unknown): ParsedLine {
 389|   const warnings: string[] = [];
 390|   if (!isObj(item)) {
 391|     return blankLine(item, ["Line was not an object."]);
 392|   }
 393| 
 394|   const product_name = asString(pick(item, ["product_name"]));
 395|   const lot_code = asString(pick(item, ["inventory_id"]));
 396|   const sku = asString(pick(item, ["product_sku"]));
 397|   const qty = asNumber(pick(item, ["qty"])) ?? 0;
 398|   const linePrice = asNumber(pick(item, ["line_price"]));
 399|   const unit = asString(pick(item, ["uom"])) ?? "ea";
 400|   // Rule 1.4 (docs/data-governance.md): split strain TYPE out of the strain
 401|   // NAME at the door — vendor lines like "Chocolate Turtle Sativa" pollute
 402|   // the name box otherwise (real Grow Op Farms / Cultivera behavior).
 403|   const strainSplit = splitStrainField(
 404|     asString(pick(item, ["strain_name"])),
 405|     asString(pick(item, ["strain_type", "strain_class", "phenotype"])),
 406|   );
 407|   const strain = strainSplit.strainName;
 408|   const category = asString(pick(item, ["inventory_category"]));
 409|   const inventory_type = asString(pick(item, ["inventory_type"]));
 410|   const is_sample = asBool(pick(item, ["is_sample"])) === true;
 411|   const is_medical = asBool(pick(item, ["is_medical"])) === true;
 412|   const unit_weight = asNumber(pick(item, ["unit_weight"]));
 413|   const unit_weight_uom = asString(pick(item, ["unit_weight_uom"]));
 414| 
 415|   // Per-unit cost = line_price / qty, in minor units.
 416|   let unit_cost_minor_units: number | null = null;
```

`src/lib/inventory/intake-parser.ts` L438-L446 — WCIA JSON: manifest_number ← transfer_id/external_id; vendor_label ← from_license_name

```ts
 438|     pos_product_key: sku ?? lot_code, // fall back to inventory_id for catalog linking
 439|     brand_name: null, // WCIA carries vendor at the document level, not per line
 440|     category,
 441|     strain_name: strain,
 442|     strain_type: strainSplit.strainType,
 443|     received_qty: qty,
 444|     unit,
 445|     unit_cost_minor_units,
 446|     unit_weight,
```

`src/lib/inventory/intake-parser.ts` L278-L284 — WCIA detection requires from_license_number (→ vendors.license_number, migration 0064)

```ts
 278|  * mailbox: logged, never staged. PURE.
 279|  */
 280| export function looksLikeWciaTransferStrict(root: unknown): boolean {
 281|   if (!isObj(root)) return false;
 282|   const name = asString(pick(root, ["document_name"]))?.toLowerCase() ?? "";
 283|   if (name.includes("wcia") && name.includes("transfer")) return true;
 284|   if (asString(pick(root, ["document_schema_version"]))) return true;
```

`src/lib/inventory/ccrs-manifest-csv-core.ts` L488-L505 — CCRS manifest.csv import: lot_code and pos_product_key ← InventoryExternalIdentifier (the VENDOR's id)

```ts
 488| 
 489|   const lines: CcrsParsedLine[] = items.map((it) => {
 490|     const identifier = it.inventoryExternalIdentifier ?? it.plantExternalIdentifier;
 491|     const isGram = (it.uom ?? "").toLowerCase() === "gram";
 492|     const w = [
 493|       ...it.warnings,
 494|       "CCRS manifest carries no product name, strain, brand, category, price, or COA — enrich this line before accepting.",
 495|     ];
 496|     return {
 497|       product_name: null,
 498|       lot_code: identifier,
 499|       pos_product_key: it.inventoryExternalIdentifier,
 500|       brand_name: null,
 501|       category: null,
 502|       strain_name: null,
 503|       strain_type: null,
 504|       received_qty: it.quantity ?? 0,
 505|       unit: isGram ? "g" : "each",
```

`src/lib/inventory/sale-decrement.ts` L175-L205 — Sale decrement resolves ccrsExternalId for the sold lot (must match Sale.csv builder)

```ts
 175|     let lots: LotForDecrement[] = [];
 176|     if (lotKeys.length > 0) {
 177|       const { data: lotRows } = await admin
 178|         .from("inventory_lots")
 179|         .select("id, pos_product_key, on_hand_qty, ccrs_inventory_external_id, lot_code")
 180|         .in("pos_product_key", lotKeys)
 181|         .eq("status", "active")
 182|         .gt("on_hand_qty", 0)
 183|         .order("created_at", { ascending: true });
 184|       lots = ((lotRows as
 185|         | {
 186|             id: string;
 187|             pos_product_key: string | null;
 188|             on_hand_qty: number;
 189|             ccrs_inventory_external_id: string | null;
 190|             lot_code: string | null;
 191|           }[]
 192|         | null) ?? [])
 193|         .filter((r) => !!r.pos_product_key)
 194|         .map((r) => ({
 195|           id: r.id,
 196|           posProductKey: r.pos_product_key as string,
 197|           onHandQty: r.on_hand_qty,
 198|           // The lot's canonical CCRS id — identical derivation to the weekly
 199|           // Sale.csv builder's lot index (explicit → lot_code → key → LOT-id).
 200|           ccrsExternalId: deriveInventoryExternalId({
 201|             ccrs_inventory_external_id: r.ccrs_inventory_external_id,
 202|             pos_product_key: r.pos_product_key,
 203|             lot_code: r.lot_code,
 204|             id: r.id,
 205|           }),
```

`src/lib/pos/variant-lot-core.ts` L50-L60 — lotKeyForSaleLine

```ts
  50|  * The lot key a sold line's inventory consumption should aggregate under:
  51|  * the variant's own encoded lot key when present, else the line's
  52|  * product_id snapshot (the pre-mastering behaviour, byte for byte).
  53|  */
  54| export function lotKeyForSaleLine(line: {
  55|   productId: string | null;
  56|   variantId: string | null;
  57| }): string | null {
  58|   return lotKeyFromVariantId(line.variantId) ?? line.productId ?? null;
  59| }
  60| 
```

## I. Routes / pages / components

`src/app/admin/reports/compliance/batch-export/route.ts` L26-L70 — GET: range → buildCcrsBatch → verifyCcrsBatch → assertCcrsBatchSubmittable (refuses zip on any error)

```ts
  26|  * Generating regulatory files requires the "Change settings" permission.
  27|  */
  28| import { requirePermission } from "@/lib/auth/session";
  29| import { can } from "@/lib/auth/roles";
  30| import { recordAudit } from "@/lib/auth/audit";
  31| import { resolveRange } from "@/lib/reports/range";
  32| import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
  33| import { verifyCcrsBatch, classifyWarning } from "@/lib/compliance/ccrs-batch-core";
  34| import {
  35|   assertCcrsBatchSubmittable,
  36|   toGateInput,
  37|   verdictSummary,
  38|   type GateIssue,
  39| } from "@/lib/compliance/ccrs-submit-gate-core";
  40| import { issuePlainText } from "@/lib/compliance/ccrs-issue-display-core";
  41| import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
  42| import { emitOutboxFiles, readStoredFile } from "@/lib/compliance/ccrs-ledger-store";
  43| import { markCorrectionsExported } from "@/lib/inventory/disposition";
  44| import {
  45|   emitPayload,
  46|   planOutboxFiles,
  47|   verifyOutboxAgainstLedger,
  48|   outboxReadmeLines,
  49|   type EmitIssue,
  50| } from "@/lib/compliance/ccrs-outbox-core";
  51| import { ccrsPortalUrl } from "@/lib/compliance/ccrs-lifecycle-core";
  52| import { createSupabaseAdminClient } from "@/lib/supabase/admin";
  53| import { buildZip } from "@/lib/reports/zip";
  54| 
  55| export const dynamic = "force-dynamic";
  56| export const runtime = "nodejs";
  57| /** A full batch reads ~4,200 lots and writes up to tens of thousands of rows in one transaction. */
  58| export const maxDuration = 300;
  59| 
  60| const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  61| 
  62| export async function GET(request: Request) {
  63|   const session = await requirePermission("reports.view");
  64|   if (!can(session.profile.role, "settings.manage")) {
  65|     return new Response("Generating the CCRS batch requires the Change settings permission.", { status: 403 });
  66|   }
  67| 
  68|   const url = new URL(request.url);
  69|   const range = resolveRange({
  70|     from: url.searchParams.get("from") ?? undefined,
```

`src/app/admin/reports/compliance/batch-export/route.ts` L130-L145 — zip name CCRS_batch_<license>_<from>_<to>.zip

```ts
 130|   const planned = planOutboxFiles(
 131|     batch.files.map((f) => ({ type: f.type, csv: f.csv })),
 132|     {
 133|       licenseNumber: batch.licenseNumber,
 134|       now: new Date(batch.generatedAt),
 135|       lastStamp: batch.ledger.lastStamp ? new Date(batch.ledger.lastStamp) : null,
 136|     },
 137|   );
 138|   if (planned.length === 0) {
 139|     return new Response(
 140|       `Nothing to report for ${range.fromDate} to ${range.toDate}: every file is empty, and CCRS has no "no change" report [FAQ L0049].\r\n`,
 141|       { status: 200, headers: TEXT },
 142|     );
 143|   }
 144| 
 145|   let zipFiles: { name: string; content: string }[] = planned.map((f) => ({ name: f.fileName, content: f.csv }));
```

`src/app/admin/reports/compliance/adjustment-export/route.ts` L18-L30 — GET adjustment CSV for a range

```ts
  18| export async function GET(request: Request) {
  19|   const session = await requirePermission("settings.manage");
  20|   const url = new URL(request.url);
  21|   const range = resolveRange({
  22|     from: url.searchParams.get("from") ?? undefined,
  23|     to: url.searchParams.get("to") ?? undefined,
  24|     range: url.searchParams.get("range") ?? undefined,
  25|     year: url.searchParams.get("year") ?? undefined,
  26|   });
  27| 
  28|   const built = await buildCcrsInventoryAdjustmentCsv(range.fromISO, range.toISO);
  29| 
  30|   if (isSupabaseServiceConfigured) {
```

`src/app/admin/inventory/disposition/sale-correction-export/route.ts` L28-L40 — GET sale corrections

```ts
  28| import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
  29| import { buildSaleCorrectionFile, makeSaleCorrectionFileName } from "@/lib/compliance/ccrs-sale-correction-core";
  30| import { markCorrectionsExported } from "@/lib/inventory/disposition";
  31| import { CCRS_COLUMNS, withholdUnencodableRows } from "@/lib/compliance/ccrs-batch-core";
  32| import {
  33|   planReturnCorrections,
  34|   returnRecordFromRow,
  35|   type CustomerReturnRowLike,
  36|   type ReturnRecord,
  37| } from "@/lib/compliance/ccrs-return-corrections-core";
  38| 
  39| export const dynamic = "force-dynamic";
  40| export const runtime = "nodejs";
```

`src/app/admin/inventory/disposition/sale-correction-export/route.ts` L74-L82 — markCorrectionsExported after download

```ts
  74|         license,
  75|         ledger: "legacy",
  76|         insertedDetailIds: new Set(),
  77|       });
  78|       rows = plan.rows;
  79|       rowReturnIds = plan.groups.map((g) => g.returnIds);
  80|       for (const n of plan.invalid) skipped.push(`${n.detailId || "(no sale line id)"} [${n.returnIds.join(", ")}]: ${n.reason}`);
  81|     } catch {
  82|       // customer_returns missing (pre-0115) — empty file below.
```

`src/app/admin/compliance/ccrs/page.tsx` L81-L110 — CcrsCommandCenterPage head

```ts
  81| import { loadMigrationGarbage } from "@/lib/compliance/ccrs-migration-garbage-store";
  82| import { listCcrsFiles } from "@/lib/compliance/ccrs-ledger-store";
  83| import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
  84| import { ccrsPortalUrl } from "@/lib/compliance/ccrs-lifecycle-core";
  85| 
  86| export const dynamic = "force-dynamic";
  87| 
  88| function Section({
  89|   title,
  90|   subtitle,
  91|   children,
  92| }: {
  93|   title: string;
  94|   subtitle?: string;
  95|   children: React.ReactNode;
  96| }) {
  97|   return (
  98|     <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
  99|       <div className="mb-4">
 100|         <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
 101|         {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
 102|       </div>
 103|       {children}
 104|     </section>
 105|   );
 106| }
 107| 
 108| const STATUS_META: Record<
 109|   WeekDeadline["status"],
 110|   { label: string; pill: string }
```

`src/app/admin/compliance/ccrs/page.tsx` — hub page section anchors

- L491: `title="Step 1 — Pick the reporting week"`
- L522: `title={`Step 2 — Review week ${week.start} – ${week.end}`}`
- L608: `{batch ? <CcrsAdvisorPanel aiEnabled={isAiConfigured} sp={{ from: week.start, to: week.end }} /> : null}`
- L612: `<UploadWalkthrough`
- L682: `title="Step 3 — Record this week"`
- L836: `<ErrorTriagePanel`
- L846: `title="DOH / Medical sales"`
- L901: `title="Monthly LIQ-1295 (tax report)"`
- L974: `<PushRemindersPanel />`
- L984: `<Section title="Submission ledger" subtitle="Newest first. This is the evidence trail.">`

`src/app/admin/compliance/ccrs/actions.ts` — server actions

- L11: `import { revalidatePath } from "next/cache";`
- L13: `import { requirePermission } from "@/lib/auth/session";`
- L59: `export async function resolveWeekAction(formData: FormData): Promise<void> {`
- L60: `const session = await requirePermission("settings.manage");`
- L109: `revalidatePath(BASE);`
- L114: `export async function unresolveWeekAction(formData: FormData): Promise<void> {`
- L115: `const session = await requirePermission("settings.manage");`
- L131: `revalidatePath(BASE);`
- L136: `export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {`
- L137: `const session = await requirePermission("settings.manage");`
- L165: `revalidatePath(BASE);`
- L177: `export async function assignProductIdsAction(formData: FormData): Promise<void> {`
- L178: `const session = await requirePermission("settings.manage");`
- L212: `revalidatePath(BASE);`
- L257: `export async function markUploadedAction(formData: FormData): Promise<void> {`
- L258: `const session = await requirePermission("settings.manage");`
- L278: `revalidatePath(BASE);`
- L287: `export async function recordSuccessAction(formData: FormData): Promise<void> {`
- L288: `const session = await requirePermission("settings.manage");`
- L337: `revalidatePath(BASE);`
- L353: `export async function recordErrorAction(formData: FormData): Promise<void> {`
- L354: `const session = await requirePermission("settings.manage");`
- L386: `revalidatePath(BASE);`
- L391: `export async function recordNoEmailAction(formData: FormData): Promise<void> {`
- L392: `const session = await requirePermission("settings.manage");`
- L412: `revalidatePath(BASE);`
- L417: `export async function abandonFileAction(formData: FormData): Promise<void> {`
- L418: `const session = await requirePermission("settings.manage");`
- L437: `revalidatePath(BASE);`
- L442: `export async function startPreprodLedgerAction(formData: FormData): Promise<void> {`
- L443: `const session = await requirePermission("settings.manage");`
- L459: `revalidatePath(BASE);`
- L465: `session: Awaited<ReturnType<typeof requirePermission>>,`
- L486: `export async function settlePreprodDuplicatesAction(formData: FormData): Promise<void> {`
- L487: `const session = await requirePermission("settings.manage");`
- L504: `revalidatePath(BASE);`
- L513: `export async function assignPreprodProductIdsAction(formData: FormData): Promise<void> {`
- L514: `const session = await requirePermission("settings.manage");`
- L539: `revalidatePath(BASE);`
- L554: `revalidatePath(BASE);`

`src/components/admin/compliance/UploadWalkthrough.tsx` L26-L35 — PORTAL_URL + WAIT_MINUTES constants

```ts
  26| 
  27| type FileSummary = { type: string; fileName: string; recordCount: number; empty: boolean };
  28| 
  29| type Props = {
  30|   weekKey: string;
  31|   files: FileSummary[];
  32|   batchZipHref: string;
  33|   submittable: boolean;
  34|   /** S-12c: the portal of the env the zip targets (PREprod is a different host). */
  35|   portalUrl?: string;
```

`src/components/admin/compliance/UploadWalkthrough.tsx` L144-L256 — steps array (8 steps) — the current human upload procedure encoded in UI

```ts
 144|   );
 145| 
 146|   const fileList = (group: FileSummary[]) => (
 147|     <ul className="mt-1 space-y-0.5 text-[11px] text-white/45">
 148|       {group.map((f) => (
 149|         <li key={f.type}>
 150|           • {f.fileName} — {f.recordCount} record(s){f.empty ? " (empty — skip uploading this file)" : ""}
 151|         </li>
 152|       ))}
 153|     </ul>
 154|   );
 155| 
 156|   const steps: { id: StepId; title: string; body: React.ReactNode; locked?: boolean; lockNote?: string }[] = [
 157|     {
 158|       id: "download",
 159|       title: "Download the validated batch (.zip)",
 160|       body: (
 161|         <div>
 162|           <p className="text-xs text-white/55">
 163|             The zip contains every file numbered in upload order with correct CCRS filenames and
 164|             headers. It only downloads when validation passes.
 165|           </p>
 166|           <a
 167|             href={batchZipHref}
 168|             className={`mt-2 inline-block rounded-lg px-3 py-1.5 text-xs font-bold transition ${
 169|               submittable
 170|                 ? "bg-[var(--admin-accent)] text-black hover:opacity-90"
 171|                 : "cursor-not-allowed border border-white/10 text-white/30"
 172|             }`}
 173|             aria-disabled={!submittable}
 174|             onClick={(e) => {
 175|               if (!submittable) e.preventDefault();
 176|             }}
 177|           >
 178|             {submittable ? "Download batch zip" : "Blocked — fix validation errors first"}
 179|           </a>
 180|         </div>
 181|       ),
 182|     },
 183|     {
 184|       id: "signin",
 185|       title: "Sign in to the CCRS portal",
 186|       body: (
 187|         <p className="text-xs text-white/55">
 188|           Open{" "}
 189|           <a href={PORTAL_URL} target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] underline">
 190|             {portalHost}
 191|           </a>{" "}
 192|           and choose to sign in. You are taken to {CCRS_LOGIN_LABEL}: sign in with{" "}
 193|           {signinEnv === "preprod" ? "your Pre-Production WA.gov account" : "your WA.gov account"}. Pre-Production and
 194|           live need separate WA.gov accounts (
 195|           <a
 196|             href={WAGOV_CREATE_ACCOUNT_URLS[signinEnv]}
 197|             target="_blank"
 198|             rel="noreferrer"
 199|             className="text-[var(--admin-accent)] underline"
 200|           >
 201|             create one
 202|           </a>
 203|           ). First time only: enter the email you use for CCRS reporting (already on file with LCB Licensing) and click
 204|           Register. WA.gov account problems: WaTech; CCRS problems: {CCRS_SIGNIN_SERVICE_DESK}.
 205|         </p>
 206|       ),
 207|     },
 208|     {
 209|       id: "group1",
 210|       title: "Upload Group 1 — Strain, Area, Product",
 211|       body: (
 212|         <div>
 213|           <p className="text-xs text-white/55">
 214|             Upload these first; Inventory depends on them. Empty files can be skipped.
 215|           </p>
 216|           {fileList(group1)}
 217|         </div>
 218|       ),
 219|     },
 220|     {
 221|       id: "wait1",
 222|       title: `Wait ${WAIT_MINUTES} minutes (CCRS dependency processing)`,
 223|       locked: !state.done.group1,
 224|       lockNote: "Check off Group 1 first — the timer starts automatically.",
 225|       body: state.done.group1 ? (
 226|         g1Remaining > 0 ? (
 227|           <p className="text-xs font-semibold text-amber-300">
 228|             ⏱ {fmtRemaining(g1Remaining)} remaining — CCRS needs time to process Group 1 before
 229|             Inventory can reference it.
 230|           </p>
 231|         ) : (
 232|           <p className="text-xs font-semibold text-emerald-300">
 233|             ✓ 10 minutes have passed — safe to upload Inventory.
 234|           </p>
 235|         )
 236|       ) : null,
 237|     },
 238|     {
 239|       id: "group2",
 240|       title: "Upload Group 2 — Inventory",
 241|       locked: Boolean(state.done.group1 && g1Remaining > 0),
 242|       lockNote: "Wait for the 10-minute timer above before uploading Inventory.",
 243|       body: fileList(group2),
 244|     },
 245|     {
 246|       id: "wait2",
 247|       title: `Wait ${WAIT_MINUTES} minutes again`,
 248|       locked: !state.done.group2,
 249|       lockNote: "Check off Group 2 first — the timer starts automatically.",
 250|       body: state.done.group2 ? (
 251|         g2Remaining > 0 ? (
 252|           <p className="text-xs font-semibold text-amber-300">
 253|             ⏱ {fmtRemaining(g2Remaining)} remaining before Group 3.
 254|           </p>
 255|         ) : (
 256|           <p className="text-xs font-semibold text-emerald-300">✓ Safe to upload Group 3.</p>
```

`src/app/admin/reports/compliance/page.tsx` — Reports-tab compliance page (to be retired to a pointer, owner decision Q6)

- L14: `import { LicenseSettingsForm } from "@/components/admin/reports/LicenseSettingsForm";`
- L32: `<section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">`
- L34: `<h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>`
- L220: `<Link href="/admin/compliance/ccrs" className="font-bold text-[var(--admin-accent)] underline">`
- L253: `title="Full CCRS batch"`
- L254: `subtitle="Generates every file a retailer must report — Strain, Area, Product, Inventory, InventoryAdjustment, InventoryTransfer, Sale — in the exact `
- L334: `href={`/admin/reports/compliance/batch-export?${qs}`}`
- L384: `<Section title="Generate CCRS Sale.csv" subtitle="Downloads the exact file CCRS expects for the selected range.">`
- L407: `title="Generate CCRS InventoryAdjustment.csv"`
- L408: `subtitle="Reports shrink, damage, destruction, recalls, samples & cycle-count reconciliations for the range."`
- L428: `href={`/admin/reports/compliance/adjustment-export?${qs}`}`
- L449: `title="License identity"`
- L450: `subtitle="Used in the file header (SubmittedBy) and on every row (LicenseNumber / CreatedBy)."`
- L452: `<LicenseSettingsForm`
- L462: `<Section title="Recent CCRS exports">`

`src/components/admin/reports/LicenseSettingsForm.tsx` L1-L40 — License settings editor (license_number, submitted_by, trade_name) — lives on Reports tab, NOT in the hub

```ts
   1| "use client";
   2| 
   3| import { useState, useTransition } from "react";
   4| import { Button } from "@/components/admin/ui";
   5| import { saveLicenseSettingsAction } from "@/app/admin/reports/compliance/actions";
   6| 
   7| export function LicenseSettingsForm({
   8|   licenseNumber,
   9|   submittedBy,
  10|   tradeName,
  11|   canEdit,
  12| }: {
  13|   licenseNumber: string;
  14|   submittedBy: string;
  15|   tradeName: string;
  16|   canEdit: boolean;
  17| }) {
  18|   const [pending, startTransition] = useTransition();
  19|   const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  20| 
  21|   function onSubmit(formData: FormData) {
  22|     setMsg(null);
  23|     startTransition(async () => {
  24|       const res = await saveLicenseSettingsAction(formData);
  25|       if (res.ok) setMsg({ ok: true, text: "Saved." });
  26|       else setMsg({ ok: false, text: res.error });
  27|     });
  28|   }
  29| 
  30|   return (
  31|     <form action={onSubmit} className="space-y-4">
  32|       <div className="grid gap-4 sm:grid-cols-3">
  33|         <label className="block">
  34|           <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-white/50">
  35|             CCRS license number
  36|           </span>
  37|           <input
  38|             name="license_number"
  39|             defaultValue={licenseNumber}
  40|             disabled={!canEdit}
```

`src/components/admin/admin-nav-data.ts` — nav entries mentioning CCRS/compliance

- L24: `| "CCRS"`
- L45: `// cannabis-specific glyphs (🌿 flower, 🧾 receipts, 🛡 compliance) are used where`
- L80: `{ label: "CCRS Benchmarks", href: "/admin/discovery/benchmarks", permission: "inventory.manage", icon: "\ud83d\udcca", group: "Product Intake" }, // 📊`
- L107: `{ label: "Employee Samples", href: "/admin/compliance/samples", permission: "settings.manage", icon: "\ud83e\uddea", group: "Employee" }, // 🧪 trade s`
- L108: `{ label: "Sample History", href: "/admin/compliance/samples/history", permission: "settings.manage", icon: "\ud83d\udccb", group: "Employee" }, // 📋 s`
- L116: `// CCRS: standalone top-header button → the Compliance Command Center (Task W;`
- L119: `{ label: "CCRS Command Center", href: "/admin/compliance/ccrs", permission: "reports.view", icon: "\ud83d\udee1\ufe0f", group: "CCRS" }, // 🛡️ complia`
- L120: `{ label: "Compliance Health", href: "/admin/compliance/health", permission: "reports.view", icon: "\ud83e\ude7a", group: "CCRS" }, // 🩺 health check`
- L121: `{ label: "Regulatory Watch", href: "/admin/compliance/regulatory", permission: "reports.view", icon: "\ud83d\udce1", group: "CCRS" }, // 📡 rule-change`
- L122: `{ label: "Compliance Calendar", href: "/admin/compliance/calendar", permission: "compliance.calendar", icon: "\ud83d\udcc5", group: "Lyman" }, // 📅 S-`
- L205: `{ label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "\u2696\ufe0f", group: "Admin" }, // ⚖️ legal li`
- L210: `{ label: "Sales-Limit Classification", href: "/admin/compliance/classification", permission: "inventory.manage", icon: "\ud83c\udff7\ufe0f", group: "A`
- L227: `"CCRS",`

## J. Schema anchors (Supabase migrations)

`supabase/migrations/0023_pos_inventory_lots.sql` L20-L40 — inbound_manifests — NO column for the vendor's inventory external id; raw_payload jsonb keeps the full vendor JSON

```ts
  20| -- ── inbound_manifests ───────────────────────────────────────────────────────
  21| -- A transfer/manifest of product arriving from a vendor (mirrors CCRS Manifest).
  22| create table if not exists public.inbound_manifests (
  23|   id                  uuid primary key default gen_random_uuid(),
  24|   -- Manifest / transfer identifier as issued by the originating system.
  25|   manifest_number     text,
  26|   vendor_id           uuid references public.vendors(id) on delete set null,
  27|   -- Free-text vendor label as received (when not yet matched to a vendor row).
  28|   vendor_label        text,
  29|   transfer_date       date,
  30|   -- Raw payload captured at intake (the vendor JSON) for full provenance.
  31|   raw_payload         jsonb,
  32|   -- intake state: pending review → accepted; or rejected.
  33|   status              text not null default 'pending',  -- pending | accepted | rejected
  34|   notes               text,
  35|   created_by          uuid references public.staff_profiles(id) on delete set null,
  36|   updated_by          uuid references public.staff_profiles(id) on delete set null,
  37|   created_at          timestamptz not null default now(),
  38|   updated_at          timestamptz not null default now()
  39| );
  40| 
```

`supabase/migrations/0023_pos_inventory_lots.sql` L83-L115 — inventory_lots base columns (lot_code, manifest_id, received_qty, on_hand_qty, unit_cost_minor_units, status enum comment)

```ts
  83| -- ── inventory_lots ──────────────────────────────────────────────────────────
  84| -- A received lot/batch of a product. Ties product ↔ vendor ↔ brand ↔ COA ↔
  85| -- manifest, with expiry + status for FEFO + recall handling.
  86| create table if not exists public.inventory_lots (
  87|   id                  uuid primary key default gen_random_uuid(),
  88|   -- Human/regulatory lot code (from vendor/COA). Unique-ish but not enforced
  89|   -- unique since vendors can collide; we dedupe in app logic on (vendor, code).
  90|   lot_code            text,
  91|   vendor_id           uuid references public.vendors(id) on delete set null,
  92|   brand_id            uuid references public.brands(id) on delete set null,
  93|   manifest_id         uuid references public.inbound_manifests(id) on delete set null,
  94|   lab_result_id       uuid references public.lab_results(id) on delete set null,
  95|   -- Link to the catalog product by the POS source key (matches menu_items.source_item_id).
  96|   -- Text (not FK) so deleted/re-imported menu rows don't orphan lot history.
  97|   pos_product_key     text,
  98|   product_name        text,
  99|   -- Quantities. received_qty is what came in; on_hand_qty is current (maintained
 100|   -- by adjustments + the sell flow in a later slice).
 101|   received_qty        numeric not null default 0,
 102|   on_hand_qty         numeric not null default 0,
 103|   unit                text not null default 'each',     -- each | g | mg | oz
 104|   -- Cost per unit in MINOR UNITS (cents) — the seed of margin/KPI math.
 105|   unit_cost_minor_units integer,
 106|   expires_on          date,
 107|   -- lifecycle: active | quarantine | recalled | sold_out | destroyed
 108|   status              text not null default 'active',
 109|   notes               text,
 110|   created_by          uuid references public.staff_profiles(id) on delete set null,
 111|   updated_by          uuid references public.staff_profiles(id) on delete set null,
 112|   created_at          timestamptz not null default now(),
 113|   updated_at          timestamptz not null default now()
 114| );
 115| 
```

`supabase/migrations/0024_pos_coa_potency.sql` L25-L34 — inventory_lots: strain_name, category, inventory_type, unit_weight, unit_weight_uom, is_sample, is_medical

```ts
  25| 
  26| -- ── inventory_lots: product attributes from the transfer ─────────────────────
  27| alter table public.inventory_lots add column if not exists strain_name      text;
  28| alter table public.inventory_lots add column if not exists category         text;   -- EndProduct | IntermediateProduct
  29| alter table public.inventory_lots add column if not exists inventory_type   text;   -- Usable Marijuana | Concentrate for Inhalation | ...
  30| alter table public.inventory_lots add column if not exists unit_weight      numeric;
  31| alter table public.inventory_lots add column if not exists unit_weight_uom  text;   -- g | mg | oz
  32| alter table public.inventory_lots add column if not exists is_sample        boolean not null default false;
  33| alter table public.inventory_lots add column if not exists is_medical       boolean not null default false;
  34| 
```

`supabase/migrations/0031_ccrs_license_export.sql` L10-L48 — license_settings singleton + order_lines.ccrs_inventory_external_id override

```ts
  10| --   * SaleExternalIdentifier (one per sale/transaction)
  11| --   * SaleDetailExternalIdentifier (unique per line within a sale)
  12| --   * 37% CannabisExciseTax (cannabis retail), combined 9.3% SalesTax, etc.
  13| --
  14| -- This migration adds:
  15| --   1. license_settings  — singleton holding the license number + SubmittedBy
  16| --      name + default CreatedBy actor used in the export header/rows.
  17| --   2. order_lines.ccrs_inventory_external_id — optional override of the
  18| --      InventoryExternalIdentifier for a line (defaults to product_id at export
  19| --      time when null). Stable external ids for sale/detail are derived from the
  20| --      order_number + line id at export time (deterministic, idempotent).
  21| --   3. ccrs_export_batches — audit log of generated CCRS files (filename, range,
  22| --      record count, generated_by, operation) so we can track what was reported.
  23| --
  24| -- All idempotent: safe to re-run in the Supabase SQL editor.
  25| -- =============================================================================
  26| 
  27| -- 1) License / reporting identity ---------------------------------------------
  28| create table if not exists public.license_settings (
  29|   id               boolean primary key default true,
  30|   -- WA retail cannabis license number (6 digits in CCRS, stored as text to keep
  31|   -- any leading zeros intact).
  32|   license_number   text not null default '',
  33|   -- Name shown as SubmittedBy / CreatedBy in the CCRS file (text, max 35).
  34|   submitted_by     text not null default '',
  35|   -- Optional: default UBI / trade name for reference (not exported).
  36|   trade_name       text,
  37|   notes            text,
  38|   created_at       timestamptz not null default now(),
  39|   updated_at       timestamptz not null default now(),
  40|   constraint license_settings_singleton check (id = true)
  41| );
  42| 
  43| -- 2) Per-line CCRS inventory id override --------------------------------------
  44| alter table public.order_lines
  45|   add column if not exists ccrs_inventory_external_id text;
  46| 
  47| -- 3) Export audit log ----------------------------------------------------------
  48| create table if not exists public.ccrs_export_batches (
```

`supabase/migrations/0034_ccrs_lot_external_id.sql` L1-L40 — inventory_lots.ccrs_inventory_external_id + SQL backfill mirroring deriveInventoryExternalId

```ts
   1| -- 0034_ccrs_lot_external_id.sql  (Run 5 / Slice 22)
   2| --
   3| -- CCRS InventoryExternalIdentifier hardening.
   4| --
   5| -- The CCRS Upload Guide requires that an item's Inventory.ExternalIdentifier is
   6| -- the SAME identifier reused on LabTest.csv, Sale.csv, Transfer.csv, and
   7| -- InventoryAdjustment.csv, and is assigned by the licensee. To keep this stable
   8| -- forever we persist ONE canonical external id per inventory lot and reuse it
   9| -- everywhere. (order_lines already has an optional per-sale override from 0031.)
  10| --
  11| -- Idempotent: safe to run multiple times.
  12| 
  13| ALTER TABLE public.inventory_lots
  14|   ADD COLUMN IF NOT EXISTS ccrs_inventory_external_id text;
  15| 
  16| -- Helpful for resolving a sold line -> its lot's canonical id at export time.
  17| CREATE INDEX IF NOT EXISTS inventory_lots_pos_product_key_idx
  18|   ON public.inventory_lots (pos_product_key);
  19| 
  20| CREATE INDEX IF NOT EXISTS inventory_lots_ccrs_ext_id_idx
  21|   ON public.inventory_lots (ccrs_inventory_external_id);
  22| 
  23| -- Backfill a canonical id for existing lots that don't have one yet, derived
  24| -- deterministically: prefer lot_code, then pos_product_key, then a LOT-<id>
  25| -- fallback. Sanitized to alphanumerics + single hyphens, clamped to 100 chars.
  26| -- This mirrors deriveInventoryExternalId() in the app layer.
  27| UPDATE public.inventory_lots
  28| SET ccrs_inventory_external_id = LEFT(
  29|   TRIM(BOTH '-' FROM regexp_replace(
  30|     COALESCE(
  31|       NULLIF(TRIM(lot_code), ''),
  32|       NULLIF(TRIM(pos_product_key), ''),
  33|       'LOT-' || id::text
  34|     ),
  35|     '[^A-Za-z0-9]+', '-', 'g'
  36|   )),
  37|   100
  38| )
  39| WHERE ccrs_inventory_external_id IS NULL;
  40| 
```

`supabase/migrations/0040_medical_doh.sql` L80-L106 — medical_exempt_sales (WAC 314-55-090(2))

```ts
  80| -- Excise-exempt sale records — WAC 314-55-090(2). Retain 5 years.
  81| -- One row per excise-exempt line item (SKU + price), tied to the card data.
  82| -- ---------------------------------------------------------------------------
  83| create table if not exists public.medical_exempt_sales (
  84|   id                          uuid primary key default gen_random_uuid(),
  85|   order_id                    uuid references public.orders(id) on delete set null,
  86|   customer_id                 uuid references public.customers(id) on delete set null,
  87|   authorization_id            uuid references public.patient_authorizations(id) on delete set null,
  88|   -- WAC 314-55-090(2)(a)
  89|   sale_date                   date not null default current_date,
  90|   -- WAC 314-55-090(2)(b) — copied from the recognition card at time of sale
  91|   unique_patient_identifier   text not null,
  92|   card_effective_on           date,
  93|   card_expires_on             date,
  94|   -- WAC 314-55-090(2)(c)
  95|   product_sku                 text not null,
  96|   product_name                text,
  97|   -- WAC 314-55-090(2)(d) — minor units (cents)
  98|   sales_price_minor           integer not null,
  99|   -- which exemption(s) applied
 100|   sales_tax_exempt            boolean not null default true,
 101|   excise_tax_exempt           boolean not null default true,
 102|   excise_amount_exempt_minor  integer not null default 0,
 103|   recorded_by                 uuid references public.staff_profiles(id) on delete set null,
 104|   created_at                  timestamptz not null default now()
 105| );
 106| create index if not exists med_exempt_order_idx on public.medical_exempt_sales (order_id);
```

`supabase/migrations/0059_intake_lot_disposition.sql` L20-L60 — lot disposition / reject_reason columns

```ts
  20| -- Per-lot disposition on inventory_lots
  21| -- ---------------------------------------------------------------------------
  22| -- disposition: NULL/'pending' (awaiting decision) | 'accepted' | 'rejected_at_dock'
  23| -- When 'rejected_at_dock', the lot's lifecycle status is set to 'rejected' by
  24| -- app logic and it is never activated into sellable inventory.
  25| alter table public.inventory_lots
  26|   add column if not exists disposition text;
  27| 
  28| alter table public.inventory_lots
  29|   add column if not exists reject_reason text;
  30| 
  31| alter table public.inventory_lots
  32|   add column if not exists reject_reason_code text;
  33| 
  34| alter table public.inventory_lots
  35|   add column if not exists dispositioned_by uuid references public.staff_profiles(id) on delete set null;
  36| 
  37| alter table public.inventory_lots
  38|   add column if not exists dispositioned_at timestamptz;
  39| 
  40| -- Backfill: any lot already active/sold_out is implicitly an accepted lot; any
  41| -- lot previously destroyed by the old reject path we leave as-is (do not rewrite
  42| -- history), but mark its disposition so the UI is consistent.
  43| update public.inventory_lots
  44|   set disposition = 'accepted'
  45|   where disposition is null
  46|     and status in ('active', 'sold_out', 'recalled');
  47| 
  48| -- A soft guard: only allow the known disposition values (NULL allowed = pending).
  49| do $$
  50| begin
  51|   if not exists (
  52|     select 1 from pg_constraint where conname = 'inventory_lots_disposition_chk'
  53|   ) then
  54|     alter table public.inventory_lots
  55|       add constraint inventory_lots_disposition_chk
  56|       check (disposition is null or disposition in ('pending', 'accepted', 'rejected_at_dock'));
  57|   end if;
  58| end$$;
  59| 
  60| create index if not exists inventory_lots_disposition_idx
```

`supabase/migrations/0064_vendor_license_number.sql` L1-L20 — vendors.license_number (FromLicenseNumber source)

```ts
   1| -- 0064_vendor_license_number.sql
   2| -- E7 (inventory intake manifest autofill).
   3| --
   4| -- Adds a stable WA cannabis LICENSE NUMBER to each vendor so the vendor-intake
   5| -- manifest transport form can auto-fill the ORIGIN license number and origin
   6| -- license name (legal_name/display_name) from the vendor record instead of
   7| -- re-typing it on every delivery. Per WAC 314-55-085 the transportation
   8| -- manifest must record the originating licensee; the license number and legal
   9| -- name are stable per vendor (unlike the per-shipment driver/vehicle, which
  10| -- stay on inbound_manifests where they already live via migration 0044).
  11| --
  12| -- Idempotent: safe to run more than once.
  13| 
  14| ALTER TABLE public.vendors
  15|   ADD COLUMN IF NOT EXISTS license_number text;
  16| 
  17| COMMENT ON COLUMN public.vendors.license_number IS
  18|   'WA cannabis license number of the vendor (originating licensee). Used to auto-fill the CCRS/WAC 314-55-085 manifest origin license fields at intake.';
  19| 
```

`supabase/migrations/0118_ccrs_command_center.sql` L25-L110 — ccrs_week_submissions, compliance_reminder_log, push_subscriptions

```ts
  25| -- APPLY MANUALLY in the Supabase SQL editor (standing rule).
  26| -- =============================================================================
  27| 
  28| -- ---------------------------------------------------------------------------
  29| -- 1) ccrs_week_submissions — ONE row per resolved Sun–Sat reporting week.
  30| -- ---------------------------------------------------------------------------
  31| create table if not exists public.ccrs_week_submissions (
  32|   id               uuid primary key default gen_random_uuid(),
  33|   -- Week key 'W-YYYY-MM-DD' (the week-start SUNDAY) — same convention as the
  34|   -- S-18 compliance calendar and ccrs-week-core.ts.
  35|   week_key         text not null unique,
  36|   week_start       date not null,
  37|   week_end         date not null,
  38|   due_date         date not null,
  39|   -- How the week was resolved.
  40|   resolution       text not null check (resolution in ('submitted', 'nothing_to_report')),
  41|   -- When the human says they completed the CCRS upload (or verified no-activity).
  42|   resolved_at      timestamptz not null default now(),
  43|   resolved_by      uuid references public.staff_profiles(id) on delete set null,
  44|   resolved_by_email text,
  45|   -- Whether the resolution happened on/before due_date (computed at write time
  46|   -- so the audit story survives later date math changes).
  47|   on_time          boolean not null default true,
  48|   -- For 'submitted': which files went up (JSON summary from the generated
  49|   -- batch: [{type, fileName, recordCount}, ...]) — drafts-only evidence trail.
  50|   files_json       jsonb,
  51|   total_records    integer not null default 0,
  52|   -- Error tracking: CCRS notifies failures BY EMAIL after upload. 'clean' when
  53|   -- no error email arrived; 'errors_reported' when one did; 'resolved' after
  54|   -- the fix was re-uploaded.
  55|   error_status     text not null default 'clean'
  56|                    check (error_status in ('clean', 'errors_reported', 'resolved')),
  57|   error_notes      text,
  58|   notes            text,
  59|   created_at       timestamptz not null default now(),
  60|   updated_at       timestamptz not null default now()
  61| );
  62| 
  63| create index if not exists idx_ccrs_week_submissions_week_start
  64|   on public.ccrs_week_submissions(week_start desc);
  65| 
  66| drop trigger if exists trg_ccrs_week_submissions_updated on public.ccrs_week_submissions;
  67| create trigger trg_ccrs_week_submissions_updated
  68|   before update on public.ccrs_week_submissions
  69|   for each row execute function public.set_updated_at();
  70| 
  71| -- ---------------------------------------------------------------------------
  72| -- 2) compliance_reminder_log — send-once dedupe for reminder emails/pushes.
  73| --    A cron may run repeatedly; a dedupe_key can only ever be sent once.
  74| -- ---------------------------------------------------------------------------
  75| create table if not exists public.compliance_reminder_log (
  76|   id           uuid primary key default gen_random_uuid(),
  77|   -- e.g. 'sunday_due:W-2026-01-11' or 'overdue_daily:W-2026-01-11:2026-01-19'
  78|   dedupe_key   text not null unique,
  79|   stage        text not null,
  80|   week_key     text,
  81|   channel      text not null default 'email' check (channel in ('email', 'push', 'email+push')),
  82|   subject      text,
  83|   sent_at      timestamptz not null default now(),
  84|   recipients   text
  85| );
  86| 
  87| create index if not exists idx_compliance_reminder_log_sent
  88|   on public.compliance_reminder_log(sent_at desc);
  89| 
  90| -- ---------------------------------------------------------------------------
  91| -- 3) push_subscriptions — Web Push (VAPID) endpoints per staff browser.
  92| -- ---------------------------------------------------------------------------
  93| create table if not exists public.push_subscriptions (
  94|   id           uuid primary key default gen_random_uuid(),
  95|   staff_id     uuid references public.staff_profiles(id) on delete cascade,
  96|   -- The PushSubscription endpoint URL is unique per browser registration.
  97|   endpoint     text not null unique,
  98|   p256dh       text not null,
  99|   auth         text not null,
 100|   user_agent   text,
 101|   created_at   timestamptz not null default now(),
 102|   last_used_at timestamptz
 103| );
 104| 
 105| create index if not exists idx_push_subscriptions_staff
 106|   on public.push_subscriptions(staff_id);
 107| 
 108| -- ---------------------------------------------------------------------------
 109| -- RLS
 110| -- ---------------------------------------------------------------------------
```

`supabase/migrations/0131_pacific_sale_date_default.sql` L1-L32 — medical_exempt_sales.sale_date default → Pacific date

```ts
   1| -- ---------------------------------------------------------------------------
   2| -- 0131_pacific_sale_date_default.sql  (GW-009 fix — run manually in the SQL editor)
   3| --
   4| -- THE PROBLEM: medical_exempt_sales.sale_date (the WAC 314-55-090(2)(a)
   5| -- excise-exempt ledger date) defaulted to `current_date` — the DATABASE
   6| -- SERVER's calendar day, which on Supabase is UTC. The store operates on
   7| -- America/Los_Angeles time: between 4/5 PM Pacific and midnight Pacific,
   8| -- UTC is already "tomorrow", so an evening exempt sale on the last day of
   9| -- the month would land in NEXT month's medical ledger, LIQ-1295 excise
  10| -- return, and CCRS RecreationalMedical period.
  11| --
  12| -- THE FIX (two layers, same PR):
  13| --   1. Application code now writes the Pacific day EXPLICITLY on every
  14| --      insert (src/lib/medical/store.ts uses pacificToday()), so the
  15| --      default is no longer relied upon at all.
  16| --   2. This migration re-points the column DEFAULT at the Pacific calendar
  17| --      day anyway, so any future insert path that forgets the column still
  18| --      gets the correct store-local date. `America/Los_Angeles` is
  19| --      DST-aware inside Postgres — no manual offset math.
  20| --
  21| -- No backfill: the owner has not cut over, and historical rows are off by
  22| -- at most one day only for evening sales at period boundaries (audit
  23| -- documented this as acceptable; see FINDINGS GW-009).
  24| --
  25| -- Idempotent: ALTER ... SET DEFAULT simply overwrites the previous default.
  26| -- Safe to re-run.
  27| -- ---------------------------------------------------------------------------
  28| 
  29| alter table public.medical_exempt_sales
  30|   alter column sale_date
  31|   set default ((now() at time zone 'America/Los_Angeles')::date);
  32| 
```

`supabase/migrations/0214_inventory_lot_received_date.sql` L25-L55 — inventory_lots.received_on (+source/set_by/set_at) — the honest CCRS CreatedDate/TransferDate source

```ts
  25| -- THE PRECEDENT WE ARE FOLLOWING (0191_inventory_audit.sql:105-118)
  26| -- -----------------------------------------------------------------
  27| -- last_counted_at is NULLABLE ON PURPOSE, because "a lot that has never been
  28| -- counted must READ as never counted until somebody counts it." Same doctrine
  29| -- here: a lot whose receipt date is unknown must READ as unknown until a human
  30| -- supplies it. We do NOT default received_on to created_at, to now(), or to
  31| -- anything else. NULL is the flag, and the flag is the point.
  32| --
  33| -- IDEMPOTENT (Rule 6): every statement is add-column-if-not-exists / guarded
  34| -- DO block / create-index-if-not-exists. Safe to re-run. The owner applies
  35| -- this MANUALLY in the Supabase SQL editor.
  36| -- ===========================================================================
  37| 
  38| -- ---------------------------------------------------------------------------
  39| -- 1. The columns
  40| -- ---------------------------------------------------------------------------
  41| alter table public.inventory_lots
  42|   add column if not exists received_on         date,
  43|   add column if not exists received_on_source  text,
  44|   add column if not exists received_on_set_by  uuid references public.staff_profiles(id) on delete set null,
  45|   add column if not exists received_on_set_at  timestamptz;
  46| 
  47| comment on column public.inventory_lots.received_on is
  48|   'The calendar day this lot was physically received (Pacific). NULL means UNKNOWN and must never be backfilled to a date on which no receipt is evidenced — it is the fla
  49| 
  50| comment on column public.inventory_lots.received_on_source is
  51|   'Where received_on came from: pos_import (read from the Cultivera export) | manifest (inbound transfer) | owner_entered (typed from the paper record). Provenance is its
  52| 
  53| comment on column public.inventory_lots.received_on_set_by is
  54|   'Staff member who last set received_on. NULL for machine-derived values.';
  55| 
```

## K. Tests and fixtures

### `tests/compliance/ccrs-batch.test.ts` (284 L) — `describe`/`it` titles

- L46: `describe("CCRS golden files — all 7 retailer file types", () => {`
- L48: `it(`${type}.csv is byte-identical to the hand-verified golden`, () => {`
- L58: `it(`${type} golden passes the offline batch verifier`, () => {`
- L64: `it("the full 7-file batch passes verifyCcrsBatch", () => {`
- L71: `describe("CCRS column headers match the official LCB templates (docs/ccrs-templates)", () => {`
- L83: `it(`${type} columns equal row 4 of ${templateFile[type]}`, () => {`
- L92: `describe("CCRS header rows / NumberRecords", () => {`
- L93: `it("NumberRecords equals the data-row count exactly", () => {`
- L106: `it("a tampered NumberRecords is rejected by the verifier", () => {`
- L115: `it("bare-LF line endings are rejected", () => {`
- L122: `describe("ccrsDate uses the PACIFIC calendar day", () => {`
- L123: `it("a UTC instant on the next day still reports the Pacific day", () => {`
- L127: `it("a plain Pacific-afternoon instant formats as expected", () => {`
- L132: `describe("ccrsCell — written the way CCRS reads (S-09b)", () => {`
- L133: `it("never adds quotes; refuses a comma (CCRS splits on every comma, P20261005A); a double quote passes through (P20261006A)", () => {`
- L141: `describe("file naming convention", () => {`
- L142: `it("UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv", () => {`
- L155: `describe("upload order of operations (Group 1 → 2 → 3)", () => {`
- L156: `it("upload order covers all 7 types with Sale last", () => {`
- L161: `it("Strain/Area/Product precede Inventory, which precedes Sale", () => {`
- L167: `describe("SaleType / StrainType enums", () => {`
- L168: `it("medical orders → RecreationalMedical, others → RecreationalRetail", () => {`
- L172: `it("strain-type normalization collapses to the 3 CCRS values", () => {`
- L180: `describe("product classification (Table 2)", () => {`
- L181: `it("valid category/type pairs pass, invalid ones fail", () => {`
- L193: `it("canonicalizes legacy 2021 LCB vocabulary to the modern enum", () => {`
- L211: `describe("Sale numeric-column safety (defense in depth)", () => {`
- L213: `it("a clean Sale row passes", () => {`
- L216: `it("zero/negative/non-numeric quantity is flagged", () => {`
- L223: `it("negative or 3-decimal money is flagged", () => {`
- L233: `describe("CCRS Product.Name two-layer composition (SLICE 53)", () => {`
- L234: `it("composes the owner-approved example and guards duplication/collisions", async () => {`
- L270: `it("__runCcrsProductNameCoreTests", async () => {`
- L278: `describe("embedded self-tests still pass under vitest", () => {`
- L279: `it("__runCcrsBatchCoreTests", async () => {`

### `tests/compliance/pure-selftests.test.ts` (654 L) — `describe`/`it` titles

- L96: `describe("embedded pure self-test suites", () => {`
- L97: `it("order-pricing-core (S-2/S-3 money math + floor)", () => {`
- L100: `it("discount-engine-core (promotions engine)", () => {`
- L103: `it("brand-match-core (SLICE T1: ONE brand matcher, real catalogue fixtures)", () => {`
- L108: `it("markdown-lock-core (SLICE C1: clearance is excluded from other deals)", () => {`
- L113: `it("brand-resolve-core (rule 11: RECEIVING intake shares the ONE brand matcher)", () => {`
- L118: `it("po-receive-core (defects A+B: auto-receive refuses ambiguous names)", () => {`
- L122: `it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {`
- L126: `it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {`
- L130: `it("weight-label-core (SLICE W1: one grams parser for discounts AND the WAC limit)", () => {`
- L133: `it("promo-guard-core (Task R: CCRS below-cost publish guard)", () => {`
- L136: `it("sales-limits-core (WAC 314-55-095 buckets)", () => {`
- L139: `it("sales-limit-gate-core (S-1 completion gate)", () => {`
- L142: `it("chunked-in (S-7 pagination)", async () => {`
- L145: `it("exempt-sale-record-core (S-8 / WAC 314-55-090(2))", () => {`
- L150: `it("medical/tax (RCW 82.08.9998 + WAC 314-55-090 exemptions, card validity)", () => {`
- L153: `it("medical-authorization-core (DOH 608-048 issuance + validity-at-date)", () => {`
- L158: `it("medical-sale-core (Task O: DOH categories, exemption plan, high-THC gate)", () => {`
- L161: `it("medical-intake-core (Task P: RCW 69.51A.230(4) date rules, age classes, card number)", () => {`
- L166: `it("sales-hours-core (WAC 314-55-147 window)", () => {`
- L169: `it("receipt-core (Pacific timestamps, receipt shape)", () => {`
- L172: `it("pin-hash (S-10 scrypt + throttle)", () => {`
- L175: `it("at-rest-crypto (S-10 AES-256-GCM envelope)", () => {`
- L178: `it("loyalty engine (points math, tiers, code gen)", () => {`
- L181: `it("loyalty-config-core (customizer drafts, RCW discount cap)", () => {`
- L184: `it("loyalty-sale-core (Task S-a: best-deal-wins, code spread, floors)", () => {`
- L187: `it("signup-customer-core (Task V: signup → customer create-or-link)", () => {`
- L190: `it("schedule-core (week math, Pacific)", () => {`
- L193: `it("employee-lifecycle-core (Task S-b: RCW 49.94 order, activation gate, deadlines, sick leave)", () => {`
- L197: `it("user-guards-core (Task S-c: self-rule, rank rule, privilege ceiling, last-owner rule)", () => {`
- L201: `it("campaign-rules-core (Task S-d: WAC 314-55-155 per-channel rules, warnings map)", () => {`
- L205: `it("competitive-playbook-core (Task S-d: legal plays, in-app tool links, guardrails)", () => {`
- L209: `it("midjourney-core (Creative Studio brief -> prompt assembly)", () => {`
- L212: `it("flux-core (Task U: verified per-endpoint FLUX request contracts)", () => {`
- L215: `it("flux-presets-core (R62: general-purpose prompt templates, snippets, prompt lint)", () => {`
- L218: `it("flux-video-core (R62: schema-exact FLUX 3 video t2v/i2v/v2v/edit/upscale/draft_enhance bodies)", () => {`
- L221: `it("creative-placements-core (Task U: verified destination sizes, 4MP ceiling)", () => {`
- L224: `it("ccrs-week-core (Task W: Sun–Sat week, due next Sunday, reminder planner)", () => {`
- L229: `it("ccrs-deadline-core (Slice 106 + Task W: LIQ-1295 due dates + monthly reminder planner)", () => {`
- L234: `it("ccrs-error-triage-core (Task W: error-email triage + examiner draft)", () => {`
- L242: `it("ccrs-submit-gate-core (S-01/N-06: the upload gate — errors block, warnings do not)", () => {`
- L250: `it("ccrs-preflight-core (S-02: E7-E13 blocking pre-flight checks)", () => {`
- L254: `it("ccrs-lot-product-core (Part 17 S-17b: why a lot's product is not in Product.csv)", () => {`
- L259: `it("ccrs-signin-core (Part 11 §G S-17c: CCRS signs in with WA.gov, separate PREprod account)", () => {`
- L264: `it("ccrs-handover-core (Part 09 S-17d: first upload date and hand-over warnings)", () => {`
- L269: `it("ccrs-mail-core (Part 09 S-18a: CCRS mailbox monitor, classify and prove)", () => {`
- L274: `it("ccrs-strategy-core (Part 09 S-18b: strategy report for CCRS error email)", () => {`
- L279: `it("ccrs-watchdog-core (Part 09 S-18c: no CCRS answer after 60 minutes; mailbox monitor down)", () => {`
- L284: `it("ccrs-reseed-core (Part 17 G-1, S-15: re-seed / diff of the ledger from a later delivery)", () => {`
- L289: `it("ccrs-equalize-core (Part 17 §E, S-14: equalize waves)", () => {`
- L294: `it("ccrs-copy-verify-core (Part 17 §G G-3, S-16: copy diff verifier)", () => {`
- L299: `it("ccrs-issue-display-core (Part 17 S-17a: every withheld row shown with its next step)", () => {`
- L304: `it("ccrs-ledger-core (Bible v2 S-11: ledger routing, strain casing, filed product name)", () => {`
- L307: `it("menu-feed-core (syndication feed mapping: strain normalize, stock, quantity, image)", () => {`
- L310: `it("leafly-payload-core (Leafly v2 wire format: cents, quantity, null-not-NA)", () => {`
- L313: `it("leafly-payload-validate-core (SLICE L-2: fail-closed last gate before the wire)", () => {`
- L318: `it("leafly-orderability-core (SLICE L-3: fail-closed pickup + DOH/endorsement gates)", () => {`
- L323: `it("leafly-readback-core (SLICE L-4: GET /menu parse + reconcile, fails soft)", () => {`
- L328: `it("leafly-certification-core (SLICE L-4: Leafly's five criteria, fails closed)", () => {`
- L333: `it("leafly-readback-proof-core (SLICE L-52: stored read-back verdict proves criterion 5)", () => {`
- L338: `it("strain-placeholder-core (SLICE L-52: placeholder strains become null)", () => {`
- L343: `it("leafly-readback-baseline-core (SLICE L-52: sync-state rebuild baseline)", () => {`
- L348: `it("leafly-hmac-core (SLICE L-5: raw-body HMAC, timing-safe, fails closed)", () => {`
- L360: `it("leafly-order-map-core (SLICE L-5: status vocabulary in both directions)", () => {`
- L369: `it("leafly-webhook-parse-core (SLICE L-5: fails soft, because the spec demands 200)", () => {`
- L376: `it("leafly-preview-core (SLICE L-5: the money a shopper reads before buying)", () => {`
- L394: `it("leafly-auto-ack-core (SLICE L-33: the machine presses the button)", () => {`
- L420: `it("leafly-auto-ack-sweep-core (SLICE L-33: the net under the net)", () => {`
- L456: `it("leafly-order-ack-core (SLICE L-6: talking back to Leafly, one-way doors)", () => {`
- L491: `it("leafly-schedule-core (SLICE L-7: both automation and the manual button)", () => {`
- L530: `it("leafly-evidence-core (SLICE L-8: the webhook evidence reader)", () => {`
- L551: `it("order-origin-core (SLICE L-2: website vs Leafly vs register)", () => {`
- L563: `it("leafly-bridge-core (SLICE L-10: arrival announces/prints, acceptance creates)", () => {`
- L585: `it("weedmaps-payload-core (Task X: verified Request_MenuItem variants/price/weight)", () => {`
- L592: `it("integration-credentials-core (DB-over-env overrides + masking; L-5 Leafly keys)", () => {`
- L596: `it("sync-plan-core (Task X: payload-hash idempotency + delta sync plan)", () => {`
- L599: `it("preflight-core (Task X: pre-push validation — dup ids, prices, weights)", () => {`
- L602: `it("richness-core (Task X: menu richness scoring + connection health)", () => {`
- L605: `it("sync-settings-core (Task X + L-7: transmission parameters AND the schedule)", () => {`
- L616: `it("apply-settings-core (Task X: owner toggles applied to channel payloads)", () => {`
- L619: `it("syndication-playbook (Task X: verified connect/stay/reconnect playbook + AI grounding)", () => {`
- L622: `it("leafly-order-cart-core (SLICE L-48: changing a Leafly order's items)", () => {`
- L631: `it("leafly-badge-core (Inventory LEAFLY badge)", () => {`
- L636: `it("leafly-register-lines-core (Leafly order -> register cart ids)", () => {`
- L643: `it("outbound-history-core (L-49: Order-API call history, PII-safe display/export)", () => {`
- L648: `it("cart-picker-core (L-50: picker offers only sizes the Leafly payload sends)", () => {`

### Golden fixtures (`tests/compliance/golden/ccrs/`)

- `Area.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Area,IsQuarantine,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation`
- `Inventory.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,Create`
- `InventoryAdjustment.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryExternalIdentifier,AdjustmentReason,AdjustmentDetail,Quantity,AdjustmentDate,ExternalIdentifier,C`
- `InventoryTransfer.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`FromLicenseNumber,ToLicenseNumber,FromInventoryExternalIdentifier,ToInventoryExternalIdentifier,Quantity,TransferDate,Ex`
- `Product.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,`
- `Sale.golden.csv`: rows=7, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPri`
- `Strain.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate`

