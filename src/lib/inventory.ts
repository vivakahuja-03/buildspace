import type { DB, Role } from '../types';
import { can } from './permissions';
import { mulMoney as mul, sumMoney as sum } from './money';
import { applyStock } from './calc';
import { isIsoDate } from './dates';
import { DomainError } from './errors';
import { claimOp, nextId } from './ids';
import { isMoneyAmount, isQuantity, roundQty } from './money';
export const PO_NEXT: Record<string, string | undefined> = { Requested: 'Approved', Approved: 'Ordered', Ordered: 'Received' };
export const UNITS = ['bag', 'ton', 'kg', 'pcs', 'm', 'm2', 'm3', 'l', 'roll', 'pail', 'box', 'set'];
const UNIT_RE = /^[\p{L}\p{N}²³ ./"'-]{1,16}$/u;
/** Applies a stock movement and writes the history row in one step. Throws (changing nothing) on invalid quantities. */
export function recordMovement(d: DB, materialId: number, kind: 'in' | 'out', qty: number, today: string, project: number | null, label?: string, note?: string): void {
  const m = d.I.find((x) => x.id === materialId);
  if (!m) throw new Error('Material not found');
  const next = applyStock(m.qty, kind, qty);
  m.qty = next; m.upd = today;
  const row: (string | number | null)[] = [today, m.name, label ?? (kind === 'in' ? 'Received' : 'Consumed'), qty, project];
  if (note) row.push(note);
  d.MV.unshift(row);
}
/** Receive or consume stock. Repeating the same `opId` (e.g. a double click) is a no-op. */
export function moveStock(d: DB, o: { id: number; kind: 'in' | 'out'; qty: number; today: string; project?: number | null; opId?: string }): void {
  if (!isQuantity(o.qty)) throw new DomainError('Quantity must be greater than 0 (max 3 decimals)');
  if (!isIsoDate(o.today)) throw new DomainError('Invalid date');
  if (o.kind === 'out') { const p = d.P.find((x) => x.id === o.project); if (!p || p.status === 'Archived') throw new DomainError('Choose an active project to charge the consumption to'); }
  const m = d.I.find((x) => x.id === o.id);
  if (!m) throw new DomainError('Material not found');
  if (!claimOp(d, o.opId)) return;
  try { recordMovement(d, o.id, o.kind, o.qty, o.today, o.kind === 'out' ? o.project ?? null : null); }
  catch (e) { throw new DomainError(e instanceof Error && e.message === 'Insufficient stock' ? `Insufficient stock (available: ${m.qty} ${m.unit})` : 'Invalid stock movement'); }
}
/** Sets stock to a counted quantity and records the difference with a mandatory reason. */
export function adjustStock(d: DB, o: { id: number; counted: number; reason: string; today: string; opId?: string }): void {
  const m = d.I.find((x) => x.id === o.id);
  if (!m) throw new DomainError('Material not found');
  if (!isQuantity(o.counted, { allowZero: true })) throw new DomainError('Counted quantity must be 0 or more (max 3 decimals)');
  const reason = o.reason.trim();
  if (reason.length < 3 || reason.length > 200) throw new DomainError('Give a reason for the adjustment (3-200 characters)');
  if (!claimOp(d, o.opId)) return;
  const diff = roundQty(o.counted - m.qty);
  if (diff === 0) throw new DomainError('The counted quantity equals the current stock');
  recordMovement(d, o.id, diff > 0 ? 'in' : 'out', Math.abs(diff), o.today, null, diff > 0 ? 'Adjustment (+)' : 'Adjustment (-)', reason);
}
export interface MaterialInput { name: string; cat: string; unit: string; qty: number; min: number; cost: number; sup: string }
export function saveMaterial(d: DB, input: MaterialInput, today: string, editingId?: number) {
  const old = editingId === undefined ? undefined : d.I.find((x) => x.id === editingId);
  if (editingId !== undefined && !old) throw new DomainError('Material not found');
  const name = input.name.trim().replace(/\s+/g, ' '), cat = input.cat.trim(), unit = input.unit.trim(), sup = input.sup.trim();
  if (name.length < 2 || name.length > 80) throw new DomainError('Name must be 2-80 characters');
  if (!cat || cat.length > 40) throw new DomainError('Category is required (max 40 characters)');
  if (!UNIT_RE.test(unit)) throw new DomainError('Unit must be 1-16 characters (e.g. bag, ton, m3)');
  if (sup.length < 2 || sup.length > 80) throw new DomainError('Supplier must be 2-80 characters');
  if (!isQuantity(input.min, { allowZero: true })) throw new DomainError('Minimum stock must be 0 or more');
  if (!isMoneyAmount(input.cost, { allowZero: true })) throw new DomainError('Unit cost must be 0 or more with at most 2 decimal places');
  if (d.I.some((x) => x.id !== editingId && x.name.toLowerCase() === name.toLowerCase() && x.sup.toLowerCase() === sup.toLowerCase())) throw new DomainError('This material already exists for that supplier');
  if (old) {
    if (old.unit !== unit && old.qty > 0) throw new DomainError('The unit cannot change while stock exists. Adjust stock to 0 first.');
    if (old.name !== name) d.MV.forEach((r) => { if (r[1] === old.name) r[1] = name; });
    Object.assign(old, { name, cat, unit, sup, min: input.min, cost: input.cost, upd: today }); return old;
  }
  if (!isQuantity(input.qty, { allowZero: true })) throw new DomainError('Opening quantity must be 0 or more (max 3 decimals)');
  const n = { id: nextId(d.I), name, cat, unit, qty: 0, min: input.min, cost: input.cost, sup, sku: `MAT-${String(Math.max(0, ...d.I.map((x) => Number(/(\d+)$/.exec(x.sku)?.[1] ?? 0))) + 1).padStart(3, '0')}`, upd: today };
  d.I.push(n);
  if (input.qty > 0) recordMovement(d, n.id, 'in', input.qty, today, null, 'Opening balance');
  return n;
}
export function createPurchaseRequest(d: DB, o: { m: number; q: number; today: string; opId?: string; p?: number | null; by?: string }): void {
  if (o.p !== undefined && o.p !== null && !d.P.some((x) => x.id === o.p && x.status !== 'Archived')) throw new DomainError('Choose an active project (or none)');
  if (!d.I.some((x) => x.id === o.m)) throw new DomainError('Choose a valid material');
  if (!isQuantity(o.q)) throw new DomainError('Quantity must be greater than 0 (max 3 decimals)');
  if (!claimOp(d, o.opId)) return;
  d.PO.push({ id: nextId(d.PO), m: o.m, q: o.q, status: 'Requested', date: o.today, p: o.p ?? undefined, by: o.by });
}
/** Moves a request one step forward. Receiving adds stock exactly once (an already received request cannot be advanced). */
export function advancePurchaseOrder(d: DB, id: number, today: string, actor: { role?: Role; by?: string } = {}): void {
  const o = d.PO.find((x) => x.id === id);
  if (!o) throw new DomainError('Purchase request not found');
  const nx = PO_NEXT[o.status];
  if (!nx) throw new DomainError(`A ${o.status.toLowerCase()} request cannot be advanced`);
  if (nx === 'Approved') { if (!can(actor.role ?? 'Administrator', 'purchase:approve')) throw new DomainError('Only a Project Manager or Administrator can approve a purchase request'); o.approvedBy = actor.by ?? actor.role ?? 'Administrator'; }
  if (nx === 'Received') recordMovement(d, o.m, 'in', o.q, today, null, `Received (PO #${o.id})`);
  o.status = nx;
}
export function cancelPurchaseOrder(d: DB, id: number): void {
  const o = d.PO.find((x) => x.id === id);
  if (!o) throw new DomainError('Purchase request not found');
  if (!PO_NEXT[o.status]) throw new DomainError(`A ${o.status.toLowerCase()} request cannot be cancelled`);
  o.status = 'Cancelled';
}

/** Estimated value of purchase requests still in progress for a project. Shown beside (never added to) committed costs, which only count pending expenses, so nothing is counted twice. */
export const openPurchaseValue = (d: Pick<DB, 'PO' | 'I'>, projectId: number): number =>
  sum(d.PO.filter((o) => o.p === projectId && (o.status === 'Approved' || o.status === 'Ordered')).map((o) => mul(o.q, d.I.find((m) => m.id === o.m)?.cost ?? 0)));
