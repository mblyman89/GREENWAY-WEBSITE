# 03 — Code Anchor Atlas (generated from the tree)

Generated 2026-10-06 22:09Z at commit `88bce0c30815adeafa136c4ce700c7fb2755baf2` by `build_atlas_part.py`.

**Rules for using this part**

1. Every `L####` here was read from the file at the commit above. Before editing, run `git diff 88bce0c -- <file>`; if the file changed, re-run the generator and re-pin.
2. Snippets are verbatim. If a snippet here disagrees with the file, the FILE wins and this part must be regenerated — never 'fix' the atlas by hand.
3. Anchors are grouped by the flow they belong to: (A) batch builders, (B) core/pure helpers, (C) identifiers, (D) week/ledger, (E) triage/gate, (F) adjustments & corrections, (G) returns/disposition, (H) intake & Cultivera identity, (I) routes/pages/components, (J) schema.

## 0. Module inventory (line counts + every `export` with its line)

### `src/lib/compliance/ccrs-batch.ts` (959 L)

- L64: `export type CcrsFile = {`
- L76: `export type CcrsSyncIssue = {`
- L93: `export type CcrsBatch = {`
- L644: `export async function buildCcrsBatch(fromISO: string, toISO: string): Promise<CcrsBatch> {`

### `src/lib/compliance/ccrs-batch-core.ts` (1516 L)

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
- L944: `export type CcrsBatchProblem = {`
- L950: `export type CcrsBatchVerification = {`
- L961: `export function splitCsvLine(line: string): string[] {`
- L1007: `export function verifyCcrsFile(`
- L1147: `export function verifyCcrsBatch(`
- L1164: `export function __runCcrsBatchCoreTests(): void {`

### `src/lib/compliance/ccrs-sales.ts` (527 L)

- L49: `export type CcrsLicenseSettings = {`
- L54: `export type CcrsBuildResult = {`
- L87: `export async function getCcrsLicenseSettings(): Promise<CcrsLicenseSettings> {`
- L186: `export async function buildCcrsSaleCsv(fromISO: string, toISO: string): Promise<CcrsBuildResult> {`

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

### `src/lib/compliance/ccrs-week-core.ts` (451 L)

- L40: `export function addDaysIso(iso: string, days: number): string {`
- L47: `export function isoWeekday(iso: string): number {`
- L53: `export function isoDayDiff(aIso: string, bIso: string): number {`
- L63: `export type CcrsWeek = {`
- L75: `export function weekStartFor(dateIso: string): string {`
- L80: `export function weekFromStart(startIso: string): CcrsWeek {`
- L87: `export function weekContaining(dateIso: string): CcrsWeek {`
- L96: `export function lastCompletedWeek(todayIso: string): CcrsWeek {`
- L101: `export function weekFromKey(key: string): CcrsWeek | null {`
- L115: `export type WeekResolution = "submitted" | "nothing_to_report";`
- L117: `export type WeekStatus =`
- L125: `export type WeekDeadline = {`
- L137: `export function weekDeadline(`
- L153: `export type WeeklyOverview = {`
- L170: `export function weeklyDeadlineOverview(`
- L215: `export type ReminderStage = "thursday_heads_up" | "saturday_wrap" | "sunday_due" | "overdue_daily";`
- L217: `export type PlannedReminder = {`
- L234: `export function planWeeklyReminders(`
- L306: `export function __runCcrsWeekTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-week-store.ts` (158 L)

- L24: `export type WeekSubmissionRow = {`
- L46: `export async function listWeekSubmissions(limit = 12): Promise<WeekSubmissionRow[]> {`
- L62: `export async function getWeekResolutions(lookbackWeeks = 8): Promise<Map<string, WeekResolution>> {`
- L70: `export async function getWeeklyOverview(opts?: { lookbackWeeks?: number }): Promise<WeeklyOverview> {`
- L81: `export async function resolveWeek(opts: {`
- L125: `export async function unresolveWeek(weekKey: string): Promise<{ ok: boolean; error?: string }> {`
- L139: `export async function setWeekErrorStatus(opts: {`

### `src/lib/compliance/ccrs-error-triage-core.ts` (366 L)

- L15: `export type TriageSeverity = "benign" | "fixable" | "escalate";`
- L17: `export type TriageFinding = {`
- L29: `export type TriageResult = {`
- L164: `export function triageCcrsErrorEmail(pasted: string): TriageResult {`
- L226: `export const LCB_CONTACTS = {`
- L234: `export type ExaminerDraft = {`
- L245: `export function buildExaminerDraft(opts: {`
- L280: `export function __runCcrsErrorTriageTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-submit-gate-core.ts` (230 L)

- L25: `export type GateSeverity = "error" | "warning";`
- L28: `export type GateIssueInput = {`
- L36: `export type GateFileInput = {`
- L43: `export type GateIssue = {`
- L52: `export type CcrsSubmitVerdict = {`
- L68: `export function defaultClassifyWarning(message: string | null | undefined): GateSeverity {`
- L77: `export function assertCcrsBatchSubmittable(input: {`
- L138: `export function verdictSummary(v: CcrsSubmitVerdict): string {`
- L149: `export function __runCcrsSubmitGateTests(): { passed: number; failed: number } {`

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

### `src/lib/compliance/ccrs-filing-status.ts` (110 L)

- L37: `export type CcrsFilingOverview = {`
- L67: `export async function getCcrsFilingOverview(`

### `src/lib/compliance/ccrs-product-name-core.ts` (319 L)

- L46: `export type CcrsNameSource = {`
- L63: `export type ComposedCcrsName = {`
- L80: `export function containsTokens(haystack: string, needle: string): boolean {`
- L109: `export function composeCcrsProductName(src: CcrsNameSource): ComposedCcrsName {`
- L167: `export function disambiguateCcrsName(`
- L191: `export function __runCcrsProductNameCoreTests(): void {`

### `src/lib/compliance/ccrs-deadline-core.ts` (449 L)

- L31: `export type ReportingPeriod = {`
- L38: `export type DeadlineStatus =`
- L45: `export type PeriodDeadline = {`
- L84: `export function dueDateForPeriod(period: ReportingPeriod, holidays: ReadonlySet<string> = new Set()): string {`
- L109: `export function periodDeadline(`
- L130: `export function periodKey(p: ReportingPeriod): string {`
- L135: `export function keyToPeriod(key: string): ReportingPeriod {`
- L153: `export function monthsFullyCoveredByRange(fromIso: string, toIso: string): Set<string> {`
- L180: `export function priorPeriod(todayIso: string, monthsBack: number): ReportingPeriod {`
- L194: `export function reportingDeadlineOverview(`
- L223: `export type MonthlyReminderStage = "liq_due_soon" | "liq_due_today" | "liq_overdue_daily";`
- L225: `export type PlannedMonthlyReminder = {`
- L245: `export function planMonthlyReminders(`
- L293: `export function __runCcrsDeadlineTests(): { passed: number; failed: number } {`

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

### `src/lib/inventory/intake-store.ts` (2280 L)

- L142: `export async function listManifests(opts?: {`
- L164: `export async function countManifestsByStatus(): Promise<StageCounts> {`
- L216: `export async function resolveOrCreateVendor(`
- L452: `export async function resolveBrandId(`
- L464: `export async function resolveBrandIdDetailed(`
- L537: `export async function stageManifest(`
- L807: `export async function rejectManifest(`
- L867: `export async function setLotDisposition(`
- L924: `export async function preflightManifestSampleCap(`
- L1062: `export async function gatherSampleCapNotice(manifestId: string): Promise<`
- L1125: `export async function finalizeManifestDispositions(`
- L1592: `export async function seedIncomingSampleEvents(`
- L1693: `export async function rememberVendorUsualTransport(`
- L1741: `export async function listManifestLots(manifestId: string) {`
- L1800: `export async function listLabFactsByIds(`
- L1868: `export type ManifestLotExportRow = {`
- L1896: `export async function listAllManifestLotsForExport(`
- L1954: `export type ManifestLifecycleStatus =`
- L1969: `export async function logManifestEvent(`
- L1994: `export async function setManifestLifecycle(`
- L2020: `export async function updateManifestTransport(`
- L2081: `export async function setManifestInvoiceOverride(`
- L2117: `export async function recordInvoiceNumberDetected(`
- L2173: `export async function seedTransportFromParsed(`
- L2218: `export async function backfillManifestTransport(`
- L2268: `export async function listManifestEvents(manifestId: string) {`

### `src/lib/inventory/intake-parser.ts` (797 L)

- L21: `export type ParsedLab = {`
- L44: `export type ParsedLine = {`
- L94: `export type ParsedTransport = {`
- L110: `export function emptyTransport(): ParsedTransport {`
- L127: `export function transportHasData(t: ParsedTransport | null | undefined): t is ParsedTransport {`
- L138: `export function combineDateAndTime(dateIso: string | null, timeRaw: string | null): string | null {`
- L151: `export type ParsedManifest = {`
- L168: `export type ParseResult =`
- L241: `export function cleanUrl(v: unknown): string | null {`
- L273: `export function looksLikeWciaTransferStrict(root: unknown): boolean {`
- L691: `export function parseVendorJson(jsonText: string): ParseResult {`
- L725: `export type CoaLink = {`
- L740: `export function extractCoaLinks(m: ParsedManifest): CoaLink[] {`
- L760: `export function summarizeManifest(m: ParsedManifest): {`

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

### `src/lib/pos/import-lot-core.ts` (952 L)

- L43: `export type ImportLotSource = {`
- L88: `export type PlannedImportLot = {`
- L141: `export type ImportLotDiagnostic = {`
- L148: `export type ImportLotPlan = {`
- L167: `export function costToMinorUnits(raw: string | null | undefined): number | null {`
- L177: `export function parseUsDate(raw: string | null | undefined): string | null {`
- L200: `export function coaFlagToBool(raw: string | null | undefined): boolean {`
- L250: `export function resolveLotCreatedAt(plannedIso: string | null, fallbackIso: string): string {`
- L263: `export function insertKeySignature(row: Record<string, unknown>): string {`
- L274: `export function findNonUniformInsertRow(`
- L294: `export function assertUniformInsertKeys(rows: readonly Record<string, unknown>[], label: string): void {`
- L332: `export const POS_POTENCY_COLUMNS = ["pos_thc", "pos_thca", "pos_cbd", "pos_cbda", "pos_potency_unit", "pos_potency_set_at"] as const;`
- L340: `export function receivedOnForDb(receivedOn: string | null, pacificToday: string): string | null {`
- L347: `export function potencyColumns(p: LotPotency | null, nowIso: string): Record<string, unknown> {`
- L358: `export type ExistingLotFacts = {`
- L369: `export type LotFactFillPlan = {`
- L383: `export function planLotFactFill(`
- L433: `export function planImportLots(sources: readonly ImportLotSource[]): ImportLotPlan {`
- L661: `export function __runImportLotCoreTests(): void {`
- L932: `export function __runImportLotFactFillTests(): { passed: number } {`

