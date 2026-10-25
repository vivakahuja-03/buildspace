const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
/** Whole days since 1970-01-01 (UTC). NaN for invalid input. */
export const toDay = (s: string): number => Date.parse(`${s}T00:00:00Z`) / 864e5;
export const fromDay = (n: number): string => new Date(n * 864e5).toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => fromDay(toDay(s) + n);
export const diffDays = (a: string, b: string): number => toDay(b) - toDay(a);
export const todayIso = (): string => new Date().toISOString().slice(0, 10);
