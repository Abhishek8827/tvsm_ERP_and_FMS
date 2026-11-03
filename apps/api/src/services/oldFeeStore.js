import mongoose from "mongoose";
import { Charge } from "../models/Charge.js";
import { Counter } from "../models/Counter.js";
import { OldFeeAdjustment } from "../models/OldFeeAdjustment.js";
import { Rebate } from "../models/Rebate.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";
import { checkOldFeeChange, deltaMap } from "./oldFees.js";

/**
 * Admin corrections of the OLD fee (see models/OldFeeAdjustment.js). A correction is saved in ONE
 * transaction, under the same per-student lock the receipts use, so a payment and a correction can
 * never cross each other.
 */
export function makeOldFeeStore() {
  return {
    listForStudent: (tenantId, studentId, fy) =>
      OldFeeAdjustment.find({ tenantId, studentId, ...(fy ? { fy } : {}) })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),

    async create({
      tenantId,
      studentId,
      fy,
      head,
      newPaise,
      effectiveDate,
      reason,
      student,
      user,
      audit,
    }) {
      const session = await mongoose.startSession();
      try {
        let saved;
        await session.withTransaction(async () => {
          await Counter.updateOne(
            { tenantId, key: `lock:${studentId}` },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
          const charge = await Charge.findOne({
            tenantId,
            studentId,
            fy,
            head,
            period: "opening",
          })
            .session(session)
            .lean();
          const earlier = await OldFeeAdjustment.find({
            tenantId,
            studentId,
            fy,
            head,
          })
            .session(session)
            .select("studentId head deltaPaise")
            .lean();
          const current = charge
            ? charge.amountPaise +
              (deltaMap(earlier).get(`${studentId}|${head}`) ?? 0)
            : 0;

          // What is already paid (valid receipts) or rebated against this old fee.
          let credited = 0;
          if (charge) {
            const gone = (
              await ReceiptCancellation.find({
                tenantId,
                studentId,
                status: "cancelled",
              })
                .session(session)
                .select("receiptId")
                .lean()
            ).map((r) => r.receiptId);
            const receipts = await Receipt.find({
              tenantId,
              studentId,
              fy,
              _id: { $nin: gone },
              "lines.chargeId": charge._id,
            })
              .session(session)
              .select("lines")
              .lean();
            const rebates = await Rebate.find({
              tenantId,
              studentId,
              fy,
              status: "active",
            })
              .session(session)
              .select("lines")
              .lean();
            for (const doc of [...receipts, ...rebates])
              for (const l of doc.lines ?? [])
                if (String(l.chargeId) === String(charge._id))
                  credited += l.amountPaise;
          }
          checkOldFeeChange({
            currentPaise: current,
            newPaise,
            creditedPaise: credited,
          });

          let chargeId = charge?._id;
          let dueDate = charge?.dueDate;
          let delta = newPaise - current;
          let createdCharge = false;
          if (!charge) {
            // No old fee was imported for this student (for example a mid-session admission).
            const [made] = await Charge.create(
              [
                {
                  tenantId,
                  studentId,
                  fy,
                  head,
                  period: "opening",
                  dueDate: effectiveDate,
                  amountPaise: newPaise,
                },
              ],
              { session, ordered: true },
            );
            chargeId = made._id;
            dueDate = effectiveDate;
            delta = 0; // the new charge itself carries the amount
            createdCharge = true;
          }
          const [doc] = await OldFeeAdjustment.create(
            [
              {
                tenantId,
                studentId,
                fy,
                head,
                chargeId,
                createdCharge,
                previousPaise: current,
                newPaise,
                deltaPaise: delta,
                dueDate,
                effectiveDate,
                reason,
                student,
                createdBy: String(user.id),
                createdByName: user.name,
              },
            ],
            { session, ordered: true },
          );
          saved = doc.toObject();
          if (audit) await audit(saved, session);
        });
        return saved;
      } finally {
        await session.endSession();
      }
    },
  };
}