### `src/lib/pos/import-service.ts` (972 L)

- L63: `export function sha256(buffer: Buffer | Uint8Array): string {`
- L67: `export type CreateImportInput = {`
- L77: `export type CreateImportResult = {`
- L84: `export async function findDuplicateImport(`
- L104: `export async function runImport(input: CreateImportInput): Promise<CreateImportResult> {`
- L360: `export type PublishMenuVersionOptions = {`
- L372: `export type PublishMenuVersionResult = {`
- L377: `export async function publishMenuVersion(`
- L742: `export async function fillImportLotFacts(`
- L835: `export async function countTestData(): Promise<{ imports: number; versions: number }> {`
- L849: `export async function cleanSlateTestData(): Promise<{`
- L897: `export async function backfillImportLots(`

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

### `src/app/admin/compliance/ccrs/page.tsx` (675 L)

- L47: `export const dynamic = "force-dynamic";`
- L81: `export default async function CcrsCommandCenterPage({`

### `src/app/admin/compliance/ccrs/actions.ts` (136 L)

- L27: `export async function resolveWeekAction(formData: FormData): Promise<void> {`
- L82: `export async function unresolveWeekAction(formData: FormData): Promise<void> {`
- L104: `export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {`

### `src/app/admin/reports/compliance/page.tsx` (478 L)

- L27: `export const dynamic = "force-dynamic";`
- L41: `export default async function CompliancePage({`

### `src/app/admin/reports/compliance/batch-export/route.ts` (147 L)

- L23: `export const dynamic = "force-dynamic";`
- L24: `export const runtime = "nodejs";`
- L26: `export async function GET(request: Request) {`

### `src/app/admin/reports/compliance/adjustment-export/route.ts` (61 L)

- L15: `export const dynamic = "force-dynamic";`
- L16: `export const runtime = "nodejs";`
- L18: `export async function GET(request: Request) {`

### `src/app/admin/reports/compliance/advisor-action.ts` (41 L)

- L14: `export type CcrsAdvisorResult = { ok: true; advice: CcrsAdvice } | { ok: false; error: string };`
- L16: `export async function generateCcrsAdviceAction(sp: {`

### `src/app/admin/inventory/disposition/sale-correction-export/route.ts` (108 L)

- L26: `export const dynamic = "force-dynamic";`
- L27: `export const runtime = "nodejs";`
- L29: `export async function GET() {`

### `src/components/admin/compliance/UploadWalkthrough.tsx` (322 L)

- L87: `export function UploadWalkthrough({ weekKey, files, batchZipHref, submittable }: Props) {`

### `src/components/admin/compliance/ErrorTriagePanel.tsx` (167 L)

- L39: `export function ErrorTriagePanel({ licenseNumber, licenseeName, weekStart, weekEnd, fileTypes }: Props) {`

### `src/components/admin/compliance/PushRemindersPanel.tsx` (176 L)

- L37: `export function PushRemindersPanel() {`

### `src/components/admin/reports/CcrsAdvisorPanel.tsx` (114 L)

- L50: `export function CcrsAdvisorPanel({ aiEnabled, sp }: Props) {`

### `src/components/admin/reports/LicenseSettingsForm.tsx` (89 L)

- L7: `export function LicenseSettingsForm({`

### `src/components/admin/reports/ReportTabs.tsx` (62 L)

- L13: `export type ReportTab = { href: string; label: string; icon: string };`
- L15: `export const REPORT_TABS: ReportTab[] = [`
- L35: `export function ReportTabs() {`

### `src/components/admin/admin-nav-data.ts` (232 L)

- L4: `export type AdminNavItem = {`
- L41: `export const adminNav: AdminNavItem[] = [`
- L195: `export const navGroups: AdminNavItem["group"][] = [`

## A. Batch builders — `src/lib/compliance/ccrs-batch.ts`

`src/lib/compliance/ccrs-batch.ts` L160-L193 — buildStrainFile — NOTE: no guard for Unknown/THC/Other (guide p.12 L358: 'Strain name is invalid, cannot be Unknown, THC, or Other'). Defaults StrainType to Hybrid.

```ts
 160|   ccrs_inventory_external_id: string | null;
 161|   received_qty: number;
 162|   on_hand_qty: number;
 163|   unit_cost_minor_units: number | null;
 164|   unit_weight: number | null;
 165|   unit_weight_uom: string | null;
 166|   status: string;
 167|   created_at: string;
 168|   /**
 169|    * SLICE 2 (migration 0214) — the evidenced day the lot was received.
 170|    * NULL means unknown; see ccrsInventoryCreatedDate() for how that is
 171|    * handled when filling Inventory.CreatedDate.
 172|    */
 173|   received_on: string | null;
 174|   /**
 175|    * S-02 / E7: a vendor TRADE SAMPLE (migration 0024 L32,
 176|    * `is_sample boolean not null default false`). It has no purchase value, but
 177|    * CCRS still requires a positive TotalCost and the FAQ dictates exactly
 178|    * $0.01 [FAQ L0035]. Selected explicitly so the E7 check can tell a sample
 179|    * apart from a lot whose cost was never entered.
 180|    */
 181|   is_sample: boolean | null;
 182| };
 183| 
 184| // ---------------------------------------------------------------------------
 185| // Per-file generators for the master-data files (Strain / Area / Product /
 186| // Inventory). Adjustment + Sale reuse the existing mature builders.
 187| // ---------------------------------------------------------------------------
 188| 
 189| /** grams from a unit_weight + uom (g default). Returns "" when unknown. */
 190| function toGrams(weight: number | null, uom: string | null): string {
 191|   if (weight == null || !Number.isFinite(weight)) return "";
 192|   const u = (uom ?? "g").toLowerCase();
 193|   const g = u === "mg" ? weight / 1000 : u === "oz" ? weight * AVOIRDUPOIS_GRAMS_PER_OUNCE : weight;
```

`src/lib/compliance/ccrs-batch.ts` L201-L213 — buildAreaFile — emits Area 'Quarantine' IsQuarantine=TRUE whenever hasQuarantine. FAQ (Data Reporting, IsQuarantine Q): 'There are no quarantine requirements for cannabis products. You will have an entry as FALSE.' → compliance question, Part 04 flag N-01.

```ts
 201|   createdBy: string,
 202|   createdDate: string,
 203|   plan: LedgerPlan,
 204| ): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[] } {
 205|   const warnings: string[] = [];
 206|   const seen = new Set<string>();
 207|   const rows: string[][] = [];
 208|   const defaulted: string[] = [];
 209|   const reserved: CcrsIssueRow[] = [];
 210|   for (const it of items) {
 211|     const raw = (it.strain_name ?? "").trim();
 212|     if (!raw) continue;
 213|     // S-11: the plan decides. A strain already on file in ANY casing is never
```

`src/lib/compliance/ccrs-batch.ts` L215-L260 — buildProductFile (part 1) — weightByKey from lots; grams may be '' when no lot weight.

```ts
 215|     // filed or already-emitted strain is never sent at all [BRIAN A16].
 216|     const strain = plan.strainCanonical.get(raw) ?? raw;
 217|     if (!plan.strainEmit.has(strain)) continue;
 218|     if (seen.has(strain)) continue;
 219|     seen.add(strain);
 220|     // E11 [G L0358] "Strain name is invalid, cannot be Unknown, THC, or Other."
 221|     // Exact match only — "Other Kush" is a real strain and must still ship.
 222|     if (isReservedStrainName(strain)) {
 223|       reserved.push({
 224|         id: (it.source_item_id ?? strain).trim(),
 225|         label: strain,
 226|         detail: `"${strain}" is a reserved CCRS strain name`,
 227|       });
 228|       continue;
 229|     }
 230|     // B2: StrainType MUST be one of Indica/Sativa/Hybrid. Normalize the POS
 231|     // label; when it can't be resolved we default to Hybrid (safe superset) and
 232|     // flag the strain so an employee can correct it (drafts-only).
 233|     const st = normalizeStrainType(it.strain_type);
 234|     if (st.defaulted) defaulted.push(strain);
 235|     rows.push([license, strain, st.value, createdBy, createdDate]);
 236|   }
 237|   if (defaulted.length > 0) {
 238|     warnings.push(
 239|       `${defaulted.length} strain(s) had no recognizable Indica/Sativa/Hybrid type and were defaulted to "Hybrid" — set the correct StrainType before uploading: ${default
 240|         .slice(0, 15)
 241|         .join(", ")}${defaulted.length > 15 ? "…" : ""}.`,
 242|     );
 243|   }
 244|   if (rows.length === 0) warnings.push("No named strains found in the published menu.");
 245|   const issues: CcrsSyncIssue[] = [];
 246|   if (plan.strainCaseVariants.length > 0) {
 247|     issues.push({
 248|       severity: "warning",
 249|       file: "Strain",
 250|       code: "E39_STRAIN_CASE_VARIANT",
 251|       specPin: specPinFor("E39_STRAIN_CASE_VARIANT"),
 252|       count: plan.strainCaseVariants.length,
 253|       rows: plan.strainCaseVariants.map((v) => ({
 254|         id: v.ours,
 255|         label: v.ours,
 256|         detail: `written as "${v.value}" (${v.source === "ledger" ? "the spelling already filed in CCRS" : "the first spelling in this batch"})`,
 257|       })),
 258|       message: `${plan.strainCaseVariants.length} strain name(s) differ from another only by capital letters. CCRS must never receive the same strain with a different cap
 259|     });
 260|   }
