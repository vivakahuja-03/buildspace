/** Money is stored as plain numbers (legacy data shape) but ALL arithmetic goes through integer minor units (1/100). */
export const MAX_AMOUNT = 1e13;
export const toMinor = (n: number): number => Math.round(n * 100);
export const fromMinor = (m: number): number => m / 100;
export const sumMoney = (values: number[]): number => fromMinor(values.reduce((s, v) => s + toMinor(Number.isFinite(v) ? v : 0), 0));
export const subMoney = (a: number, b: number): number => fromMinor(toMinor(a) - toMinor(b));
/** quantity x unit price, rounded to the nearest minor unit. */
export const mulMoney = (qty: number, price: number): number => fromMinor(Math.round(qty * price * 100));
export function isMoneyAmount(n: unknown, opts: { allowZero?: boolean } = {}): n is number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n > MAX_AMOUNT) return false;
  if (n < 0 || (n === 0 && !opts.allowZero)) return false;
  return Math.abs(toMinor(n) / 100 - n) < 1e-9; // at most 2 decimal places
}
export function formatMoney(n: number, cur: string): string {
  const v = Number.isFinite(n) ? n : 0, frac = toMinor(v) % 100 !== 0;
  return `${cur} ${v.toLocaleString('en-US', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 })}`;
}
/** Quantities allow up to 3 decimals; rounding removes binary float noise (0.1 + 0.2). */
export const roundQty = (n: number): number => Math.round(n * 1000) / 1000;
export const isQuantity = (n: unknown, opts: { allowZero?: boolean } = {}): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n <= 1e9 && (opts.allowZero ? n >= 0 : n > 0) && Math.abs(roundQty(n) - n) < 1e-9;
