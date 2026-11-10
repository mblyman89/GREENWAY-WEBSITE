# 03 — Code Anchor Atlas (generated from the tree)

Generated 2026-11-10 20:03Z at commit `0917405e1490fd189aa27aa67b5dfacb880b7921` by `build_atlas_part.py`.

**Rules for using this part**

1. Every `L####` here was read from the file at the commit above. Before editing, run `git diff 0917405 -- <file>`; if the file changed, re-run the generator and re-pin.
2. Snippets are verbatim. If a snippet here disagrees with the file, the FILE wins and this part must be regenerated — never 'fix' the atlas by hand.
3. Anchors are grouped by the flow they belong to: (A) batch builders, (B) core/pure helpers, (C) identifiers, (D) week/ledger, (E) triage/gate, (F) adjustments & corrections, (G) returns/disposition, (H) intake & Cultivera identity, (I) routes/pages/components, (J) schema.

## 0. Module inventory (line counts + every `export` with its line)

### `src/lib/compliance/ccrs-batch.ts` (2203 L)

- L160: `export type CcrsFile = {`
- L172: `export type CcrsSyncIssue = {`
- L189: `export type CcrsBatch = {`
- L1181: `export async function buildCcrsBatch(`

### `src/lib/compliance/ccrs-batch-core.ts` (1574 L)

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
- L1205: `export function verifyCcrsBatch(`
- L1222: `export function __runCcrsBatchCoreTests(): void {`

### `src/lib/compliance/ccrs-sales.ts` (546 L)

- L51: `export type CcrsLicenseSettings = {`
- L56: `export type CcrsBuildResult = {`
- L95: `export async function getCcrsLicenseSettings(): Promise<CcrsLicenseSettings> {`
- L190: `export async function buildCcrsSaleCsv(fromISO: string, toISO: string): Promise<CcrsBuildResult> {`

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

### `src/lib/compliance/ccrs-error-triage-core.ts` (383 L)

- L15: `export type TriageSeverity = "benign" | "fixable" | "escalate";`
- L17: `export type TriageFinding = {`
- L29: `export type TriageResult = {`
- L175: `export function triageCcrsErrorEmail(pasted: string): TriageResult {`
- L237: `export const LCB_CONTACTS = {`
- L245: `export type ExaminerDraft = {`
- L256: `export function buildExaminerDraft(opts: {`
- L291: `export function __runCcrsErrorTriageTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-submit-gate-core.ts` (379 L)

- L27: `export type GateSeverity = "error" | "warning";`
- L30: `export type GateIssueInput = {`
- L44: `export type GateFileInput = {`
- L51: `export type GateIssue = {`
- L64: `export type CcrsSubmitVerdict = {`
- L91: `export const HELD_BACK_CODES: ReadonlySet<string> = new Set([`
- L126: `export function isHeldBack(i: { severity: GateSeverity; code?: string }): boolean {`
- L137: `export function toGateInput(s: {`
- L163: `export function defaultClassifyWarning(message: string | null | undefined): GateSeverity {`
- L172: `export function assertCcrsBatchSubmittable(input: {`
- L248: `export function verdictSummary(v: CcrsSubmitVerdict): string {`
- L262: `export function __runCcrsSubmitGateTests(): { passed: number; failed: number } {`

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

### `src/lib/compliance/ccrs-inventory-adjustment.ts` (151 L)

- L31: `export {`
- L40: `export type {`
- L46: `export type CcrsAdjustmentBuildResult = {`
- L59: `export async function buildCcrsInventoryAdjustmentCsv(`

### `src/lib/compliance/ccrs-sale-correction-core.ts` (305 L)

- L30: `export type SaleCorrectionSource = {`
- L52: `export type SaleCorrectionRowResult = { row: string[] | null; skipReason?: string };`
- L65: `export function ccrsDateLoose(v: string): string {`
- L78: `export const CCRS_EXCISE_RATE_BPS = 3700;`
- L81: `export function prorateLineMinor(lineMinor: number, remainingQty: number, originalQty: number): number {`
- L88: `export function mapSaleCorrectionRow(`
- L155: `export function buildSaleCorrectionFile(`
- L162: `export function makeSaleCorrectionFileName(licenseNumber: string): string {`
- L170: `export function __runSaleCorrectionTests(): { passed: number; failed: number } {`

### `src/lib/compliance/ccrs-resend-refused-core.ts` (201 L)

- L26: `export type RefusedRow = { rowNo: number; externalId: string; state: string; saleDate: string | null };`
- L31: `export function saleDateIso(mdy: string | null | undefined): string | null {`
- L37: `export function moneyMinor(s: string | undefined): number | null {`
- L45: `export function resendScope(rows: readonly RefusedRow[]): {`
- L59: `export function saleRowIdentityProblem(cells: readonly string[]): string | null {`
- L71: `export type ResendPlan = {`
- L87: `export function planResendRefused(freshSaleCsv: string, refusedIds: readonly string[]): ResendPlan {`
- L124: `export function resendSummaryText(plan: ResendPlan, fileName: string | null): string {`
- L138: `export function __runCcrsResendRefusedCoreTests(): { passed: number; failed: number } {`

### `src/lib/reports/tax-base-core.ts` (285 L)

- L42: `export function stillDueRateBps(opts: {`
- L60: `export function backOutInclusiveMinor(inclusiveMinor: number, rateBps: number): number {`
- L71: `export function preTaxLineBaseMinor(opts: {`
- L93: `export function preTaxUnitMinor(opts: {`
- L133: `export type CcrsSaleLineMoney = {`
- L146: `export function ccrsSaleLineMoney(opts: {`
- L188: `export function ccrsPrintedExciseMinor(quantity: number, unitPriceMinor: number, discountMinor: number, exciseRateBps = 3700): number {`
- L200: `export function __runTaxBaseCoreTests(): void {`

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

### `src/lib/inventory/disposition.ts` (1854 L)

- L89: `export const DESTRUCTION_QUARANTINE_HOURS = HOLD_HOURS_DEFAULT;`
- L96: `export {`
- L101: `export type VendorReturn = {`
- L147: `export type CustomerReturn = {`
- L179: `export type DestructionEvent = {`
- L225: `export type VendorReturnWithLot = VendorReturn & WithLot;`
- L226: `export type DestructionEventWithLot = DestructionEvent & WithLot & { hold_elapsed: boolean };`
- L232: `export type DispositionSettings = { holdHours: number };`
- L233: `export const DEFAULT_DISPOSITION_SETTINGS: DispositionSettings = { holdHours: HOLD_HOURS_DEFAULT };`
- L235: `export async function getDispositionSettings(): Promise<DispositionSettings> {`
- L251: `export async function updateDispositionSettings(`
- L426: `export async function listCustomerReturns(limit = 50): Promise<CustomerReturn[]> {`
- L458: `export async function createCustomerReturn(`
- L849: `export async function markCorrectionsExported(ids: string[]): Promise<void> {`
- L869: `export async function readCorrectionRoute(): Promise<CorrectionRoute> {`
- L895: `export async function listVendorReturns(limit = 100): Promise<VendorReturnWithLot[]> {`
- L907: `export const RESERVE_VENDOR_RETURN_RPC = "reserve_vendor_return";`
- L908: `export const DEPART_VENDOR_RETURN_RPC = "depart_vendor_return";`
- L909: `export const RELEASE_VENDOR_RETURN_RPC = "release_vendor_return";`
- L912: `export const VENDOR_RETURN_PENDING_MIGRATION =`
- L921: `export async function getVendorReturnPacket(id: string): Promise<{`
- L973: `export async function getVendorReturn(id: string): Promise<VendorReturn | null> {`
- L989: `export async function createVendorReturn(`
- L1079: `export async function updateVendorReturnTransport(`
- L1141: `export async function updateVendorReturnManifest(`
- L1243: `export async function cancelVendorReturn(`
- L1266: `export async function listDestructionEvents(limit = 100): Promise<DestructionEventWithLot[]> {`
- L1286: `export async function listCompletedDestructionsForMonth(`
- L1322: `export async function getDestructionRecordForPrint(id: string): Promise<`
- L1353: `export async function getDestructionEvent(id: string): Promise<DestructionEvent | null> {`
- L1429: `export async function scheduleDestruction(`
- L1544: `export async function completeDestruction(`
- L1702: `export async function cancelDestruction(`
- L1776: `export type DispositionSummary = {`
- L1784: `export async function dispositionSummary(): Promise<DispositionSummary> {`

### `src/lib/inventory/disposition-core.ts` (635 L)

- L35: `export const HOLD_HOURS_DEFAULT = 0; // D67: legal minimum (no waiting period in WAC 314-55-097)`
- L36: `export const HOLD_HOURS_MIN = 0;`
- L37: `export const HOLD_HOURS_MAX = 336; // 14 days`
- L40: `export function clampHoldHours(v: unknown): number {`
- L47: `export function computeEarliestDestroyAt(startISO: string, holdHours: number): string {`
- L53: `export function holdElapsed(earliestDestroyAtISO: string | null, nowMs: number): boolean {`
- L62: `export const CUSTOMER_RETURN_REASONS = [`
- L70: `export type CustomerReturnReason = (typeof CUSTOMER_RETURN_REASONS)[number];`
- L72: `export type CustomerReturnDisposition = "restock" | "destroy";`
- L74: `export type CustomerReturnDraft = {`
- L97: `export type CustomerReturnValidation =`
- L105: `export function validateCustomerReturn(d: CustomerReturnDraft): CustomerReturnValidation {`
- L159: `export function dollars(minor: number): string {`
- L164: `export function refundTooHighMessage(refundMinor: number, maxRefundMinor: number): string {`
- L192: `export function refundCeilingMinor(input: {`
- L212: `export function buildCustomerReturnAdjustmentNote(opts: {`
- L235: `export const RENDERING_METHODS = [`
- L240: `export type RenderingMethod = (typeof RENDERING_METHODS)[number];`
- L242: `export const RENDERING_METHOD_LABELS: Record<RenderingMethod, string> = {`
- L249: `export const MIX_MATERIAL_EXAMPLES: Record<Exclude<RenderingMethod, "lcb_approved_other">, string[]> = {`
- L254: `export type DestructionCompletionDraft = {`
- L274: `export type DestructionValidation = { ok: true } | { ok: false; error: string };`
- L281: `export function validateDestructionCompletion(d: DestructionCompletionDraft): DestructionValidation {`
- L329: `export function buildDestructionAdjustmentNote(opts: {`
- L359: `export const MANIFEST_STATUSES = [`
- L366: `export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];`
- L368: `export const MANIFEST_STATUS_LABELS: Record<ManifestStatus, string> = {`
- L381: `export function nextManifestStatuses(current: string): ManifestStatus[] {`
- L405: `export function __runDispositionCoreTests(): { passed: number; failed: number } {`

### `src/lib/inventory/intake-store.ts` (3414 L)

- L207: `export async function listManifests(opts?: {`
- L281: `export async function countManifestsByStatus(): Promise<StageCounts> {`
- L336: `export async function resolveOrCreateVendor(`
- L354: `export async function followVendorMerge(`
- L629: `export async function resolveBrandId(`
- L641: `export async function resolveBrandIdDetailed(`
- L839: `export async function stageManifest(`
- L1297: `export async function rejectManifest(`
- L1381: `export async function setLotDisposition(`
- L1459: `export async function setLotDockCount(`
- L1613: `export async function listLotShortCounts(`
- L1665: `export async function preflightManifestSampleCap(`
- L1803: `export async function gatherSampleCapNotice(manifestId: string): Promise<`
- L1866: `export async function finalizeManifestDispositions(`
- L2465: `export async function seedIncomingSampleEvents(`
- L2566: `export async function rememberVendorUsualTransport(`
- L2614: `export async function listManifestLots(manifestId: string) {`
- L2673: `export async function listLabFactsByIds(`
- L2741: `export type ManifestLotExportRow = {`
- L2769: `export async function listAllManifestLotsForExport(`
- L2827: `export type ManifestLifecycleStatus =`
- L2842: `export async function logManifestEvent(`
- L2867: `export async function setManifestLifecycle(`
- L2893: `export async function updateManifestTransport(`
- L2954: `export async function setManifestInvoiceOverride(`
- L2990: `export async function recordInvoiceNumberDetected(`
- L3046: `export async function seedTransportFromParsed(`
- L3091: `export async function backfillManifestTransport(`
- L3141: `export async function listManifestEvents(manifestId: string) {`
- L3166: `export async function dismissDuplicateManifest(`
- L3276: `export async function suspectedDuplicateOf(`
- L3312: `export async function findDuplicateTwinsFor(`
- L3357: `export async function listLotVendorIds(`
- L3382: `export async function setLotVendorInventoryId(`

### `src/lib/inventory/intake-parser.ts` (831 L)

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
- L389: `export const NO_SKU_LINE_WARNING =`
- L725: `export function parseVendorJson(jsonText: string): ParseResult {`
- L759: `export type CoaLink = {`
- L774: `export function extractCoaLinks(m: ParsedManifest): CoaLink[] {`
- L794: `export function summarizeManifest(m: ParsedManifest): {`

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

