export function formatMinorCurrency(minorUnits: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(minorUnits / 100);
}
