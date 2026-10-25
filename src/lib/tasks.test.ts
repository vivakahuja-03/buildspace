import { describe, expect, it } from 'vitest';
import { dependencyError } from './tasks';
import type { Task } from '../types';
const t = (id: number, dep: number | '', start: string, due: string): Task => ({ id, p: 1, title: `T${id}`, who: 'A', status: 'To Do', start, due, pct: 0, ms: false, dep });
const T = [t(1, '', '2026-01-01', '2026-01-10'), t(2, 1, '2026-01-11', '2026-01-20')];
describe('dependencyError', () => {
  it('accepts no dependency', () => expect(dependencyError(T, '', '2026-01-01')).toBeNull());
  it('rejects unknown task', () => expect(dependencyError(T, 99, '2026-01-01')).toMatch(/not found/));
  it('rejects a start before the predecessor ends', () => expect(dependencyError(T, 2, '2026-01-15')).toMatch(/Must start on or after/));
  it('rejects cycles', () => expect(dependencyError(T, 2, '2026-02-01', 1)).toMatch(/circular/));
  it('accepts a valid finish-to-start link', () => expect(dependencyError(T, 1, '2026-01-10', 2)).toBeNull());
});
