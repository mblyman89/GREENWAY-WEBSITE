/**
 * src/lib/cms/faq-store.ts
 *
 * Server-side service for the database-backed FAQ (migration 0015). Mirrors the
 * carousel / page_sections pattern: published + draft_* columns, draft-aware
 * public rendering, staff CRUD + reorder, and a lazy seed from the committed
 * static list so the page is never blank.
 */
import { draftMode } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { faqItems as STATIC_FAQ } from "@/content/faq";

const SELECT =
  "id, sort_order, status, enabled, draft_enabled, locked, question, answer, draft_question, draft_answer, created_at, updated_at";

export type FaqItemRow = {
  id: string;
  sort_order: number;
  status: "draft" | "scheduled" | "published" | "archived";
  enabled: boolean;
  draft_enabled: boolean;
  locked: boolean;
  question: string | null;
  answer: string | null;
  draft_question: string | null;
  draft_answer: string | null;
  created_at: string;
  updated_at: string;
};

export type FaqAdminVM = FaqItemRow & { dirty: boolean };

export type FaqRenderItem = { id: string; question: string; answer: string };

function coerce(row: Record<string, unknown>): FaqItemRow {
  return row as unknown as FaqItemRow;
}

/** A row is "dirty" when its draft differs from the published values. */
function isDirty(r: FaqItemRow): boolean {
  return (
    (r.draft_question ?? "") !== (r.question ?? "") ||
    (r.draft_answer ?? "") !== (r.answer ?? "") ||
    r.draft_enabled !== r.enabled
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Admin manager list (all rows, ordered). */
export async function listFaqItems(): Promise<FaqAdminVM[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("faq_items")
    .select(SELECT)
    .order("sort_order", { ascending: true });
  const rows = ((data as Record<string, unknown>[] | null) ?? []).map(coerce);
  return rows.map((r) => ({ ...r, dirty: isDirty(r) }));
}

export async function getFaqItem(id: string): Promise<FaqItemRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("faq_items")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  return data ? coerce(data as Record<string, unknown>) : null;
}

/**
 * Public render list (draft-aware). Returns [] when the table is empty so the
 * caller keeps the static fallback. Staff preview shows draft values +
 * draft-enabled rows; normal visitors see published+enabled rows.
 */
export async function getFaqForRender(): Promise<FaqRenderItem[]> {
  let preview = false;
  try {
    preview = (await draftMode()).isEnabled;
  } catch {
    preview = false;
  }
  if (!isSupabaseServiceConfigured) return [];

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("faq_items")
      .select(SELECT)
      .order("sort_order", { ascending: true });
    const rows = ((data as Record<string, unknown>[] | null) ?? []).map(coerce);
    const visible = rows.filter((r) =>
      preview ? r.draft_enabled : r.status === "published" && r.enabled,
    );
    return visible
      .map((r) => ({
        id: r.id,
        question: (preview ? r.draft_question : r.question) ?? r.question ?? "",
        answer: (preview ? r.draft_answer : r.answer) ?? r.answer ?? "",
      }))
      .filter((i) => i.question.trim().length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Lazy seed (from the committed static list)
// ---------------------------------------------------------------------------

export async function ensureFaqSeeded(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("faq_items")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return 0;

  const rows = STATIC_FAQ.map((item, i) => ({
    sort_order: i,
    status: "published" as const,
    enabled: true,
    draft_enabled: true,
    locked: false,
    question: item.question,
    answer: item.answer,
    draft_question: item.question,
    draft_answer: item.answer,
  }));
  if (rows.length === 0) return 0;
  const { error } = await admin.from("faq_items").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a new (draft) Q&A at the end of the list. */
export async function createFaqItem(
  editorId: string | null,
): Promise<{ id: string } | { error: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const admin = createSupabaseAdminClient();
  const { data: maxRow } = await admin
    .from("faq_items")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await admin
    .from("faq_items")
    .insert({
      sort_order: nextOrder,
      status: "draft" as const,
      enabled: false,
      draft_enabled: true,
      question: "New question",
      answer: "",
      draft_question: "New question",
      draft_answer: "",
      last_edited_by: editorId,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Create failed." };
  return { id: (data as { id: string }).id };
}

export type FaqDraftInput = {
  question: string;
  answer: string;
  draft_enabled: boolean;
};

export async function saveFaqDraft(
  id: string,
  input: FaqDraftInput,
  editorId: string | null,
): Promise<{ error?: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const admin = createSupabaseAdminClient();
  const existing = await getFaqItem(id);
  if (existing?.locked) return { error: "This item is locked." };
  const { error } = await admin
    .from("faq_items")
    .update({
      draft_question: input.question,
      draft_answer: input.answer,
      draft_enabled: input.draft_enabled,
      last_edited_by: editorId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return {};
}

/** Promote draft → published. */
export async function publishFaqItem(
  id: string,
  editorId: string | null,
): Promise<{ error?: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const admin = createSupabaseAdminClient();
  const row = await getFaqItem(id);
  if (!row) return { error: "Not found." };
  if (row.locked) return { error: "This item is locked." };
  const { error } = await admin
    .from("faq_items")
    .update({
      question: row.draft_question,
      answer: row.draft_answer,
      enabled: row.draft_enabled,
      status: "published" as const,
      published_by: editorId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return {};
}

export async function deleteFaqItem(id: string): Promise<{ error?: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const admin = createSupabaseAdminClient();
  const row = await getFaqItem(id);
  if (row?.locked) return { error: "This item is locked." };
  const { error } = await admin.from("faq_items").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}

/** Swap sort_order with the adjacent row in the given direction. */
export async function moveFaqItem(
  id: string,
  direction: "up" | "down",
): Promise<{ error?: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const admin = createSupabaseAdminClient();
  const items = await listFaqItems();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return { error: "Not found." };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return {};
  const a = items[idx];
  const b = items[swapIdx];
  await admin.from("faq_items").update({ sort_order: b.sort_order }).eq("id", a.id);
  await admin.from("faq_items").update({ sort_order: a.sort_order }).eq("id", b.id);
  return {};
}
