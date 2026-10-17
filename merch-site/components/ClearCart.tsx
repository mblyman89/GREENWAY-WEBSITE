"use client";
import { useEffect } from "react";
import { cart } from "./cart-store";

/** Empties the cart once Stripe confirms payment (success page only). */
export function ClearCart() {
  useEffect(() => { cart.clear(); }, []);
  return null;
}
