"use client";

/**
 * D225 — the menu card fallback picture lists, sent ONCE per page.
 *
 * Owner: "the cards with fallback images, should rotate images."
 *
 * The site layout reads the owner lists (one cached snapshot, only categories
 * with two or more pictures) and hands them to this provider, so every card
 * can rotate without each card carrying its own copy of the URLs (the grid
 * payload stays the size it was). Outside the provider (admin pages, tests)
 * the lists are empty and nothing rotates.
 */
import { createContext, useContext, type ReactNode } from "react";

const RotationListsContext = createContext<Readonly<Record<string, readonly string[]>>>({});

export function MenuCardRotationProvider({
  lists,
  children,
}: {
  lists: Readonly<Record<string, readonly string[]>>;
  children: ReactNode;
}) {
  return <RotationListsContext.Provider value={lists}>{children}</RotationListsContext.Provider>;
}

/** The owner list for one website category (empty when it does not rotate). */
export function useRotationList(category: string | null | undefined): readonly string[] {
  const lists = useContext(RotationListsContext);
  const key = String(category ?? "").trim().toLowerCase();
  return lists[key] ?? EMPTY;
}

const EMPTY: readonly string[] = [];