```

`src/lib/compliance/ccrs-batch.ts` L280-L349 — buildProductFile (part 2) — classification via deriveCcrsClassificationFromType; E4 error message; clamps; warnings.slice(0,30).

```ts
 280|  */
 281| function buildAreaFile(
 282|   hasQuarantine: boolean,
 283|   license: string,
 284|   createdBy: string,
 285|   createdDate: string,
 286| ): { rows: string[][]; warnings: string[] } {
 287|   const rows: string[][] = [];
 288|   rows.push([license, "Sales Floor", "FALSE", "AREA-SALES-FLOOR", createdBy, createdDate, "", "", "Insert"]);
 289|   if (hasQuarantine) {
 290|     rows.push([license, "Quarantine", "TRUE", "AREA-QUARANTINE", createdBy, createdDate, "", "", "Insert"]);
 291|   }
 292|   return { rows, warnings: [] };
 293| }
 294| 
 295| function buildProductFile(
 296|   items: MenuItemRow[],
 297|   lots: LotRow[],
 298|   license: string,
 299|   createdBy: string,
 300|   createdDate: string,
 301| ): {
 302|   rows: string[][];
 303|   warnings: string[];
 304|   nameByProductKey: Map<string, string>;
 305|   /** S-11: the product key behind each row in `rows`, same order. */
 306|   keys: string[];
 307|   issues: CcrsSyncIssue[];
 308| } {
 309|   const warnings: string[] = [];
 310|   const e9Rows: CcrsIssueRow[] = [];
 311|   const e10Rows: CcrsIssueRow[] = [];
 312|   // CCRS joins Inventory.Product -> Product.Name by the EXACT name string. We
 313|   // record the final (clamped) Name we wrote for each raw product key so the
 314|   // Inventory file can reference the IDENTICAL string. See
 315|   // docs/CCRS_PRODUCT_NAMING_RESEARCH.md (the Inventory.Product join bug).
 316|   const nameByProductKey = new Map<string, string>();
 317|   // Weight per product key from lots (first non-null wins).
 318|   const weightByKey = new Map<string, string>();
 319|   for (const l of lots) {
 320|     const key = (l.pos_product_key ?? "").trim();
 321|     if (!key) continue;
 322|     if (!weightByKey.has(key)) {
 323|       const g = toGrams(l.unit_weight, l.unit_weight_uom);
 324|       if (g) weightByKey.set(key, g);
 325|     }
 326|   }
 327|   const seen = new Set<string>();
 328|   const usedNamesLower = new Set<string>();
 329|   const rows: string[][] = [];
 330|   const keys: string[] = [];
 331|   for (const it of items) {
 332|     const key = (it.source_item_id ?? "").trim();
 333|     if (!key) continue;
 334|     const ext = sanitizeExternalId(key);
 335|     if (!ext || seen.has(ext)) continue;
 336|     seen.add(ext);
 337|     const rawCategory = (it.pos_inventory_category ?? "").trim();
 338|     const rawType = (it.pos_inventory_type ?? "").trim();
 339|     const grams = weightByKey.get(key) ?? "";
 340| 
 341|     // SLICE 53 (two-layer naming, owner-approved): the CCRS Product.Name is
 342|     // AUTO-COMPOSED from stored fields — short vendor + brand + display name +
 343|     // measured cannabinoid tag + type + size ("Downtown Space OG Flower 1g").
 344|     // The human-facing menu_items.name is untouched; the composed name lives
 345|     // only in these files. Falls back to the display name when composition is
 346|     // impossible (never guesses).
 347|     const composed = composeCcrsProductName({
 348|       name: (it.name ?? "").trim(),
 349|       vendor: it.vendor_name,
```

`src/lib/compliance/ccrs-batch.ts` L351-L417 — buildInventoryFile — ext id derive; Area choice; TotalCost = unit_cost_minor_units*received_qty (0 when cost missing → guide p.17 L614 'TotalCost cannot equal 0'); IsMedical hard 'FALSE'; Operation Insert.

```ts
 351|       posInventoryCategory: it.pos_inventory_category,
 352|       category: it.category,
 353|       unitWeightGrams: grams || null,
 354|       totalThc: jsonToCannabinoid(it.total_thc_json),
 355|       totalCbd: jsonToCannabinoid(it.total_cbd_json),
 356|       compounds: jsonToCompounds(it.compounds_json),
 357|     });
 358|     // CCRS joins Inventory.Product -> Product.Name by EXACT string, so two
 359|     // DIFFERENT products must never share one Name. Deterministic suffix from
 360|     // the product's own external id on collision (stable batch after batch).
 361|     const disamb = disambiguateCcrsName(composed.name, ext, usedNamesLower);
 362|     if (disamb.disambiguated) {
 363|       warnings.push(
 364|         `Product "${composed.name.slice(0, 40)}…": composed CCRS name collided with another product — suffixed to "${disamb.name.slice(0, 60)}" to keep the Inventory→Prod
 365|       );
 366|     }
 367|     const productName = disamb.name;
 368| 
 369|     // C1 (Slice 55, owner-confirmed): the CCRS (InventoryCategory, InventoryType)
 370|     // is derived from the vendor-set LCB TYPE alone (pos_inventory_type). The
 371|     // house/merchandising label (pos_inventory_category, e.g. "Pre-roll",
 372|     // "Gummies") is a STOREFRONT concept and is NOT used as a CCRS category — it
 373|     // only feeds the composed Name above. Deriving the category from the type
 374|     // (an inversion of the CCRS enum) is deterministic and never guesses; a
 375|     // blank/unknown type still raises the pre-existing ERROR safety net so a
 376|     // human fixes the source. NEVER-INVENT policy preserved.
 377|     const cls = deriveCcrsClassificationFromType(rawType);
 378|     let category = rawCategory;
 379|     let type = rawType;
 380|     if (cls.ok) {
 381|       category = cls.category;
 382|       type = cls.type;
 383|       // Advisory (never blocks): a legacy 2021-vocabulary value ("Usable
 384|       // Marijuana", inhalation concentrate under IntermediateProduct) was
 385|       // canonicalized to the current Table 2 spelling/category. Surface it so
 386|       // staff see what was translated.
 387|       if (cls.aliased && cls.aliasNote) {
 388|         warnings.push(`Product "${productName || ext}": ${cls.aliasNote}`);
 389|       }
 390|     } else {
 391|       warnings.push(`ERROR — Product "${productName || ext}": ${cls.error} Fix the CCRS mapping (Inventory types) before submitting.`);
 392|     }
 393| 
 394|     // C2: clamp Name (75) and Description (250); flag truncation (don't silently cut).
 395|     const nameClamp = clampText(productName, CCRS_PRODUCT_NAME_MAX);
 396|     if (nameClamp.truncated) {
 397|       warnings.push(`Product "${productName.slice(0, 40)}…": Name exceeds ${CCRS_PRODUCT_NAME_MAX} chars and was truncated — shorten it in the source.`);
 398|     }
 399|     // Naming-convention check (drafts-only, surfaced as a warning): if the Name
 400|     // violates the house convention (leading symbol, disallowed char, casing),
 401|     // flag it so staff fix the source. Does NOT alter the value written here.
 402|     const nameCheck = validateName(nameClamp.value);
 403|     if (!nameCheck.ok) {
 404|       warnings.push(
 405|         `Product "${nameClamp.value.slice(0, 40)}…": name convention issues — ${nameCheck.issues.map((i) => i.message).join(" ")} Suggested: "${suggestName(nameClamp.valu
 406|       );
 407|     }
 408|     // Record the exact Name for the Inventory.Product join (keyed by raw key).
 409|     nameByProductKey.set(key, nameClamp.value);
 410|     const descClamp = clampText(it.description, CCRS_PRODUCT_DESCRIPTION_MAX);
 411|     if (descClamp.truncated) {
 412|       warnings.push(`Product "${productName || ext}": Description exceeds ${CCRS_PRODUCT_DESCRIPTION_MAX} chars and was truncated — shorten it in the source.`);
 413|     }
 414| 
 415|     // E9 / E10 — for Usable Cannabis and Cannabis Mix Packaged ONLY, the guide
 416|     // makes UnitWeightGrams and Description mandatory:
 417|     //   [G L0489-L0490] "required when InventoryType = Useable cannabis, or
```

`src/lib/compliance/ccrs-batch.ts` L424-L500 — buildCcrsBatch (part 1) — license/Supabase guards E1/E2; published menu; lots pagedAll excluding status=destroyed.

```ts
 424|     for (const found of productRowIssues({
 425|       id: ext,
 426|       label: nameClamp.value || ext,
 427|       inventoryType: type,
 428|       unitWeightGrams: grams,
 429|       description: descClamp.value,
 430|     })) {
 431|       if (found.code === "E9_UNITWEIGHT_ZERO_USABLE") e9Rows.push(found.row);
 432|       else e10Rows.push(found.row);
 433|     }
 434| 
 435|     rows.push([
 436|       license,
 437|       category,
 438|       type,
 439|       nameClamp.value,
 440|       descClamp.value,
 441|       grams,
 442|       ext,
 443|       createdBy,
 444|       createdDate,
 445|       "",
 446|       "",
 447|       "Insert",
 448|     ]);
 449|     keys.push(key);
 450|   }
 451|   if (rows.length === 0) warnings.push("No products found in the published menu.");
 452|   // Cap the warning noise (errors first so critical mapping issues aren't buried).
 453|   const unique = [...new Set(warnings)];
 454|   const errorsFirst = [
 455|     ...unique.filter((w) => w.startsWith("ERROR")),
 456|     ...unique.filter((w) => !w.startsWith("ERROR")),
 457|   ];
 458|   const dedupWarnings = errorsFirst.slice(0, 30);
 459|   const issues: CcrsSyncIssue[] = [];
 460|   if (e9Rows.length > 0) {
 461|     issues.push({
 462|       severity: "error",
 463|       file: "Product",
 464|       code: "E9_UNITWEIGHT_ZERO_USABLE",
 465|       specPin: specPinFor("E9_UNITWEIGHT_ZERO_USABLE"),
 466|       count: e9Rows.length,
 467|       rows: e9Rows,
 468|       message: `${e9Rows.length} Usable Cannabis / Cannabis Mix Packaged product(s) have no unit weight. CCRS rejects the Product file — "If Useable Cannabis is selected,
 469|     });
 470|   }
 471|   if (e10Rows.length > 0) {
 472|     issues.push({
 473|       severity: "error",
 474|       file: "Product",
 475|       code: "E10_DESCRIPTION_REQUIRED",
 476|       specPin: specPinFor("E10_DESCRIPTION_REQUIRED"),
 477|       count: e10Rows.length,
 478|       rows: e10Rows,
 479|       message: `${e10Rows.length} Usable Cannabis / Cannabis Mix Packaged product(s) have no Description, which CCRS requires for those two types [G L0482-L0483]. Add a s
 480|     });
 481|   }
 482|   return { rows, warnings: dedupWarnings, nameByProductKey, keys, issues };
 483| }
 484| 
 485| function buildInventoryFile(
 486|   lots: LotRow[],
 487|   license: string,
 488|   createdBy: string,
 489|   plan: LedgerPlan,
 490| ): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[] } {
 491|   const warnings: string[] = [];
 492|   const rows: string[][] = [];
 493|   // S-02 coded pre-flight errors. Rows are collected, never capped.
 494|   const e7Rows: CcrsIssueRow[] = [];
 495|   const e8Rows: CcrsIssueRow[] = [];
 496|   // S-10: a lot with NO assigned ccrs_inventory_external_id is withheld, never
 497|   // given an id invented at export time (standing rule 3). Every receiving-
 498|   // intake and Cultivera-import lot is assigned one when it is created, so this
 499|   // only fires on an anomaly — exactly the lot an employee must look at.
 500|   const e3Rows: CcrsIssueRow[] = [];
```

`src/lib/compliance/ccrs-batch.ts` L540-L652 — buildCcrsBatch (part 2) — InventoryTransfer emitted EMPTY with an explanatory note (guide p.33 L1162 says it 'is required weekly by any licensed facility that receives inventory'); sort; E3; orphan products; verifySaleNumericColumns; WARNING_CAP_PER_FILE.

```ts
 540|     // references it fails too (CCRS accepts row-by-row: U-17 CLOSED FALSE,
 541|     // PREprod P20261005A/P20261006A, Brian A24).
 542|     const initialQty = l.received_qty ?? 0;
 543|     const onHandQty = l.on_hand_qty ?? 0;
 544|     const verdict = inventoryRowVerdict({
 545|       id: l.id,
 546|       label: l.lot_code ?? ext,
 547|       initialQty,
 548|       onHandQty,
 549|       totalCostMinorUnits: totalCostMinor,
 550|       isSample: l.is_sample === true,
 551|     });
 552|     if (!verdict.emit) {
 553|       if (verdict.code === "E8_ONHAND_GT_INITIAL") e8Rows.push(verdict.row);
 554|       else e7Rows.push(verdict.row);
 555|       continue;
 556|     }
 557| 
 558|     rows.push([
 559|       license,
 560|       strain,
 561|       area,
 562|       productName,
 563|       String(l.received_qty ?? 0),
 564|       String(l.on_hand_qty ?? 0),
 565|       verdict.totalCost,
 566|       "FALSE", // IsMedical — medical exemptions are tracked per-sale, not per-lot
 567|       ext,
 568|       createdBy,
 569|       // SLICE 2 — report the day the lot was ACTUALLY received when we can
 570|       // evidence it. This used to be `ccrsDate(l.created_at)` unconditionally;
 571|       // for a lot whose POS export had a blank Received date, created_at is
 572|       // the instant the migration ran, so the LCB was being told the lot was
 573|       // created on import day. ccrsInventoryCreatedDate() prefers the
 574|       // evidenced received_on and falls back to created_at only when the date
 575|       // is genuinely unknown — and those lots are flagged for the owner rather
 576|       // than quietly given a manufactured date.
 577|       //
 578|       // This is a no-op for the ~3,977 lots that DID carry a received date:
 579|       // SLICE 1 already set their created_at to noon UTC on that same day, so
 580|       // the emitted MM/DD/YYYY is byte-identical.
 581|       ccrsDate(ccrsInventoryCreatedDate(l)),
 582|       "",
 583|       "",
 584|       planned.op,
 585|     ]);
 586|     // S-10: filed ids carry dots (4,295 in the LCB delivery) and are legal
 587|     // [G L0224]; only CSV-breaking characters and > 100 chars are flagged.
 588|     const idErrs = validatePassThroughExternalId(ext);
 589|     if (idErrs.length) warnings.push(`Inventory id "${ext}" ${idErrs.join(", ")}.`);
 590|   }
 591|   if (rows.length === 0) warnings.push("No inventory lots found to report.");
 592|   const issues: CcrsSyncIssue[] = [];
 593|   if (e3Rows.length > 0) {
 594|     issues.push({
 595|       severity: "error",
 596|       file: "Inventory",
 597|       code: "E3_EXTERNAL_ID_UNASSIGNED",
 598|       specPin: specPinFor("E3_EXTERNAL_ID_UNASSIGNED"),
 599|       count: e3Rows.length,
 600|       rows: e3Rows,
 601|       message: `${e3Rows.length} lot(s) have no CCRS inventory identifier assigned, so they were left out of Inventory.csv. ExternalIdentifier is required on every row [G
 602|     });
 603|   }
 604|   if (e41Rows.length > 0) {
 605|     issues.push({
 606|       severity: "error",
 607|       file: "Inventory",
 608|       code: "E41_LEDGER_WITHHELD",
 609|       specPin: specPinFor("E41_LEDGER_WITHHELD"),
 610|       count: e41Rows.length,
 611|       rows: e41Rows,
 612|       message: `${e41Rows.length} lot(s) were left out of Inventory.csv because we cannot prove what CCRS holds for them. Insert creates a record and Update alters "an ex
 613|     });
 614|   }
 615|   if (e8Rows.length > 0) {
 616|     issues.push({
 617|       severity: "error",
 618|       file: "Inventory",
 619|       code: "E8_ONHAND_GT_INITIAL",
 620|       specPin: specPinFor("E8_ONHAND_GT_INITIAL"),
 621|       count: e8Rows.length,
 622|       rows: e8Rows,
 623|       message: `${e8Rows.length} lot(s) report more on hand than were ever received. CCRS rejects the Inventory file with "QuanityOnHand is greater than InitialQuantity" 
 624|     });
 625|   }
 626|   if (e7Rows.length > 0) {
 627|     issues.push({
 628|       severity: "error",
 629|       file: "Inventory",
 630|       code: "E7_TOTALCOST_ZERO",
 631|       specPin: specPinFor("E7_TOTALCOST_ZERO"),
 632|       count: e7Rows.length,
 633|       rows: e7Rows,
 634|       message: `${e7Rows.length} lot(s) have no cost, so TotalCost would be 0 and CCRS rejects the Inventory file ("TotalCost cannot equal 0" [G L0614]). Enter the unit c
 635|     });
 636|   }
 637|   return { rows, warnings: [...new Set(warnings)].slice(0, 25), issues };
 638| }
 639| 
 640| // ---------------------------------------------------------------------------
 641| // The full batch
 642| // ---------------------------------------------------------------------------
 643| 
 644| export async function buildCcrsBatch(fromISO: string, toISO: string): Promise<CcrsBatch> {
 645|   const license = await getCcrsLicenseSettings();
 646|   const submittedBy = license.submittedBy || "Greenway";
 647|   const createdBy = submittedBy;
 648|   const now = new Date();
 649|   const createdDate = ccrsDate(now);
 650|   const syncIssues: CcrsSyncIssue[] = [];
 651| 
 652|   const emptyBatch = (): CcrsBatch => ({
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
  78| 
  79| /** Build the CcrsWeek whose start-Sunday is `startIso` (must be a Sunday). PURE. */
  80| export function weekFromStart(startIso: string): CcrsWeek {
  81|   const start = weekStartFor(startIso); // normalize defensively
  82|   const end = addDaysIso(start, 6);
  83|   return { start, end, due: addDaysIso(end, 1), key: `W-${start}` };
  84| }
  85| 
  86| /** The week CONTAINING `dateIso` (may still be in progress). PURE. */
  87| export function weekContaining(dateIso: string): CcrsWeek {
  88|   return weekFromStart(weekStartFor(dateIso));
  89| }
  90| 
  91| /**
  92|  * The most recently COMPLETED Sun–Sat week as of `todayIso` — the week whose
  93|  * report is currently owed. On a Sunday this is the week that ended yesterday
  94|  * (its report is due TODAY). PURE.
  95|  */
  96| export function lastCompletedWeek(todayIso: string): CcrsWeek {
  97|   return weekFromStart(addDaysIso(weekStartFor(todayIso), -7));
  98| }
  99| 
 100| /** `W-YYYY-MM-DD` key → CcrsWeek (null when malformed). PURE. */
 101| export function weekFromKey(key: string): CcrsWeek | null {
 102|   if (!/^W-\d{4}-\d{2}-\d{2}$/.test(key)) return null;
 103|   const start = key.slice(2);
 104|   if (parseIsoDate(start) === null || isoWeekday(start) !== 0) return null;
 105|   return weekFromStart(start);
 106| }
 107| 
 108| // ── Week status ─────────────────────────────────────────────────────────────
 109| 
 110| /**
 111|  * How a completed week was resolved. Per the LCB FAQ, a week with no new
 112|  * activity requires NO upload — but recording that someone VERIFIED there was
 113|  * nothing to report is what makes the ledger audit-defensible.
 114|  */
 115| export type WeekResolution = "submitted" | "nothing_to_report";
 116| 
 117| export type WeekStatus =
 118|   | "in_progress" // the week is still running (its report isn't owed yet)
 119|   | "open" // completed, before the due day (early submission window)
 120|   | "due_today" // today IS the due Sunday and the week is unresolved
 121|   | "overdue" // past the due Sunday and unresolved
 122|   | "submitted" // resolved: files uploaded to CCRS
 123|   | "nothing_to_report"; // resolved: verified no new activity that week
 124| 
 125| export type WeekDeadline = {
 126|   week: CcrsWeek;
 127|   status: WeekStatus;
 128|   /** Signed days from today to the due date (negative once overdue). */
 129|   daysUntilDue: number;
 130|   resolution: WeekResolution | null;
 131| };
 132| 
 133| /**
 134|  * Status of one week relative to `todayIso` given its resolution (or null).
 135|  * PURE.
 136|  */
 137| export function weekDeadline(
 138|   week: CcrsWeek,
 139|   todayIso: string,
 140|   resolution: WeekResolution | null,
```

`src/lib/compliance/ccrs-week-core.ts` L213-L260 — ReminderStage + planWeeklyReminders

```ts
 213|  * Each reminder carries a dedupe key so a re-run cron can never double-send.
 214|  */
 215| export type ReminderStage = "thursday_heads_up" | "saturday_wrap" | "sunday_due" | "overdue_daily";
 216| 
 217| export type PlannedReminder = {
 218|   stage: ReminderStage;
 219|   /** Week the reminder is about. */
 220|   weekKey: string;
 221|   /** Unique send-once key. overdue_daily includes the date so it repeats daily. */
 222|   dedupeKey: string;
 223|   /** Plain-language subject line seed. */
 224|   subject: string;
 225|   /** Plain-language body seed (the sender may add links/formatting). */
 226|   body: string;
 227|   urgency: "info" | "warning" | "critical";
 228| };
 229| 
 230| /**
 231|  * Which weekly reminders should fire on `todayIso` given the resolution map.
 232|  * Deterministic + idempotent per day. PURE.
 233|  */
 234| export function planWeeklyReminders(
 235|   todayIso: string,
 236|   resolutions: ReadonlyMap<string, WeekResolution> | Record<string, WeekResolution>,
 237|   opts?: { lookbackWeeks?: number },
 238| ): PlannedReminder[] {
 239|   const out: PlannedReminder[] = [];
 240|   const dow = isoWeekday(todayIso);
 241|   const overview = weeklyDeadlineOverview(todayIso, resolutions, opts);
 242| 
 243|   if (dow === 4) {
 244|     // Thursday heads-up about the running week.
 245|     const wk = overview.current.week;
 246|     out.push({
 247|       stage: "thursday_heads_up",
 248|       weekKey: wk.key,
 249|       dedupeKey: `thursday_heads_up:${wk.key}`,
 250|       subject: `CCRS heads-up: reporting week ends Saturday ${wk.end}`,
 251|       body:
 252|         `The current CCRS reporting week (${wk.start} – ${wk.end}) closes Saturday. ` +
 253|         `The upload deadline is Sunday ${wk.due}. You can generate and upload the batch early from the Compliance Command Center.`,
 254|       urgency: "info",
 255|     });
 256|   }
 257| 
 258|   if (dow === 6) {
 259|     // Saturday wrap — the week closes tonight.
 260|     const wk = overview.current.week;
```

`src/lib/compliance/ccrs-week-store.ts` L40-L157 — listWeekSubmissions, getWeekResolutions, getWeeklyOverview, resolveWeek, unresolveWeek, setWeekErrorStatus

```ts
  40| 
  41| const ROW_COLUMNS =
  42|   "id, week_key, week_start, week_end, due_date, resolution, resolved_at, " +
  43|   "resolved_by_email, on_time, files_json, total_records, error_status, error_notes, notes";
  44| 
  45| /** Recent ledger rows, newest week first. */
  46| export async function listWeekSubmissions(limit = 12): Promise<WeekSubmissionRow[]> {
  47|   if (!isSupabaseServiceConfigured) return [];
  48|   try {
  49|     const admin = createSupabaseAdminClient();
  50|     const { data } = await admin
  51|       .from("ccrs_week_submissions")
  52|       .select(ROW_COLUMNS)
  53|       .order("week_start", { ascending: false })
  54|       .limit(Math.min(Math.max(limit, 1), 60));
  55|     return (data as WeekSubmissionRow[] | null) ?? [];
  56|   } catch {
  57|     return [];
  58|   }
  59| }
  60| 
  61| /** week_key → resolution map for the deadline engine. */
  62| export async function getWeekResolutions(lookbackWeeks = 8): Promise<Map<string, WeekResolution>> {
  63|   const out = new Map<string, WeekResolution>();
  64|   const rows = await listWeekSubmissions(Math.max(lookbackWeeks, 8));
  65|   for (const r of rows) out.set(r.week_key, r.resolution);
  66|   return out;
  67| }
  68| 
  69| /** The full weekly deadline picture as of today (Pacific). */
  70| export async function getWeeklyOverview(opts?: { lookbackWeeks?: number }): Promise<WeeklyOverview> {
  71|   const lookbackWeeks = opts?.lookbackWeeks ?? 4;
  72|   const resolutions = await getWeekResolutions(lookbackWeeks);
  73|   return weeklyDeadlineOverview(pacificToday(), resolutions, { lookbackWeeks });
  74| }
  75| 
  76| /**
  77|  * Resolve a week: record 'submitted' (with the generated files summary) or
  78|  * 'nothing_to_report'. Upserts on week_key so a correction overwrites the
  79|  * previous resolution rather than duplicating it.
  80|  */
  81| export async function resolveWeek(opts: {
  82|   weekKey: string;
  83|   resolution: WeekResolution;
  84|   byId: string | null;
  85|   byEmail: string | null;
  86|   files?: { type: string; fileName: string; recordCount: number }[];
  87|   totalRecords?: number;
  88|   notes?: string | null;
  89| }): Promise<{ ok: boolean; error?: string }> {
  90|   if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  91|   const week = weekFromKey(opts.weekKey);
  92|   if (!week) return { ok: false, error: "Invalid week key." };
  93|   // A week can only be resolved once it has COMPLETED (today past its end).
  94|   const today = pacificToday();
  95|   if (today <= week.end) {
  96|     return { ok: false, error: "This reporting week is still in progress — it can be resolved after Saturday." };
  97|   }
  98|   try {
  99|     const admin = createSupabaseAdminClient();
 100|     const { error } = await admin.from("ccrs_week_submissions").upsert(
 101|       {
 102|         week_key: week.key,
 103|         week_start: week.start,
 104|         week_end: week.end,
 105|         due_date: week.due,
 106|         resolution: opts.resolution,
 107|         resolved_at: new Date().toISOString(),
 108|         resolved_by: opts.byId,
 109|         resolved_by_email: opts.byEmail,
 110|         on_time: today <= week.due,
 111|         files_json: opts.resolution === "submitted" ? (opts.files ?? []) : null,
 112|         total_records: opts.resolution === "submitted" ? (opts.totalRecords ?? 0) : 0,
 113|         notes: opts.notes ?? null,
 114|       },
 115|       { onConflict: "week_key" },
 116|     );
 117|     if (error) return { ok: false, error: error.message };
 118|     return { ok: true };
 119|   } catch (e) {
 120|     return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
 121|   }
 122| }
 123| 
 124| /** Un-resolve a week (undo a mistaken sign-off). */
 125| export async function unresolveWeek(weekKey: string): Promise<{ ok: boolean; error?: string }> {
 126|   if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
 127|   if (!weekFromKey(weekKey)) return { ok: false, error: "Invalid week key." };
 128|   try {
 129|     const admin = createSupabaseAdminClient();
 130|     const { error } = await admin.from("ccrs_week_submissions").delete().eq("week_key", weekKey);
 131|     if (error) return { ok: false, error: error.message };
 132|     return { ok: true };
 133|   } catch (e) {
 134|     return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
 135|   }
 136| }
 137| 
 138| /** Flag / clear an error-email status on a submitted week. */
 139| export async function setWeekErrorStatus(opts: {
 140|   weekKey: string;
 141|   errorStatus: "clean" | "errors_reported" | "resolved";
 142|   errorNotes?: string | null;
 143| }): Promise<{ ok: boolean; error?: string }> {
 144|   if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
 145|   if (!weekFromKey(opts.weekKey)) return { ok: false, error: "Invalid week key." };
 146|   try {
 147|     const admin = createSupabaseAdminClient();
 148|     const { error } = await admin
 149|       .from("ccrs_week_submissions")
 150|       .update({ error_status: opts.errorStatus, error_notes: opts.errorNotes ?? null })
 151|       .eq("week_key", opts.weekKey);
 152|     if (error) return { ok: false, error: error.message };
 153|     return { ok: true };
 154|   } catch (e) {
 155|     return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
 156|   }
 157| }
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
  60| };
  61| 
  62| /**
  63|  * The default warning classifier. A warning whose message begins with "ERROR"
  64|  * (case-insensitive) is BLOCKING; everything else is advisory. This mirrors the
  65|  * app's existing `classifyWarning` in ccrs-batch-core. Injectable for testing
  66|  * and so callers can pass the real one to stay perfectly in sync.
  67|  */
  68| export function defaultClassifyWarning(message: string | null | undefined): GateSeverity {
  69|   const m = (message ?? "").trim().toLowerCase();
  70|   return m.startsWith("error") ? "error" : "warning";
  71| }
  72| 
  73| /**
  74|  * Compute the submit verdict. PURE. Pass the real `classifyWarning` from
  75|  * ccrs-batch-core to keep classification identical to the rest of the app.
  76|  */
  77| export function assertCcrsBatchSubmittable(input: {
  78|   syncIssues: readonly GateIssueInput[];
  79|   verifierProblems: readonly GateIssueInput[];
  80|   files: readonly GateFileInput[];
  81|   classifyWarning?: (message: string | null | undefined) => GateSeverity;
  82| }): CcrsSubmitVerdict {
  83|   const classify = input.classifyWarning ?? defaultClassifyWarning;
  84|   const collected: GateIssue[] = [];
  85| 
  86|   for (const s of input.syncIssues) {
  87|     collected.push({
  88|       severity: s.severity,
  89|       file: String(s.file),
  90|       message: s.message,
  91|       count: s.count,
  92|       source: "sync",
  93|     });
  94|   }
  95|   for (const p of input.verifierProblems) {
  96|     collected.push({
  97|       severity: p.severity,
  98|       file: String(p.file),
  99|       message: p.message,
 100|       count: p.count,
 101|       source: "verifier",
 102|     });
 103|   }
 104|   for (const f of input.files) {
 105|     for (const w of f.warnings) {
 106|       collected.push({
 107|         severity: classify(w),
 108|         file: String(f.type),
 109|         message: w,
 110|         source: "file-warning",
 111|       });
 112|     }
 113|   }
 114| 
 115|   // De-duplicate identical (severity+file+message) lines.
 116|   const seen = new Set<string>();
 117|   const deduped = collected.filter((i) => {
 118|     const k = `${i.severity}|${i.file}|${i.message}`;
 119|     if (seen.has(k)) return false;
 120|     seen.add(k);
 121|     return true;
 122|   });
 123| 
 124|   const errors = deduped.filter((i) => i.severity === "error");
 125|   const warnings = deduped.filter((i) => i.severity === "warning");
 126| 
 127|   return {
 128|     submittable: errors.length === 0,
 129|     errorCount: errors.length,
 130|     warningCount: warnings.length,
 131|     errors,
 132|     warnings,
 133|     issues: [...errors, ...warnings],
 134|   };
 135| }
 136| 
 137| /** A short human summary line for banners/logs. PURE. */
 138| export function verdictSummary(v: CcrsSubmitVerdict): string {
 139|   if (v.submittable) {
 140|     return v.warningCount > 0
 141|       ? `Safe to submit — ${v.warningCount} advisory warning(s) to review.`
 142|       : "Safe to submit — no problems detected.";
 143|   }
 144|   return `DO NOT UPLOAD — ${v.errorCount} blocking error(s) must be fixed first.`;
 145| }
 146| 
 147| // ── Self-tests (tsx) ────────────────────────────────────────────────────────
 148| 
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

`src/lib/inventory/disposition.ts` L455-L480 — createCustomerReturn contract (FAQ: 'sale identifier should be deleted … inventory identifier reported on an Inventory Adjustment as a return')

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

`src/lib/inventory/disposition.ts` L595-L630 — CCRS Sale-row snapshot + medical mirror

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

`src/lib/inventory/disposition.ts` L675-L705 — postAddition 'return' + destroy branch

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

`src/lib/inventory/disposition.ts` L780-L800 — createVendorReturn (reducing 'other' adjustment)

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

`src/lib/inventory/disposition.ts` L968-L985 — completeDestruction head ('destruction')

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
  45|   posProductKey: string;
  46|   /** Card display name (messages only). */
  47|   itemName: string;
  48|   /** Cultivera Barcode — the CCRS-filed inventory identifier. */
  49|   barcode: string;
  50|   /** Raw Product cell. */
```

`src/lib/pos/import-lot-core.ts` L78-L83 — lot_code = barcode; ccrsExternalId = sanitized barcode

```ts
  78|    * R15a: raw potency columns for THIS row (Total / Thc / Thca / Cbd / Cbda).
  79|    * Optional so older callers/tests keep compiling; absent = unknown.
  80|    */
  81|   totalRaw?: number | null;
  82|   thcRaw?: number | null;
  83|   thcaRaw?: number | null;
```

`src/lib/pos/import-lot-core.ts` L416-L426 — L420: ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode

```ts
 416| function lotNote(opts: { receivedOn: string | null; coaPresent: boolean; merged: number }): string {
 417|   const parts: string[] = ["Cultivera migration (one-time POS import)."];
 418|   parts.push(opts.receivedOn ? `Received ${opts.receivedOn}.` : "Received date missing in POS export.");
 419|   parts.push(
 420|     opts.coaPresent
 421|       ? "COA on file per POS export (attach the document during enrichment)."
 422|       : "COA flag N in POS export — obtain and attach the COA during enrichment.",
 423|   );
 424|   if (opts.merged > 1) parts.push(`Merged ${opts.merged} POS rows sharing this barcode.`);
 425|   parts.push("Expiration date not provided by POS export — set during enrichment.");
 426|   return parts.join(" ");
```

`src/lib/pos/import-service.ts` L440-L460 — Dedupe by ccrs_inventory_external_id; why imported lots are 'active' (already reported by Cultivera as integrator)

```ts
 440|       serverItemCount,
 441|       observedReviews: reviewsResult.reviews.length,
 442|       reviewsReadFailed: !reviewsResult.ok,
 443|     }, { acknowledgedPendingCount: options.acknowledgedPendingCount ?? null });
 444|     if (!gate.ready) throw new Error(gate.message);
 445|     openReviewsAcknowledged = gate.openReviewsAcknowledged;
 446|     // Persist the balanced equation so the audit trail shows exactly what
 447|     // this publish committed (idempotent by code+import via the review UI).
 448|     await persistDiagnostics(importId, [
 449|       {
 450|         severity: "info",
 451|         code: "import_commit_reconciled",
 452|         message: gate.message,
 453|         // R14a: the acknowledged count rides with the equation so the audit
 454|         // trail shows a "publish now, fix after" commit as exactly that.
 455|         context: { ...gate.reconciliation, openReviewsAcknowledged },
 456|       },
 457|     ]);
 458| 
 459|     // Compliance lots BEFORE the menu swap. Throws on failure → publish aborts.
 460|     await createImportLots(importId, actorId);
```

`src/lib/inventory/intake-store.ts` L650-L668 — Intake writes ccrs_inventory_external_id via deriveInventoryExternalId({pos_product_key, lot_code})

```ts
 650|             category: l.category,
 651|           })),
 652|         )
 653|       ).map((r) => r.websiteCategory);
 654|     } catch (err) {
 655|       console.error("[intake-store] identity inputs failed (staging unaffected):", err);
 656|       stampCategories = [];
 657|     }
 658|   }
 659|   // Set once a lot insert proves 0234 is not applied: stop sending the column.
 660|   let identityColumnsMissing = false;
 661| 
 662|   // 2) per line: lab_result (if any) + quarantine lot
 663|   for (const [lineIndex, line] of parsed.lines.entries()) {
 664|     let labId: string | null = null;
 665|     if (line.lab) {
 666|       const extId = line.lab.labtest_external_identifier;
 667|       if (extId && labIdCache.has(extId)) {
 668|         labId = labIdCache.get(extId)!;
```

`src/lib/inventory/intake-parser.ts` L368-L416 — WCIA JSON: lot_code ← item.inventory_id (the VENDOR's CCRS InventoryExternalIdentifier); pos_product_key ← sku ?? lot_code

```ts
 368|   }
 369| 
 370|   const product_name = asString(pick(item, ["product_name"]));
 371|   const lot_code = asString(pick(item, ["inventory_id"]));
 372|   const sku = asString(pick(item, ["product_sku"]));
 373|   const qty = asNumber(pick(item, ["qty"])) ?? 0;
 374|   const linePrice = asNumber(pick(item, ["line_price"]));
 375|   const unit = asString(pick(item, ["uom"])) ?? "ea";
 376|   // Rule 1.4 (docs/data-governance.md): split strain TYPE out of the strain
 377|   // NAME at the door — vendor lines like "Chocolate Turtle Sativa" pollute
 378|   // the name box otherwise (real Grow Op Farms / Cultivera behavior).
 379|   const strainSplit = splitStrainField(
 380|     asString(pick(item, ["strain_name"])),
 381|     asString(pick(item, ["strain_type", "strain_class", "phenotype"])),
 382|   );
 383|   const strain = strainSplit.strainName;
 384|   const category = asString(pick(item, ["inventory_category"]));
 385|   const inventory_type = asString(pick(item, ["inventory_type"]));
 386|   const is_sample = asBool(pick(item, ["is_sample"])) === true;
 387|   const is_medical = asBool(pick(item, ["is_medical"])) === true;
 388|   const unit_weight = asNumber(pick(item, ["unit_weight"]));
 389|   const unit_weight_uom = asString(pick(item, ["unit_weight_uom"]));
 390| 
 391|   // Per-unit cost = line_price / qty, in minor units.
 392|   let unit_cost_minor_units: number | null = null;
 393|   if (linePrice != null && qty > 0) {
 394|     unit_cost_minor_units = Math.round((linePrice / qty) * 100);
 395|   } else if (linePrice != null) {
 396|     unit_cost_minor_units = Math.round(linePrice * 100);
 397|   }
 398| 
 399|   const lab = parseWciaLab(item);
 400|   const expires_on = lab?.coa_expire_date ?? null;
 401| 
 402|   if (!product_name) warnings.push("Missing product name.");
 403|   if (qty <= 0 && !is_sample) warnings.push("Quantity is zero or missing.");
 404|   if (!lab) warnings.push("No COA / lab result found — required before sale.");
 405|   else if (!lab.labtest_external_identifier)
 406|     warnings.push("COA has no lab result id (CCRS LabtestexternalIdentifier).");
 407|   if (linePrice === 0 || (linePrice != null && linePrice === 0)) {
 408|     if (!is_sample) warnings.push("$0 line — likely a vendor sample; confirm before selling.");
 409|   }
 410| 
 411|   return {
 412|     product_name,
 413|     lot_code,
 414|     pos_product_key: sku ?? lot_code, // fall back to inventory_id for catalog linking
 415|     brand_name: null, // WCIA carries vendor at the document level, not per line
 416|     category,
```

`src/lib/inventory/intake-parser.ts` L438-L446 — WCIA JSON: manifest_number ← transfer_id/external_id; vendor_label ← from_license_name

```ts
 438| }
 439| 
 440| function parseWcia(root: Obj): ParsedManifest {
 441|   const manifest_number = asString(pick(root, ["transfer_id", "external_id"]));
 442|   const vendor_label = asString(pick(root, ["from_license_name"]));
 443|   const vendor_license = asString(pick(root, ["from_license_number"]));
 444|   const transfer_date = asDate(
 445|     pick(root, ["transferred_at", "est_arrival_at", "created_at"]),
 446|   );
```

`src/lib/inventory/intake-parser.ts` L278-L284 — WCIA detection requires from_license_number (→ vendors.license_number, migration 0064)

```ts
 278|   const items = pick(root, ["inventory_transfer_items"]);
 279|   const hasItems = Array.isArray(items) && items.length > 0;
 280|   const transferId = asString(pick(root, ["transfer_id"]));
 281|   const fromLicense = asString(pick(root, ["from_license_number"]));
 282|   return Boolean(hasItems && transferId && fromLicense);
 283| }
 284| 
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
  26| export async function GET(request: Request) {
  27|   const session = await requirePermission("reports.view");
  28|   if (!can(session.profile.role, "settings.manage")) {
  29|     return new Response("Generating the CCRS batch requires the Change settings permission.", { status: 403 });
  30|   }
  31| 
  32|   const url = new URL(request.url);
  33|   const range = resolveRange({
  34|     from: url.searchParams.get("from") ?? undefined,
  35|     to: url.searchParams.get("to") ?? undefined,
  36|     range: url.searchParams.get("range") ?? undefined,
  37|     year: url.searchParams.get("year") ?? undefined,
  38|   });
  39| 
  40|   const batch = await buildCcrsBatch(range.fromISO, range.toISO);
  41| 
  42|   // Number the files by upload group so the folder sorts in the required order.
  43|   const files = batch.files.map((f, i) => ({
  44|     name: `${String(i + 1).padStart(2, "0")}_${f.fileName}`,
  45|     content: f.csv,
  46|   }));
  47| 
  48|   // Slice 94/95: verify the ASSEMBLED files are byte-correct offline, and merge
  49|   // those findings with the builder sync issues. The dry-run catches structural
  50|   // problems (bad header, NumberRecords mismatch, invalid enum, CRLF, dates).
  51|   const verification = verifyCcrsBatch(
  52|     batch.files.map((f) => ({ type: f.type, csv: f.csv })),
  53|   );
  54| 
  55|   // Slice 105 — AUTHORITATIVE HARD GATE. Consolidate every problem source
  56|   // (builder sync issues + offline verifier problems + per-file warnings, the
  57|   // last classified with the SAME classifyWarning the app trusts) into one
  58|   // verdict. If ANY blocking error exists, we REFUSE to emit the .zip — the
  59|   // malformed CSVs never leave the building. This is the difference between
  60|   // "we warned you" and "we protected you."
  61|   const verdict = assertCcrsBatchSubmittable({
  62|     syncIssues: batch.syncIssues.map((s) => ({
  63|       severity: s.severity,
  64|       file: String(s.file),
  65|       message: s.message,
  66|       count: s.count,
  67|     })),
  68|     verifierProblems: verification.problems.map((p) => ({
  69|       severity: p.severity,
  70|       file: String(p.file),
```

`src/app/admin/reports/compliance/batch-export/route.ts` L130-L145 — zip name CCRS_batch_<license>_<from>_<to>.zip

```ts
 130|     "",
 131|     warnings.length ? `Advisory warnings (${warnings.length}):` : "No advisory warnings.",
 132|     ...warnings.map(fmt),
 133|   ].join("\r\n");
 134|   files.push({ name: "00_README.txt", content: readme + "\r\n" });
 135| 
 136|   const zip = buildZip(files, new Date(batch.generatedAt));
 137|   const zipName = `CCRS_batch_${batch.licenseNumber || "LICENSE"}_${range.fromDate}_${range.toDate}.zip`;
 138| 
 139|   return new Response(new Uint8Array(zip), {
 140|     headers: {
 141|       "Content-Type": "application/zip",
 142|       "Content-Disposition": `attachment; filename="${zipName}"`,
 143|       "Cache-Control": "no-store",
 144|     },
 145|   });
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
  28| 
  29| export async function GET() {
  30|   const session = await requirePermission("inventory.manage");
  31| 
  32|   const license = await getCcrsLicenseSettings();
  33|   const rows: string[][] = [];
  34|   const includedIds: string[] = [];
  35|   const skipped: string[] = [];
  36| 
  37|   if (isSupabaseServiceConfigured) {
  38|     try {
  39|       const admin = createSupabaseAdminClient();
  40|       const { data } = await admin
```

`src/app/admin/inventory/disposition/sale-correction-export/route.ts` L74-L82 — markCorrectionsExported after download

```ts
  74|     }
  75|   }
  76| 
  77|   // S-09 E38 / S-09b E42: a correction carrying a line break or comma cannot
  78|   // be one CCRS record (CCRS splits on every comma). A `"` is fine (S-09c).
  79|   // Withhold it and leave it PENDING (never marked exported) so it is fixed
  80|   // and re-sent, not lost. rows[i] belongs to includedIds[i].
  81|   const e38 = withholdUnencodableRows(rows, CCRS_COLUMNS.Sale, (_r, i) => includedIds[i]);
  82|   const withheldIds = new Set(e38.withheld.map((w) => w.label));
```

`src/app/admin/compliance/ccrs/page.tsx` L81-L110 — CcrsCommandCenterPage head

```ts
  81| export default async function CcrsCommandCenterPage({
  82|   searchParams,
  83| }: {
  84|   searchParams: Promise<{ week?: string; saved?: string; error?: string }>;
  85| }) {
  86|   const session = await requirePermission("reports.view");
  87|   const canEdit = can(session.profile.role, "settings.manage");
  88|   const sp = await searchParams;
  89|   const todayIso = pacificToday();
  90| 
  91|   // ── Weekly deadline picture ────────────────────────────────────────────────
  92|   const overview = await getWeeklyOverview({ lookbackWeeks: 6 });
  93|   const ledger = isSupabaseServiceConfigured ? await listWeekSubmissions(12) : [];
  94| 
  95|   // Selected week: explicit ?week= → most urgent unresolved → last completed.
  96|   const requested = sp.week ? weekFromKey(sp.week) : null;
  97|   const selectedDeadline: WeekDeadline =
  98|     (requested
  99|       ? [...overview.weeks, overview.current].find((w) => w.week.key === requested.key)
 100|       : null) ??
 101|     overview.mostUrgent ??
 102|     overview.weeks[0] ??
 103|     overview.current;
 104|   const week = selectedDeadline.week;
 105|   const weekCompleted = todayIso > week.end;
 106|   const ledgerRow = ledger.find((r) => r.week_key === week.key) ?? null;
 107| 
 108|   // ── Batch + authoritative gate for the selected week ──────────────────────
 109|   const license = await getCcrsLicenseSettings();
 110|   const range = resolveRange({ from: week.start, to: week.end });
```

`src/app/admin/compliance/ccrs/page.tsx` — hub page section anchors

- L282: `title="Step 1 — Pick the reporting week"`
- L313: `title={`Step 2 — Review week ${week.start} – ${week.end}`}`
- L378: `{batch ? <CcrsAdvisorPanel aiEnabled={isAiConfigured} sp={{ from: week.start, to: week.end }} /> : null}`
- L382: `<UploadWalkthrough`
- L397: `title="Step 3 — Record this week"`
- L522: `<ErrorTriagePanel`
- L532: `title="DOH / Medical sales"`
- L587: `title="Monthly LIQ-1295 (tax report)"`
- L617: `<PushRemindersPanel />`
- L626: `<Section title="Submission ledger" subtitle="Newest first. This is the evidence trail.">`

`src/app/admin/compliance/ccrs/actions.ts` — server actions

- L11: `import { revalidatePath } from "next/cache";`
- L13: `import { requirePermission } from "@/lib/auth/session";`
- L27: `export async function resolveWeekAction(formData: FormData): Promise<void> {`
- L28: `const session = await requirePermission("settings.manage");`
- L77: `revalidatePath(BASE);`
- L82: `export async function unresolveWeekAction(formData: FormData): Promise<void> {`
- L83: `const session = await requirePermission("settings.manage");`
- L99: `revalidatePath(BASE);`
- L104: `export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {`
- L105: `const session = await requirePermission("settings.manage");`
- L133: `revalidatePath(BASE);`

`src/components/admin/compliance/UploadWalkthrough.tsx` L26-L35 — PORTAL_URL + WAIT_MINUTES constants

```ts
  26|   batchZipHref: string;
  27|   submittable: boolean;
  28| };
  29| 
  30| const PORTAL_URL = "https://cannabisreporting.lcb.wa.gov";
  31| const WAIT_MINUTES = 10;
  32| 
  33| type StepId =
  34|   | "download"
  35|   | "signin"
```

`src/components/admin/compliance/UploadWalkthrough.tsx` L144-L256 — steps array (8 steps) — the current human upload procedure encoded in UI

```ts
 144|   const steps: { id: StepId; title: string; body: React.ReactNode; locked?: boolean; lockNote?: string }[] = [
 145|     {
 146|       id: "download",
 147|       title: "Download the validated batch (.zip)",
 148|       body: (
 149|         <div>
 150|           <p className="text-xs text-white/55">
 151|             The zip contains every file numbered in upload order with correct CCRS filenames and
 152|             headers. It only downloads when validation passes.
 153|           </p>
 154|           <a
 155|             href={batchZipHref}
 156|             className={`mt-2 inline-block rounded-lg px-3 py-1.5 text-xs font-bold transition ${
 157|               submittable
 158|                 ? "bg-[var(--admin-accent)] text-black hover:opacity-90"
 159|                 : "cursor-not-allowed border border-white/10 text-white/30"
 160|             }`}
 161|             aria-disabled={!submittable}
 162|             onClick={(e) => {
 163|               if (!submittable) e.preventDefault();
 164|             }}
 165|           >
 166|             {submittable ? "Download batch zip" : "Blocked — fix validation errors first"}
 167|           </a>
 168|         </div>
 169|       ),
 170|     },
 171|     {
 172|       id: "signin",
 173|       title: "Sign in to the CCRS portal",
 174|       body: (
 175|         <p className="text-xs text-white/55">
 176|           Open{" "}
 177|           <a href={PORTAL_URL} target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] underline">
 178|             cannabisreporting.lcb.wa.gov
 179|           </a>{" "}
 180|           and sign in with your SecureAccess Washington (SAW) account. (The LCB is moving CCRS to
 181|           WA.gov login around Oct 2026.)
 182|         </p>
 183|       ),
 184|     },
 185|     {
 186|       id: "group1",
 187|       title: "Upload Group 1 — Strain, Area, Product",
 188|       body: (
 189|         <div>
 190|           <p className="text-xs text-white/55">
 191|             Upload these first; Inventory depends on them. Empty files can be skipped.
 192|           </p>
 193|           {fileList(group1)}
 194|         </div>
 195|       ),
 196|     },
 197|     {
 198|       id: "wait1",
 199|       title: `Wait ${WAIT_MINUTES} minutes (CCRS dependency processing)`,
 200|       locked: !state.done.group1,
 201|       lockNote: "Check off Group 1 first — the timer starts automatically.",
 202|       body: state.done.group1 ? (
 203|         g1Remaining > 0 ? (
 204|           <p className="text-xs font-semibold text-amber-300">
 205|             ⏱ {fmtRemaining(g1Remaining)} remaining — CCRS needs time to process Group 1 before
 206|             Inventory can reference it.
 207|           </p>
 208|         ) : (
 209|           <p className="text-xs font-semibold text-emerald-300">
 210|             ✓ 10 minutes have passed — safe to upload Inventory.
 211|           </p>
 212|         )
 213|       ) : null,
 214|     },
 215|     {
 216|       id: "group2",
 217|       title: "Upload Group 2 — Inventory",
 218|       locked: Boolean(state.done.group1 && g1Remaining > 0),
 219|       lockNote: "Wait for the 10-minute timer above before uploading Inventory.",
 220|       body: fileList(group2),
 221|     },
 222|     {
 223|       id: "wait2",
 224|       title: `Wait ${WAIT_MINUTES} minutes again`,
 225|       locked: !state.done.group2,
 226|       lockNote: "Check off Group 2 first — the timer starts automatically.",
 227|       body: state.done.group2 ? (
 228|         g2Remaining > 0 ? (
 229|           <p className="text-xs font-semibold text-amber-300">
 230|             ⏱ {fmtRemaining(g2Remaining)} remaining before Group 3.
 231|           </p>
 232|         ) : (
 233|           <p className="text-xs font-semibold text-emerald-300">✓ Safe to upload Group 3.</p>
 234|         )
 235|       ) : null,
 236|     },
 237|     {
 238|       id: "group3",
 239|       title: "Upload Group 3 — InventoryAdjustment, InventoryTransfer, Sale",
 240|       locked: Boolean(state.done.group2 && g2Remaining > 0),
 241|       lockNote: "Wait for the second 10-minute timer before uploading Group 3.",
 242|       body: fileList(group3),
 243|     },
 244|     {
 245|       id: "record",
 246|       title: "Record the submission in the ledger below",
 247|       body: (
 248|         <p className="text-xs text-white/55">
 249|           Scroll to “Record this week” and mark it SUBMITTED — that stops the reminders, stamps
 250|           who/when, and stores the file manifest as evidence. Then watch your email for CCRS error
 251|           notifications (triage panel below).
 252|         </p>
 253|       ),
 254|     },
 255|   ];
 256| 
```

`src/app/admin/reports/compliance/page.tsx` — Reports-tab compliance page (to be retired to a pointer, owner decision Q6)

- L14: `import { LicenseSettingsForm } from "@/components/admin/reports/LicenseSettingsForm";`
- L31: `<section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">`
- L33: `<h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>`
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
- L39: `// cannabis-specific glyphs (🌿 flower, 🧾 receipts, 🛡 compliance) are used where`
- L71: `{ label: "CCRS Benchmarks", href: "/admin/discovery/benchmarks", permission: "inventory.manage", icon: "\ud83d\udcca", group: "Product Intake" }, // 📊`
- L95: `{ label: "Employee Samples", href: "/admin/compliance/samples", permission: "settings.manage", icon: "\ud83e\uddea", group: "Employee" }, // 🧪 trade s`
- L96: `{ label: "Sample History", href: "/admin/compliance/samples/history", permission: "settings.manage", icon: "\ud83d\udccb", group: "Employee" }, // 📋 s`
- L104: `// CCRS: standalone top-header button → the Compliance Command Center (Task W;`
- L107: `{ label: "CCRS Command Center", href: "/admin/compliance/ccrs", permission: "reports.view", icon: "\ud83d\udee1\ufe0f", group: "CCRS" }, // 🛡️ complia`
- L108: `{ label: "Compliance Health", href: "/admin/compliance/health", permission: "reports.view", icon: "\ud83e\ude7a", group: "CCRS" }, // 🩺 health check`
- L109: `{ label: "Regulatory Watch", href: "/admin/compliance/regulatory", permission: "reports.view", icon: "\ud83d\udce1", group: "CCRS" }, // 📡 rule-change`
- L110: `{ label: "Compliance Calendar", href: "/admin/compliance/calendar", permission: "compliance.calendar", icon: "\ud83d\udcc5", group: "Lyman" }, // 📅 S-`
- L183: `{ label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "\u2696\ufe0f", group: "Admin" }, // ⚖️ legal li`
- L188: `{ label: "Sales-Limit Classification", href: "/admin/compliance/classification", permission: "inventory.manage", icon: "\ud83c\udff7\ufe0f", group: "A`
- L205: `"CCRS",`

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

### `tests/compliance/pure-selftests.test.ts` (586 L) — `describe`/`it` titles

- L84: `describe("embedded pure self-test suites", () => {`
- L85: `it("order-pricing-core (S-2/S-3 money math + floor)", () => {`
- L88: `it("discount-engine-core (promotions engine)", () => {`
- L91: `it("brand-match-core (SLICE T1: ONE brand matcher, real catalogue fixtures)", () => {`
- L96: `it("markdown-lock-core (SLICE C1: clearance is excluded from other deals)", () => {`
- L101: `it("brand-resolve-core (rule 11: RECEIVING intake shares the ONE brand matcher)", () => {`
- L106: `it("po-receive-core (defects A+B: auto-receive refuses ambiguous names)", () => {`
- L110: `it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {`
- L114: `it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {`
- L118: `it("weight-label-core (SLICE W1: one grams parser for discounts AND the WAC limit)", () => {`
- L121: `it("promo-guard-core (Task R: CCRS below-cost publish guard)", () => {`
- L124: `it("sales-limits-core (WAC 314-55-095 buckets)", () => {`
- L127: `it("sales-limit-gate-core (S-1 completion gate)", () => {`
- L130: `it("chunked-in (S-7 pagination)", async () => {`
- L133: `it("exempt-sale-record-core (S-8 / WAC 314-55-090(2))", () => {`
- L138: `it("medical/tax (RCW 82.08.9998 + WAC 314-55-090 exemptions, card validity)", () => {`
- L141: `it("medical-authorization-core (DOH 608-048 issuance + validity-at-date)", () => {`
- L146: `it("medical-sale-core (Task O: DOH categories, exemption plan, high-THC gate)", () => {`
- L149: `it("medical-intake-core (Task P: RCW 69.51A.230(4) date rules, age classes, card number)", () => {`
- L154: `it("sales-hours-core (WAC 314-55-147 window)", () => {`
- L157: `it("receipt-core (Pacific timestamps, receipt shape)", () => {`
- L160: `it("pin-hash (S-10 scrypt + throttle)", () => {`
- L163: `it("at-rest-crypto (S-10 AES-256-GCM envelope)", () => {`
- L166: `it("loyalty engine (points math, tiers, code gen)", () => {`
- L169: `it("loyalty-config-core (customizer drafts, RCW discount cap)", () => {`
- L172: `it("loyalty-sale-core (Task S-a: best-deal-wins, code spread, floors)", () => {`
- L175: `it("signup-customer-core (Task V: signup → customer create-or-link)", () => {`
- L178: `it("schedule-core (week math, Pacific)", () => {`
- L181: `it("employee-lifecycle-core (Task S-b: RCW 49.94 order, activation gate, deadlines, sick leave)", () => {`
- L185: `it("user-guards-core (Task S-c: self-rule, rank rule, privilege ceiling, last-owner rule)", () => {`
- L189: `it("campaign-rules-core (Task S-d: WAC 314-55-155 per-channel rules, warnings map)", () => {`
- L193: `it("competitive-playbook-core (Task S-d: legal plays, in-app tool links, guardrails)", () => {`
- L197: `it("midjourney-core (Creative Studio brief -> prompt assembly)", () => {`
- L200: `it("flux-core (Task U: verified per-endpoint FLUX request contracts)", () => {`
- L203: `it("creative-placements-core (Task U: verified destination sizes, 4MP ceiling)", () => {`
- L206: `it("ccrs-week-core (Task W: Sun–Sat week, due next Sunday, reminder planner)", () => {`
- L211: `it("ccrs-deadline-core (Slice 106 + Task W: LIQ-1295 due dates + monthly reminder planner)", () => {`
- L216: `it("ccrs-error-triage-core (Task W: error-email triage + examiner draft)", () => {`
- L224: `it("ccrs-submit-gate-core (S-01/N-06: the upload gate — errors block, warnings do not)", () => {`
- L232: `it("ccrs-preflight-core (S-02: E7-E13 blocking pre-flight checks)", () => {`
- L236: `it("ccrs-ledger-core (Bible v2 S-11: ledger routing, strain casing, filed product name)", () => {`
- L239: `it("menu-feed-core (syndication feed mapping: strain normalize, stock, quantity, image)", () => {`
- L242: `it("leafly-payload-core (Leafly v2 wire format: cents, quantity, null-not-NA)", () => {`
- L245: `it("leafly-payload-validate-core (SLICE L-2: fail-closed last gate before the wire)", () => {`
- L250: `it("leafly-orderability-core (SLICE L-3: fail-closed pickup + DOH/endorsement gates)", () => {`
- L255: `it("leafly-readback-core (SLICE L-4: GET /menu parse + reconcile, fails soft)", () => {`
- L260: `it("leafly-certification-core (SLICE L-4: Leafly's five criteria, fails closed)", () => {`
- L265: `it("leafly-readback-proof-core (SLICE L-52: stored read-back verdict proves criterion 5)", () => {`
- L270: `it("strain-placeholder-core (SLICE L-52: placeholder strains become null)", () => {`
- L275: `it("leafly-readback-baseline-core (SLICE L-52: sync-state rebuild baseline)", () => {`
- L280: `it("leafly-hmac-core (SLICE L-5: raw-body HMAC, timing-safe, fails closed)", () => {`
- L292: `it("leafly-order-map-core (SLICE L-5: status vocabulary in both directions)", () => {`
- L301: `it("leafly-webhook-parse-core (SLICE L-5: fails soft, because the spec demands 200)", () => {`
- L308: `it("leafly-preview-core (SLICE L-5: the money a shopper reads before buying)", () => {`
- L326: `it("leafly-auto-ack-core (SLICE L-33: the machine presses the button)", () => {`
- L352: `it("leafly-auto-ack-sweep-core (SLICE L-33: the net under the net)", () => {`
- L388: `it("leafly-order-ack-core (SLICE L-6: talking back to Leafly, one-way doors)", () => {`
- L423: `it("leafly-schedule-core (SLICE L-7: both automation and the manual button)", () => {`
- L462: `it("leafly-evidence-core (SLICE L-8: the webhook evidence reader)", () => {`
- L483: `it("order-origin-core (SLICE L-2: website vs Leafly vs register)", () => {`
- L495: `it("leafly-bridge-core (SLICE L-10: arrival announces/prints, acceptance creates)", () => {`
- L517: `it("weedmaps-payload-core (Task X: verified Request_MenuItem variants/price/weight)", () => {`
- L524: `it("integration-credentials-core (DB-over-env overrides + masking; L-5 Leafly keys)", () => {`
- L528: `it("sync-plan-core (Task X: payload-hash idempotency + delta sync plan)", () => {`
- L531: `it("preflight-core (Task X: pre-push validation — dup ids, prices, weights)", () => {`
- L534: `it("richness-core (Task X: menu richness scoring + connection health)", () => {`
- L537: `it("sync-settings-core (Task X + L-7: transmission parameters AND the schedule)", () => {`
- L548: `it("apply-settings-core (Task X: owner toggles applied to channel payloads)", () => {`
- L551: `it("syndication-playbook (Task X: verified connect/stay/reconnect playbook + AI grounding)", () => {`
- L554: `it("leafly-order-cart-core (SLICE L-48: changing a Leafly order's items)", () => {`
- L563: `it("leafly-badge-core (Inventory LEAFLY badge)", () => {`
- L568: `it("leafly-register-lines-core (Leafly order -> register cart ids)", () => {`
- L575: `it("outbound-history-core (L-49: Order-API call history, PII-safe display/export)", () => {`
- L580: `it("cart-picker-core (L-50: picker offers only sizes the Leafly payload sends)", () => {`

### Golden fixtures (`tests/compliance/golden/ccrs/`)

- `Area.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Area,IsQuarantine,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation`
- `Inventory.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,Create`
- `InventoryAdjustment.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryExternalIdentifier,AdjustmentReason,AdjustmentDetail,Quantity,AdjustmentDate,ExternalIdentifier,C`
- `InventoryTransfer.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`FromLicenseNumber,ToLicenseNumber,FromInventoryExternalIdentifier,ToInventoryExternalIdentifier,Quantity,TransferDate,Ex`
- `Product.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,`
- `Sale.golden.csv`: rows=7, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPri`
- `Strain.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate`

