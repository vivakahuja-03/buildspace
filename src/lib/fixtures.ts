import { seed } from '../data/seed';
import type { DB } from '../types';
/** Fresh seeded database for tests (deep copy, fixed "today" friendly). */
export const freshDb = (): DB => structuredClone(seed());
export const TODAY_T = '2026-10-23';
