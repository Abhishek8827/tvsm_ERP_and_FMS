import express, { Router } from 'express';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';
import { getFinancialYear, sessionStartYear } from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { OLD_DUES_HEADERS, parseOldDuesSheet } from '../services/oldDuesImport.js';
import { AppError } from '../utils/errors.js';

const MAX_ROWS = 5000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const query = z.object({ commit: z.enum(['true', 'false']).default('false') });

/**
 * Admin-only Excel import of OLD fees (unpaid before this system started).
 *  - GET  /old-dues/template
 *  - POST /old-dues/import?commit=false   checks the file, saves nothing
 *  - POST /old-dues/import?commit=true    saves the good rows
 * Old fees are saved against the CURRENT financial year. A student who already has old fees
 * imported is skipped (never doubled), so importing the same file twice is harmless (rule 5).
 */
export function oldDuesImportRouter(deps, authenticate) {
  const router = Router();
  const adminOnly = [authenticate, requireRole('admin')];

  router.get('/old-dues/template', ...adminOnly, async (_req, res, next) => {
    try {
      const header = OLD_DUES_HEADERS.map((value) => ({ value, fontWeight: 'bold' }));
      const buffer = await writeXlsxFile([header]).toBuffer();
      res
        .set('Content-Type', XLSX)
        .set('Content-Disposition', 'attachment; filename="old-fees-import-template.xlsx"')
        .send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/old-dues/import',
    ...adminOnly,
    express.raw({ type: 'application/octet-stream', limit: '5mb' }),
    async (req, res, next) => {
      try {
        const { commit } = query.parse(req.query);
        if (!Buffer.isBuffer(req.body) || req.body.length === 0)
          throw new AppError('NO_FILE', 400, 'Please choose an Excel (.xlsx) file.');
        let sheet;
        try {
          sheet = await readSheet(new Blob([req.body]));
        } catch {
          throw new AppError('BAD_FILE', 400, 'This file could not be read. Use an .xlsx file.');
        }
        if (sheet.length > MAX_ROWS + 1)
          throw new AppError('TOO_MANY_ROWS', 400, `Import up to ${MAX_ROWS} rows at a time.`);
        const parsed = parseOldDuesSheet(sheet);
        if (parsed.fileError) throw new AppError('BAD_TEMPLATE', 400, parsed.fileError);

        const tenantId = req.user.tenantId;
        const fy = getFinancialYear(new Date());
        const ids = await deps.studentStore.idsByAdmissionNo(
          tenantId,
          parsed.rows.map((r) => r.admissionNo),
        );
        const had = await deps.chargeStore.openingKeys(tenantId, fy, [...ids.values()]);
        const errors = [...parsed.errors];
        const items = [];
        let rowsReady = 0;
        for (const r of parsed.rows) {
          const studentId = ids.get(r.admissionNo);
          if (!studentId) {
            errors.push({ row: r.row, message: `SCH. ${r.admissionNo} not found (skipped)` });
            continue;
          }
          // WHY April 1st: old fees are already overdue, and this keeps them first in the pay order.
          const dueDate = `${sessionStartYear(fy)}-04-01`;
          const add = (head, amountPaise) => {
            if (amountPaise <= 0) return;
            if (had.has(`${studentId}|${head}`))
              errors.push({
                row: r.row,
                message: `SCH. ${r.admissionNo}: ${head === 'old_fees' ? 'old school' : 'old transport'} fees already imported (skipped)`,
              });
            else items.push({ studentId, head, period: 'opening', dueDate, amountPaise });
          };
          add('old_fees', r.schoolPaise);
          add('transport_old', r.transportPaise);
          rowsReady += 1;
        }
        errors.sort((a, b) => a.row - b.row);

        let created = 0;
        if (commit === 'true' && items.length > 0) {
          created = await deps.chargeStore.postBatch(tenantId, fy, items);
          await recordAudit(deps, req, {
            action: 'create',
            entity: 'old_dues_import',
            newValue: { fy, charges: created, skipped: errors.length },
          });
        }
        res.json({
          committed: commit === 'true',
          fy,
          rowsInFile: parsed.rows.length + parsed.errors.length,
          ready: items.length,
          created,
          skipped: errors.length,
          errors: errors.slice(0, 200),
          rowsReady,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
