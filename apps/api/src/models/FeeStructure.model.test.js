import { describe, expect, it } from 'vitest';
import { FeeStructure } from './FeeStructure.js';

// Regression: the tenant plugin used to add a required tenantId to the sub-documents too,
// which made the fee chart impossible to save.
describe('FeeStructure schema', () => {
  it('only the top-level document needs tenantId', async () => {
    const doc = new FeeStructure({
      tenantId: 'tvsm',
      fy: '2026-27',
      formFeePaise: 10000,
      classFees: [{ classKey: 'NURSERY', monthlyTuitionPaise: 70000, admissionPaise: 100000 }],
      villages: [{ name: 'siwal', monthlyPaise: 70000 }],
    });
    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.villages[0].name).toBe('SIWAL');
  });
});
