import { describe, expect, it } from 'vitest';
import { navForRole } from './roles.js';
describe('navForRole', () => {
  it('cashier never sees admin-only screens (the fee chart is view-only for cashier)', () => {
    const keys = navForRole('cashier').map((n) => n.key);
    expect(keys).toContain('collect-fee');
    expect(keys).toContain('fee-structure');
    for (const forbidden of ['data-import', 'users-settings', 'audit-log', 'approvals']) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it('principal sees approvals but no data-entry screens', () => {
    const keys = navForRole('principal').map((n) => n.key);
    expect(keys).toContain('approvals');
    expect(keys).toContain('fee-structure'); // view only
    for (const forbidden of ['collect-fee', 'data-import', 'users-settings']) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it('everyone can open TC & Bonafide (only the Admin can make them)', () => {
    for (const r of ['admin', 'principal', 'cashier'])
      expect(navForRole(r).map((n) => n.key)).toContain('tc-bonafide');
  });
  it('admin cannot see principal-only approvals inbox', () => {
    expect(navForRole('admin').map((n) => n.key)).not.toContain('approvals');
  });
});
