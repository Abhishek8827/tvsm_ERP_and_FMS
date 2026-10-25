import { Router } from "express";
import { z } from "zod";
import {
  fyMonths,
  getFinancialYear,
  matchVillage,
  prevMonth,
} from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { postPlans } from "../services/feePlan.js";
import { AppError, notFound } from "../utils/errors.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Bad id");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");
const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  state: z.enum(["on", "stopped", "pending"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const enrollBody = z.object({
  studentId: objectId,
  village: z.string().trim().min(1).max(80),
  // The bus fee starts from this month (the school's default is June).
  fromMonth: month,
});
const stopBody = z.object({
  studentId: objectId,
  // First month that is NOT charged any more.
  fromMonth: month,
  reason: z.string().trim().min(3, "Write the reason").max(300),
});

const stateOf = (s) =>
  s.transportFrom
    ? s.usesTransport
      ? "on"
      : "stopped"
    : s.usesTransport
      ? "pending"
      : "none";

/**
 * Transport module. Everyone signed in can look (the Cashier needs it at the counter); only the
 * Admin enters a student on the bus, or stops him. The village is the student's ADDRESS matched
 * with the fee chart; the bus fee is charged only for the months he is on the bus.
 */
export function transportRouter(deps, authenticate) {
  const router = Router();
  const view = [authenticate, requireRole("admin", "principal", "cashier")];
  const adminOnly = [authenticate, requireRole("admin")];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  const shape = (s, chart) => {
    const v = chart?.villages?.find((x) => x.name === s.village?.toUpperCase());
    return {
      id: String(s._id),
      admissionNo: s.admissionNo,
      name: s.name,
      fatherName: s.fatherName ?? "",
      classKey: s.classKey,
      section: s.section ?? "",
      contactNo: s.contactNo ?? "",
      address: s.address ?? "",
      village: s.village ?? "",
      monthlyPaise: v?.monthlyPaise ?? null,
      state: stateOf(s),
      transportFrom: s.transportFrom ?? null,
      transportUntil: s.transportUntil ?? null,
    };
  };

  router.get(
    "/transport",
    ...view,
    wrap(async (req, res) => {
      const f = listQuery.parse(req.query);
      const tenantId = req.user.tenantId;
      const fy = getFinancialYear(new Date());
      const [out, chart] = await Promise.all([
        deps.studentStore.listTransport(tenantId, f),
        deps.feeStore.get(tenantId, fy),
      ]);
      res.json({
        page: f.page,
        pageSize: f.pageSize,
        total: out.total,
        fy,
        rows: out.rows.map((s) => shape(s, chart)),
      });
    }),
  );

  // Scholar number -> details, the village found from the address, and the villages to choose from.
  router.get(
    "/transport/lookup/:admissionNo",
    ...adminOnly,
    wrap(async (req, res) => {
      const no = z.string().trim().min(1).max(30).parse(req.params.admissionNo);
      const tenantId = req.user.tenantId;
      const [s] = await deps.studentStore.findByAdmissionNos(tenantId, [no]);
      if (!s) throw notFound("Student");
      const fy = getFinancialYear(new Date());
      const chart = await deps.feeStore.get(tenantId, fy);
      const found = matchVillage(s.address, chart?.villages);
      res.json({
        ...shape(s, chart),
        status: s.status,
        fy,
        suggestedVillage: found?.name ?? null,
        villages: (chart?.villages ?? []).map((v) => ({
          name: v.name,
          monthlyPaise: v.monthlyPaise,
        })),
        months: fyMonths(fy),
        defaultFromMonth: `${fy.slice(0, 4)}-06`,
      });
    }),
  );

  router.post(
    "/transport/enroll",
    ...adminOnly,
    wrap(async (req, res) => {
      const body = enrollBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const fy = getFinancialYear(new Date());
      if (!fyMonths(fy).includes(body.fromMonth))
        throw new AppError("BAD_MONTH", 422, `The month must be inside ${fy}.`);
      const student = await deps.studentStore.findById(
        tenantId,
        body.studentId,
      );
      if (!student) throw notFound("Student");
      if (student.status !== "active")
        throw new AppError(
          "INACTIVE",
          409,
          "Only an active student can be put on the bus.",
        );
      if (student.usesTransport && student.transportFrom)
        throw new AppError(
          "ALREADY_ON_BUS",
          409,
          "This student is already in the Transport module.",
        );
      const chart = await deps.feeStore.get(tenantId, fy);
      const village = chart?.villages?.find(
        (v) => v.name === body.village.toUpperCase(),
      );
      if (!village)
        throw new AppError(
          "NO_VILLAGE_FEE",
          422,
          `Bus fee for "${body.village}" is not in the fee chart. Add it in Fee Structure first.`,
        );
      const updated = await deps.studentStore.update(tenantId, student._id, {
        usesTransport: true,
        village: village.name,
        transportFrom: body.fromMonth,
        transportUntil: null,
      });
      // Post the bus fee from the start month up to this month right away.
      const plan = await postPlans({
        deps,
        tenantId,
        students: [updated],
        fy,
        kinds: ["transport"],
      });
      await recordAudit(
        deps,
        req,
        {
          action: "update",
          entity: "student_transport",
          entityId: String(student._id),
          newValue: {
            admissionNo: student.admissionNo,
            village: village.name,
            fromMonth: body.fromMonth,
            monthlyPaise: village.monthlyPaise,
          },
        },
        { critical: true },
      );
      res
        .status(201)
        .json({ student: shape(updated, chart), newCharges: plan.newCharges });
    }),
  );

  router.post(
    "/transport/stop",
    ...adminOnly,
    wrap(async (req, res) => {
      const body = stopBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const fy = getFinancialYear(new Date());
      const student = await deps.studentStore.findById(
        tenantId,
        body.studentId,
      );
      if (!student) throw notFound("Student");
      if (!student.usesTransport || !student.transportFrom)
        throw new AppError(
          "NOT_ON_BUS",
          409,
          "This student is not on the bus.",
        );
      if (body.fromMonth < student.transportFrom)
        throw new AppError(
          "BAD_MONTH",
          422,
          `The bus started in ${student.transportFrom}; choose that month or a later one.`,
        );
      if (!fyMonths(fy).includes(body.fromMonth))
        throw new AppError("BAD_MONTH", 422, `The month must be inside ${fy}.`);
      // Months from the stop month on are no longer charged. A posted month that is already
      // paid or rebated cannot be removed: the Admin must first cancel that receipt / rebate.
      const [charges, receipts, rebates] = await Promise.all([
        deps.chargeStore.listForStudent(tenantId, student._id, fy),
        deps.receiptStore.listForStudent(tenantId, student._id, fy),
        deps.rebateStore.listForStudent(tenantId, student._id),
      ]);
      const used = new Set([
        ...receipts.flatMap((r) => r.lines.map((l) => String(l.chargeId))),
        ...rebates
          .filter((r) => r.status === "active")
          .flatMap((r) => r.lines.map((l) => String(l.chargeId))),
      ]);
      const gone = charges.filter(
        (c) => c.head === "transport" && c.period >= body.fromMonth,
      );
      const blocked = gone.filter((c) => used.has(String(c._id)));
      if (blocked.length)
        throw new AppError(
          "MONTH_ALREADY_PAID",
          409,
          `The bus fee of ${blocked.map((c) => c.period).join(", ")} is already paid or rebated. Cancel that receipt / rebate first, or choose a later month.`,
        );
      if (gone.length)
        await deps.chargeStore.deleteByIds(
          tenantId,
          gone.map((c) => c._id),
        );
      const updated = await deps.studentStore.update(tenantId, student._id, {
        usesTransport: false,
        transportUntil: prevMonth(body.fromMonth),
      });
      await recordAudit(
        deps,
        req,
        {
          action: "update",
          entity: "student_transport",
          entityId: String(student._id),
          reason: body.reason,
          oldValue: { transportFrom: student.transportFrom },
          newValue: {
            admissionNo: student.admissionNo,
            stoppedFrom: body.fromMonth,
            removedMonths: gone.length,
          },
        },
        { critical: true },
      );
      const chart = await deps.feeStore.get(tenantId, fy);
      res.json({ student: shape(updated, chart), removedMonths: gone.length });
    }),
  );

  return router;
}
