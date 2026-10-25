import { describe, expect, it } from 'vitest';
import { activateMember, addMember, deactivateMember, updateMember } from './team';
import { adjustStock, advancePurchaseOrder, cancelPurchaseOrder, createPurchaseRequest, moveStock, saveMaterial } from './inventory';
import { saveProject, setProjectStatus } from './projects';
import { inventoryValue, isLowStock } from './calc';
import { freshDb, TODAY_T } from './fixtures';
const mat = { name: 'Wire mesh', cat: 'Steel', unit: 'roll', qty: 5, min: 2, cost: 1250.5, sup: 'Pak Steel Mills' };
describe('team', () => {
  it('adds with validation and unique names/emails', () => {
    const d = freshDb(); addMember(d, { name: 'Sara Noor', role: 'Team Member', dept: 'Ops', email: 'sara@x.com' });
    expect(() => addMember(d, { name: ' sara  noor ', role: 'Team Member', dept: 'Ops' })).toThrow(/exists/); expect(() => addMember(d, { name: 'Other P', role: 'Team Member', dept: 'Ops', email: 'SARA@x.com' })).toThrow(/email/);
    for (const bad of [{ name: 'A' }, { role: 'Boss' }, { dept: '' }, { email: 'nope' }, { phone: 'abc' }]) expect(() => addMember(d, { name: 'Valid Name', role: 'Team Member', dept: 'Ops', ...bad })).toThrow();
  });
  it('deactivation is blocked while work or projects would be orphaned', () => { const d = freshDb(); expect(() => deactivateMember(d, 'Imran Ali')).not.toThrow(); expect(() => deactivateMember(d, 'Zara Malik')).toThrow(/open task/); expect(() => deactivateMember(d, 'Ayesha Khan')).toThrow(/manages/); });
  it('reassigns open work on deactivation but keeps completed history', () => {
    const d = freshDb(), done = d.T.filter((t) => t.who === 'Zara Malik' && t.status === 'Completed').length;
    deactivateMember(d, 'Zara Malik', 'Imran Ali'); expect(d.M.find((m) => m.name === 'Zara Malik')?.active).toBe(false); expect(d.T.some((t) => t.who === 'Zara Malik' && t.status !== 'Completed')).toBe(false); expect(d.T.filter((t) => t.who === 'Zara Malik' && t.status === 'Completed')).toHaveLength(done);
    expect(() => deactivateMember(d, 'Ayesha Khan', 'Imran Ali')).toThrow(/cannot manage/); deactivateMember(d, 'Ayesha Khan', 'Bilal Ahmed'); expect(d.P.find((p) => p.id === 1)?.mgr).toBe('Bilal Ahmed');
    activateMember(d, 'Zara Malik'); expect(d.M.find((m) => m.name === 'Zara Malik')?.active).toBe(true);
  });
  it('cannot assign inactive members to new tasks or projects', () => { const d = freshDb(); expect(() => saveProject(d, { name: 'X Project', mgr: 'Nida Rauf', loc: 'L', start: '2026-01-01', end: '2026-02-01', budget: 1 }, TODAY_T)).toThrow(); });
  it('renames propagate and role changes are guarded', () => { const d = freshDb(); updateMember(d, 'Zara Malik', { name: 'Zara M. Malik', role: 'Site Supervisor', dept: 'Structures' }); expect(d.T.some((t) => t.who === 'Zara Malik')).toBe(false); expect(d.T.some((t) => t.who === 'Zara M. Malik')).toBe(true); expect(() => updateMember(d, 'Ayesha Khan', { name: 'Ayesha Khan', role: 'Team Member', dept: 'Management' })).toThrow(/manages/); });
  it('keeps at least one active manager', () => { const d = freshDb(); d.P.forEach((p) => { p.status = 'Completed'; }); d.M.forEach((m) => { if (m.role === 'Project Manager' && m.name !== 'Ayesha Khan') m.active = false; }); expect(() => deactivateMember(d, 'Ayesha Khan')).toThrow(/At least one/); });
});
describe('inventory', () => {
  it('creates materials with opening balance history, valid SKU, and validation', () => {
    const d = freshDb(), m = saveMaterial(d, mat, TODAY_T); expect(m.sku).toBe('MAT-010'); expect(d.MV[0]).toEqual([TODAY_T, 'Wire mesh', 'Opening balance', 5, null]);
    for (const bad of [{ name: 'x' }, { unit: '' }, { unit: '<script>' }, { qty: -1 }, { min: -1 }, { cost: -1 }, { cost: 1.234 }, { sup: '' }, { qty: NaN }]) expect(() => saveMaterial(d, { ...mat, name: 'Other mesh', ...bad }, TODAY_T)).toThrow();
    expect(() => saveMaterial(d, mat, TODAY_T)).toThrow(/already exists/);
  });
  it('edits materials; unit is locked while stock exists; renames update history', () => { const d = freshDb(), m = saveMaterial(d, mat, TODAY_T); expect(() => saveMaterial(d, { ...mat, unit: 'kg' }, TODAY_T, m.id)).toThrow(/unit/); saveMaterial(d, { ...mat, name: 'Wire mesh 6mm', cost: 1300 }, TODAY_T, m.id); expect(d.MV[0]?.[1]).toBe('Wire mesh 6mm'); expect(m.cost).toBe(1300); });
  it('never allows negative stock and rolls back on failure', () => { const d = freshDb(), q = d.I[0]!.qty, mv = d.MV.length; expect(() => moveStock(d, { id: 1, kind: 'out', qty: q + 1, today: TODAY_T, project: 1 })).toThrow(/Insufficient/); expect(() => moveStock(d, { id: 1, kind: 'out', qty: 1, today: TODAY_T, project: 99 })).toThrow(/project/); expect(d.I[0]!.qty).toBe(q); expect(d.MV).toHaveLength(mv); });
  it('a repeated operation id is applied only once', () => { const d = freshDb(), q = d.I[0]!.qty; moveStock(d, { id: 1, kind: 'in', qty: 5, today: TODAY_T, opId: 'op-1' }); moveStock(d, { id: 1, kind: 'in', qty: 5, today: TODAY_T, opId: 'op-1' }); expect(d.I[0]!.qty).toBe(q + 5); expect(d.MV).toHaveLength(1); });
  it('keeps decimal quantities exact', () => { const d = freshDb(); d.I[0]!.qty = 0; moveStock(d, { id: 1, kind: 'in', qty: 0.1, today: TODAY_T }); moveStock(d, { id: 1, kind: 'in', qty: 0.2, today: TODAY_T }); expect(d.I[0]!.qty).toBe(0.3); });
  it('stock adjustments record the difference with a reason', () => { const d = freshDb(); adjustStock(d, { id: 1, counted: 1790.5, reason: 'Cycle count', today: TODAY_T }); expect(d.I[0]!.qty).toBe(1790.5); expect(d.MV[0]).toEqual([TODAY_T, 'Cement bags (50kg)', 'Adjustment (-)', 9.5, null, 'Cycle count']); expect(() => adjustStock(d, { id: 1, counted: 1790.5, reason: 'again', today: TODAY_T })).toThrow(/equals/); expect(() => adjustStock(d, { id: 1, counted: -1, reason: 'bad count', today: TODAY_T })).toThrow(); expect(() => adjustStock(d, { id: 1, counted: 5, reason: '', today: TODAY_T })).toThrow(/reason/); });
  it('valuation and low-stock alerts', () => { const d = freshDb(); const v = inventoryValue(d.I); expect(v).toBe(d.I.reduce((s, m) => s + Math.round(m.qty * m.cost * 100) / 100, 0)); expect(d.I.filter(isLowStock).map((m) => m.name)).toEqual(['Sand', 'Gravel']); });
  it('purchase requests: validated, idempotent, received once, cancel rules', () => {
    const d = freshDb(), q = d.I[3]!.qty; createPurchaseRequest(d, { m: 4, q: 10, today: TODAY_T, opId: 'po-1' }); createPurchaseRequest(d, { m: 4, q: 10, today: TODAY_T, opId: 'po-1' }); expect(d.PO).toHaveLength(1);
    expect(() => createPurchaseRequest(d, { m: 99, q: 1, today: TODAY_T })).toThrow(); expect(() => createPurchaseRequest(d, { m: 4, q: 0, today: TODAY_T })).toThrow();
    const id = d.PO[0]!.id; for (let i = 0; i < 3; i++) advancePurchaseOrder(d, id, TODAY_T); expect(d.PO[0]!.status).toBe('Received'); expect(d.I[3]!.qty).toBe(q + 10);
    expect(() => advancePurchaseOrder(d, id, TODAY_T)).toThrow(); expect(() => cancelPurchaseOrder(d, id)).toThrow(); expect(d.I[3]!.qty).toBe(q + 10);
  });
});
describe('projects', () => {
  it('validates, edits and records budget revisions with a reason', () => {
    const d = freshDb(), p = { name: 'Harbour Works', mgr: 'Ayesha Khan', loc: 'Karachi', start: '2026-11-01', end: '2027-11-01', budget: 5e6 };
    const n = saveProject(d, p, TODAY_T); expect(n.status).toBe('Planning'); expect(() => saveProject(d, p, TODAY_T)).toThrow(/exists/);
    for (const bad of [{ end: '2026-10-01' }, { budget: -1 }, { budget: 1.234 }, { mgr: 'Imran Ali' }, { start: 'x' }, { name: '' }]) expect(() => saveProject(d, { ...p, name: 'Other One', ...bad }, TODAY_T)).toThrow();
    expect(() => saveProject(d, { ...p, budget: 6e6 }, TODAY_T, n.id)).toThrow(/reason/); saveProject(d, { ...p, budget: 6e6, reason: 'Scope increase' }, TODAY_T, n.id); expect(n.budgetHistory).toEqual([{ date: TODAY_T, from: 5e6, to: 6e6, reason: 'Scope increase' }]); saveProject(d, { ...p, budget: 0, reason: 'On hold' }, TODAY_T, n.id); expect(n.budget).toBe(0);
  });
  it('cannot complete a project with open tasks', () => { const d = freshDb(); expect(() => setProjectStatus(d, 1, 'Completed')).toThrow(/open/); setProjectStatus(d, 5, 'Archived'); expect(d.P.find((p) => p.id === 5)?.status).toBe('Archived'); });
});
