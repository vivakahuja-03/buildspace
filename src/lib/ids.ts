import type { DB } from '../types';
export const nextId = (list: { id: number }[]): number => Math.max(0, ...list.map((x) => x.id)) + 1;
const MAX_OPS = 300;
/** Idempotency guard for repeatable operations (stock moves, purchase requests). Returns false when `opId` was already applied. */
export function claimOp(d: Pick<DB, 'ops'>, opId: string | undefined): boolean {
  if (!opId) return true;
  d.ops = d.ops ?? [];
  if (d.ops.includes(opId)) return false;
  d.ops.push(opId); if (d.ops.length > MAX_OPS) d.ops.splice(0, d.ops.length - MAX_OPS);
  return true;
}
