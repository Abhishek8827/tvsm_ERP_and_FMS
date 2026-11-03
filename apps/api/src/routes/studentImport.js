import express, { Router } from "express";
import { readSheet } from "read-excel-file/universal";
import writeXlsxFile from "write-excel-file/node";
import { z } from "zod";
import { getFinancialYear } from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { postPlans } from "../services/feePlan.js";
import {
  TEMPLATE_HEADERS,
  missingFieldsPatch,
  parseStudentSheet,
} from "../services/studentImport.js";
import { AppError } from "../utils/errors.js";

const MAX_ROWS = 5000;
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const query = z.object({ commit: z.enum(["true", "false"]).default("false") });

/**
 * Admin-only Excel import of students.
 *  - GET  /students/import-template      downloads the empty template
 *  - POST /students/import?commit=false   checks the file and reports problems (saves nothing)
 *  - POST /students/import?commit=true    saves the good rows; rows with problems are skipped and listed
 * Students that already exist (same SCH. number) are never duplicated and nothing already saved is
 * replaced: a re-upload only FILLS fields that are still empty on the record (Admin decision), so
 * running the same file twice changes nothing the second time (rule 5).
 */
export function studentImportRouter(deps, authenticate) {
  const router = Router();
  const adminOnly = [authenticate, requireRole("admin")];

  router.get(
    "/students/import-template",
    ...adminOnly,
    async (_req, res, next) => {
      try {
        const header = TEMPLATE_HEADERS.map((value) => ({
          value,
          fontWeight: "bold",
        }));
        const buffer = await writeXlsxFile([header]).toBuffer();
        res
          .set("Content-Type", XLSX)
          .set(
            "Content-Disposition",
            'attachment; filename="student-import-template.xlsx"',
          )
          .send(buffer);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/students/import",
    ...adminOnly,
    // The file arrives as raw bytes (not JSON), so this route has its own size limit.
    express.raw({ type: "application/octet-stream", limit: "5mb" }),
    async (req, res, next) => {
      try {
        const { commit } = query.parse(req.query);
        if (!Buffer.isBuffer(req.body) || req.body.length === 0)
          throw new AppError(
            "NO_FILE",
            400,
            "Please choose an Excel (.xlsx) file.",
          );
        let sheet;
        try {
          sheet = await readSheet(new Blob([req.body]));
        } catch {
          throw new AppError(
            "BAD_FILE",
            400,
            "This file could not be read. Use an .xlsx file.",
          );
        }
        if (sheet.length > MAX_ROWS + 1)
          throw new AppError(
            "TOO_MANY_ROWS",
            400,
            `Import up to ${MAX_ROWS} rows at a time.`,
          );

        const parsed = parseStudentSheet(sheet);
        if (parsed.fileError)
          throw new AppError("BAD_TEMPLATE", 400, parsed.fileError);

        const tenantId = req.user.tenantId;
        const existing = await deps.studentStore.existingAdmissionNos(
          tenantId,
          parsed.students.map((s) => s.data.admissionNo),
        );
        const errors = [...parsed.errors];
        const ready = [];
        const found = existing.size
          ? new Map(
              (
                await deps.studentStore.findByAdmissionNos(tenantId, [
                  ...existing,
                ])
              ).map((d) => [d.admissionNo, d]),
            )
          : new Map();
        // Students already in the system: the file may only ADD what is missing on the record.
        const updates = [];
        let unchanged = 0;
        for (const s of parsed.students) {
          if (!existing.has(s.data.admissionNo)) {
            ready.push(s);
            continue;
          }
          const doc = found.get(s.data.admissionNo);
          const patch = doc ? missingFieldsPatch(doc, s.data) : {};
          if (Object.keys(patch).length) updates.push({ id: doc._id, patch });
          else unchanged += 1;
        }
        errors.sort((a, b) => a.row - b.row);

        let created = 0;
        let updated = 0;
        const fieldsFilled = {};
        let feePlan = null;
        if (commit === "true" && (ready.length > 0 || updates.length > 0)) {
          if (ready.length > 0) {
            created = await deps.studentStore.createMany(
              tenantId,
              ready.map((s) => s.data),
            );
            feePlan = await postPlans({
              deps,
              tenantId,
              students: await deps.studentStore.findByAdmissionNos(
                tenantId,
                ready.map((s) => s.data.admissionNo),
              ),
              fy: getFinancialYear(new Date()),
            });
          }
          for (const u of updates) {
            if (
              (await deps.studentStore.fillMissing(tenantId, u.id, u.patch)) > 0
            ) {
              updated += 1;
              for (const k of Object.keys(u.patch))
                fieldsFilled[k] = (fieldsFilled[k] ?? 0) + 1;
            }
          }
          await recordAudit(deps, req, {
            action: "create",
            entity: "student_import",
            newValue: {
              rowsInFile: sheet.length - 1,
              created,
              updated,
              fieldsFilled,
              skipped: errors.length,
            },
          });
        }
        res.json({
          committed: commit === "true",
          rowsInFile: parsed.students.length + parsed.errors.length,
          ready: ready.length,
          created,
          toUpdate: updates.length,
          updated,
          unchanged,
          feePlan,
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
