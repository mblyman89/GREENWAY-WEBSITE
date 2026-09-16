# 03 — Code Anchor Atlas (generated from the tree)

Generated 2026-09-16 00:16Z at commit `b90851dc69ccb1191a1a5de68b20c27f3771b37d` by `build_atlas_part.py`.

**Rules for using this part**

1. Every `L####` here was read from the file at the commit above. Before editing, run `git diff b90851d -- <file>`; if the file changed, re-run the generator and re-pin.
2. Snippets are verbatim. If a snippet here disagrees with the file, the FILE wins and this part must be regenerated — never 'fix' the atlas by hand.
3. Anchors are grouped by the flow they belong to: (A) batch builders, (B) core/pure helpers, (C) identifiers, (D) week/ledger, (E) triage/gate, (F) adjustments & corrections, (G) returns/disposition, (H) intake & Cultivera identity, (I) routes/pages/components, (J) schema.

## 0. Module inventory (line counts + every `export` with its line)

### `src/lib/compliance/ccrs-batch.ts` (653 L)

- L45: `export type CcrsFile = {`
- L57: `export type CcrsSyncIssue = {`
- L64: `export type CcrsBatch = {`
- L424: `export async function buildCcrsBatch(fromISO: string, toISO: string): Promise<CcrsBatch> {`

### `src/lib/compliance/ccrs-batch-core.ts` (1304 L)

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
- L582: `export function ccrsCell(v: unknown): string {`
- L595: `export function ccrsDate(iso: string | Date): string {`
- L617: `export function ccrsFileStamp(now: Date = new Date()): string {`
- L630: `export function ccrsFileName(`
- L647: `export function assembleCcrsFile(opts: {`
- L690: `export function padHeaderRowsForTemplates(`
- L728: `export function verifySaleNumericColumns(rows: ReadonlyArray<readonly string[]>): CcrsBatchProblem[] {`
- L765: `export type CcrsBatchProblem = {`
- L771: `export type CcrsBatchVerification = {`
- L782: `export function splitCsvLine(line: string): string[] {`
- L828: `export function verifyCcrsFile(`
- L965: `export function verifyCcrsBatch(`
- L982: `export function __runCcrsBatchCoreTests(): void {`

### `src/lib/compliance/ccrs-sales.ts` (515 L)

- L46: `export type CcrsLicenseSettings = {`
- L51: `export type CcrsBuildResult = {`
- L84: `export async function getCcrsLicenseSettings(): Promise<CcrsLicenseSettings> {`
- L183: `export async function buildCcrsSaleCsv(fromISO: string, toISO: string): Promise<CcrsBuildResult> {`

### `src/lib/compliance/ccrs-identifiers.ts` (347 L)

- L29: `export const CCRS_EXTERNAL_ID_MAX = 100;`
- L41: `export function sanitizeExternalId(raw: string): string {`
- L53: `export function validateExternalId(value: string | null | undefined): string[] {`
- L75: `export function validateLicenseNumber(`
- L100: `export type ExternalIdCollision = {`
- L115: `export function findExternalIdCollisions(`
- L132: `export type SaleIdProblem = {`
- L146: `export function checkSaleIdentifierIntegrity(`
- L198: `export type LotIdentitySource = {`
- L221: `export function deriveInventoryExternalId(src: LotIdentitySource): string | null {`
- L245: `export function resolveSaleInventoryExternalId(opts: {`
- L264: `export function __runCcrsIdentifierTests(): { passed: number; failed: number } {`

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

### `src/lib/compliance/ccrs-inventory-adjustment-core.ts` (374 L)

- L22: `export type CcrsLicenseLike = {`
- L32: `export const CCRS_ADJUSTMENT_REASONS = [`
- L41: `export type CcrsAdjustmentReason = (typeof CCRS_ADJUSTMENT_REASONS)[number];`
- L58: `export function mapAdjustmentReason(internal: string): CcrsAdjustmentReason {`
- L97: `export function isReportableAdjustment(internal: string, qtyDelta: number): boolean {`
- L109: `export function mmddyyyy(iso: string | Date): string {`
- L114: `export function cell(v: unknown): string {`
- L121: `export function adjustmentQuantity(qtyDelta: number): string {`
- L127: `export function adjustmentDetail(note: string | null | undefined): string {`
- L135: `export const ADJUSTMENT_COLUMNS = [`
- L154: `export type AdjustmentSourceRow = {`
- L167: `export type AdjustmentMapResult = {`
- L173: `export function mapAdjustmentRow(`
- L217: `export function buildAdjustmentFile(rows: string[][], license: CcrsLicenseLike): string {`
- L226: `export function makeAdjustmentFileName(licenseNumber: string): string {`
- L234: `export function __runCcrsAdjustmentTests(): void {`

### `src/lib/compliance/ccrs-inventory-adjustment.ts` (112 L)

- L23: `export {`
- L32: `export type {`
- L38: `export type CcrsAdjustmentBuildResult = {`
- L51: `export async function buildCcrsInventoryAdjustmentCsv(`

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

### `src/lib/inventory/disposition.ts` (1170 L)

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
- L751: `export async function markCorrectionsExported(ids: string[]): Promise<void> {`
- L768: `export async function listVendorReturns(limit = 100): Promise<VendorReturnWithLot[]> {`
- L783: `export async function createVendorReturn(`
- L853: `export async function updateVendorReturnManifest(`
- L884: `export async function listDestructionEvents(limit = 100): Promise<DestructionEventWithLot[]> {`
- L899: `export async function getDestructionEvent(id: string): Promise<DestructionEvent | null> {`
- L913: `export async function scheduleDestruction(`
- L973: `export async function completeDestruction(`
- L1074: `export async function cancelDestruction(`
- L1092: `export type DispositionSummary = {`
- L1100: `export async function dispositionSummary(): Promise<DispositionSummary> {`

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

### `src/lib/inventory/intake-store.ts` (2060 L)

- L118: `export async function listManifests(opts?: {`
- L140: `export async function countManifestsByStatus(): Promise<StageCounts> {`
- L192: `export async function resolveOrCreateVendor(`
- L428: `export async function resolveBrandId(`
- L440: `export async function resolveBrandIdDetailed(`
- L513: `export async function stageManifest(`
- L716: `export async function rejectManifest(`
- L776: `export async function setLotDisposition(`
- L833: `export async function preflightManifestSampleCap(`
- L971: `export async function gatherSampleCapNotice(manifestId: string): Promise<`
- L1034: `export async function finalizeManifestDispositions(`
- L1435: `export async function seedIncomingSampleEvents(`
- L1536: `export async function rememberVendorUsualTransport(`
- L1584: `export async function listManifestLots(manifestId: string) {`
- L1638: `export async function listLabFactsByIds(`
- L1706: `export type ManifestLotExportRow = {`
- L1734: `export async function listAllManifestLotsForExport(`
- L1792: `export type ManifestLifecycleStatus =`
- L1807: `export async function logManifestEvent(`
- L1832: `export async function setManifestLifecycle(`
- L1858: `export async function updateManifestTransport(`
- L1919: `export async function setManifestInvoiceOverride(`
- L1953: `export async function seedTransportFromParsed(`
- L1998: `export async function backfillManifestTransport(`
- L2048: `export async function listManifestEvents(manifestId: string) {`

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

### `src/lib/pos/import-lot-core.ts` (777 L)

- L42: `export type ImportLotSource = {`
- L78: `export type PlannedImportLot = {`
- L126: `export type ImportLotDiagnostic = {`
- L133: `export type ImportLotPlan = {`
- L152: `export function costToMinorUnits(raw: string | null | undefined): number | null {`
- L162: `export function parseUsDate(raw: string | null | undefined): string | null {`
- L185: `export function coaFlagToBool(raw: string | null | undefined): boolean {`
- L235: `export function resolveLotCreatedAt(plannedIso: string | null, fallbackIso: string): string {`
- L248: `export function insertKeySignature(row: Record<string, unknown>): string {`
- L259: `export function findNonUniformInsertRow(`
- L279: `export function assertUniformInsertKeys(rows: readonly Record<string, unknown>[], label: string): void {`
- L308: `export function planImportLots(sources: readonly ImportLotSource[]): ImportLotPlan {`
- L524: `export function __runImportLotCoreTests(): void {`

### `src/lib/pos/import-service.ts` (794 L)

- L52: `export function sha256(buffer: Buffer | Uint8Array): string {`
- L56: `export type CreateImportInput = {`
- L66: `export type CreateImportResult = {`
- L73: `export async function findDuplicateImport(`
- L93: `export async function runImport(input: CreateImportInput): Promise<CreateImportResult> {`
- L344: `export async function publishMenuVersion(versionId: string, actorId: string | null): Promise<void> {`
- L657: `export async function countTestData(): Promise<{ imports: number; versions: number }> {`
- L671: `export async function cleanSlateTestData(): Promise<{`
- L719: `export async function backfillImportLots(`

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

### `src/app/admin/inventory/disposition/sale-correction-export/route.ts` (98 L)

- L25: `export const dynamic = "force-dynamic";`
- L26: `export const runtime = "nodejs";`
- L28: `export async function GET() {`

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

### `src/components/admin/reports/ReportTabs.tsx` (61 L)

- L13: `export type ReportTab = { href: string; label: string; icon: string };`
- L15: `export const REPORT_TABS: ReportTab[] = [`
- L34: `export function ReportTabs() {`