### `src/lib/inventory/sale-decrement.ts` (293 L)

- L58: `export async function decrementInventoryForOrder(orderId: string): Promise<void> {`

### `src/lib/pos/import-lot-core.ts` (1225 L)

- L47: `export type ImportLotSource = {`
- L104: `export type PlannedImportLot = {`
- L163: `export type ImportLotDiagnostic = {`
- L170: `export type ImportLotPlan = {`
- L189: `export function costToMinorUnits(raw: string | null | undefined): number | null {`
- L199: `export function parseUsDate(raw: string | null | undefined): string | null {`
- L231: `export function coaFlagToBool(raw: string | null | undefined): boolean {`
- L281: `export function resolveLotCreatedAt(plannedIso: string | null, fallbackIso: string): string {`
- L294: `export function insertKeySignature(row: Record<string, unknown>): string {`
- L305: `export function findNonUniformInsertRow(`
- L325: `export function assertUniformInsertKeys(rows: readonly Record<string, unknown>[], label: string): void {`
- L363: `export const POS_POTENCY_COLUMNS = ["pos_thc", "pos_thca", "pos_cbd", "pos_cbda", "pos_potency_unit", "pos_potency_set_at"] as const;`
- L370: `export const SIZE_LINK_COLUMNS = ["menu_source_variant_id", "menu_source_variant_source"] as const;`
- L373: `export function sizeLinkColumns(menuSourceVariantId: string | null | undefined): Record<string, unknown> {`
- L380: `export type ExistingLotSizeLink = {`
- L388: `export type SizeLinkFillPlan = {`
- L418: `export function planSizeLinkFill(`
- L464: `export function sizeLinkFillNote(plan: SizeLinkFillPlan, opts: { dryRun: boolean; written: number }): string {`
- L490: `export function receivedOnForDb(receivedOn: string | null, pacificToday: string): string | null {`
- L497: `export function potencyColumns(p: LotPotency | null, nowIso: string): Record<string, unknown> {`
- L508: `export type ExistingLotFacts = {`
- L519: `export type LotFactFillPlan = {`
- L533: `export function planLotFactFill(`
- L583: `export function planImportLots(sources: readonly ImportLotSource[]): ImportLotPlan {`
- L829: `export function __runImportLotCoreTests(): void {`
- L1108: `export function __runImportLotFactFillTests(): { passed: number } {`
- L1130: `export function __runImportLotSizeLinkTests(): { passed: number; failed: number } {`

### `src/lib/pos/import-service.ts` (1154 L)

- L73: `export function sha256(buffer: Buffer | Uint8Array): string {`
- L77: `export type CreateImportInput = {`
- L87: `export type CreateImportResult = {`
- L94: `export async function findDuplicateImport(`
- L114: `export async function runImport(input: CreateImportInput): Promise<CreateImportResult> {`
- L370: `export type PublishMenuVersionOptions = {`
- L382: `export type PublishMenuVersionResult = {`
- L387: `export async function publishMenuVersion(`
- L802: `export async function fillImportLotFacts(`
- L905: `export async function fillImportLotSizeLinks(`
- L1022: `export async function countTestData(): Promise<{ imports: number; versions: number }> {`
- L1036: `export async function cleanSlateTestData(): Promise<{`
- L1084: `export async function backfillImportLots(`

### `src/lib/pos/returns-core.ts` (428 L)

- L63: `export const RETURN_WINDOW_DAYS = DEFAULT_RETURN_WINDOW_DAYS;`
- L79: `export function defaultReturnPolicyText(policy?: PosReturnPolicyConfig | null): string {`
- L96: `export function normalizeReceiptNumber(raw: unknown): string | null {`
- L107: `export function clientUuidMatchesReceipt(clientUuid: string, receiptNumber8: string): boolean {`
- L118: `export function receiptLookupSuffix(raw: unknown): string | null {`
- L132: `export function pacificDaysBetween(earlierIso: string, laterIso: string): number {`
- L140: `export type ReturnWindowVerdict =`
- L151: `export function returnWindowVerdict(`
- L178: `export type ReturnEligibilityInput = {`
- L194: `export type ReturnEligibilityVerdict =`
- L204: `export function evaluateReturnEligibility(input: ReturnEligibilityInput): ReturnEligibilityVerdict {`
- L234: `export type RefundLineInput = {`
- L243: `export type RefundLineVerdict = { ok: true; refundMinor: number } | { ok: false; error: string };`
- L251: `export function refundForLine(input: RefundLineInput): RefundLineVerdict {`
- L271: `export function refundForLines(lines: RefundLineInput[]): RefundLineVerdict {`
- L286: `export type PointsClawbackInput = {`
- L302: `export function pointsClawback(input: PointsClawbackInput): number {`
- L319: `export function __runPosReturnsCoreTests(): void {`

### `src/lib/pos/returns-store.ts` (645 L)

- L80: `export type CounterReturnLine = {`
- L102: `export type CounterReturnSale = {`
- L121: `export type CounterReturnLookup =`
- L136: `export async function lookupSaleByReceipt(rawReceipt: string, asOfIso?: string, exactSaleClientUuid?: string): Promise<CounterReturnLookup> {`
- L320: `export type MemberSalesResult = { ok: true; sales: MemberSaleRow[]; windowDays: number } | { ok: false; error: string };`
- L328: `export async function listMemberSalesForReturn(customerId: string, asOfIso?: string): Promise<MemberSalesResult> {`
- L393: `export async function lookupSaleForMember(customerId: string, orderId: string, asOfIso?: string): Promise<CounterReturnLookup> {`
- L422: `export async function verifyReturnScan(`
- L451: `export type ProcessCounterReturnInput = {`
- L468: `export type ProcessCounterReturnResult =`
- L495: `export async function processCounterReturn(`
- L644: `export { receiptNumber };`

### `src/lib/pos/variant-lot-core.ts` (145 L)

- L33: `export const ONBOARDED_VARIANT_SUFFIX = "-onboarded";`
- L41: `export function lotKeyFromVariantId(variantId: string | null | undefined): string | null {`
- L54: `export function lotKeyForSaleLine(line: {`
- L68: `export function lotKeysForLines(`
- L86: `export function __runVariantLotCoreTests(): void {`

### `src/app/admin/compliance/ccrs/page.tsx` (1338 L)

- L104: `export const dynamic = "force-dynamic";`
- L109: `export const maxDuration = 300;`
- L287: `export default async function CcrsCommandCenterPage({`

### `src/app/admin/compliance/ccrs/actions.ts` (833 L)

- L77: `export async function resolveWeekAction(formData: FormData): Promise<void> {`
- L134: `export async function unresolveWeekAction(formData: FormData): Promise<void> {`
- L157: `export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {`
- L199: `export async function assignProductIdsAction(formData: FormData): Promise<void> {`
- L280: `export async function markUploadedAction(formData: FormData): Promise<void> {`
- L310: `export async function recordSuccessAction(formData: FormData): Promise<void> {`
- L376: `export async function recordErrorAction(formData: FormData): Promise<void> {`
- L434: `export async function recordNoEmailAction(formData: FormData): Promise<void> {`
- L460: `export async function abandonFileAction(formData: FormData): Promise<void> {`
- L485: `export async function startPreprodLedgerAction(formData: FormData): Promise<void> {`
- L529: `export async function settlePreprodDuplicatesAction(formData: FormData): Promise<void> {`
- L556: `export async function assignPreprodProductIdsAction(formData: FormData): Promise<void> {`
- L604: `export async function setObligationStartAction(formData: FormData): Promise<void> {`
- L628: `export async function setHandoverFactsAction(formData: FormData): Promise<void> {`
- L651: `export async function dismissPeriodAction(formData: FormData): Promise<void> {`
- L674: `export async function undoDismissalAction(formData: FormData): Promise<void> {`
- L699: `export async function ccrsCleanupAction(formData: FormData): Promise<void> {`
- L733: `export async function transferCorrectionAction(formData: FormData): Promise<void> {`
- L770: `export async function resendRefusedRowsAction(formData: FormData): Promise<void> {`

### `src/app/admin/reports/compliance/page.tsx` (500 L)

- L28: `export const dynamic = "force-dynamic";`
- L42: `export default async function CompliancePage({`

### `src/app/admin/reports/compliance/batch-export/route.ts` (292 L)

- L59: `export const dynamic = "force-dynamic";`
- L60: `export const runtime = "nodejs";`
- L62: `export const maxDuration = 300;`
- L66: `export async function GET(request: Request) {`

### `src/app/admin/reports/compliance/adjustment-export/route.ts` (61 L)

- L15: `export const dynamic = "force-dynamic";`
- L16: `export const runtime = "nodejs";`
- L18: `export async function GET(request: Request) {`

### `src/app/admin/reports/compliance/advisor-action.ts` (41 L)

- L14: `export type CcrsAdvisorResult = { ok: true; advice: CcrsAdvice } | { ok: false; error: string };`
- L16: `export async function generateCcrsAdviceAction(sp: {`

### `src/app/admin/inventory/disposition/sale-correction-export/route.ts` (135 L)

- L44: `export const dynamic = "force-dynamic";`
- L45: `export const runtime = "nodejs";`
- L50: `export async function GET() {`

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

### `src/components/admin/reports/ReportTabs.tsx` (88 L)

- L13: `export type ReportTab = { href: string; label: string; icon: string };`
- L15: `export const REPORT_TABS: ReportTab[] = [`
- L47: `export const ACH_REPORT_TAB: ReportTab = { href: "/admin/reports/ach-payments", label: "ACH Payments", icon: "🏦" };`
- L55: `export const CULTIVERA_BENCHMARK_TAB: ReportTab = { href: "/admin/reports/cultivera-benchmark", label: "Cultivera Benchmark", icon: "\ud83c\udfc1" };`
- L57: `export function reportTabsFor(showAchTab: boolean, showCultiveraTab = false): ReportTab[] {`
- L61: `export function ReportTabs({ showAchTab = false, showCultiveraTab = false }: { showAchTab?: boolean; showCultiveraTab?: boolean }) {`

### `src/components/admin/admin-nav-data.ts` (271 L)

- L4: `export type AdminNavItem = {`
- L47: `export const adminNav: AdminNavItem[] = [`
- L234: `export const navGroups: AdminNavItem["group"][] = [`

## A. Batch builders — `src/lib/compliance/ccrs-batch.ts`

`src/lib/compliance/ccrs-batch.ts` L160-L193 — buildStrainFile — NOTE: no guard for Unknown/THC/Other (guide p.12 L358: 'Strain name is invalid, cannot be Unknown, THC, or Other'). Defaults StrainType to Hybrid.

```ts
 160| export type CcrsFile = {
 161|   type: CcrsRetailerFileType;
 162|   group: number;
 163|   fileName: string;
 164|   csv: string;
 165|   recordCount: number;
 166|   skipped: number;
 167|   warnings: string[];
 168|   /** True when this file has zero data rows (nothing to report for the range). */
 169|   empty: boolean;
 170| };
 171| 
 172| export type CcrsSyncIssue = {
 173|   severity: "error" | "warning";
 174|   file: CcrsRetailerFileType | "General";
 175|   message: string;
 176|   count?: number;
 177|   /**
 178|    * S-02: stable machine id for the check that fired, e.g. "E7_TOTALCOST_ZERO".
 179|    * Optional so the many legacy warnings keep compiling; every issue raised by
 180|    * a bible-grounded check MUST set it (Part 08 §C).
 181|    */
 182|   code?: CcrsIssueCode | LedgerProblemCode;
 183|   /** The verbatim LCB pin behind the check, e.g. "[G L0614]". */
 184|   specPin?: string;
 185|   /** Every offending row — NEVER capped; a capped list hides the blocker. */
 186|   rows?: CcrsIssueRow[];
 187| };
 188| 
 189| export type CcrsBatch = {
 190|   licenseNumber: string;
 191|   submittedBy: string;
 192|   fromISO: string;
 193|   toISO: string;
```

`src/lib/compliance/ccrs-batch.ts` L201-L213 — buildAreaFile — emits Area 'Quarantine' IsQuarantine=TRUE whenever hasQuarantine. FAQ (Data Reporting, IsQuarantine Q): 'There are no quarantine requirements for cannabis products. You will have an entry as FALSE.' → compliance question, Part 04 flag N-01.

```ts
 201|    * the production seed is not finalized yet (ccrs-ledger-store-core).
 202|    */
 203|   ledger: {
 204|     env: LedgerEnv;
 205|     view: LedgerView | null;
 206|     /** why there is no view (null when loaded). */
 207|     absentReason: "migration-not-applied" | "seed-not-finalized" | "not-configured" | null;
 208|     /** greatest file stamp already stored in this env (ISO), null = none. */
 209|     lastStamp: string | null;
 210|     /**
 211|      * Product keys withheld ONLY because no GWP- id is assigned yet (sorted).
 212|      * The owner assigns them with one audited action (ccrs_assign_product_ids);
 213|      * the export never assigns on its own (D-01a: ids are minted deliberately).
```

`src/lib/compliance/ccrs-batch.ts` L215-L260 — buildProductFile (part 1) — weightByKey from lots; grams may be '' when no lot weight.

