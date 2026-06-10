/**
 * T2.1 B0 — Workpaper form registry: the packet's table of contents.
 *
 * Order = packet order: the reconciliation worksheet first (the CPA's
 * cross-check index), then Form 1040 and its schedules in filing order, then
 * credit forms, other-tax forms, detail forms, and the state summaries last.
 * Each builder returns null when the form is not applicable to the return —
 * the packet includes only applicable forms.
 */

import type { FormBuildContext, FormBuilder, FormInstance } from "./formSpec";
import { buildReconciliationWorksheet } from "./reconciliationWorksheet";

import { build1040 } from "./form1040Spec";
import { buildSchedule1 } from "./schedule1Spec";
import { buildSchedule1A } from "./schedule1ASpec";
import { buildSchedule2 } from "./schedule2Spec";
import { buildSchedule3 } from "./schedule3Spec";
import { buildScheduleA } from "./scheduleASpec";
import { buildScheduleB } from "./scheduleBSpec";
import { buildScheduleC } from "./scheduleCSpec";
import { buildScheduleD } from "./scheduleDSpec";
import { buildForm8949 } from "./form8949Spec";
import { buildScheduleE } from "./scheduleESpec";
import { buildScheduleSE } from "./scheduleSESpec";
import { buildScheduleHForm } from "./scheduleHSpec";

// Credit forms
import { buildForm8812 } from "./form8812Spec";
import { buildForm8863 } from "./form8863Spec";
import { buildForm8880 } from "./form8880Spec";
import { buildForm2441 } from "./form2441Spec";
import { buildForm8962 } from "./form8962Spec";
import { buildForm5695 } from "./form5695Spec";
import { buildForm8839 } from "./form8839Spec";
import { buildForm1116 } from "./form1116Spec";

// Other-tax forms
import { buildForm6251 } from "./form6251Spec";
import { buildForm8959 } from "./form8959Spec";
import { buildForm8960 } from "./form8960Spec";
import { buildForm8615 } from "./form8615Spec";
import { buildForm5329 } from "./form5329Spec";

// Detail forms
import { buildForm8995 } from "./form8995Spec";
import { buildForm4562 } from "./form4562Spec";
import { buildForm8582 } from "./form8582Spec";
import { buildForm4952 } from "./form4952Spec";
import { buildForm2555 } from "./form2555Spec";
import { buildForm7206 } from "./form7206Spec";
import { buildForm8283 } from "./form8283Spec";
import { buildForm4797Form } from "./form4797Spec";

// State summaries
import { buildCa540 } from "./stateCa540Spec";
import { buildNyIt201 } from "./stateNyIt201Spec";
import { buildNj1040 } from "./stateNj1040Spec";
import { buildMaForm1 } from "./stateMaForm1Spec";
import { buildPa40 } from "./statePa40Spec";
import { buildStateGeneric } from "./stateGenericSpec";

/**
 * The full ordered builder list (the reconciliation worksheet is prepended
 * separately so it always leads the packet). null-returning builders are
 * filtered out by buildAllFormInstances.
 */
const FORM_BUILDERS: FormBuilder[] = [
  // ── Form 1040 + core schedules (filing order) ──
  build1040,
  buildSchedule1,
  buildSchedule1A,
  buildSchedule2,
  buildSchedule3,
  buildScheduleA,
  buildScheduleB,
  buildScheduleC,
  buildScheduleD,
  buildForm8949,
  buildScheduleE,
  buildScheduleSE,
  buildScheduleHForm,
  // ── Credit forms ──
  buildForm8812,
  buildForm8863,
  buildForm8880,
  buildForm2441,
  buildForm8962,
  buildForm5695,
  buildForm8839,
  buildForm1116,
  // ── Other-tax forms ──
  buildForm6251,
  buildForm8959,
  buildForm8960,
  buildForm8615,
  buildForm5329,
  // ── Detail forms ──
  buildForm8995,
  buildForm4562,
  buildForm8582,
  buildForm4952,
  buildForm2555,
  buildForm7206,
  buildForm8283,
  buildForm4797Form,
  // ── State summaries ──
  buildCa540,
  buildNyIt201,
  buildNj1040,
  buildMaForm1,
  buildPa40,
  buildStateGeneric,
];

export function buildAllFormInstances(ctx: FormBuildContext): FormInstance[] {
  const instances: FormInstance[] = [buildReconciliationWorksheet(ctx)];
  for (const builder of FORM_BUILDERS) {
    const inst = builder(ctx);
    if (inst) instances.push(inst);
  }
  return instances;
}