### `src/components/admin/admin-nav-data.ts` (230 L)

- L4: `export type AdminNavItem = {`
- L41: `export const adminNav: AdminNavItem[] = [`
- L193: `export const navGroups: AdminNavItem["group"][] = [`

## A. Batch builders — `src/lib/compliance/ccrs-batch.ts`

`src/lib/compliance/ccrs-batch.ts` L160-L193 — buildStrainFile — NOTE: no guard for Unknown/THC/Other (guide p.12 L358: 'Strain name is invalid, cannot be Unknown, THC, or Other'). Defaults StrainType to Hybrid.

```ts
 160| function buildStrainFile(
 161|   items: MenuItemRow[],
 162|   license: string,
 163|   submittedBy: string,
 164|   createdBy: string,
 165|   createdDate: string,
 166| ): { rows: string[][]; warnings: string[] } {
 167|   const warnings: string[] = [];
 168|   const seen = new Set<string>();
 169|   const rows: string[][] = [];
 170|   const defaulted: string[] = [];
 171|   for (const it of items) {
 172|     const strain = (it.strain_name ?? "").trim();
 173|     if (!strain) continue;
 174|     const key = strain.toLowerCase();
 175|     if (seen.has(key)) continue;
 176|     seen.add(key);
 177|     // B2: StrainType MUST be one of Indica/Sativa/Hybrid. Normalize the POS
 178|     // label; when it can't be resolved we default to Hybrid (safe superset) and
 179|     // flag the strain so an employee can correct it (drafts-only).
 180|     const st = normalizeStrainType(it.strain_type);
 181|     if (st.defaulted) defaulted.push(strain);
 182|     rows.push([license, strain, st.value, createdBy, createdDate]);
 183|   }
 184|   if (defaulted.length > 0) {
 185|     warnings.push(
 186|       `${defaulted.length} strain(s) had no recognizable Indica/Sativa/Hybrid type and were defaulted to "Hybrid" — set the correct StrainType before uploading: ${default
 187|         .slice(0, 15)
 188|         .join(", ")}${defaulted.length > 15 ? "…" : ""}.`,
 189|     );
 190|   }
 191|   if (rows.length === 0) warnings.push("No named strains found in the published menu.");
 192|   return { rows, warnings };
 193| }
```

`src/lib/compliance/ccrs-batch.ts` L201-L213 — buildAreaFile — emits Area 'Quarantine' IsQuarantine=TRUE whenever hasQuarantine. FAQ (Data Reporting, IsQuarantine Q): 'There are no quarantine requirements for cannabis products. You will have an entry as FALSE.' → compliance question, Part 04 flag N-01.

```ts
 201| function buildAreaFile(
 202|   hasQuarantine: boolean,
 203|   license: string,
 204|   createdBy: string,
 205|   createdDate: string,
 206| ): { rows: string[][]; warnings: string[] } {
 207|   const rows: string[][] = [];
 208|   rows.push([license, "Sales Floor", "FALSE", "AREA-SALES-FLOOR", createdBy, createdDate, "", "", "Insert"]);
 209|   if (hasQuarantine) {
 210|     rows.push([license, "Quarantine", "TRUE", "AREA-QUARANTINE", createdBy, createdDate, "", "", "Insert"]);
 211|   }
 212|   return { rows, warnings: [] };
 213| }
```

`src/lib/compliance/ccrs-batch.ts` L215-L260 — buildProductFile (part 1) — weightByKey from lots; grams may be '' when no lot weight.

```ts
 215| function buildProductFile(
 216|   items: MenuItemRow[],
 217|   lots: LotRow[],
 218|   license: string,
 219|   createdBy: string,
 220|   createdDate: string,
 221| ): { rows: string[][]; warnings: string[]; nameByProductKey: Map<string, string> } {
 222|   const warnings: string[] = [];
 223|   // CCRS joins Inventory.Product -> Product.Name by the EXACT name string. We
 224|   // record the final (clamped) Name we wrote for each raw product key so the
 225|   // Inventory file can reference the IDENTICAL string. See
 226|   // docs/CCRS_PRODUCT_NAMING_RESEARCH.md (the Inventory.Product join bug).
 227|   const nameByProductKey = new Map<string, string>();
 228|   // Weight per product key from lots (first non-null wins).
 229|   const weightByKey = new Map<string, string>();
 230|   for (const l of lots) {
 231|     const key = (l.pos_product_key ?? "").trim();
 232|     if (!key) continue;
 233|     if (!weightByKey.has(key)) {
 234|       const g = toGrams(l.unit_weight, l.unit_weight_uom);
 235|       if (g) weightByKey.set(key, g);
 236|     }
 237|   }
 238|   const seen = new Set<string>();
 239|   const usedNamesLower = new Set<string>();
 240|   const rows: string[][] = [];
 241|   for (const it of items) {
 242|     const key = (it.source_item_id ?? "").trim();
 243|     if (!key) continue;
 244|     const ext = sanitizeExternalId(key);
 245|     if (!ext || seen.has(ext)) continue;
 246|     seen.add(ext);
 247|     const rawCategory = (it.pos_inventory_category ?? "").trim();
 248|     const rawType = (it.pos_inventory_type ?? "").trim();
 249|     const grams = weightByKey.get(key) ?? "";
 250| 
 251|     // SLICE 53 (two-layer naming, owner-approved): the CCRS Product.Name is
 252|     // AUTO-COMPOSED from stored fields — short vendor + brand + display name +
 253|     // measured cannabinoid tag + type + size ("Downtown Space OG Flower 1g").
 254|     // The human-facing menu_items.name is untouched; the composed name lives
 255|     // only in these files. Falls back to the display name when composition is
 256|     // impossible (never guesses).
 257|     const composed = composeCcrsProductName({
 258|       name: (it.name ?? "").trim(),
 259|       vendor: it.vendor_name,
 260|       brand: it.brand_name,
```

`src/lib/compliance/ccrs-batch.ts` L280-L349 — buildProductFile (part 2) — classification via deriveCcrsClassificationFromType; E4 error message; clamps; warnings.slice(0,30).

```ts
 280|     // is derived from the vendor-set LCB TYPE alone (pos_inventory_type). The
 281|     // house/merchandising label (pos_inventory_category, e.g. "Pre-roll",
 282|     // "Gummies") is a STOREFRONT concept and is NOT used as a CCRS category — it
 283|     // only feeds the composed Name above. Deriving the category from the type
 284|     // (an inversion of the CCRS enum) is deterministic and never guesses; a
 285|     // blank/unknown type still raises the pre-existing ERROR safety net so a
 286|     // human fixes the source. NEVER-INVENT policy preserved.
 287|     const cls = deriveCcrsClassificationFromType(rawType);
 288|     let category = rawCategory;
 289|     let type = rawType;
 290|     if (cls.ok) {
 291|       category = cls.category;
 292|       type = cls.type;
 293|       // Advisory (never blocks): a legacy 2021-vocabulary value ("Usable
 294|       // Marijuana", inhalation concentrate under IntermediateProduct) was
 295|       // canonicalized to the current Table 2 spelling/category. Surface it so
 296|       // staff see what was translated.
 297|       if (cls.aliased && cls.aliasNote) {
 298|         warnings.push(`Product "${productName || ext}": ${cls.aliasNote}`);
 299|       }
 300|     } else {
 301|       warnings.push(`ERROR — Product "${productName || ext}": ${cls.error} Fix the CCRS mapping (Inventory types) before submitting.`);
 302|     }
 303| 
 304|     // C2: clamp Name (75) and Description (250); flag truncation (don't silently cut).
 305|     const nameClamp = clampText(productName, CCRS_PRODUCT_NAME_MAX);
 306|     if (nameClamp.truncated) {
 307|       warnings.push(`Product "${productName.slice(0, 40)}…": Name exceeds ${CCRS_PRODUCT_NAME_MAX} chars and was truncated — shorten it in the source.`);
 308|     }
 309|     // Naming-convention check (drafts-only, surfaced as a warning): if the Name
 310|     // violates the house convention (leading symbol, disallowed char, casing),
 311|     // flag it so staff fix the source. Does NOT alter the value written here.
 312|     const nameCheck = validateName(nameClamp.value);
 313|     if (!nameCheck.ok) {
 314|       warnings.push(
 315|         `Product "${nameClamp.value.slice(0, 40)}…": name convention issues — ${nameCheck.issues.map((i) => i.message).join(" ")} Suggested: "${suggestName(nameClamp.valu
 316|       );
 317|     }
 318|     // Record the exact Name for the Inventory.Product join (keyed by raw key).
 319|     nameByProductKey.set(key, nameClamp.value);
 320|     const descClamp = clampText(it.description, CCRS_PRODUCT_DESCRIPTION_MAX);
 321|     if (descClamp.truncated) {
 322|       warnings.push(`Product "${productName || ext}": Description exceeds ${CCRS_PRODUCT_DESCRIPTION_MAX} chars and was truncated — shorten it in the source.`);
 323|     }
 324| 
 325|     rows.push([
 326|       license,
 327|       category,
 328|       type,
 329|       nameClamp.value,
 330|       descClamp.value,
 331|       grams,
 332|       ext,
 333|       createdBy,
 334|       createdDate,
 335|       "",
 336|       "",
 337|       "Insert",
 338|     ]);
 339|   }
 340|   if (rows.length === 0) warnings.push("No products found in the published menu.");
 341|   // Cap the warning noise (errors first so critical mapping issues aren't buried).
 342|   const unique = [...new Set(warnings)];
 343|   const errorsFirst = [
 344|     ...unique.filter((w) => w.startsWith("ERROR")),
 345|     ...unique.filter((w) => !w.startsWith("ERROR")),
 346|   ];
 347|   const dedupWarnings = errorsFirst.slice(0, 30);
 348|   return { rows, warnings: dedupWarnings, nameByProductKey };
 349| }
