import { describe, expect, it } from 'vitest';
import { navForRole } from './roles.js';
describe('navForRole', () => {
  it('cashier never sees admin-only screens (the fee chart is view-only for cashier)', () => {
    const keys = navForRole('cashier').map((n) => n.key);
    expect(keys).toContain('collect-fee');
    expect(keys).toContain('fee-structure');
    for (const forbidden of [
      'data-import',
      'users-settings',
      'tc-bonafide',
      'fees-database',
      'audit-log',
      'approvals',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it('principal sees approvals but no data-entry screens', () => {
    const keys = navForRole('principal').map((n) => n.key);
    expect(keys).toContain('approvals');
    expect(keys).toContain('fee-structure'); // view only
    for (const forbidden of ['collect-fee', 'data-import', 'users-settings', 'tc-bonafide']) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it('admin cannot see principal-only approvals inbox', () => {
    expect(navForRole('admin').map((n) => n.key)).not.toContain('approvals');
  });
});