```ts
 215|     unassignedProductKeys: string[];
 216|   };
 217|   /**
 218|    * R74 S25: what every lot and product is filed under (Cultivera lots on the
 219|    * ids Cultivera filed vs our intake lots on our ids / GWP- products). Null
 220|    * when no lots were read (not configured).
 221|    */
 222|   identity: IdentityProof | null;
 223|   /**
 224|    * R5-1: customer-return Sale corrections carried in this batch's Sale file.
 225|    * `exportReturnIds` is filled ONLY for a production emission (preprod never
 226|    * marks the shared correction_status); the route marks them after emit.
 227|    */
 228|   corrections: {
 229|     exportReturnIds: string[];
 230|     emitted: number;
 231|     withheld: number;
 232|     invalid: number;
 233|     reflected: number;
 234|   };
 235| };
 236| 
 237| // ---------------------------------------------------------------------------
 238| // Helpers to read the published menu snapshot + inventory lots
 239| // ---------------------------------------------------------------------------
 240| 
 241| type Admin = ReturnType<typeof createSupabaseAdminClient>;
 242| 
 243| async function getPublishedVersionId(admin: Admin): Promise<string | null> {
 244|   const { data } = await admin
 245|     .from("menu_versions")
 246|     .select("id")
 247|     .eq("status", "published")
 248|     .order("published_at", { ascending: false })
 249|     .limit(1)
 250|     .maybeSingle();
 251|   return (data as { id: string } | null)?.id ?? null;
 252| }
 253| 
 254| const LOT_COLUMNS =
 255|   "id, lot_code, pos_product_key, product_name, ccrs_inventory_external_id, received_qty, on_hand_qty, unit_cost_minor_units, unit_weight, unit_weight_uom, status, create
 256| 
 257| /**
 258|  * R6-2: every ACCEPTED lot of a delivery received on or before `toDay` (live
 259|  * or destroyed: a lot sold out or destroyed was still received), with the
 260|  * delivery facts an InventoryTransfer row needs. The retailer is the
```

`src/lib/compliance/ccrs-batch.ts` L280-L349 — buildProductFile (part 2) — classification via deriveCcrsClassificationFromType; E4 error message; clamps; warnings.slice(0,30).

```ts
 280| type TransferManifestRow = LineageManifestRow & {
 281|   vendor_id: string | null;
 282|   from_license_number?: string | null;
 283|   vendor_license?: string | null;
 284| };
 285| async function readTransferLots(admin: Admin, toDay: string): Promise<{ kind: "absent" } | { kind: "loaded"; lots: TransferLot[] }> {
 286|   let missing = false;
 287|   let failed: string | null = null;
 288|   const rows = await pagedAll<TransferLotRow>(async (from, to) => {
 289|     if (missing || failed) return [];
 290|     const { data, error } = await admin
 291|       .from("inventory_lots")
 292|       .select(TRANSFER_LOT_COLUMNS)
 293|       .not("manifest_id", "is", null)
 294|       .eq("disposition", "accepted")
 295|       .lte("received_on", toDay)
 296|       .order("id", { ascending: true })
 297|       .range(from, to);
 298|     if (error) {
 299|       if (isMissingColumnError(error)) missing = true;
 300|       else failed = error.message;
 301|       return [];
 302|     }
 303|     return (data as TransferLotRow[] | null) ?? [];
 304|   });
 305|   if (missing) return { kind: "absent" };
 306|   if (failed) throw new Error(`R6-2: reading received lots for InventoryTransfer failed: ${failed}`);
 307|   const manifestIds = [...new Set(rows.map((r) => (r.manifest_id ?? "").trim()).filter(Boolean))];
 308|   let mFailed: string | null = null;
 309|   const manifests = await chunkedIn<string, TransferManifestRow>(manifestIds, async (chunk, from, to) => {
 310|     const { data, error } = await admin
 311|       .from("inbound_manifests")
 312|       .select(`${LINEAGE_MANIFEST_SELECT}, vendor_id, from_license_number:raw_payload->>from_license_number, vendor_license:raw_payload->>vendor_license`)
 313|       .in("id", chunk)
 314|       .order("id", { ascending: true })
 315|       .range(from, to);
 316|     if (error) mFailed = error.message;
 317|     return (data as TransferManifestRow[] | null) ?? [];
 318|   });
 319|   if (mFailed) throw new Error(`R6-2: reading delivery manifests for InventoryTransfer failed: ${mFailed}`);
 320|   const byManifest = new Map(manifests.map((m) => [m.id, m]));
 321|   const vendorIds = [
 322|     ...new Set([...rows.map((r) => r.vendor_id), ...manifests.map((m) => m.vendor_id)].filter((x): x is string => !!x)),
 323|   ];
 324|   let vFailed: string | null = null;
 325|   const vendors = await chunkedIn<string, { id: string; license_number: string | null }>(vendorIds, async (chunk, from, to) => {
 326|     const { data, error } = await admin.from("vendors").select("id, license_number").in("id", chunk).order("id", { ascending: true }).range(from, to);
 327|     if (error) vFailed = error.message;
 328|     return (data as { id: string; license_number: string | null }[] | null) ?? [];
 329|   });
 330|   if (vFailed) throw new Error(`R6-2: reading vendor licenses for InventoryTransfer failed: ${vFailed}`);
 331|   const licenseByVendor = new Map(vendors.map((v) => [v.id, (v.license_number ?? "").trim()]));
 332|   const migration = cultiveraManifestIdSet(manifests);
 333|   const lots: TransferLot[] = rows.map((r) => {
 334|     const m = r.manifest_id ? byManifest.get(r.manifest_id) : undefined;
 335|     // The delivery's own sending license first (exact for THIS manifest),
 336|     // then the vendor record's license.
 337|     const fromDoc = (m?.from_license_number ?? m?.vendor_license ?? "").trim();
 338|     const vendorRecord = licenseByVendor.get(m?.vendor_id ?? r.vendor_id ?? "") ?? "";
 339|     const qty = r.received_qty === null ? null : Number(r.received_qty);
 340|     return {
 341|       lotId: r.id,
 342|       manifestId: r.manifest_id,
 343|       label: r.lot_code ?? r.id,
 344|       ourId: assignedInventoryExternalId(r),
 345|       vendorId: r.vendor_inventory_external_id,
 346|       vendorIdSource: r.vendor_inventory_external_id_source,
 347|       vendorLicense: fromDoc || vendorRecord || null,
 348|       receivedQty: qty,
 349|       receivedOn: r.received_on,
```

`src/lib/compliance/ccrs-batch.ts` L351-L417 — buildInventoryFile — ext id derive; Area choice; TotalCost = unit_cost_minor_units*received_qty (0 when cost missing → guide p.17 L614 'TotalCost cannot equal 0'); IsMedical hard 'FALSE'; Operation Insert.

