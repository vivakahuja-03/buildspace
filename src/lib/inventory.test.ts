import { describe, expect, it } from 'vitest';
import { PO_NEXT, recordMovement } from './inventory';
import type { DB } from '../types';
const mk = () => ({ I: [{ id: 1, name: 'Cement', qty: 10, min: 5, cost: 100, unit: 'bag', cat: 'c', sup: 's', sku: 'MAT-001', upd: '' }], MV: [] }) as unknown as DB;
describe('recordMovement', () => {
  it('receives and consumes stock and records history', () => {
    const d = mk(); recordMovement(d, 1, 'in', 5, '2026-01-01', null); recordMovement(d, 1, 'out', 3, '2026-01-02', 7);
    expect(d.I[0]?.qty).toBe(12); expect(d.MV).toHaveLength(2); expect(d.MV[0]).toEqual(['2026-01-02', 'Cement', 'Consumed', 3, 7]);
  });
  it('rejects invalid movements without changing anything', () => {
    const d = mk(); expect(() => recordMovement(d, 1, 'out', 99, 't', null)).toThrow(); expect(() => recordMovement(d, 1, 'in', 0, 't', null)).toThrow(); expect(() => recordMovement(d, 2, 'in', 1, 't', null)).toThrow();
    expect(d.I[0]?.qty).toBe(10); expect(d.MV).toHaveLength(0);
  });
  it('purchase order flow ends at Received', () => { expect(PO_NEXT.Requested).toBe('Approved'); expect(PO_NEXT.Ordered).toBe('Received'); expect(PO_NEXT.Received).toBeUndefined(); });
});
