import { describe, expect, it } from 'vitest';
import { navForRole } from './roles.js';
describe('navForRole', () => {
  it('cashier never sees admin-only screens', () => {
    const keys = navForRole('cashier').map((n) => n.key);
    expect(keys).toContain('collect-fee');
    for (const forbidden of [
      'fee-structure',
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
    for (const forbidden of [
      'collect-fee',
      'fee-structure',
      'data-import',
      'users-settings',
      'tc-bonafide',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it('admin cannot see principal-only approvals inbox', () => {
    expect(navForRole('admin').map((n) => n.key)).not.toContain('approvals');
  });
});
