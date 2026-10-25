import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../services/certificates.js';
import { BonafideCertificate } from './BonafideCertificate.js';
import { CertificateRequest } from './CertificateRequest.js';
import { CertificateSettings } from './CertificateSettings.js';
import { TransferCertificate } from './TransferCertificate.js';

/**
 * No database needed: these check that the documents the approval flow builds pass the models'
 * own validation. WHY: the global tenant plugin adds a required tenantId to EVERY schema,
 * sub-documents included, unless the sub-schema says `tenantScope: false`. Forgetting that made
 * every approval fail with a 500 on a real database while all the fake-store tests passed.
 */
const studentId = new mongoose.Types.ObjectId();
const student = {
  _id: studentId, name: 'Aarav', admissionNo: '412', classKey: '7', section: 'A',
  fatherName: 'R', motherName: 'S', category: 'General', gender: 'MALE',
  dateOfBirth: new Date('2014-03-14T00:00:00Z'), firstAdmissionDate: new Date('2019-07-04T00:00:00Z'),
  firstAdmissionClass: '1', nationality: 'Indian',
}; // prettier-ignore
const entered = {
  lastExam: 'x', failedInSameClass: 'No', subjects: 'E', qualifiedForPromotion: 'Yes',
  workingDays: 220, daysPresent: 198, ncc: 'NA', games: 'NA', conduct: 'Good',
  dateOfApplication: '2026-10-12', dateOfIssue: '2026-10-13', reason: 'Parent Request', remarks: 'None',
}; // prettier-ignore

describe('certificate models accept the documents the code builds', () => {
  it('Transfer Certificate (with a dues override)', () => {
    const snapshot = buildSnapshot({
      student,
      dues: { totals: {}, instalments: [] },
      concession: 'None',
    });
    const tc = new TransferCertificate({
      tenantId: 'tvsm', fy: '2026-27', slNo: 143, studentId, idempotencyKey: 'req-abc12345',
      issuedBy: 'u', issuedByName: 'Admin', bookNo: '7', snapshot, entered,
      duesOverride: { reason: 'Parent will pay', byName: 'Admin', duePaise: 150000 },
      requestId: 'r1', approvedByName: 'Principal', approvedAt: new Date(),
    }); // prettier-ignore
    expect(tc.validateSync()?.message).toBeUndefined();
  });
  it('Bonafide', () => {
    const b = new BonafideCertificate({
      tenantId: 'tvsm', fy: '2026-27', seq: 1, number: 'BON/FY2026-27/001', studentId,
      idempotencyKey: 'req-abc12346', issuedBy: 'u', issuedByName: 'Admin',
      snapshot: { admissionNo: '412', name: 'A', fatherName: 'R', gender: 'MALE', classKey: '7', section: 'A', dob: '2014-03-14' },
      academicYear: '2026-27', purpose: 'Passport', dateOfIssue: '2026-10-13',
      requestId: 'r1', approvedByName: 'Principal', approvedAt: new Date(),
    }); // prettier-ignore
    expect(b.validateSync()?.message).toBeUndefined();
  });
  it('request and settings (with history)', () => {
    const r = new CertificateRequest({
      tenantId: 'tvsm', kind: 'tc', studentId, fy: '2026-27', payload: { a: 1 }, preview: { b: 1 },
      studentName: 'A', admissionNo: '1', idempotencyKey: 'k12345678', requestedBy: 'u', requestedByName: 'Admin',
      duesOverride: { reason: 'x', duePaise: 1 },
    }); // prettier-ignore
    expect(r.validateSync()?.message).toBeUndefined();
    const s = new CertificateSettings({
      tenantId: 'tvsm', tcBookNo: '7', tcStartSl: 143, history: [{ byName: 'Admin', tcBookNo: '7', tcStartSl: 143 }],
    }); // prettier-ignore
    expect(s.validateSync()?.message).toBeUndefined();
  });
});
