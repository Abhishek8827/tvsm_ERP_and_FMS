import express, { Router } from 'express';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { TEMPLATE_HEADERS, parseStudentSheet } from '../services/studentImport.js';
import { AppError } from '../utils/errors.js';

const MAX_ROWS = 5000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const query = z.object({ commit: z.enum(['true', 'false']).default('false') });

/**
 * Admin-only Excel import of students.
 *  - GET  /students/import-template      downloads the empty template
 *  - POST /students/import?commit=false   checks the file and reports problems (saves nothing)
 *  - POST /students/import?commit=true    saves the good rows; rows with problems are skipped and listed
 * Students that already exist (same SCH. number) are never changed or duplicated, so running the
 * same import twice is harmless (rule 5).
 */
export function studentImportRouter(deps, authenticate) {
  const router = Router();
  const adminOnly = [authenticate, requireRole('admin')];

  router.get('/students/import-template', ...adminOnly, async (_req, res, next) => {
    try {
      const header = TEMPLATE_HEADERS.map((value) => ({ value, fontWeight: 'bold' }));
      const buffer = await writeXlsxFile([header]).toBuffer();
      res
        .set('Content-Type', XLSX)
        .set('Content-Disposition', 'attachment; filename="student-import-template.xlsx"')
        .send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/students/import',
    ...adminOnly,
    // The file arrives as raw bytes (not JSON), so this route has its own size limit.
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

        const parsed = parseStudentSheet(sheet);
        if (parsed.fileError) throw new AppError('BAD_TEMPLATE', 400, parsed.fileError);

        const tenantId = req.user.tenantId;
        const existing = await deps.studentStore.existingAdmissionNos(
          tenantId,
          parsed.students.map((s) => s.data.admissionNo),
        );
        const errors = [...parsed.errors];
        const ready = [];
        for (const s of parsed.students) {
          if (existing.has(s.data.admissionNo))
            errors.push({
              row: s.row,
              message: `SCH. ${s.data.admissionNo} already exists (skipped)`,
            });
          else ready.push(s);
        }
        errors.sort((a, b) => a.row - b.row);

        let created = 0;
        if (commit === 'true' && ready.length > 0) {
          created = await deps.studentStore.createMany(
            tenantId,
            ready.map((s) => s.data),
          );
          await recordAudit(deps, req, {
            action: 'create',
            entity: 'student_import',
            newValue: { rowsInFile: sheet.length - 1, created, skipped: errors.length },
          });
        }
        res.json({
          committed: commit === 'true',
          rowsInFile: parsed.students.length + parsed.errors.length,
          ready: ready.length,
          created,
          skipped: errors.length,
          errors: errors.slice(0, 200),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