```ts
 351|       isCultivera: lotFlaggedCultivera(r, migration),
 352|     };
 353|   });
 354|   return { kind: "loaded", lots };
 355| }
 356| 
 357| /**
 358|  * R74 S25: ids of the migration manifests the batch's lots sit on (the shared
 359|  * lineage predicate, cultiveraManifestIdSet). A read error THROWS: without it a
 360|  * re-homed Cultivera lot whose notes lost the marker could pass as ours.
 361|  */
 362| /** R74 S42: true when the batch has a non-empty Sale file to check. */
 363| function f_saleRowsChecked(files: readonly CcrsFile[]): boolean {
 364|   const sf = files.find((f) => f.type === "Sale");
 365|   return !!sf && sf.recordCount > 0;
 366| }
 367| 
 368| /** R74 S42: the owner's CCRS clean-up list (relic products never reported). */
 369| async function readCleanupList(admin: Admin): Promise<{ items: CleanupProduct[]; error: string | null }> {
 370|   try {
 371|     const { data, error } = await admin.from("site_settings").select("value_json").eq("key", CCRS_CLEANUP_SETTING_KEY).maybeSingle();
 372|     if (error) return { items: [], error: error.message };
 373|     return { items: normalizeCleanup((data as { value_json?: unknown } | null)?.value_json ?? null), error: null };
 374|   } catch (e) {
 375|     return { items: [], error: e instanceof Error ? e.message : String(e) };
 376|   }
 377| }
 378| 
 379| async function readMigrationManifestIds(admin: Admin, lots: readonly { manifest_id: string | null }[]): Promise<Set<string>> {
 380|   const ids = [...new Set(lots.map((l) => (l.manifest_id ?? "").trim()).filter(Boolean))];
 381|   let failed: string | null = null;
 382|   const rows = await chunkedIn<string, LineageManifestRow>(ids, async (chunk, from, to) => {
 383|     const { data, error } = await admin
 384|       .from("inbound_manifests")
 385|       .select(LINEAGE_MANIFEST_SELECT)
 386|       .in("id", chunk)
 387|       .order("id", { ascending: true })
 388|       .range(from, to);
 389|     if (error) failed = error.message;
 390|     return (data as LineageManifestRow[] | null) ?? [];
 391|   });
 392|   if (failed) throw new Error(`R74 S25: reading lot manifests for the CCRS identity guard failed: ${failed}`);
 393|   return cultiveraManifestIdSet(rows);
 394| }
 395| 
 396| const TRANSFER_ISSUE_TEXT: Record<TransferIssueCode, (n: number) => string> = {
 397|   E14_TRANSFER_FIELD_MISSING: (n) => `${n} received lot(s) are missing a field InventoryTransfer.csv requires (vendor license, our lot id, or received date). Fix each del
 398|   E14_TRANSFER_VENDOR_ID_UNKNOWN: (n) =>
 399|     `${n} received lot(s) have no confirmed vendor inventory id. CCRS needs "the original ... InventoryExternalIdentifier from the producer" [FAQ L0058-L0059]. Open the d
 400|   E14_TRANSFER_SAME_LICENSE: (n) => `${n} received lot(s) name our own license as the vendor. A transfer to the same license is an error [G L1205]; fix the vendor on the 
 401|   E14_TRANSFER_QUANTITY: (n) => `${n} received lot(s) have a received quantity that is not positive ("No negative entries allowed" [G L1238]).`,
 402|   E14_TRANSFER_LEDGER_WITHHELD: (n) => `${n} transfer(s) were left out because an earlier file naming them is not answered yet. Record that file's CCRS result, then rebui
 403|   E14_TRANSFER_LOT_NOT_REPORTED: (n) =>
 404|     `${n} transfer(s) were left out because their lot is not in Inventory.csv and CCRS does not hold it yet ("ensure the inventory has been reported through the inventory
 405|   E63_TRANSFER_CORRECTION_PENDING: (n) =>
 406|     `${n} transfer(s) CCRS already holds now differ from what CCRS accepted (received quantity, date or vendor id changed). The examiner: "the update path is the correct 
 407| };
 408| 
 409| /** C1: the owner's approved transfer corrections (site_settings). Unreadable = none approved (nothing is sent on a guess). */
 410| async function readTransferApprovals(admin: Admin, env: LedgerEnv): Promise<TransferCorrectionApproval[]> {
 411|   try {
 412|     const { data, error } = await admin.from("site_settings").select("value_json").eq("key", transferCorrectionSettingKey(env)).maybeSingle();
 413|     if (error) return [];
 414|     return normalizeTransferApprovals((data as { value_json?: unknown } | null)?.value_json ?? null);
 415|   } catch {
 416|     return [];
 417|   }
```

`src/lib/compliance/ccrs-batch.ts` L424-L500 — buildCcrsBatch (part 1) — license/Supabase guards E1/E2; published menu; lots pagedAll excluding status=destroyed.

```ts
 424|  * Destruction adjustment [G L1302-L1304, EXAM L0430]. A read error THROWS:
 425|  * silently dropping the lot would send an adjustment CCRS rejects.
 426|  */
 427| async function readDestroyedLots(admin: Admin, refs: readonly string[]): Promise<LotRow[]> {
 428|   if (refs.length === 0) return [];
 429|   let failed: string | null = null;
 430|   const rows = await chunkedIn<string, LotRow>(refs, async (chunk, from, to) => {
 431|     const { data, error } = await admin
 432|       .from("inventory_lots")
 433|       .select(LOT_COLUMNS)
 434|       .eq("status", "destroyed")
 435|       .in("ccrs_inventory_external_id", chunk)
 436|       .order("id", { ascending: true })
 437|       .range(from, to);
 438|     if (error) failed = error.message;
 439|     return (data as LotRow[] | null) ?? [];
 440|   });
 441|   if (failed) throw new Error(`R5-1: could not read destroyed lots named by this batch: ${failed}`);
 442|   // The stored id may carry surrounding spaces; assignedInventoryExternalId
 443|   // trims, so match on what the event row printed.
 444|   const wanted = new Set(refs);
 445|   const seen = new Set<string>();
 446|   return rows.filter((l) => {
 447|     const assigned = assignedInventoryExternalId(l);
 448|     if (!assigned || !wanted.has(assigned) || seen.has(l.id)) return false;
 449|     seen.add(l.id);
 450|     return true;
 451|   });
 452| }
 453| 
 454| const RETURN_COLUMNS =
 455|   "id, sale_external_id, sale_detail_external_id, inventory_external_id, sale_type, sale_date, unit_price_minor, discount_minor, sales_tax_minor, excise_minor, quantity, 
 456| 
 457| /** customer_returns missing (pre-0115) reads as "no returns"; any other error throws. */
 458| function isMissingTable(error: { code?: string; message?: string } | null): boolean {
 459|   if (!error) return false;
 460|   const msg = (error.message ?? "").toLowerCase();
 461|   return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/.test(msg);
 462| }
 463| 
 464| /**
 465|  * R5-1: the returns a batch must consider for Sale corrections: every PENDING
 466|  * return, every return made (created_at) inside the batch range, and every
 467|  * other return of those sale lines (the correction states the line after ALL
 468|  * its returns: rule 1). Same rule in both envs.
 469|  *   - `correction_status` is ONE flag that only a PROD emission sets
 470|  *     (correctionExportIds), so it cannot say what PREprod has seen, nor
 471|  *     whether CCRS accepted a prod correction. The env's own ledger decides
 472|  *     that (reflected = already applied, in flight = wait).
 473|  *   - The range part lets a correction whose file was rejected or abandoned
 474|  *     be planned again by rebuilding that week; the ledger stops re-sends.
 475|  */
 476| async function readReturnsForCorrections(
 477|   admin: Admin,
 478|   fromISO: string,
 479|   toISO: string,
 480| ): Promise<{ records: ReturnRecord[]; tableMissing: boolean }> {
 481|   const seeds = await pagedAll<CustomerReturnRowLike>(async (from, to) => {
 482|     const { data, error } = await admin
 483|       .from("customer_returns")
 484|       .select(RETURN_COLUMNS)
 485|       .or(`correction_status.eq.pending,and(created_at.gte.${fromISO},created_at.lte.${toISO})`)
 486|       .order("id", { ascending: true })
 487|       .range(from, to);
 488|     if (error) {
 489|       if (isMissingTable(error)) throw new MissingReturnsTable();
 490|       throw new Error(`R5-1: could not read customer_returns: ${error.message}`);
 491|     }
 492|     return (data as CustomerReturnRowLike[] | null) ?? [];
 493|   }).catch((e) => {
 494|     if (e instanceof MissingReturnsTable) return null;
 495|     throw e;
 496|   });
 497|   if (seeds === null) return { records: [], tableMissing: true };
 498|   const lineIds = [...new Set(seeds.map((r) => (r.sale_detail_external_id ?? "").trim()).filter(Boolean))];
 499|   let failed: string | null = null;
 500|   const siblings = await chunkedIn<string, CustomerReturnRowLike>(lineIds, async (chunk, from, to) => {
```

`src/lib/compliance/ccrs-batch.ts` L540-L652 — buildCcrsBatch (part 2) — InventoryTransfer emitted EMPTY with an explanatory note (guide p.33 L1162 says it 'is required weekly by any licensed facility that receives inventory'); sort; E3; orphan products; verifySaleNumericColumns; WARNING_CAP_PER_FILE.

```ts
 540|       const { data, error } = await admin
 541|         .from("menu_items")
 542|         .select("source_item_id, hidden_reason")
 543|         .eq("menu_version_id", publishedVersionId)
 544|         .eq("hidden", true)
 545|         .in("source_item_id", chunk)
 546|         .order("id", { ascending: true })
 547|         .range(from, to);
 548|       if (error) failed = error.message;
 549|       return (data as { source_item_id: string | null; hidden_reason: string | null }[] | null) ?? [];
 550|     });
 551|     const { data: stagedVersions, error: sErr } = await admin.from("menu_versions").select("id").eq("status", "staged");
 552|     if (sErr) failed = sErr.message;
 553|     const stagedIds = ((stagedVersions as { id: string }[] | null) ?? []).map((v) => v.id);
 554|     const staged =
 555|       stagedIds.length === 0
 556|         ? []
 557|         : await chunkedIn<string, { source_item_id: string | null }>(keys, async (chunk, from, to) => {
 558|             const { data, error } = await admin
 559|               .from("menu_items")
 560|               .select("source_item_id")
 561|               .in("menu_version_id", stagedIds)
 562|               .in("source_item_id", chunk)
 563|               .order("id", { ascending: true })
 564|               .range(from, to);
 565|             if (error) failed = error.message;
 566|             return (data as { source_item_id: string | null }[] | null) ?? [];
 567|           });
 568|     if (failed) return { readable: false, error: failed };
 569|     return menuPresenceFromRows(true, visiblePublishedKeys, hidden, staged);
 570|   } catch (e) {
 571|     return { readable: false, error: e instanceof Error ? e.message : String(e) };
 572|   }
 573| }
 574| 
 575| type MenuItemRow = {
 576|   source_item_id: string;
 577|   name: string;
 578|   strain_name: string | null;
 579|   strain_type: string | null;
 580|   pos_inventory_type: string | null;
 581|   pos_inventory_category: string | null;
 582|   description: string | null;
 583|   // SLICE 53 (two-layer naming): fields the CCRS Product.Name composer uses.
 584|   brand_name: string | null;
 585|   vendor_name: string | null;
 586|   category: string | null;
 587|   total_thc_json: unknown;
 588|   total_cbd_json: unknown;
 589|   compounds_json: unknown;
 590| };
 591| 
 592| /** Parse a stored cannabinoid JSON blob (same shape live-menu.ts reads). */
 593| function jsonToCannabinoid(json: unknown): Cannabinoid | null {
 594|   if (!json || typeof json !== "object") return null;
 595|   const o = json as Record<string, unknown>;
 596|   if (typeof o.type !== "string" || typeof o.unit !== "string") return null;
 597|   return {
 598|     type: o.type as Cannabinoid["type"],
 599|     value: typeof o.value === "string" || typeof o.value === "number" ? o.value : null,
 600|     unit: o.unit as Cannabinoid["unit"],
 601|   };
 602| }
 603| 
 604| function jsonToCompounds(json: unknown): Cannabinoid[] {
 605|   if (!Array.isArray(json)) return [];
 606|   return json.map(jsonToCannabinoid).filter((c): c is Cannabinoid => c != null);
 607| }
 608| 
 609| type LotRow = {
 610|   id: string;
 611|   /** P-F: the lot's own strain (migration 0024, from the transfer); a fallback when the product has none. */
 612|   strain_name?: string | null;
 613|   lot_code: string | null;
 614|   pos_product_key: string | null;
 615|   product_name: string | null;
 616|   ccrs_inventory_external_id: string | null;
 617|   received_qty: number;
 618|   on_hand_qty: number;
 619|   unit_cost_minor_units: number | null;
 620|   unit_weight: number | null;
 621|   unit_weight_uom: string | null;
 622|   status: string;
 623|   created_at: string;
 624|   /**
 625|    * SLICE 2 (migration 0214) — the evidenced day the lot was received.
 626|    * NULL means unknown; see ccrsInventoryCreatedDate() for how that is
 627|    * handled when filling Inventory.CreatedDate.
 628|    */
 629|   received_on: string | null;
 630|   /**
 631|    * S-02 / E7: a vendor TRADE SAMPLE (migration 0024 L32,
 632|    * `is_sample boolean not null default false`). It has no purchase value, but
 633|    * CCRS still requires a positive TotalCost and the FAQ dictates exactly
 634|    * $0.01 [FAQ L0035]. Selected explicitly so the E7 check can tell a sample
 635|    * apart from a lot whose cost was never entered.
 636|    */
 637|   is_sample: boolean | null;
 638|   /**
 639|    * R74 S25: the Cultivera flag (lotFlaggedCultivera) reads the notes marker
 640|    * and the lot's manifest, so the identity guard can tell a migrated lot
 641|    * (keeps the id Cultivera filed) from one we received (our id, GWP- product).
 642|    */
 643|   notes: string | null;
 644|   manifest_id: string | null;
 645| };
 646| 
 647| // ---------------------------------------------------------------------------
 648| // Per-file generators for the master-data files (Strain / Area / Product /
 649| // Inventory). Adjustment + Sale reuse the existing mature builders.
 650| // ---------------------------------------------------------------------------
 651| 
 652| /** grams from a unit_weight + uom (g default). Returns "" when unknown. */
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
 128|     id: "excise_not_37pct",
 129|     needles: ["excise tax does not equal 37%", "excisetax does not equal 37%"],
 130|     severity: "fixable",
 131|     meaning:
 132|       "CCRS recomputed 37% of the printed row (Quantity x UnitPrice - Discount, rounded to the cent) and it did not equal CannabisExciseTax. Seen 2026-11-10 in PREprod: 1
 133|     fixSteps: [
 134|       "Apply the error file so the refused rows are marked refused.",
 135|       "Re-send only the refused rows (CCRS files panel: Re-send refused rows). The exporter now prints UnitPrice and Discount so the row total is exactly the taxed amount
 136|     ],
 137|   },
 138|   {
 139|     id: "excise_zero_nonmedical",
 140|     needles: ["only medical sales can be 0", "only medical sales can be $0"],
 141|     severity: "fixable",
 142|     meaning:
 143|       "A non-medical sale row reported $0 cannabis excise tax. Excise must equal 37% of unit price for every retail sale; ONLY SaleType=RecreationalMedical rows (DOH-veri
 144|     fixSteps: [
 145|       "If the sale was NOT a verified medical exemption: correct the excise to 37% of the unit price and re-upload.",
 146|       "If it WAS a valid medical sale: set SaleType=RecreationalMedical (both tax columns $0.00) and confirm the inventory row was reported IsMedical=TRUE.",
 147|     ],
 148|   },
 149|   {
 150|     id: "number_records_mismatch",
 151|     needles: ["numberrecords", "number of records"],
 152|     severity: "fixable",
 153|     meaning:
 154|       "The NumberRecords value in the file's header doesn't equal the actual data-row count, so CCRS rejected the whole file.",
 155|     fixSteps: [
 156|       "Regenerate the file from the Command Center — the generator always writes a matching NumberRecords — rather than hand-editing.",
 157|       "If you hand-edited the CSV, recount the data rows (exclude the 3 header rows) and fix the header, then re-upload.",
 158|     ],
 159|   },
 160|   {
 161|     id: "quarantine",
 162|     needles: ["quarantine"],
 163|     severity: "fixable",
 164|     meaning:
 165|       "A sale references inventory sitting in a quarantine area. Cannabis products should never be in quarantine areas (IsQuarantine=TRUE is only for imported CBD awaitin
```

`src/lib/compliance/ccrs-error-triage-core.ts` L226-L280 — LCB_CONTACTS + buildExaminerDraft

```ts
 226|         `${unrecognized.length} line(s) look like errors but match no known pattern — if you can't resolve them, send the escalation draft to examiner@lcb.wa.gov with the
 227|       );
 228|     }
 229|     summary = parts.join(" ");
 230|   }
 231| 
 232|   return { findings, unrecognized, needsAction, suggestEscalation, summary };
 233| }
 234| 
 235| // ── Examiner escalation draft (DRAFTS-ONLY) ──────────────────────────────────
 236| 
 237| export const LCB_CONTACTS = {
 238|   examiner: "examiner@lcb.wa.gov",
 239|   serviceDesk: "servicedesk@lcb.wa.gov",
 240|   taxes: "cannabistaxes@lcb.wa.gov",
 241|   enforcement: "cannabisenf@lcb.wa.gov",
 242|   endorsement: "cannabisendorsement@lcb.wa.gov",
 243| } as const;
 244| 
 245| export type ExaminerDraft = {
 246|   to: string;
 247|   subject: string;
 248|   body: string;
 249| };
 250| 
 251| /**
 252|  * Build the examiner escalation email as a DRAFT (never sent automatically —
 253|  * standing drafts-only rule). The owner attaches the CSV and forwards the
 254|  * original CCRS error email per the LCB workflow.
 255|  */
 256| export function buildExaminerDraft(opts: {
 257|   licenseNumber: string;
 258|   licenseeName: string;
 259|   weekStart: string; // ISO
 260|   weekEnd: string; // ISO
 261|   fileTypes: string[];
 262|   errorExcerpt: string;
 263|   contactEmail?: string;
 264| }): ExaminerDraft {
 265|   const files = opts.fileTypes.length > 0 ? opts.fileTypes.join(", ") : "(files not specified)";
 266|   const excerpt = opts.errorExcerpt.trim().slice(0, 1500);
 267|   const subject = `CCRS upload error assistance — license ${opts.licenseNumber} — week ${opts.weekStart} to ${opts.weekEnd}`;
 268|   const body = [
 269|     "Hello,",
 270|     "",
 271|     `We are ${opts.licenseeName} (license ${opts.licenseNumber}). We received an error notification after our weekly CCRS upload covering ${opts.weekStart} through ${opts
 272|     "",
 273|     "Error message received:",
 274|     "----------------------------------------",
 275|     excerpt || "(paste the CCRS error text here)",
 276|     "----------------------------------------",
 277|     "",
 278|     "The original CSV file(s) are attached, and the CCRS error email is forwarded with this message. Could you please advise how to correct and resubmit?",
 279|     "",
 280|     "Thank you,",
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
  70|   /**
  71|    * R74 S39: records HELD BACK. Their rows were left out of the files (so the
  72|    * files are correct without them); they wait until fixed and are reported
  73|    * by a later batch. They never block the good records.
  74|    */
  75|   held: GateIssue[];
  76|   heldCount: number;
  77|   /** All issues (errors, then held, then warnings) for a single ordered report. */
  78|   issues: GateIssue[];
  79| };
  80| 
  81| /**
  82|  * R74 S39 (owner, Round 19): "we can not be blocked from reporting to the
  83|  * state ... we cant block good records from being uploaded". Each code below
  84|  * is raised ONLY for rows the builder already LEFT OUT of every file, so the
  85|  * files are complete and correct without them; CCRS accepts row by row
  86|  * (U-17 CLOSED FALSE). Every other error still blocks: it means a row IN a
  87|  * file would be rejected, or the whole batch is unsafe (license, E53).
  88|  * R74 S42: E9, E11, an unknown type (E57), ledger duplicates (E59) and rows
  89|  * the verifier / ledger self-check refuse (E60) are held back too.
  90|  */
  91| export const HELD_BACK_CODES: ReadonlySet<string> = new Set([
  92|   "E3_EXTERNAL_ID_UNASSIGNED",
  93|   "E7_TOTALCOST_ZERO",
  94|   "E8_ONHAND_GT_INITIAL",
  95|   "E38_FIELD_HAS_LINE_BREAK",
  96|   "E42_FIELD_HAS_COMMA",
  97|   "E41_LEDGER_WITHHELD",
  98|   "E49_SALE_LINE_ALREADY_HELD",
  99|   "E52_CULTIVERA_LOT_NOT_ON_RECORD",
 100|   "E56_EVENT_ROW_LOT_HELD",
 101|   "E14_TRANSFER_FIELD_MISSING",
 102|   "E14_TRANSFER_VENDOR_ID_UNKNOWN",
 103|   "E14_TRANSFER_SAME_LICENSE",
 104|   "E14_TRANSFER_QUANTITY",
 105|   // R74 S42 (owner, Round 22): "remove all blockers ... the records we have
 106|   // that are factual are able to be uploaded no matter what". Each of these
 107|   // now LEAVES its rows (and every row that would name them) out of the files.
 108|   "E9_UNITWEIGHT_ZERO_USABLE",
 109|   "E11_STRAIN_NAME_RESERVED",
 110|   "E57_PRODUCT_TYPE_UNKNOWN",
 111|   "E46_AREA_LEDGER",
 112|   "E59_LEDGER_DUPLICATE_HELD",
 113|   "E60_ROW_REFUSED_HELD",
 114|   // W-3: an adjustment whose CCRS state is unproven (or the ledger could not
 115|   // be read) is left out of InventoryAdjustment.csv and owed. (E61 in-flight
 116|   // holds are advisory warnings: those rows were sent, they are not owed.)
 117|   "E62_ADJUSTMENT_LEDGER",
 118|   // C1: a transfer correction waiting for the owner's approval is left out of
 119|   // InventoryTransfer.csv (CCRS keeps the accepted values) and owed.
 120|   "E63_TRANSFER_CORRECTION_PENDING",
 121|   // P-F: a lot with no strain anywhere is left out of Inventory.csv and owed.
 122|   "E64_INVENTORY_NO_STRAIN",
 123| ]);
 124| 
 125| /** True when an error-severity issue only describes rows left out of the files. */
 126| export function isHeldBack(i: { severity: GateSeverity; code?: string }): boolean {
 127|   return i.severity === "error" && !!i.code && HELD_BACK_CODES.has(i.code);
 128| }
 129| 
 130| /**
 131|  * S-17a: the ONE mapping from a builder sync issue to gate input. Every caller
 132|  * (hub page, compliance report, batch-export route) uses this instead of a
 133|  * hand-written `{severity, file, message, count}` literal — that literal is
 134|  * exactly how the 2026-10-19 hub lost the rows of "17 lot(s) were left out"
 135|  * (Part 17 §C.4 defect 1). A source test pins that no caller maps by hand.
 136|  */
 137| export function toGateInput(s: {
 138|   severity: GateSeverity;
 139|   file: string;
 140|   message: string;
 141|   count?: number;
 142|   code?: string;
 143|   specPin?: string;
 144|   rows?: readonly DisplayRow[];
 145| }): GateIssueInput {
 146|   return {
 147|     severity: s.severity,
 148|     file: String(s.file),
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
  45| 
  46| export type CcrsAdjustmentBuildResult = {
  47|   csv: string;
  48|   fileName: string;
  49|   recordCount: number;
  50|   skipped: number;
  51|   warnings: string[];
  52|   licenseNumber: string;
  53| };
  54| 
  55| /**
  56|  * Build the InventoryAdjustment.csv for adjustments created in [fromISO, toISO].
  57|  * Joins each adjustment to its lot for the external identifier.
  58|  */
  59| export async function buildCcrsInventoryAdjustmentCsv(
  60|   fromISO: string,
  61|   toISO: string,
  62| ): Promise<CcrsAdjustmentBuildResult> {
  63|   const license = await getCcrsLicenseSettings();
  64|   const result: CcrsAdjustmentBuildResult = {
  65|     csv: "",
  66|     fileName: makeAdjustmentFileName(license.licenseNumber),
  67|     recordCount: 0,
  68|     skipped: 0,
  69|     warnings: [],
  70|     licenseNumber: license.licenseNumber,
  71|   };
  72| 
  73|   if (!license.licenseNumber) {
  74|     result.warnings.push("License number is not set — set it on the Compliance tab before uploading.");
  75|   }
  76| 
  77|   if (!isSupabaseServiceConfigured) {
  78|     result.csv = buildAdjustmentFile([], license);
  79|     return result;
  80|   }
  81| 
  82|   const admin = createSupabaseAdminClient();
  83|   // R74 S39: paged. One read stopped at PostgREST's 1,000-row cap, so a week
  84|   // with more adjustments silently dropped the rest from the file.
  85|   let error: { message: string } | null = null;
  86|   const data = await pagedAll<unknown>(async (from, to) => {
  87|     if (error) return [];
  88|     const r = await admin
  89|       .from("inventory_adjustments")
  90|       .select(
  91|         "id, qty_delta, reason, note, created_at, lot:inventory_lots(id, lot_code, pos_product_key, ccrs_inventory_external_id)",
  92|       )
  93|       .gte("created_at", fromISO)
  94|       .lte("created_at", toISO)
  95|       .order("created_at", { ascending: true })
  96|       .order("id", { ascending: true })
  97|       .range(from, to);
  98|     if (r.error) error = r.error;
  99|     return (r.data as unknown[] | null) ?? [];
 100|   }, { concurrency: ADMIN_PAGED_CONCURRENCY });
 101| 
 102|   const loadErr = error as { message: string } | null; // assigned inside the pager
 103|   if (loadErr) {
 104|     result.warnings.push(`Could not load adjustments: ${loadErr.message}`);
 105|     result.csv = buildAdjustmentFile([], license);
 106|     return result;
 107|   }
 108| 
 109|   const rows: string[][] = [];
 110|   for (const raw of (data ?? []) as unknown as AdjustmentSourceRow[]) {
 111|     const lotRel = (raw as { lot: unknown }).lot;
```

`src/lib/compliance/ccrs-sale-correction-core.ts` L80-L160 — mapSaleCorrectionRow (Delete full / Update partial), buildSaleCorrectionFile, makeSaleCorrectionFileName

```ts
  80| /** Pro-rate a whole-line money amount to a remaining quantity. */
  81| export function prorateLineMinor(lineMinor: number, remainingQty: number, originalQty: number): number {
  82|   if (!(originalQty > 0)) return 0;
  83|   const r = Math.max(0, Math.min(remainingQty, originalQty));
  84|   return Math.round((lineMinor * r) / originalQty);
  85| }
  86| 
  87| /** Map one customer-return correction to a CCRS Sale.csv row. PURE. */
  88| export function mapSaleCorrectionRow(
  89|   src: SaleCorrectionSource,
  90|   license: { licenseNumber: string; submittedBy: string },
  91| ): SaleCorrectionRowResult {
  92|   if (!src.saleExternalId || !src.saleDetailExternalId) {
  93|     return { row: null, skipReason: "missing original sale identifiers (required on Update/Delete)" };
  94|   }
  95|   if (!src.inventoryExternalId) {
  96|     return { row: null, skipReason: "missing InventoryExternalIdentifier (required on Update/Delete)" };
  97|   }
  98|   if (!(src.originalQuantity > 0) || !(src.returnQuantity > 0)) {
  99|     return { row: null, skipReason: "quantities must be positive" };
 100|   }
 101|   if (src.returnQuantity > src.originalQuantity) {
 102|     return { row: null, skipReason: "return quantity exceeds original quantity" };
 103|   }
 104| 
 105|   const remaining = src.originalQuantity - src.returnQuantity;
 106|   const isDelete = src.correctionOperation === "Delete" || remaining <= 0;
 107|   const qty = isDelete ? src.originalQuantity : remaining;
 108|   // D227: a partial Update must still satisfy CCRS's printed check,
 109|   // CannabisExciseTax == 37% of (Quantity x UnitPrice - Discount)
 110|   // [G L1374, L1377]. Pro-rating discount and excise SEPARATELY can break it
 111|   // by a cent (e.g. 3 x 12.30, excise 13.66, one returned: 2 x 12.30 - 0.00
 112|   // gives 9.10, pro-rated excise 9.11). So the remaining BASE is pro-rated
 113|   // once, Discount is what makes the row print that base, and excise is 37%
 114|   // of it. A line with no excise (medical, [G L1378]) keeps 0.
 115|   const originalBase = Math.max(0, src.unitPriceMinor * src.originalQuantity - src.discountMinor);
 116|   const remainingBase = prorateLineMinor(originalBase, remaining, src.originalQuantity);
 117|   const discount = isDelete ? src.discountMinor : Math.max(0, src.unitPriceMinor * qty - remainingBase);
 118|   const salesTax = isDelete ? src.salesTaxMinor : prorateLineMinor(src.salesTaxMinor, remaining, src.originalQuantity);
 119|   const excise = isDelete
 120|     ? src.exciseMinor
 121|     : src.exciseMinor > 0
 122|       ? Math.round((remainingBase * CCRS_EXCISE_RATE_BPS) / 10000)
 123|       : 0;
 124| 
 125|   const saleDate = ccrsDateLoose(src.saleDateISO);
 126|   // "Updated Date cannot be prior to Created Date" — clamp forward if needed
 127|   // (compared as Pacific calendar days, the granularity CCRS validates).
 128|   const returnedDate = ccrsDateLoose(src.returnedAtISO);
 129|   const updatedDate = dayNumber(returnedDate) < dayNumber(saleDate) ? saleDate : returnedDate;
 130| 
 131|   const row = [
 132|     license.licenseNumber, // LicenseNumber
 133|     "", // SoldToLicenseNumber (retail = blank)
 134|     src.inventoryExternalId, // InventoryExternalIdentifier
 135|     "", // PlantExternalIdentifier
 136|     src.saleType, // SaleType (must match the original Insert)
 137|     saleDate, // SaleDate (must match the original Insert)
 138|     String(qty), // Quantity (Delete: original; Update: REMAINING)
 139|     dollars(src.unitPriceMinor), // UnitPrice (unchanged per-unit)
 140|     dollars(discount), // Discount
 141|     dollars(salesTax), // RetailSalesTax
 142|     dollars(excise), // CannabisExciseTax
 143|     src.saleExternalId, // SaleExternalIdentifier (ORIGINAL)
 144|     src.saleDetailExternalId, // SaleDetailExternalIdentifier (ORIGINAL)
 145|     license.submittedBy, // CreatedBy
 146|     saleDate, // CreatedDate (original)
 147|     license.submittedBy, // UpdatedBy (required on corrections)
 148|     updatedDate, // UpdatedDate (>= CreatedDate)
 149|     isDelete ? "Delete" : "Update", // Operation
 150|   ];
 151|   return { row };
 152| }
 153| 
 154| /** Assemble the correction file (3-row header + Sale columns + rows). */
 155| export function buildSaleCorrectionFile(
 156|   rows: string[][],
 157|   license: { licenseNumber: string; submittedBy: string },
 158| ): string {
 159|   return assembleCcrsFile({ type: "Sale", submittedBy: license.submittedBy, rows });
 160| }
```

## G. Returns / disposition — `src/lib/inventory/disposition.ts`

`src/lib/inventory/disposition.ts` L455-L480 — createCustomerReturn contract (FAQ: 'sale identifier should be deleted … inventory identifier reported on an Inventory Adjustment as a return')

```ts
 455|  * and in CCRS, never sellable (sale-lot-read, POS menu, sellability report).
 456|  * Before 0308 the old writes run and any failure undoes the add-back.
 457|  */
 458| export async function createCustomerReturn(
 459|   input: {
 460|     orderId: string;
 461|     orderLineId: string;
 462|     lotId?: string | null;
 463|     quantity: number;
 464|     disposition: CustomerReturnDisposition;
 465|     reason: string;
 466|     detail?: string | null;
 467|     refundMinor: number;
 468|     originalPackaging: boolean;
 469|     lotIdLegible: boolean;
 470|   },
 471|   actorId: string | null,
 472| ): Promise<{ ok: true; id: string; held: boolean; notice?: string } | { ok: false; error: string }> {
 473|   if (!isSupabaseServiceConfigured) {
 474|     return { ok: false, error: "Supabase service role not configured." };
 475|   }
 476|   const admin = createSupabaseAdminClient();
 477| 
 478|   // ── Load the original order + line ─────────────────────────────────────────
 479|   const [{ data: order }, { data: line }] = await Promise.all([
 480|     admin
```

`src/lib/inventory/disposition.ts` L595-L630 — CCRS Sale-row snapshot + medical mirror

```ts
 595|           }[]
 596|         | null) ?? [];
 597|     lotRow = candidates.find((c) => c.status !== "quarantine") ?? candidates[0] ?? null;
 598|     lotId = lotRow?.id ?? null;
 599|   }
 600|   if (!lotRow || !lotId) {
 601|     return {
 602|       ok: false,
 603|       error:
 604|         "The system couldn't tell which inventory lot this product came from. Pick the lot by hand (the lot number is printed on the package) so the returned item goes ba
 605|     };
 606|   }
 607| 
 608|   // ── Snapshot the CCRS Sale-row data for the correction file ───────────────
 609|   const inventoryExternalId = resolveSaleInventoryExternalId({
 610|     lineExplicit: l.ccrs_inventory_external_id,
 611|     // S-10: the correction must reference the id the lot was FILED under.
 612|     lotCanonical: deriveInventoryExternalId({
 613|       ccrs_inventory_external_id: lotRow.ccrs_inventory_external_id ?? null,
 614|       lot_code: lotRow.lot_code,
 615|       pos_product_key: lotRow.pos_product_key,
 616|       id: lotRow.id,
 617|     }),
 618|     posProductKey: lineLotKey,
 619|   }).value;
 620| 
 621|   const qty = Number(l.quantity) || 0;
 622|   const soldUnit = l.price_minor_units ?? 0; // tax-INCLUSIVE out-the-door unit
 623|   const regularUnit = l.regular_price_minor_units ?? soldUnit; // tax-INCLUSIVE
 624| 
 625|   // Medical + tax status mirror the Sale.csv builder (see ccrs-sales.ts).
 626|   let isMedical = false;
 627|   let salesExempt = false;
 628|   let exciseExempt = false;
 629|   try {
 630|     const { data: exemptRows } = await admin
```

`src/lib/inventory/disposition.ts` L675-L705 — postAddition 'return' + destroy branch

```ts
 675|     soldUnitMinorUnits: soldUnit,
 676|     regularUnitMinorUnits: regularUnit,
 677|     quantity: qty,
 678|     isCannabis,
 679|     salesExempt,
 680|     exciseExempt,
 681|     combinedSalesRateBps: combinedBps,
 682|     exciseRateBps: taxSettings.exciseRateBps,
 683|   });
 684|   const preTaxRegularUnit = money.unitPriceMinor;
 685|   const discountCents = money.discountMinor;
 686|   const salesTaxCents = money.salesTaxMinor;
 687|   const exciseCents = money.exciseMinor;
 688| 
 689|   const saleExternalId = o.order_number || o.id;
 690|   const saleDetailExternalId = `${saleExternalId}-${l.id.slice(0, 8)}`;
 691|   const saleDate = pacificDayKey(o.completed_at ?? o.placed_at); // YYYY-MM-DD
 692| 
 693|   // ── Post the POSITIVE add-back adjustment (internal 'return' → CCRS Other) ─
 694|   const note = buildCustomerReturnAdjustmentNote({
 695|     quantity: input.quantity,
 696|     unit: null,
 697|     reason: input.reason,
 698|     disposition: input.disposition,
 699|     saleExternalId,
 700|     detail: input.detail,
 701|   });
 702|   const returnRow = {
 703|     order_id: o.id,
 704|     order_line_id: l.id,
 705|     sale_external_id: saleExternalId,
```

`src/lib/inventory/disposition.ts` L780-L800 — createVendorReturn (reducing 'other' adjustment)

```ts
 780|     );
 781|     if (!scheduled.ok) {
 782|       await undoAddition(admin, lotId, input.quantity, posted.adjustmentId, actorId, false);
 783|       return { ok: false, error: `The destruction event could not be opened, so the return was not saved and the add-back was undone: ${scheduled.error}` };
 784|     }
 785|     destructionEventId = scheduled.id;
 786|   }
 787| 
 788|   const { data: created, error: insErr } = await admin
 789|     .from("customer_returns")
 790|     .insert({
 791|       ...returnRow,
 792|       lot_id: lotId,
 793|       quantity: input.quantity,
 794|       adjustment_id: posted.adjustmentId,
 795|       destruction_event_id: destructionEventId,
 796|       created_by: actorId,
 797|     })
 798|     .select("id")
 799|     .single();
 800|   if (insErr || !created) {
```

`src/lib/inventory/disposition.ts` L968-L985 — completeDestruction head ('destruction')

```ts
 968|       cancelled_by: nameOf(who.cancelled_by),
 969|     },
 970|   };
 971| }
 972| 
 973| export async function getVendorReturn(id: string): Promise<VendorReturn | null> {
 974|   if (!isSupabaseServiceConfigured) return null;
 975|   const admin = createSupabaseAdminClient();
 976|   const { data } = await admin.from("vendor_returns").select("*").eq("id", id).maybeSingle();
 977|   return (data as VendorReturn | null) ?? null;
 978| }
 979| 
 980| /**
 981|  * Fix Phase 1.5 (G-42 req 1, 2, 6; F-15-1, F-15-2; D63 (4), D65): log a vendor
 982|  * return. The units are RESERVED (inventory_lots.held_qty): out of sale but
 983|  * still on hand and in CCRS. Nothing posts to CCRS now; the reduction and the
 984|  * CCRS Other adjustment post at departure (departVendorReturn). RMA, vendor,
 985|  * numeric processor license and detail are required; a Recalled lot may be
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
  25|  *   • Is Sample is always "False"; Is Cannabis was always "True" in that old
  26|  *     UI export (it hid non-cannabis rows). The API harvest now includes
  27|  *     non-cannabis lots; R74 Slice 1 (cultivera-noncannabis-gate-core) removes
  28|  *     them inside transformWorkbooks, so no lot source here is ever non-cannabis.
  29|  *
  30|  * Identity & idempotency: one planned lot per BARCODE. Duplicate-barcode rows
```

`src/lib/pos/import-lot-core.ts` L45-L50 — PlannedLot.barcode doc

```ts
  45| import { parseCultiveraTimestamp } from "@/lib/inventory/cultivera-manifest-group-core";
  46| 
  47| export type ImportLotSource = {
  48|   /** menu_items.source_item_id of the card this row rolled into (`pos-…`). */
  49|   posProductKey: string;
  50|   /**
```

`src/lib/pos/import-lot-core.ts` L78-L83 — lot_code = barcode; ccrsExternalId = sanitized barcode

```ts
  78|   expirationDateRaw: string;
  79|   /** Raw [COA Y/N] cell ("Y" / "N" / ""). */
  80|   coaRaw: string;
  81|   isMedical: boolean;
  82|   isSample: boolean;
  83|   /** Parsed package quantity for the variant this row collapsed into. */
```

`src/lib/pos/import-lot-core.ts` L416-L426 — L420: ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode

```ts
 416|  *     price, so it changes when that price changes).
 417|  */
 418| export function planSizeLinkFill(
 419|   planned: readonly Pick<PlannedImportLot, "ccrsExternalId" | "posProductKey" | "menuSourceVariantId" | "productName">[],
 420|   existing: readonly ExistingLotSizeLink[],
 421|   liveVariantIds: ReadonlySet<string> | null,
 422| ): SizeLinkFillPlan {
 423|   const byExt = new Map(planned.map((l) => [l.ccrsExternalId, l]));
 424|   const out: SizeLinkFillPlan = { writes: [], matched: 0, unchanged: 0, ownerKept: 0, noSize: 0, keyMismatch: 0, notOnMenu: 0, examples: [] };
 425|   const example = (reason: SizeLinkFillPlan["examples"][number]["reason"], l: { ccrsExternalId: string; productName: string }) => {
 426|     if (out.examples.filter((e) => e.reason === reason).length < 5) out.examples.push({ reason, ccrsExternalId: l.ccrsExternalId, productName: l.productName });
```

`src/lib/pos/import-service.ts` L440-L460 — Dedupe by ccrs_inventory_external_id; why imported lots are 'active' (already reported by Cultivera as integrator)

```ts
 440|     );
 441|     // SLICE 4A: the reconciliation arithmetic is computed FROM these buckets,
 442|     // so it cannot detect that its own inputs came back short. Corroborate the
 443|     // read against independent witnesses BEFORE trusting the equation.
 444|     // `getVersionItems` returns [] on a read error, which previously
 445|     // reconciled as a "trivially balanced" empty import and OPENED the gate --
 446|     // the evidence check turns that fail-open into a refusal.
 447|     const gate = evaluateCommitGate(buckets, {
 448|       observedItems: items.length,
 449|       recordedItemCount: (version as MenuVersion).item_count,
 450|       serverItemCount,
 451|       observedReviews: reviewsResult.reviews.length,
 452|       reviewsReadFailed: !reviewsResult.ok,
 453|     }, { acknowledgedPendingCount: options.acknowledgedPendingCount ?? null });
 454|     if (!gate.ready) throw new Error(gate.message);
 455|     openReviewsAcknowledged = gate.openReviewsAcknowledged;
 456|     // Persist the balanced equation so the audit trail shows exactly what
 457|     // this publish committed (idempotent by code+import via the review UI).
 458|     await persistDiagnostics(importId, [
 459|       {
 460|         severity: "info",
```

`src/lib/inventory/intake-store.ts` L650-L668 — Intake writes ccrs_inventory_external_id via deriveInventoryExternalId({pos_product_key, lot_code})

```ts
 650|   //    behaviour. Most manifests spell the brand exactly, so this is the
 651|   //    common case and costs exactly what it always cost.
 652|   {
 653|     let q = admin.from("brands").select("id, display_name, vendor_id").ilike("display_name", clean).limit(1);
 654|     if (vendorId) q = q.eq("vendor_id", vendorId);
 655|     const { data } = await q;
 656|     const row = (data as BrandCandidate[] | null)?.[0];
 657|     if (row?.id) {
 658|       return {
 659|         brandId: row.id,
 660|         outcome: { kind: "exact", brandId: row.id, matched: row.display_name ?? clean },
 661|       };
 662|     }
 663|   }
 664| 
 665|   // 2) SQUEEZED PATH — only reached on a miss. Scan COMPLETELY (PostgREST caps
 666|   //    a response at 1,000 rows and `.limit(n)` cannot raise that cap; the
 667|   //    vendor resolver above was already burned by exactly that), then let the
 668|   //    PURE core decide using the shared brandKey().
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
 388| /** D195: the receiving warning for a WCIA line keyed by its barcode (no product SKU). */
 389| export const NO_SKU_LINE_WARNING =
 390|   "No product SKU on this line, so the lot is keyed by its barcode. Finish it in Product Onboarding so it joins its menu card; otherwise link it on Inventory > Stock on n
 391| 
 392| function parseWciaLine(item: unknown): ParsedLine {
 393|   const warnings: string[] = [];
 394|   if (!isObj(item)) {
 395|     return blankLine(item, ["Line was not an object."]);
 396|   }
 397| 
 398|   const product_name = asString(pick(item, ["product_name"]));
 399|   const lot_code = asString(pick(item, ["inventory_id"]));
 400|   const sku = asString(pick(item, ["product_sku"]));
 401|   const qty = asNumber(pick(item, ["qty"])) ?? 0;
 402|   const linePrice = asNumber(pick(item, ["line_price"]));
 403|   const unit = asString(pick(item, ["uom"])) ?? "ea";
 404|   // Rule 1.4 (docs/data-governance.md): split strain TYPE out of the strain
 405|   // NAME at the door — vendor lines like "Chocolate Turtle Sativa" pollute
 406|   // the name box otherwise (real Grow Op Farms / Cultivera behavior).
 407|   const strainSplit = splitStrainField(
 408|     asString(pick(item, ["strain_name"])),
 409|     asString(pick(item, ["strain_type", "strain_class", "phenotype"])),
 410|   );
 411|   const strain = strainSplit.strainName;
 412|   const category = asString(pick(item, ["inventory_category"]));
 413|   const inventory_type = asString(pick(item, ["inventory_type"]));
 414|   const is_sample = asBool(pick(item, ["is_sample"])) === true;
 415|   const is_medical = asBool(pick(item, ["is_medical"])) === true;
 416|   const unit_weight = asNumber(pick(item, ["unit_weight"]));
```

`src/lib/inventory/intake-parser.ts` L438-L446 — WCIA JSON: manifest_number ← transfer_id/external_id; vendor_label ← from_license_name

```ts
 438|   // D195 step 2 (root cause): with no product SKU the lot is keyed by its
 439|   // barcode below. Product Onboarding joins it to its menu card; if the
 440|   // manifest is rejected or the draft is skipped, the lot stays on no card
 441|   // (cost, FIFO and Promotions cannot see it) until linked on
 442|   // /admin/inventory/unlinked.
 443|   if (!sku && lot_code) warnings.push(NO_SKU_LINE_WARNING);
 444| 
 445|   return {
 446|     product_name,
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
 175|         fallbackAbsoluteLevel: u.newLevel,
 176|       });
 177|     }
 178|     for (const u of variantPlan.itemStatusUpdates) {
 179|       await admin.from("menu_items").update({ inventory_status: u.newStatus }).eq("id", u.rowId);
 180|     }
 181| 
 182|     // ── Layer 2: inventory lots (FIFO oldest-first, active only) ──────────
 183|     // Mastering Slice 1: load lots for BOTH the card keys and each variant's
 184|     // own encoded lot key (single-lot cards: identical set, so nothing new
 185|     // is fetched; mastered cards: every size's lot is present for the plan).
 186|     const lotKeys = lotKeysForLines(lines);
 187|     let lots: LotForDecrement[] = [];
 188|     // R74 S31: the shared reader (the cost replan uses the same one) also
 189|     // carries each lot's size link (0294) so a sold size draws from its own lots.
 190|     let sizeLinkPending = false;
 191|     const heldByLot = new Map<string, number>();
 192|     if (lotKeys.length > 0) {
 193|       const read = await readSaleLots(admin, lotKeys);
 194|       if (!read.ok) throw new Error(`Could not read the lots to draw from: ${read.error}`);
 195|       sizeLinkPending = read.sizeLinkPending;
 196|       for (const r of read.rows) if (r.held_qty > 0) heldByLot.set(r.id, r.held_qty);
 197|       lots = read.rows
 198|         .filter((r) => !!r.pos_product_key)
 199|         .map((r) => ({
 200|           id: r.id,
 201|           posProductKey: r.pos_product_key as string,
 202|           // Fix Phase 1.4 (G-44): plan on SELLABLE units; held units are never drawn.
 203|           onHandQty: sellableQty(r.on_hand_qty, r.held_qty),
 204|           // The lot's canonical CCRS id — identical derivation to the weekly
 205|           // Sale.csv builder's lot index (explicit → lot_code → key → LOT-id).
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
  28| import { duplicateEmitLine } from "@/lib/compliance/ccrs-reupload-core";
  29| import { requirePermission } from "@/lib/auth/session";
  30| import { can } from "@/lib/auth/roles";
  31| import { recordAudit } from "@/lib/auth/audit";
  32| import { resolveRange } from "@/lib/reports/range";
  33| import { heldRecordsOf } from "@/lib/compliance/ccrs-held-back-core";
  34| import { recordHeldBack } from "@/lib/compliance/ccrs-held-store";
  35| import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
  36| import { verifyCcrsBatch, classifyWarning } from "@/lib/compliance/ccrs-batch-core";
  37| import {
  38|   assertCcrsBatchSubmittable,
  39|   toGateInput,
  40|   verdictSummary,
  41|   type GateIssue,
  42| } from "@/lib/compliance/ccrs-submit-gate-core";
  43| import { issuePlainText } from "@/lib/compliance/ccrs-issue-display-core";
  44| import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
  45| import { emitOutboxFiles, listCcrsFiles, readStoredFile } from "@/lib/compliance/ccrs-ledger-store";
  46| import { unansweredWarningLines } from "@/lib/compliance/ccrs-answer-core";
  47| import { markCorrectionsExported } from "@/lib/inventory/disposition";
  48| import {
  49|   emitPayload,
  50|   planOutboxFiles,
  51|   verifyOutboxAgainstLedger,
  52|   outboxReadmeLines,
  53|   type EmitIssue,
  54| } from "@/lib/compliance/ccrs-outbox-core";
  55| import { ccrsPortalUrl } from "@/lib/compliance/ccrs-lifecycle-core";
  56| import { createSupabaseAdminClient } from "@/lib/supabase/admin";
  57| import { buildZip } from "@/lib/reports/zip";
  58| 
  59| export const dynamic = "force-dynamic";
  60| export const runtime = "nodejs";
  61| /** A full batch reads ~4,200 lots and writes up to tens of thousands of rows in one transaction. */
  62| export const maxDuration = 300;
  63| 
  64| const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  65| 
  66| export async function GET(request: Request) {
  67|   const session = await requirePermission("reports.view");
  68|   if (!can(session.profile.role, "settings.manage")) {
  69|     return new Response("Generating the CCRS batch requires the Change settings permission.", { status: 403 });
  70|   }
```

`src/app/admin/reports/compliance/batch-export/route.ts` L130-L145 — zip name CCRS_batch_<license>_<from>_<to>.zip

```ts
 130|     ]);
 131|   }
 132| 
 133|   // S-12b step 3: chunk + stamp the exact bytes.
 134|   const planned = planOutboxFiles(
 135|     batch.files.map((f) => ({ type: f.type, csv: f.csv })),
 136|     {
 137|       licenseNumber: batch.licenseNumber,
 138|       now: new Date(batch.generatedAt),
 139|       lastStamp: batch.ledger.lastStamp ? new Date(batch.ledger.lastStamp) : null,
 140|     },
 141|   );
 142|   if (planned.length === 0) {
 143|     return new Response(
 144|       `Nothing to report for ${range.fromDate} to ${range.toDate}: every file is empty, and CCRS has no "no change" report [FAQ L0049].\r\n`,
 145|       { status: 200, headers: TEXT },
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
  28| import { requirePermission } from "@/lib/auth/session";
  29| import { recordAudit } from "@/lib/auth/audit";
  30| import { createSupabaseAdminClient } from "@/lib/supabase/admin";
  31| import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
  32| import { getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
  33| import { buildSaleCorrectionFile, makeSaleCorrectionFileName } from "@/lib/compliance/ccrs-sale-correction-core";
  34| import { markCorrectionsExported, readCorrectionRoute } from "@/lib/inventory/disposition";
  35| import { correctionDownloadRefusal } from "@/lib/inventory/disposition-messages-core";
  36| import { CCRS_COLUMNS, withholdUnencodableRows } from "@/lib/compliance/ccrs-batch-core";
  37| import {
  38|   planReturnCorrections,
  39|   returnRecordFromRow,
  40|   type CustomerReturnRowLike,
```

`src/app/admin/inventory/disposition/sale-correction-export/route.ts` L74-L82 — markCorrectionsExported after download

```ts
  74|         .limit(500);
  75|       const pendingRows = (pending as CustomerReturnRowLike[] | null) ?? [];
  76|       // Every other return of the same sale lines: the correction states the
  77|       // line after ALL its returns, not just the pending ones.
  78|       const lineIds = [...new Set(pendingRows.map((r) => (r.sale_detail_external_id ?? "").trim()).filter(Boolean))];
  79|       const { data: siblings } = lineIds.length
  80|         ? await admin.from("customer_returns").select(RETURN_COLUMNS).in("sale_detail_external_id", lineIds)
  81|         : { data: [] };
  82|       const byId = new Map<string, ReturnRecord>();
```

`src/app/admin/compliance/ccrs/page.tsx` L81-L110 — CcrsCommandCenterPage head

```ts
  81| import { errorsFromStored, mailConfigFromEnv } from "@/lib/compliance/ccrs-mail-core";
  82| import { parseNotProcessed } from "@/lib/compliance/ccrs-whole-file-core";
  83| import {
  84|   applyAllCcrsMailAction,
  85|   applyCcrsErrorMailAction,
  86|   applyCcrsNotProcessedMailAction,
  87|   applyCcrsSuccessMailAction,
  88|   dismissCcrsMailAction,
  89|   pollCcrsMailNowAction,
  90| } from "./mail-actions";
  91| import { MigrationGarbagePanel } from "@/components/admin/compliance/MigrationGarbagePanel";
  92| import { CcrsIdentityProofPanel } from "@/components/admin/compliance/CcrsIdentityProofPanel";
  93| import { loadMigrationGarbage } from "@/lib/compliance/ccrs-migration-garbage-store";
  94| import { listCcrsFiles, listCcrsFilesLite } from "@/lib/compliance/ccrs-ledger-store";
  95| import { medicalSaleRowCount, pickSelectedWeek, recordGate, settle, waitingFilesOfEnv, WAITING_STATES } from "@/lib/compliance/ccrs-hub-view-core";
  96| import { CCRS_UPLOAD_ORDER } from "@/lib/compliance/ccrs-batch-core";
  97| import type { CcrsBatch } from "@/lib/compliance/ccrs-batch";
  98| import { readOwed } from "@/lib/compliance/ccrs-held-store";
  99| import { owedByWeek, owedSentence } from "@/lib/compliance/ccrs-held-back-core";
 100| import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
 101| import { ccrsPortalUrl } from "@/lib/compliance/ccrs-lifecycle-core";
 102| import { isUnansweredState, unansweredWarningLines } from "@/lib/compliance/ccrs-answer-core";
 103| 
 104| export const dynamic = "force-dynamic";
 105| // W-1 (2026-10-30): the page builds the week's batch, and its server actions
 106| // (email Apply, week sign-off) re-read files and rows. A page-level
 107| // maxDuration also covers every server action posted from this page
 108| // (Next docs: route-segment-config/maxDuration). Same ceiling as /records.
 109| export const maxDuration = 300;
 110| 
```

`src/app/admin/compliance/ccrs/page.tsx` — hub page section anchors

- L621: `title="Step 1 — Pick the reporting week"`
- L652: `title={`Step 2 — Review week ${week.start} – ${week.end}`}`
- L825: `{({ batch }) => (batch ? <CcrsAdvisorPanel aiEnabled={isAiConfigured} sp={{ from: week.start, to: week.end }} /> : null)}`
- L852: `<UploadWalkthrough`
- L953: `title="Step 3 — Record this week"`
- L1127: `<ErrorTriagePanel`
- L1140: `title="DOH / Medical sales"`
- L1206: `title="Monthly LIQ-1295 (tax report)"`
- L1279: `<PushRemindersPanel />`
- L1289: `<Section title="Submission ledger" subtitle="Newest first. This is the evidence trail.">`

`src/app/admin/compliance/ccrs/actions.ts` — server actions

- L12: `import { revalidatePath } from "next/cache";`
- L14: `import { requirePermission } from "@/lib/auth/session";`
- L77: `export async function resolveWeekAction(formData: FormData): Promise<void> {`
- L78: `const session = await requirePermission("settings.manage");`
- L129: `revalidatePath(BASE);`
- L134: `export async function unresolveWeekAction(formData: FormData): Promise<void> {`
- L135: `const session = await requirePermission("settings.manage");`
- L152: `revalidatePath(BASE);`
- L157: `export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {`
- L158: `const session = await requirePermission("settings.manage");`
- L187: `revalidatePath(BASE);`
- L199: `export async function assignProductIdsAction(formData: FormData): Promise<void> {`
- L200: `const session = await requirePermission("settings.manage");`
- L236: `revalidatePath(BASE);`
- L280: `export async function markUploadedAction(formData: FormData): Promise<void> {`
- L281: `const session = await requirePermission("settings.manage");`
- L301: `revalidatePath(BASE);`
- L310: `export async function recordSuccessAction(formData: FormData): Promise<void> {`
- L311: `const session = await requirePermission("settings.manage");`
- L360: `revalidatePath(BASE);`
- L376: `export async function recordErrorAction(formData: FormData): Promise<void> {`
- L377: `const session = await requirePermission("settings.manage");`
- L402: `revalidatePath(BASE);`
- L429: `revalidatePath(BASE);`
- L434: `export async function recordNoEmailAction(formData: FormData): Promise<void> {`
- L435: `const session = await requirePermission("settings.manage");`
- L455: `revalidatePath(BASE);`
- L460: `export async function abandonFileAction(formData: FormData): Promise<void> {`
- L461: `const session = await requirePermission("settings.manage");`
- L480: `revalidatePath(BASE);`
- L485: `export async function startPreprodLedgerAction(formData: FormData): Promise<void> {`
- L486: `const session = await requirePermission("settings.manage");`
- L502: `revalidatePath(BASE);`
- L508: `session: Awaited<ReturnType<typeof requirePermission>>,`
- L529: `export async function settlePreprodDuplicatesAction(formData: FormData): Promise<void> {`
- L530: `const session = await requirePermission("settings.manage");`
- L547: `revalidatePath(BASE);`
- L556: `export async function assignPreprodProductIdsAction(formData: FormData): Promise<void> {`
- L557: `const session = await requirePermission("settings.manage");`
- L582: `revalidatePath(BASE);`

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
- L228: `<Link href="/admin/compliance/ccrs" className="font-bold text-[var(--admin-accent)] underline">`
- L261: `title="Full CCRS batch"`
- L262: `subtitle="Generates every file a retailer must report — Strain, Area, Product, Inventory, InventoryAdjustment, InventoryTransfer, Sale — in the exact `
- L356: `href={`/admin/reports/compliance/batch-export?${qs}`}`
- L406: `<Section title="Generate CCRS Sale.csv" subtitle="Downloads the exact file CCRS expects for the selected range.">`
- L429: `title="Generate CCRS InventoryAdjustment.csv"`
- L430: `subtitle="Reports shrink, damage, destruction, recalls, samples & cycle-count reconciliations for the range."`
- L450: `href={`/admin/reports/compliance/adjustment-export?${qs}`}`
- L471: `title="License identity"`
- L472: `subtitle="Used in the file header (SubmittedBy) and on every row (LicenseNumber / CreatedBy)."`
- L474: `<LicenseSettingsForm`
- L484: `<Section title="Recent CCRS exports">`

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
- L81: `{ label: "CCRS Benchmarks", href: "/admin/discovery/benchmarks", permission: "inventory.manage", icon: "\ud83d\udcca", group: "Product Intake" }, // 📊`
- L113: `{ label: "Employee Samples", href: "/admin/compliance/samples", permission: "settings.manage", icon: "\ud83e\uddea", group: "Employee" }, // 🧪 trade s`
- L114: `{ label: "Sample History", href: "/admin/compliance/samples/history", permission: "settings.manage", icon: "\ud83d\udccb", group: "Employee" }, // 📋 s`
- L126: `// CCRS: standalone top-header button → the Compliance Command Center (Task W;`
- L129: `{ label: "CCRS Command Center", href: "/admin/compliance/ccrs", permission: "reports.view", icon: "\ud83d\udee1\ufe0f", group: "CCRS" }, // 🛡️ complia`
- L130: `{ label: "CCRS Sales Check", href: "/admin/compliance/sales-check", permission: "reports.view", icon: "\u2705", group: "CCRS" }, // D183: every sale f`
- L131: `{ label: "Taxes Owed", href: "/admin/compliance/taxes-owed", permission: "reports.view", icon: "\ud83e\uddfe", group: "CCRS" }, // D183: excise + sale`
- L132: `{ label: "Compliance Health", href: "/admin/compliance/health", permission: "reports.view", icon: "\ud83e\ude7a", group: "CCRS" }, // 🩺 health check`
- L133: `{ label: "Regulatory Watch", href: "/admin/compliance/regulatory", permission: "reports.view", icon: "\ud83d\udce1", group: "CCRS" }, // 📡 rule-change`
- L134: `{ label: "Compliance Calendar", href: "/admin/compliance/calendar", permission: "compliance.calendar", icon: "\ud83d\udcc5", group: "Lyman" }, // 📅 S-`
- L221: `{ label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "\u2696\ufe0f", group: "Admin" }, // ⚖️ legal li`
- L226: `{ label: "Sales-Limit Classification", href: "/admin/compliance/classification", permission: "inventory.manage", icon: "\ud83c\udff7\ufe0f", group: "A`
- L244: `"CCRS",`

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

### `tests/compliance/pure-selftests.test.ts` (672 L) — `describe`/`it` titles

- L99: `describe("embedded pure self-test suites", () => {`
- L100: `it("order-pricing-core (S-2/S-3 money math + floor)", () => {`
- L103: `it("discount-engine-core (promotions engine)", () => {`
- L106: `it("brand-match-core (SLICE T1: ONE brand matcher, real catalogue fixtures)", () => {`
- L111: `it("markdown-lock-core (SLICE C1: clearance is excluded from other deals)", () => {`
- L116: `it("brand-resolve-core (rule 11: RECEIVING intake shares the ONE brand matcher)", () => {`
- L121: `it("po-receive-core (defects A+B: auto-receive refuses ambiguous names)", () => {`
- L125: `it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {`
- L129: `it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {`
- L133: `it("weight-label-core (SLICE W1: one grams parser for discounts AND the WAC limit)", () => {`
- L136: `it("promo-guard-core (Task R: CCRS below-cost publish guard)", () => {`
- L139: `it("sales-limits-core (WAC 314-55-095 buckets)", () => {`
- L142: `it("sales-limit-gate-core (S-1 completion gate)", () => {`
- L145: `it("chunked-in (S-7 pagination)", async () => {`
- L148: `it("exempt-sale-record-core (S-8 / WAC 314-55-090(2))", () => {`
- L153: `it("medical/tax (RCW 82.08.9998 + WAC 314-55-090 exemptions, card validity)", () => {`
- L156: `it("medical-authorization-core (DOH 608-048 issuance + validity-at-date)", () => {`
- L161: `it("medical-sale-core (Task O: DOH categories, exemption plan, high-THC gate)", () => {`
- L164: `it("medical-intake-core (Task P: RCW 69.51A.230(4) date rules, age classes, card number)", () => {`
- L169: `it("sales-hours-core (WAC 314-55-147 window)", () => {`
- L172: `it("receipt-core (Pacific timestamps, receipt shape)", () => {`
- L175: `it("pin-hash (S-10 scrypt + throttle)", () => {`
- L178: `it("at-rest-crypto (S-10 AES-256-GCM envelope)", () => {`
- L181: `it("loyalty engine (points math, tiers, code gen)", () => {`
- L184: `it("loyalty-config-core (customizer drafts, RCW discount cap)", () => {`
- L187: `it("loyalty-sale-core (Task S-a: best-deal-wins, code spread, floors)", () => {`
- L190: `it("signup-customer-core (Task V: signup → customer create-or-link)", () => {`
- L193: `it("schedule-core (week math, Pacific)", () => {`
- L196: `it("employee-lifecycle-core (Task S-b: RCW 49.94 order, activation gate, deadlines, sick leave)", () => {`
- L200: `it("user-guards-core (Task S-c: self-rule, rank rule, privilege ceiling, last-owner rule)", () => {`
- L204: `it("campaign-rules-core (Task S-d: WAC 314-55-155 per-channel rules, warnings map)", () => {`
- L208: `it("competitive-playbook-core (Task S-d: legal plays, in-app tool links, guardrails)", () => {`
- L212: `it("midjourney-core (Creative Studio brief -> prompt assembly)", () => {`
- L215: `it("flux-core (Task U: verified per-endpoint FLUX request contracts)", () => {`
- L218: `it("flux-presets-core (R62: general-purpose prompt templates, snippets, prompt lint)", () => {`
- L221: `it("flux-video-core (R62: schema-exact FLUX 3 video t2v/i2v/v2v/edit/upscale/draft_enhance bodies)", () => {`
- L224: `it("creative-placements-core (Task U: verified destination sizes, 4MP ceiling)", () => {`
- L227: `it("ccrs-week-core (Task W: Sun–Sat week, due next Sunday, reminder planner)", () => {`
- L232: `it("ccrs-deadline-core (Slice 106 + Task W: LIQ-1295 due dates + monthly reminder planner)", () => {`
- L237: `it("ccrs-error-triage-core (Task W: error-email triage + examiner draft)", () => {`
- L245: `it("ccrs-submit-gate-core (S-01/N-06: the upload gate — errors block, warnings do not)", () => {`
- L253: `it("ccrs-preflight-core (S-02: E7-E13 blocking pre-flight checks)", () => {`
- L257: `it("ccrs-lot-product-core (Part 17 S-17b: why a lot's product is not in Product.csv)", () => {`
- L262: `it("ccrs-signin-core (Part 11 §G S-17c: CCRS signs in with WA.gov, separate PREprod account)", () => {`
- L267: `it("ccrs-handover-core (Part 09 S-17d: first upload date and hand-over warnings)", () => {`
- L272: `it("ccrs-mail-core (Part 09 S-18a: CCRS mailbox monitor, classify and prove)", () => {`
- L277: `it("ccrs-strategy-core (Part 09 S-18b: strategy report for CCRS error email)", () => {`
- L282: `it("ccrs-watchdog-core (Part 09 S-18c: no CCRS answer after 60 minutes; mailbox monitor down)", () => {`
- L287: `it("ccrs-reseed-core (Part 17 G-1, S-15: re-seed / diff of the ledger from a later delivery)", () => {`
- L292: `it("ccrs-equalize-core (Part 17 §E, S-14: equalize waves)", () => {`
- L297: `it("ccrs-copy-verify-core (Part 17 §G G-3, S-16: copy diff verifier)", () => {`
- L302: `it("ccrs-issue-display-core (Part 17 S-17a: every withheld row shown with its next step)", () => {`
- L307: `it("ccrs-ledger-core (Bible v2 S-11: ledger routing, strain casing, filed product name)", () => {`
- L310: `it("menu-feed-core (syndication feed mapping: strain normalize, stock, quantity, image)", () => {`
- L313: `it("leafly-payload-core (Leafly v2 wire format: cents, quantity, null-not-NA)", () => {`
- L316: `it("leafly-payload-validate-core (SLICE L-2: fail-closed last gate before the wire)", () => {`
- L321: `it("leafly-orderability-core (SLICE L-3: fail-closed pickup + DOH/endorsement gates)", () => {`
- L326: `it("leafly-readback-core (SLICE L-4: GET /menu parse + reconcile, fails soft)", () => {`
- L331: `it("leafly-certification-core (SLICE L-4: Leafly's five criteria, fails closed)", () => {`
- L336: `it("leafly-readback-proof-core (SLICE L-52: stored read-back verdict proves criterion 5)", () => {`
- L341: `it("strain-placeholder-core (SLICE L-52: placeholder strains become null)", () => {`
- L346: `it("leafly-readback-baseline-core (SLICE L-52: sync-state rebuild baseline)", () => {`
- L351: `it("leafly-hmac-core (SLICE L-5: raw-body HMAC, timing-safe, fails closed)", () => {`
- L363: `it("leafly-order-map-core (SLICE L-5: status vocabulary in both directions)", () => {`
- L372: `it("leafly-webhook-parse-core (SLICE L-5: fails soft, because the spec demands 200)", () => {`
- L379: `it("leafly-preview-core (SLICE L-5: the money a shopper reads before buying)", () => {`
- L397: `it("leafly-auto-ack-core (SLICE L-33: the machine presses the button)", () => {`
- L423: `it("leafly-auto-ack-sweep-core (SLICE L-33: the net under the net)", () => {`
- L459: `it("leafly-order-ack-core (SLICE L-6: talking back to Leafly, one-way doors)", () => {`
- L494: `it("leafly-schedule-core (SLICE L-7: both automation and the manual button)", () => {`
- L533: `it("leafly-evidence-core (SLICE L-8: the webhook evidence reader)", () => {`
- L554: `it("order-origin-core (SLICE L-2: website vs Leafly vs register)", () => {`
- L566: `it("leafly-bridge-core (SLICE L-10: arrival announces/prints, acceptance creates)", () => {`
- L588: `it("weedmaps-payload-core (Task X: verified Request_MenuItem variants/price/weight)", () => {`
- L595: `it("integration-credentials-core (DB-over-env overrides + masking; L-5 Leafly keys)", () => {`
- L599: `it("sync-plan-core (Task X: payload-hash idempotency + delta sync plan)", () => {`
- L602: `it("preflight-core (Task X: pre-push validation — dup ids, prices, weights)", () => {`
- L605: `it("richness-core (Task X: menu richness scoring + connection health)", () => {`
- L608: `it("sync-settings-core (Task X + L-7: transmission parameters AND the schedule)", () => {`
- L619: `it("apply-settings-core (Task X: owner toggles applied to channel payloads)", () => {`
- L622: `it("syndication-playbook (Task X: verified connect/stay/reconnect playbook + AI grounding)", () => {`
- L625: `it("leafly-order-cart-core (SLICE L-48: changing a Leafly order's items)", () => {`
- L634: `it("leafly-badge-core (Inventory LEAFLY badge)", () => {`
- L639: `it("leafly-register-lines-core (Leafly order -> register cart ids)", () => {`
- L646: `it("outbound-history-core (L-49: Order-API call history, PII-safe display/export)", () => {`
- L651: `it("ccrs-hub-flow-core (W-1: the CCRS hub never drops PREprod; email Apply scoped to the email's env)", () => {`
- L656: `it("ccrs-hub-view-core (W-2: the CCRS hub shell renders at once; heavy panels stream and never blank the page)", () => {`
- L661: `it("ccrs-inflight-hold-core (W-3: a record already in a file waiting for its CCRS answer is not sent twice)", () => {`
- L666: `it("cart-picker-core (L-50: picker offers only sizes the Leafly payload sends)", () => {`

### Golden fixtures (`tests/compliance/golden/ccrs/`)

- `Area.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Area,IsQuarantine,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation`
- `Inventory.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,Create`
- `InventoryAdjustment.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryExternalIdentifier,AdjustmentReason,AdjustmentDetail,Quantity,AdjustmentDate,ExternalIdentifier,C`
- `InventoryTransfer.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`FromLicenseNumber,ToLicenseNumber,FromInventoryExternalIdentifier,ToInventoryExternalIdentifier,Quantity,TransferDate,Ex`
- `Product.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,`
- `Sale.golden.csv`: rows=7, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPri`
- `Strain.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate`