```

`src/lib/compliance/ccrs-batch.ts` L351-L417 — buildInventoryFile — ext id derive; Area choice; TotalCost = unit_cost_minor_units*received_qty (0 when cost missing → guide p.17 L614 'TotalCost cannot equal 0'); IsMedical hard 'FALSE'; Operation Insert.

```ts
 351| function buildInventoryFile(
 352|   lots: LotRow[],
 353|   itemsByKey: Map<string, MenuItemRow>,
 354|   license: string,
 355|   createdBy: string,
 356|   nameByProductKey: Map<string, string>,
 357| ): { rows: string[][]; warnings: string[] } {
 358|   const warnings: string[] = [];
 359|   const rows: string[][] = [];
 360|   for (const l of lots) {
 361|     const ext = deriveInventoryExternalId({
 362|       ccrs_inventory_external_id: l.ccrs_inventory_external_id,
 363|       lot_code: l.lot_code,
 364|       pos_product_key: l.pos_product_key,
 365|       id: l.id,
 366|     });
 367|     if (!ext) {
 368|       warnings.push(`Lot ${l.id} has no usable external identifier and was skipped.`);
 369|       continue;
 370|     }
 371|     const key = (l.pos_product_key ?? "").trim();
 372|     const item = key ? itemsByKey.get(key) : undefined;
 373|     const strain = (item?.strain_name ?? "").trim();
 374|     // CCRS joins Inventory.Product -> Product.Name by the EXACT name string
 375|     // (NOT by ExternalIdentifier). Write the identical Name recorded by
 376|     // buildProductFile. See docs/CCRS_PRODUCT_NAMING_RESEARCH.md.
 377|     const productName = nameByProductKey.get(key) ?? "";
 378|     if (!productName) {
 379|       warnings.push(
 380|         `Lot ${l.id}: no matching Product.Name for key "${key}" — Inventory.Product would be blank/invalid. Ensure the product is in the published menu.`,
 381|       );
 382|     }
 383|     const area = l.status === "quarantine" || l.status === "recalled" ? "Quarantine" : "Sales Floor";
 384|     const totalCostMinor = (l.unit_cost_minor_units ?? 0) * (l.received_qty ?? 0);
 385|     rows.push([
 386|       license,
 387|       strain,
 388|       area,
 389|       productName,
 390|       String(l.received_qty ?? 0),
 391|       String(l.on_hand_qty ?? 0),
 392|       (Math.max(0, totalCostMinor) / 100).toFixed(2),
 393|       "FALSE", // IsMedical — medical exemptions are tracked per-sale, not per-lot
 394|       ext,
 395|       createdBy,
 396|       // SLICE 2 — report the day the lot was ACTUALLY received when we can
 397|       // evidence it. This used to be `ccrsDate(l.created_at)` unconditionally;
 398|       // for a lot whose POS export had a blank Received date, created_at is
 399|       // the instant the migration ran, so the LCB was being told the lot was
 400|       // created on import day. ccrsInventoryCreatedDate() prefers the
 401|       // evidenced received_on and falls back to created_at only when the date
 402|       // is genuinely unknown — and those lots are flagged for the owner rather
 403|       // than quietly given a manufactured date.
 404|       //
 405|       // This is a no-op for the ~3,977 lots that DID carry a received date:
 406|       // SLICE 1 already set their created_at to noon UTC on that same day, so
 407|       // the emitted MM/DD/YYYY is byte-identical.
 408|       ccrsDate(ccrsInventoryCreatedDate(l)),
 409|       "",
 410|       "",
 411|       "Insert",
 412|     ]);
 413|     const idErrs = validateExternalId(ext);
 414|     if (idErrs.length) warnings.push(`Inventory id "${ext}" ${idErrs.join(", ")}.`);
 415|   }
 416|   if (rows.length === 0) warnings.push("No inventory lots found to report.");
 417|   return { rows, warnings: [...new Set(warnings)].slice(0, 25) };
```

`src/lib/compliance/ccrs-batch.ts` L424-L500 — buildCcrsBatch (part 1) — license/Supabase guards E1/E2; published menu; lots pagedAll excluding status=destroyed.

```ts
 424| export async function buildCcrsBatch(fromISO: string, toISO: string): Promise<CcrsBatch> {
 425|   const license = await getCcrsLicenseSettings();
 426|   const submittedBy = license.submittedBy || "Greenway";
 427|   const createdBy = submittedBy;
 428|   const now = new Date();
 429|   const createdDate = ccrsDate(now);
 430|   const syncIssues: CcrsSyncIssue[] = [];
 431| 
 432|   const emptyBatch = (): CcrsBatch => ({
 433|     licenseNumber: license.licenseNumber,
 434|     submittedBy,
 435|     fromISO,
 436|     toISO,
 437|     files: [],
 438|     syncIssues,
 439|     totalRecords: 0,
 440|     generatedAt: now.toISOString(),
 441|   });
 442| 
 443|   if (!license.licenseNumber) {
 444|     syncIssues.push({
 445|       severity: "error",
 446|       file: "General",
 447|       message: "License number is not set. Add it in Compliance settings before generating a batch.",
 448|     });
 449|   }
 450| 
 451|   if (!isSupabaseServiceConfigured) {
 452|     syncIssues.push({ severity: "error", file: "General", message: "Supabase is not configured." });
 453|     return emptyBatch();
 454|   }
 455| 
 456|   const admin = createSupabaseAdminClient();
 457| 
 458|   // --- Master data (published menu + inventory lots) ------------------------
 459|   const versionId = await getPublishedVersionId(admin);
 460|   let items: MenuItemRow[] = [];
 461|   if (versionId) {
 462|     const { data } = await admin
 463|       .from("menu_items")
 464|       .select(
 465|         "source_item_id, name, strain_name, strain_type, pos_inventory_type, pos_inventory_category, description, brand_name, vendor_name, category, total_thc_json, total
 466|       )
 467|       .eq("menu_version_id", versionId)
 468|       .eq("hidden", false);
 469|     items = (data as MenuItemRow[] | null) ?? [];
 470|   } else {
 471|     syncIssues.push({
 472|       severity: "warning",
 473|       file: "Product",
 474|       message: "No published menu version — Strain/Product files will be empty.",
 475|     });
 476|   }
 477|   const itemsByKey = new Map(items.map((i) => [i.source_item_id.trim(), i]));
 478| 
 479|   // SLICE 2: paged. `.limit(5000)` did NOT raise the PostgREST 1,000-row cap,
 480|   // so with 4,179 lots the Inventory.csv filed with the WA LCB contained the
 481|   // first 1,000 lots and silently omitted the rest. That is an incomplete
 482|   // state traceability filing, which is why this is fixed in the same slice
 483|   // as the received date. (Selecting `received_on` for CreatedDate.)
 484|   const lots = await pagedAll<LotRow>(async (from, to) => {
 485|     const { data } = await admin
 486|       .from("inventory_lots")
 487|       .select(
 488|         "id, lot_code, pos_product_key, product_name, ccrs_inventory_external_id, received_qty, on_hand_qty, unit_cost_minor_units, unit_weight, unit_weight_uom, status, 
 489|       )
 490|       .neq("status", "destroyed")
 491|       .order("id", { ascending: true })
 492|       .range(from, to);
 493|     return (data as LotRow[] | null) ?? [];
 494|   });
 495|   const hasQuarantine = lots.some((l) => l.status === "quarantine" || l.status === "recalled");
 496| 
 497|   // --- Build each master-data file ------------------------------------------
 498|   const strain = buildStrainFile(items, license.licenseNumber, submittedBy, createdBy, createdDate);
 499|   const area = buildAreaFile(hasQuarantine, license.licenseNumber, createdBy, createdDate);
 500|   const product = buildProductFile(items, lots, license.licenseNumber, createdBy, createdDate);
```

`src/lib/compliance/ccrs-batch.ts` L540-L652 — buildCcrsBatch (part 2) — InventoryTransfer emitted EMPTY with an explanatory note (guide p.33 L1162 says it 'is required weekly by any licensed facility that receives inventory'); sort; E3; orphan products; verifySaleNumericColumns; WARNING_CAP_PER_FILE.

```ts
 540|   files.push({
 541|     type: "InventoryAdjustment",
 542|     group: uploadGroupOf("InventoryAdjustment"),
 543|     fileName: adj.fileName,
 544|     csv: adj.csv,
 545|     recordCount: adj.recordCount,
 546|     skipped: adj.skipped,
 547|     warnings: adj.warnings,
 548|     empty: adj.recordCount === 0,
 549|   });
 550|   // InventoryTransfer: only the RECEIVING licensee submits it; retail intake is
 551|   // reported via Inventory.csv. We emit an empty, correctly-shaped file and note
 552|   // it so staff know it is intentionally empty for a retailer.
 553|   push("InventoryTransfer", [], [
 554|     "InventoryTransfer is submitted by the receiving licensee; retail intake is reported via Inventory.csv. This file is intentionally empty.",
 555|   ]);
 556|   files.push({
 557|     type: "Sale",
 558|     group: uploadGroupOf("Sale"),
 559|     fileName: sale.fileName,
 560|     csv: sale.csv,
 561|     recordCount: sale.recordCount,
 562|     skipped: sale.skipped,
 563|     warnings: sale.warnings,
 564|     empty: sale.recordCount === 0,
 565|   });
 566| 
 567|   // Order files by upload group (1 → 2 → 3), preserving intra-group order.
 568|   const order = new Map(CCRS_UPLOAD_ORDER.map((t, i) => [t, i]));
 569|   files.sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99));
 570| 
 571|   // --- Sync / data-integrity analysis (flag out-of-sync BEFORE upload) ------
 572|   const lotsMissingId = lots.filter(
 573|     (l) =>
 574|       !deriveInventoryExternalId({
 575|         ccrs_inventory_external_id: l.ccrs_inventory_external_id,
 576|         lot_code: l.lot_code,
 577|         pos_product_key: l.pos_product_key,
 578|         id: l.id,
 579|       }),
 580|   ).length;
 581|   if (lotsMissingId > 0) {
 582|     syncIssues.push({
 583|       severity: "error",
 584|       file: "Inventory",
 585|       message: "Inventory lots have no usable CCRS external identifier and cannot be reported.",
 586|       count: lotsMissingId,
 587|     });
 588|   }
 589| 
 590|   // Products referenced by lots but absent from the published menu (Product.csv
 591|   // won't contain them → Inventory.Product reference would be invalid).
 592|   const productExtInFile = new Set(product.rows.map((r) => r[6]));
 593|   const orphanLotProducts = new Set<string>();
 594|   for (const l of lots) {
 595|     const ext = sanitizeExternalId((l.pos_product_key ?? "").trim());
 596|     if (ext && !productExtInFile.has(ext)) orphanLotProducts.add(ext);
 597|   }
 598|   if (orphanLotProducts.size > 0) {
 599|     syncIssues.push({
 600|       severity: "warning",
 601|       file: "Product",
 602|       message: "Inventory lots reference products not present in the published menu (Product.csv).",
 603|       count: orphanLotProducts.size,
 604|     });
 605|   }
 606| 
 607|   // Slice 96: numeric-column safety on the EMITTED Sale rows. Parse the assembled
 608|   // Sale csv's data rows (skip the 3-row header + column row) and flag any
 609|   // negative/NaN/mis-formatted Quantity or money value. Defense-in-depth — the
 610|   // builder already skips bad lines, but this guarantees the file the LCB sees is
 611|   // numerically sound. Never rewrites values.
 612|   const saleFile = files.find((f) => f.type === "Sale");
 613|   if (saleFile && saleFile.recordCount > 0) {
 614|     const saleLines = saleFile.csv.replace(/\r\n$/, "").split("\r\n").slice(4);
 615|     const saleRows = saleLines.map((l) => splitCsvLine(l));
 616|     for (const p of verifySaleNumericColumns(saleRows)) {
 617|       syncIssues.push({ severity: p.severity, file: "Sale", message: p.message });
 618|     }
 619|   }
 620| 
 621|   // Carry each file's own warnings up as sync issues with HONEST severity
 622|   // (Slice 93). Batch-blocking messages (invalid enum, missing id, etc.) become
 623|   // `error` and are NEVER dropped by the cap; advisory notes stay `warning` and
 624|   // are capped per file to avoid noise.
 625|   const WARNING_CAP_PER_FILE = 5;
 626|   for (const f of files) {
 627|     let warningCount = 0;
 628|     for (const w of f.warnings) {
 629|       const severity = classifyWarning(w);
 630|       if (severity === "error") {
 631|         // Always surface blocking errors — no cap.
 632|         syncIssues.push({ severity: "error", file: f.type, message: w });
 633|       } else if (warningCount < WARNING_CAP_PER_FILE) {
 634|         syncIssues.push({ severity: "warning", file: f.type, message: w });
 635|         warningCount += 1;
 636|       }
 637|     }
 638|   }
 639| 
 640|   const totalRecords = files.reduce((a, f) => a + f.recordCount, 0);
 641| 
 642|   return {
 643|     licenseNumber: license.licenseNumber,
 644|     submittedBy,
 645|     fromISO,
 646|     toISO,
 647|     files,
 648|     syncIssues,
 649|     totalRecords,
 650|     generatedAt: now.toISOString(),
 651|   };
 652| }
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
 581| /** CCRS dislikes embedded quotes; strip them and quote if a comma/newline. */
 582| export function ccrsCell(v: unknown): string {
 583|   const s = v == null ? "" : String(v);
 584|   const clean = s.replace(/"/g, "");
 585|   return /[,\n]/.test(clean) ? `"${clean}"` : clean;
 586| }
 587| 
 588| /**
 589|  * MM/DD/YYYY for the **Pacific** calendar day (B3). Greenway operates in
 590|  * America/Los_Angeles, so a sale/adjustment recorded after ~4–5 PM Pacific is
 591|  * the NEXT day in UTC; formatting from UTC would report the wrong calendar day
 592|  * and could slip a Saturday-evening sale into the next Sun–Sat CCRS week. We
 593|  * derive the Pacific day (via the reporting timezone helper) and reformat.
 594|  */
 595| export function ccrsDate(iso: string | Date): string {
 596|   const key = pacificDayKey(iso); // YYYY-MM-DD in America/Los_Angeles
 597|   const [yyyy, mm, dd] = key.split("-");
 598|   return `${mm}/${dd}/${yyyy}`;
 599| }
 600| 
 601| /**
 602|  * YYYYMMDDHHMMSS timestamp for the file name, in the **Pacific** wall clock.
 603|  *
 604|  * CCRS bible slice S-01 / gap N-05. The LCB FAQ is explicit:
 605|  *   "the file name should be referenced in PST"   [FAQ L0075]
 606|  * and the naming convention itself is
 607|  *   UploadType_LicenseNumber_YYYYMMDDHHMMSS       [G L0046]
 608|  *
 609|  * This used `getUTC*`. A batch generated after ~5 PM Pacific was therefore named
 610|  * with TOMORROW's date while the file's own `SubmittedDate` row (ccrsDate, which
 611|  * has always been Pacific) said today — two different days inside one upload,
 612|  * and a file name that disagrees with the week it belongs to.
 613|  *
 614|  * DST is handled by the shared Intl-based helper (`pacificParts`), so PST/PDT
 615|  * resolve correctly for any instant; no fixed offset is used anywhere.
 616|  */
 617| export function ccrsFileStamp(now: Date = new Date()): string {
 618|   const t = pacificParts(now); // America/Los_Angeles wall clock
 619|   const p = (n: number, w = 2) => String(n).padStart(w, "0");
 620|   return (
 621|     `${t.year}${p(t.month)}${p(t.day)}` + `${p(t.hour)}${p(t.minute)}${p(t.second)}`
 622|   );
 623| }
 624| 
 625| /**
 626|  * Build the CCRS file name.
 627|  *   Licensees:   UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv
 628|  * When the license number is blank we substitute LICENSE so the shape is clear.
 629|  */
 630| export function ccrsFileName(
 631|   type: CcrsRetailerFileType,
 632|   licenseNumber: string,
 633|   now: Date = new Date(),
 634| ): string {
 635|   const lic = (licenseNumber ?? "").trim() || "LICENSE";
 636|   return `${type}_${lic}_${ccrsFileStamp(now)}.csv`;
 637| }
 638| 
 639| /**
 640|  * Assemble a full CCRS file from data rows.
 641|  * Row 1: SubmittedBy,<value>
 642|  * Row 2: SubmittedDate,<MM/DD/YYYY>
 643|  * Row 3: NumberRecords,<count>   (MUST equal data-row count exactly)
 644|  * Row 4: the column header row
 645|  * Rows 5+: data rows
 646|  */
 647| export function assembleCcrsFile(opts: {
 648|   type: CcrsRetailerFileType;
 649|   submittedBy: string;
 650|   submittedDate?: Date;
 651|   rows: string[][];
 652| }): string {
 653|   const { type, submittedBy, rows } = opts;
 654|   const columns = CCRS_COLUMNS[type];
 655|   const lines: string[] = [];
 656|   lines.push(["SubmittedBy", ccrsCell(submittedBy)].join(","));
 657|   lines.push(["SubmittedDate", ccrsDate(opts.submittedDate ?? new Date())].join(","));
 658|   lines.push(["NumberRecords", String(rows.length)].join(","));
 659|   lines.push(columns.map(ccrsCell).join(","));
 660|   for (const r of rows) {
```

`src/lib/compliance/ccrs-batch-core.ts` L776-L830 — verifyCcrsFile header checks

```ts
 776| 
 777| /**
 778|  * Split one CSV line into cells, honoring double-quote wrapping (RFC-4180-ish).
 779|  * ccrsCell only wraps a cell in quotes when it contains a comma/newline/quote and
 780|  * strips inner quotes, so a simple state machine is sufficient and lossless here.
 781|  */
 782| export function splitCsvLine(line: string): string[] {
 783|   const cells: string[] = [];
 784|   let cur = "";
 785|   let inQuotes = false;
 786|   for (let i = 0; i < line.length; i++) {
 787|     const ch = line[i];
 788|     if (inQuotes) {
 789|       if (ch === '"') {
 790|         // doubled quote -> literal quote; else end of quoted region
 791|         if (line[i + 1] === '"') {
 792|           cur += '"';
 793|           i++;
 794|         } else {
 795|           inQuotes = false;
 796|         }
 797|       } else {
 798|         cur += ch;
 799|       }
 800|     } else if (ch === '"') {
 801|       inQuotes = true;
 802|     } else if (ch === ",") {
 803|       cells.push(cur);
 804|       cur = "";
 805|     } else {
 806|       cur += ch;
 807|     }
 808|   }
 809|   cells.push(cur);
 810|   return cells;
 811| }
 812| 
 813| const MMDDYYYY_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
 814| 
 815| /**
 816|  * Which column indices in each file carry a CCRS date (MM/DD/YYYY). Grounded in
 817|  * the template column names — any column whose header ends in "Date".
 818|  */
 819| function dateColumnIndexes(type: CcrsRetailerFileType): number[] {
 820|   return CCRS_COLUMNS[type]
 821|     .map((name, i) => (/date$/i.test(name) ? i : -1))
 822|     .filter((i) => i >= 0);
 823| }
 824| 
 825| /**
 826|  * Verify one assembled CCRS file string. PURE. Returns problems (may be empty).
 827|  */
 828| export function verifyCcrsFile(
 829|   type: CcrsRetailerFileType,
 830|   csv: string,
```

## C. Identifiers — `src/lib/compliance/ccrs-identifiers.ts`

`src/lib/compliance/ccrs-identifiers.ts` L30-L60 — sanitizeExternalId — replaces every non-alphanumeric run with '-' (would alter a vendor-issued id containing '_' or '.'); validateExternalId

```ts
  30| 
  31| /**
  32|  * Sanitize an arbitrary string into a CCRS-safe external identifier:
  33|  *  • keep alphanumerics; map any other run to a single hyphen
  34|  *  • trim leading/trailing hyphens
  35|  *  • clamp to 100 chars
  36|  *
  37|  * CCRS says "alpha-numeric"; in practice hyphens are widely accepted and used by
  38|  * integrators for readable ids, so we allow a single hyphen as a separator but
  39|  * never anything else.
  40|  */
  41| export function sanitizeExternalId(raw: string): string {
  42|   const cleaned = (raw ?? "")
  43|     .trim()
  44|     .replace(/[^A-Za-z0-9]+/g, "-")
  45|     .replace(/^-+|-+$/g, "");
  46|   return cleaned.slice(0, CCRS_EXTERNAL_ID_MAX);
  47| }
  48| 
  49| /**
  50|  * Validate a CCRS external identifier. Returns the list of problems (empty =
  51|  * valid). Used to surface precise warnings before an upload.
  52|  */
  53| export function validateExternalId(value: string | null | undefined): string[] {
  54|   const errs: string[] = [];
  55|   const v = (value ?? "").trim();
  56|   if (!v) {
  57|     errs.push("missing");
  58|     return errs;
  59|   }
  60|   if (v.length > CCRS_EXTERNAL_ID_MAX) errs.push(`exceeds ${CCRS_EXTERNAL_ID_MAX} characters`);
```

`src/lib/compliance/ccrs-identifiers.ts` L215-L262 — deriveInventoryExternalId (explicit → lot_code → pos_product_key → LOT-<id>) and resolveSaleInventoryExternalId

```ts
 215|  *      Inventory.csv the licensee already filed.
 216|  *   3. pos_product_key.
 217|  *   4. the DB id (prefixed) as a guaranteed-unique fallback.
 218|  *
 219|  * Returns null only if nothing usable exists.
 220|  */
 221| export function deriveInventoryExternalId(src: LotIdentitySource): string | null {
 222|   const explicit = sanitizeExternalId(src.ccrs_inventory_external_id ?? "");
 223|   if (explicit) return explicit;
 224| 
 225|   const fromLot = sanitizeExternalId(src.lot_code ?? "");
 226|   if (fromLot) return fromLot;
 227| 
 228|   const fromKey = sanitizeExternalId(src.pos_product_key ?? "");
 229|   if (fromKey) return fromKey;
 230| 
 231|   const fromId = sanitizeExternalId(src.id ? `LOT-${src.id}` : "");
 232|   if (fromId) return fromId;
 233| 
 234|   return null;
 235| }
 236| 
 237| /**
 238|  * Resolve the InventoryExternalIdentifier to put on a Sale.csv line.
 239|  *
 240|  * Preference order:
 241|  *   1. The line's own ccrs_inventory_external_id (explicit per-sale override).
 242|  *   2. The canonical id derived from the matched inventory lot.
 243|  *   3. A sanitized pos_product_key as a degraded fallback (with a warning upstream).
 244|  */
 245| export function resolveSaleInventoryExternalId(opts: {
 246|   lineExplicit?: string | null;
 247|   lotCanonical?: string | null;
 248|   posProductKey?: string | null;
 249| }): { value: string; source: "line" | "lot" | "product_key" | "none" } {
 250|   const line = sanitizeExternalId(opts.lineExplicit ?? "");
 251|   if (line) return { value: line, source: "line" };
 252| 
 253|   const lot = sanitizeExternalId(opts.lotCanonical ?? "");
 254|   if (lot) return { value: lot, source: "lot" };
 255| 
 256|   const key = sanitizeExternalId(opts.posProductKey ?? "");
 257|   if (key) return { value: key, source: "product_key" };
 258| 
 259|   return { value: "", source: "none" };
 260| }
 261| 
 262| // ── Self-tests (tsx) ─────────────────────────────────────────────────────────
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
  28| // Reason mapping — internal reason → CCRS AdjustmentReason (valid values only)
  29| // ---------------------------------------------------------------------------
  30| 
  31| /** The exact set of AdjustmentReason values CCRS accepts. */
  32| export const CCRS_ADJUSTMENT_REASONS = [
  33|   "Destruction",
  34|   "Reconciliation",
  35|   "Lost",
  36|   "Seizure",
  37|   "Theft",
  38|   "ReturnedLabSample",
  39|   "Other",
  40| ] as const;
  41| export type CcrsAdjustmentReason = (typeof CCRS_ADJUSTMENT_REASONS)[number];
  42| 
  43| /**
  44|  * Map an internal adjustment reason to a valid CCRS AdjustmentReason.
  45|  *
  46|  *   receive       → (not exported — additions are reported via Inventory.csv)
  47|  *   destruction   → Destruction
  48|  *   count         → Reconciliation   (cycle-count variance correction)
  49|  *   shrink        → Lost
  50|  *   damage        → Lost
  51|  *   sample        → ReturnedLabSample (lab/QA sample pulled from sellable stock)
  52|  *   recall        → Destruction       (recalled product is destroyed)
  53|  *   return        → Other             (customer return add-back; detail REQUIRED)
  54|  *   theft         → Theft
  55|  *   seizure       → Seizure
  56|  *   other / *     → Other
  57|  */
  58| export function mapAdjustmentReason(internal: string): CcrsAdjustmentReason {
  59|   switch ((internal ?? "").trim().toLowerCase()) {
  60|     case "destruction":
  61|       return "Destruction";
  62|     case "count":
  63|       return "Reconciliation";
  64|     case "shrink":
  65|     case "damage":
  66|       return "Lost";
  67|     case "sample":
  68|       return "ReturnedLabSample";
  69|     // Task K: an EMPLOYEE trade sample (WAC 314-55-096) is reported to CCRS as
  70|     // an InventoryAdjustment with reason "Other" and a detail naming the
  71|     // employee (LCB-confirmed shape). It is NOT a returned lab sample.
  72|     case "employee_sample":
  73|       return "Other";
  74|     case "recall":
  75|       return "Destruction";
  76|     // Task Q: a CUSTOMER return (WAC 314-55-079(12)) adds quantity BACK to the
  77|     // inventory identifier. Per the LCB CCRS FAQ the sale identifier is deleted
  78|     // and the inventory identifier is "reported on an Inventory Adjustment as a
  79|     // return, with details" — 'Return' is not a valid AdjustmentReason, so the
  80|     // correct encoding is Other + a mandatory detail stating the ADD direction.
  81|     case "return":
  82|       return "Other";
  83|     case "theft":
  84|       return "Theft";
  85|     case "seizure":
  86|       return "Seizure";
  87|     default:
  88|       return "Other";
  89|   }
  90| }
  91| 
  92| /**
  93|  * Should this internal reason be exported to CCRS InventoryAdjustment at all?
  94|  * Positive deltas that represent RECEIVING are reported via Inventory.csv, not
  95|  * here, so we exclude `receive`. A zero-delta row is a no-op.
  96|  */
  97| export function isReportableAdjustment(internal: string, qtyDelta: number): boolean {
  98|   const r = (internal ?? "").trim().toLowerCase();
  99|   if (r === "receive") return false;
 100|   return qtyDelta !== 0;
 101| }
 102| 
 103| // ---------------------------------------------------------------------------
 104| // Formatting helpers
 105| // ---------------------------------------------------------------------------
 106| 
 107| /** MM/DD/YYYY for the Pacific calendar day (B3) — delegates to the shared,
 108|  * timezone-correct formatter so AdjustmentDate uses the WA business day. */
 109| export function mmddyyyy(iso: string | Date): string {
 110|   return ccrsDate(iso);
 111| }
 112| 
 113| /** CCRS dislikes embedded quotes; strip them and quote if a comma/newline. */
 114| export function cell(v: unknown): string {
 115|   const s = v == null ? "" : String(v);
 116|   const clean = s.replace(/"/g, "");
 117|   return /[,\n]/.test(clean) ? `"${clean}"` : clean;
 118| }
 119| 
 120| /** Reported quantity is always the absolute magnitude of the change. */
 121| export function adjustmentQuantity(qtyDelta: number): string {
 122|   const n = Math.abs(Number(qtyDelta) || 0);
 123|   return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(4)));
 124| }
 125| 
 126| /** Clamp free-form detail to the CCRS 250-char limit. */
 127| export function adjustmentDetail(note: string | null | undefined): string {
 128|   return (note ?? "").replace(/\s+/g, " ").trim().slice(0, 250);
 129| }
 130| 
 131| // A5: the LIVE LCB InventoryAdjustment.csv template is 12 columns — the
 132| // per-adjustment unique `ExternalIdentifier` sits between AdjustmentDate and
 133| // CreatedBy and was previously missing (11 cols → CCRS rejection). This set now
 134| // matches ccrs-batch-core.CCRS_COLUMNS.InventoryAdjustment exactly.
 135| export const ADJUSTMENT_COLUMNS = [
```

`src/lib/compliance/ccrs-inventory-adjustment-core.ts` L135-L235 — ADJUSTMENT_COLUMNS, mapAdjustmentRow, buildAdjustmentFile, makeAdjustmentFileName

```ts
 135| export const ADJUSTMENT_COLUMNS = [
 136|   "LicenseNumber",
 137|   "InventoryExternalIdentifier",
 138|   "AdjustmentReason",
 139|   "AdjustmentDetail",
 140|   "Quantity",
 141|   "AdjustmentDate",
 142|   "ExternalIdentifier",
 143|   "CreatedBy",
 144|   "CreatedDate",
 145|   "UpdatedBy",
 146|   "UpdatedDate",
 147|   "Operation",
 148| ] as const;
 149| 
 150| // ---------------------------------------------------------------------------
 151| // Row mapping (PURE)
 152| // ---------------------------------------------------------------------------
 153| 
 154| export type AdjustmentSourceRow = {
 155|   id: string;
 156|   qty_delta: number;
 157|   reason: string;
 158|   note: string | null;
 159|   created_at: string;
 160|   lot: {
 161|     id: string | null;
 162|     lot_code: string | null;
 163|     pos_product_key: string | null;
 164|   } | null;
 165| };
 166| 
 167| export type AdjustmentMapResult = {
 168|   row: string[] | null;
 169|   skipReason?: string;
 170| };
 171| 
 172| /** Map one internal adjustment row to a CCRS CSV row. PURE. */
 173| export function mapAdjustmentRow(
 174|   src: AdjustmentSourceRow,
 175|   license: CcrsLicenseLike,
 176| ): AdjustmentMapResult {
 177|   if (!isReportableAdjustment(src.reason, Number(src.qty_delta))) {
 178|     return { row: null, skipReason: `${src.reason} (not reportable)` };
 179|   }
 180| 
 181|   const externalId = deriveInventoryExternalId({
 182|     lot_code: src.lot?.lot_code ?? null,
 183|     pos_product_key: src.lot?.pos_product_key ?? null,
 184|     id: src.lot?.id ?? null,
 185|   });
 186|   if (!externalId) {
 187|     return { row: null, skipReason: `adjustment ${src.id} has no resolvable inventory identifier` };
 188|   }
 189| 
 190|   const date = mmddyyyy(src.created_at);
 191|   // A5: the per-adjustment ExternalIdentifier — unique + deterministic so
 192|   // re-generating the same range yields the same id (idempotent upload).
 193|   const adjustmentExternalId = sanitizeExternalId(`ADJ-${src.id}`);
 194|   const row = [
 195|     license.licenseNumber,
 196|     externalId,
 197|     mapAdjustmentReason(src.reason),
 198|     adjustmentDetail(src.note),
 199|     adjustmentQuantity(Number(src.qty_delta)),
 200|     date,
 201|     adjustmentExternalId, // ExternalIdentifier (per-adjustment, unique)
 202|     license.submittedBy, // CreatedBy
 203|     date, // CreatedDate
 204|     license.submittedBy, // UpdatedBy
 205|     date, // UpdatedDate
 206|     "Insert", // Operation
 207|   ];
 208|   return { row };
 209| }
 210| 
 211| /**
 212|  * Assemble the full file text. PURE. A4: uses the shared, spec-verified
 213|  * assembler so the header is the 3-row common header (SubmittedBy /
 214|  * SubmittedDate / NumberRecords, one per line), then the exact 12-column header
 215|  * row, then data rows, joined with \r\n and NumberRecords == data-row count.
 216|  */
 217| export function buildAdjustmentFile(rows: string[][], license: CcrsLicenseLike): string {
 218|   return assembleCcrsFile({
 219|     type: "InventoryAdjustment",
 220|     submittedBy: license.submittedBy,
 221|     rows,
 222|   });
 223| }
 224| 
 225| /** File naming (spec convention): InventoryAdjustment_<license>_YYYYMMDDHHMMSS.csv */
 226| export function makeAdjustmentFileName(licenseNumber: string): string {
 227|   return ccrsFileName("InventoryAdjustment", licenseNumber);
 228| }
 229| 
 230| // ---------------------------------------------------------------------------
 231| // Self-tests (tsx-runnable — PURE module, no server-only).
 232| // ---------------------------------------------------------------------------
 233| 
 234| export function __runCcrsAdjustmentTests(): void {
 235|   let pass = 0;
```

`src/lib/compliance/ccrs-inventory-adjustment.ts` L45-L111 — buildCcrsInventoryAdjustmentCsv (DB read + skipReason warnings W16)

```ts
  45| };
  46| 
  47| /**
  48|  * Build the InventoryAdjustment.csv for adjustments created in [fromISO, toISO].
  49|  * Joins each adjustment to its lot for the external identifier.
  50|  */
  51| export async function buildCcrsInventoryAdjustmentCsv(
  52|   fromISO: string,
  53|   toISO: string,
  54| ): Promise<CcrsAdjustmentBuildResult> {
  55|   const license = await getCcrsLicenseSettings();
  56|   const result: CcrsAdjustmentBuildResult = {
  57|     csv: "",
  58|     fileName: makeAdjustmentFileName(license.licenseNumber),
  59|     recordCount: 0,
  60|     skipped: 0,
  61|     warnings: [],
  62|     licenseNumber: license.licenseNumber,
  63|   };
  64| 
  65|   if (!license.licenseNumber) {
  66|     result.warnings.push("License number is not set — set it on the Compliance tab before uploading.");
  67|   }
  68| 
  69|   if (!isSupabaseServiceConfigured) {
  70|     result.csv = buildAdjustmentFile([], license);
  71|     return result;
  72|   }
  73| 
  74|   const admin = createSupabaseAdminClient();
  75|   const { data, error } = await admin
  76|     .from("inventory_adjustments")
  77|     .select(
  78|       "id, qty_delta, reason, note, created_at, lot:inventory_lots(id, lot_code, pos_product_key)",
  79|     )
  80|     .gte("created_at", fromISO)
  81|     .lte("created_at", toISO)
  82|     .order("created_at", { ascending: true });
  83| 
  84|   if (error) {
  85|     result.warnings.push(`Could not load adjustments: ${error.message}`);
  86|     result.csv = buildAdjustmentFile([], license);
  87|     return result;
  88|   }
  89| 
  90|   const rows: string[][] = [];
  91|   for (const raw of (data ?? []) as unknown as AdjustmentSourceRow[]) {
  92|     const lotRel = (raw as { lot: unknown }).lot;
  93|     const lot = Array.isArray(lotRel) ? (lotRel[0] ?? null) : (lotRel ?? null);
  94|     const mapped = mapAdjustmentRow({ ...raw, lot: lot as AdjustmentSourceRow["lot"] }, license);
  95|     if (mapped.row) {
  96|       rows.push(mapped.row);
  97|     } else {
  98|       result.skipped += 1;
  99|       if (mapped.skipReason && !mapped.skipReason.includes("not reportable")) {
 100|         result.warnings.push(mapped.skipReason);
 101|       }
 102|     }
 103|   }
 104| 
 105|   result.recordCount = rows.length;
 106|   result.csv = buildAdjustmentFile(rows, license);
 107|   if (rows.length === 0) {
 108|     result.warnings.push("No reportable adjustments found in the selected range.");
 109|   }
 110|   return result;
 111| }
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
 595|   }
 596| 
 597|   // ── Snapshot the CCRS Sale-row data for the correction file ───────────────
 598|   const inventoryExternalId = resolveSaleInventoryExternalId({
 599|     lineExplicit: l.ccrs_inventory_external_id,
 600|     lotCanonical: deriveInventoryExternalId({
 601|       lot_code: lotRow.lot_code,
 602|       pos_product_key: lotRow.pos_product_key,
 603|       id: lotRow.id,
 604|     }),
 605|     posProductKey: lineLotKey,
 606|   }).value;
 607| 
 608|   const qty = Number(l.quantity) || 0;
 609|   const soldUnit = l.price_minor_units ?? 0; // tax-INCLUSIVE out-the-door unit
 610|   const regularUnit = l.regular_price_minor_units ?? soldUnit; // tax-INCLUSIVE
 611| 
 612|   // Medical + tax status mirror the Sale.csv builder (see ccrs-sales.ts).
 613|   let isMedical = false;
 614|   let salesExempt = false;
 615|   let exciseExempt = false;
 616|   try {
 617|     const { data: exemptRows } = await admin
 618|       .from("medical_exempt_sales")
 619|       .select("product_sku, sales_tax_exempt, excise_tax_exempt")
 620|       .eq("order_id", o.id);
 621|     for (const r of (exemptRows as
 622|       | { product_sku: string | null; sales_tax_exempt: boolean | null; excise_tax_exempt: boolean | null }[]
 623|       | null) ?? []) {
 624|       isMedical = true;
 625|       if (r.product_sku && r.product_sku === l.product_id) {
 626|         salesExempt = salesExempt || r.sales_tax_exempt === true;
 627|         exciseExempt = exciseExempt || r.excise_tax_exempt === true;
 628|       }
 629|     }
 630|   } catch {
```

`src/lib/inventory/disposition.ts` L675-L705 — postAddition 'return' + destroy branch

```ts
 675|   // ── Post the POSITIVE add-back adjustment (internal 'return' → CCRS Other) ─
 676|   const note = buildCustomerReturnAdjustmentNote({
 677|     quantity: input.quantity,
 678|     unit: null,
 679|     reason: input.reason,
 680|     disposition: input.disposition,
 681|     saleExternalId,
 682|     detail: input.detail,
 683|   });
 684|   const posted = await postAddition(lotId, input.quantity, "return", note, actorId);
 685|   if (!posted.ok) return posted;
 686| 
 687|   // ── If destroying, open the destruction event for the returned quantity ───
 688|   let destructionEventId: string | null = null;
 689|   if (input.disposition === "destroy") {
 690|     const scheduled = await scheduleDestruction(
 691|       {
 692|         lotId,
 693|         quantity: input.quantity,
 694|         reason: "other",
 695|         detail: `Customer return (${input.reason.replace(/_/g, " ")}) — sale ${saleExternalId}`,
 696|         // Only the returned unit is segregated — the rest of the lot stays sellable.
 697|         quarantineLot: false,
 698|       },
 699|       actorId,
 700|     );
 701|     if (scheduled.ok) destructionEventId = scheduled.id;
 702|   }
 703| 
 704|   // ── Record the return ──────────────────────────────────────────────────────
 705|   const { data: created, error: insErr } = await admin
```

`src/lib/inventory/disposition.ts` L780-L800 — createVendorReturn (reducing 'other' adjustment)

```ts
 780|  * Create a vendor return: posts a reducing 'other' adjustment (CCRS maps 'other'
 781|  * → Other) and records the return. on-hand is reduced immediately.
 782|  */
 783| export async function createVendorReturn(
 784|   input: {
 785|     lotId: string;
 786|     vendorId?: string | null;
 787|     quantity: number;
 788|     reason: string;
 789|     detail?: string | null;
 790|     rmaNumber?: string | null;
 791|     manifestNumber?: string | null;
 792|     processorLicense?: string | null;
 793|   },
 794|   actorId: string | null,
 795| ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
 796|   if (!isSupabaseServiceConfigured) {
 797|     return { ok: false, error: "Supabase service role not configured." };
 798|   }
 799|   if (!(input.quantity > 0)) return { ok: false, error: "Quantity must be greater than zero." };
 800|   const admin = createSupabaseAdminClient();
```

`src/lib/inventory/disposition.ts` L968-L985 — completeDestruction head ('destruction')

```ts
 968|  * method + ≥50% mix and final-destination records per current WAC 314-55-097),
 969|  * posts a reducing 'destruction' adjustment (CCRS → Destruction), records the
 970|  * full waste record, and (if the lot is fully depleted) marks the lot
 971|  * destroyed.
 972|  */
 973| export async function completeDestruction(
 974|   input: {
 975|     id: string;
 976|     /** Legacy free-text method (kept for compatibility with old callers). */
 977|     method?: string | null;
 978|     witnessedBy?: string | null;
 979|     renderingMethod?: string | null;
 980|     mixMaterial?: string | null;
 981|     fiftyPercentAttested?: boolean;
 982|     finalDestination?: string | null;
 983|     disposalFacility?: string | null;
 984|     lcbCoordinated?: boolean;
 985|     lcbOfficer?: string | null;
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
  45|   /** Card display name (messages only). */
  46|   itemName: string;
  47|   /** Cultivera Barcode — the CCRS-filed inventory identifier. */
  48|   barcode: string;
  49|   /** Raw Product cell. */
  50|   productName: string;
```

`src/lib/pos/import-lot-core.ts` L78-L83 — lot_code = barcode; ccrsExternalId = sanitized barcode

```ts
  78| export type PlannedImportLot = {
  79|   /** inventory_lots.lot_code — the Cultivera barcode (null only if blank). */
  80|   lotCode: string | null;
  81|   /** Canonical CCRS InventoryExternalIdentifier (sanitized barcode). */
  82|   ccrsExternalId: string;
  83|   /** inventory_lots.pos_product_key = menu_items.source_item_id (card key). */
```

`src/lib/pos/import-lot-core.ts` L416-L426 — L420: ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode

```ts
 416|         context: { barcode, product: first.productName },
 417|       });
 418|     }
 419| 
 420|     const ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode;
 421| 
 422|     lots.push({
 423|       lotCode: (first.barcode ?? "").trim() ? barcode : null,
 424|       ccrsExternalId,
 425|       posProductKey: first.posProductKey,
 426|       productName: first.productName,
```

`src/lib/pos/import-service.ts` L440-L460 — Dedupe by ccrs_inventory_external_id; why imported lots are 'active' (already reported by Cultivera as integrator)

```ts
 440|  *      migration event, so every lot has the same manifest → lot lineage an
 441|  *      intake delivery gets.
 442|  *   3. Resolve each lot's vendor via the intake resolver ladder
 443|  *      (license → exact name → alias → normalized scan → auto-create DRAFT
 444|  *      vendor) and its brand within that vendor — identical behavior to a
 445|  *      real delivery.
 446|  *   4. Dedupe by ccrs_inventory_external_id: lots already in the table are
 447|  *      skipped, so re-publishing (or retrying a failed publish) NEVER doubles
 448|  *      inventory.
 449|  *   5. Insert lots with status "active". WHY ACTIVE, NOT QUARANTINE: these
 450|  *      products were already received, tested, and reported to CCRS by the
 451|  *      previous POS (Cultivera is a WSLCB integrator; the Barcode column is
 452|  *      the identifier it filed). The migration changes the system of record,
 453|  *      not the product's regulatory state — quarantining would block the sale
 454|  *      floor and make the weekly Sale.csv flag every line. Lots with COA flag
 455|  *      "N" are surfaced as a warning-severity enrichment worklist instead.
 456|  *   6. created_at is backdated to each lot's Received date so the sale path's
 457|  *      created_at-ordered FIFO consumes genuinely-oldest stock first.
 458|  *
 459|  * Test-mode imports NEVER reach this function (guarded by the caller), so
 460|  * Clean Slate stays sufficient for rehearsals.
```

`src/lib/inventory/intake-store.ts` L650-L668 — Intake writes ccrs_inventory_external_id via deriveInventoryExternalId({pos_product_key, lot_code})

```ts
 650|     await admin.from("inventory_lots").insert({
 651|       lot_code: line.lot_code,
 652|       vendor_id: vendorId,
 653|       brand_id: brandId,
 654|       manifest_id: manifestId,
 655|       lab_result_id: labId,
 656|       pos_product_key: line.pos_product_key,
 657|       // Canonical CCRS InventoryExternalIdentifier, assigned once and reused
 658|       // across Inventory/LabTest/Sale/Transfer/Adjustment files (CCRS spec).
 659|       ccrs_inventory_external_id: deriveInventoryExternalId({
 660|         pos_product_key: line.pos_product_key,
 661|         lot_code: line.lot_code,
 662|       }),
 663|       product_name: line.product_name,
 664|       strain_name: line.strain_name,
 665|       // Rule 1.4 (docs/data-governance.md): strain TYPE lives in its own box,
 666|       // split from the strain name at the parser door (migration 0138).
 667|       strain_type: line.strain_type,
 668|       category: line.category,
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
  28| export async function GET() {
  29|   const session = await requirePermission("inventory.manage");
  30| 
  31|   const license = await getCcrsLicenseSettings();
  32|   const rows: string[][] = [];
  33|   const includedIds: string[] = [];
  34|   const skipped: string[] = [];
  35| 
  36|   if (isSupabaseServiceConfigured) {
  37|     try {
  38|       const admin = createSupabaseAdminClient();
  39|       const { data } = await admin
  40|         .from("customer_returns")
```

`src/app/admin/inventory/disposition/sale-correction-export/route.ts` L74-L82 — markCorrectionsExported after download

```ts
  74|   }
  75| 
  76|   const csv = buildSaleCorrectionFile(rows, license);
  77|   const fileName = makeSaleCorrectionFileName(license.licenseNumber);
  78| 
  79|   if (includedIds.length > 0) {
  80|     await markCorrectionsExported(includedIds);
  81|   }
  82|   await recordAudit({
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
- L69: `{ label: "CCRS Benchmarks", href: "/admin/discovery/benchmarks", permission: "inventory.manage", icon: "\ud83d\udcca", group: "Product Intake" }, // 📊`
- L93: `{ label: "Employee Samples", href: "/admin/compliance/samples", permission: "settings.manage", icon: "\ud83e\uddea", group: "Employee" }, // 🧪 trade s`
- L94: `{ label: "Sample History", href: "/admin/compliance/samples/history", permission: "settings.manage", icon: "\ud83d\udccb", group: "Employee" }, // 📋 s`
- L102: `// CCRS: standalone top-header button → the Compliance Command Center (Task W;`
- L105: `{ label: "CCRS Command Center", href: "/admin/compliance/ccrs", permission: "reports.view", icon: "\ud83d\udee1\ufe0f", group: "CCRS" }, // 🛡️ complia`
- L106: `{ label: "Compliance Health", href: "/admin/compliance/health", permission: "reports.view", icon: "\ud83e\ude7a", group: "CCRS" }, // 🩺 health check`
- L107: `{ label: "Regulatory Watch", href: "/admin/compliance/regulatory", permission: "reports.view", icon: "\ud83d\udce1", group: "CCRS" }, // 📡 rule-change`
- L108: `{ label: "Compliance Calendar", href: "/admin/compliance/calendar", permission: "compliance.calendar", icon: "\ud83d\udcc5", group: "Lyman" }, // 📅 S-`
- L181: `{ label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "\u2696\ufe0f", group: "Admin" }, // ⚖️ legal li`
- L186: `{ label: "Sales-Limit Classification", href: "/admin/compliance/classification", permission: "inventory.manage", icon: "\ud83c\udff7\ufe0f", group: "A`
- L203: `"CCRS",`

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

### `tests/compliance/ccrs-batch.test.ts` (283 L) — `describe`/`it` titles

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
- L132: `describe("ccrsCell quoting", () => {`
- L133: `it("quotes cells containing commas and strips embedded quotes", () => {`
- L140: `describe("file naming convention", () => {`
- L141: `it("UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv", () => {`
- L154: `describe("upload order of operations (Group 1 → 2 → 3)", () => {`
- L155: `it("upload order covers all 7 types with Sale last", () => {`
- L160: `it("Strain/Area/Product precede Inventory, which precedes Sale", () => {`
- L166: `describe("SaleType / StrainType enums", () => {`
- L167: `it("medical orders → RecreationalMedical, others → RecreationalRetail", () => {`
- L171: `it("strain-type normalization collapses to the 3 CCRS values", () => {`
- L179: `describe("product classification (Table 2)", () => {`
- L180: `it("valid category/type pairs pass, invalid ones fail", () => {`
- L192: `it("canonicalizes legacy 2021 LCB vocabulary to the modern enum", () => {`
- L210: `describe("Sale numeric-column safety (defense in depth)", () => {`
- L212: `it("a clean Sale row passes", () => {`
- L215: `it("zero/negative/non-numeric quantity is flagged", () => {`
- L222: `it("negative or 3-decimal money is flagged", () => {`
- L232: `describe("CCRS Product.Name two-layer composition (SLICE 53)", () => {`
- L233: `it("composes the owner-approved example and guards duplication/collisions", async () => {`
- L269: `it("__runCcrsProductNameCoreTests", async () => {`
- L277: `describe("embedded self-tests still pass under vitest", () => {`
- L278: `it("__runCcrsBatchCoreTests", async () => {`

### `tests/compliance/pure-selftests.test.ts` (235 L) — `describe`/`it` titles

- L59: `describe("embedded pure self-test suites", () => {`
- L60: `it("order-pricing-core (S-2/S-3 money math + floor)", () => {`
- L63: `it("discount-engine-core (promotions engine)", () => {`
- L66: `it("brand-match-core (SLICE T1: ONE brand matcher, real catalogue fixtures)", () => {`
- L71: `it("markdown-lock-core (SLICE C1: clearance is excluded from other deals)", () => {`
- L76: `it("brand-resolve-core (rule 11: RECEIVING intake shares the ONE brand matcher)", () => {`
- L81: `it("po-receive-core (defects A+B: auto-receive refuses ambiguous names)", () => {`
- L85: `it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {`
- L89: `it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {`
- L93: `it("weight-label-core (SLICE W1: one grams parser for discounts AND the WAC limit)", () => {`
- L96: `it("promo-guard-core (Task R: CCRS below-cost publish guard)", () => {`
- L99: `it("sales-limits-core (WAC 314-55-095 buckets)", () => {`
- L102: `it("sales-limit-gate-core (S-1 completion gate)", () => {`
- L105: `it("chunked-in (S-7 pagination)", async () => {`
- L108: `it("exempt-sale-record-core (S-8 / WAC 314-55-090(2))", () => {`
- L113: `it("medical/tax (RCW 82.08.9998 + WAC 314-55-090 exemptions, card validity)", () => {`
- L116: `it("medical-authorization-core (DOH 608-048 issuance + validity-at-date)", () => {`
- L121: `it("medical-sale-core (Task O: DOH categories, exemption plan, high-THC gate)", () => {`
- L124: `it("medical-intake-core (Task P: RCW 69.51A.230(4) date rules, age classes, card number)", () => {`
- L129: `it("sales-hours-core (WAC 314-55-147 window)", () => {`
- L132: `it("receipt-core (Pacific timestamps, receipt shape)", () => {`
- L135: `it("pin-hash (S-10 scrypt + throttle)", () => {`
- L138: `it("at-rest-crypto (S-10 AES-256-GCM envelope)", () => {`
- L141: `it("loyalty engine (points math, tiers, code gen)", () => {`
- L144: `it("loyalty-config-core (customizer drafts, RCW discount cap)", () => {`
- L147: `it("loyalty-sale-core (Task S-a: best-deal-wins, code spread, floors)", () => {`
- L150: `it("signup-customer-core (Task V: signup → customer create-or-link)", () => {`
- L153: `it("schedule-core (week math, Pacific)", () => {`
- L156: `it("employee-lifecycle-core (Task S-b: RCW 49.94 order, activation gate, deadlines, sick leave)", () => {`
- L160: `it("user-guards-core (Task S-c: self-rule, rank rule, privilege ceiling, last-owner rule)", () => {`
- L164: `it("campaign-rules-core (Task S-d: WAC 314-55-155 per-channel rules, warnings map)", () => {`
- L168: `it("competitive-playbook-core (Task S-d: legal plays, in-app tool links, guardrails)", () => {`
- L172: `it("midjourney-core (Creative Studio brief -> prompt assembly)", () => {`
- L175: `it("flux-core (Task U: verified per-endpoint FLUX request contracts)", () => {`
- L178: `it("creative-placements-core (Task U: verified destination sizes, 4MP ceiling)", () => {`
- L181: `it("ccrs-week-core (Task W: Sun–Sat week, due next Sunday, reminder planner)", () => {`
- L186: `it("ccrs-deadline-core (Slice 106 + Task W: LIQ-1295 due dates + monthly reminder planner)", () => {`
- L191: `it("ccrs-error-triage-core (Task W: error-email triage + examiner draft)", () => {`
- L199: `it("ccrs-submit-gate-core (S-01/N-06: the upload gate — errors block, warnings do not)", () => {`
- L204: `it("menu-feed-core (syndication feed mapping: strain normalize, stock, quantity, image)", () => {`
- L207: `it("leafly-payload-core (Leafly v2 wire format: cents, quantity, null-not-NA)", () => {`
- L210: `it("weedmaps-payload-core (Task X: verified Request_MenuItem variants/price/weight)", () => {`
- L213: `it("integration-credentials-core (DB-over-env overrides + masking)", () => {`
- L216: `it("sync-plan-core (Task X: payload-hash idempotency + delta sync plan)", () => {`
- L219: `it("preflight-core (Task X: pre-push validation — dup ids, prices, weights)", () => {`
- L222: `it("richness-core (Task X: menu richness scoring + connection health)", () => {`
- L225: `it("sync-settings-core (Task X: owner-tunable transmission parameters)", () => {`
- L228: `it("apply-settings-core (Task X: owner toggles applied to channel payloads)", () => {`
- L231: `it("syndication-playbook (Task X: verified connect/stay/reconnect playbook + AI grounding)", () => {`

### Golden fixtures (`tests/compliance/golden/ccrs/`)

- `Area.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Area,IsQuarantine,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation`
- `Inventory.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,Create`
- `InventoryAdjustment.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryExternalIdentifier,AdjustmentReason,AdjustmentDetail,Quantity,AdjustmentDate,ExternalIdentifier,C`
- `InventoryTransfer.golden.csv`: rows=5, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`FromLicenseNumber,ToLicenseNumber,FromInventoryExternalIdentifier,ToInventoryExternalIdentifier,Quantity,TransferDate,Ex`
- `Product.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,`
- `Sale.golden.csv`: rows=7, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPri`
- `Strain.golden.csv`: rows=6, CRLF=yes; R1=`SubmittedBy,Greenway Marijuana`; R4=`LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate`

