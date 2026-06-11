# Forms / Workpapers / Exports audit — 2026-06-11

Auditor: fresh independent pass, READ-ONLY. Scope: `artifacts/api-server/src/lib/forms/*` (44 builders + renderer + registry + reconciliation), `pdfExport.ts`, `irsForm1040Pdf.ts`, `form1040x.ts`, `form4868.ts`, `form8824.ts`, `form8990.ts`, `taxReturnExports.ts`, `pdfBrand.ts`, `organizerPdf.ts`, `planningReportPdf.ts`.

Method: read every file; cross-checked builder arithmetic against `taxReturnEngine.ts` / `taxCalculator.ts` source (not tests); built runtime repros via `computeTaxReturnPure` + builders (`/tmp/audit-recon-repro.ts`, `/tmp/audit-credits-repro.ts`, packet render + pdfkit glyph-encoding probes). Line-number fidelity assessed from knowledge of the 2024 IRS forms; confidence noted per finding.

Severity: CRITICAL = wrong dollar/line a CPA would copy · HIGH = misleading line/label or broken render in a common path · MEDIUM = edge · LOW = cosmetic.

---

## HIGH findings

### H1. NOL-carryforward returns trip a FALSE "⚠ off by $NOL" on the headline taxable-income tie-out (1040 workpaper + reconciliation worksheet) — REPRODUCED
- Files: `forms/form1040Spec.ts` (~189–192, 222–229), `forms/reconciliationWorksheet.ts` (~145–164).
- Both compute `taxableComputed = max(0, max(0, max(0, AGI − deduction) − QBI) − OBBBA)`. The engine's actual chain (taxReturnEngine.ts 2977–3092) inserts the NOL step: `taxableAfterNol = max(0, taxable − nolDeduction)` BEFORE QBI/OBBBA. Neither identity includes `ret.nolDeduction`, and neither form renders an NOL row between lines 11→15.
- Repro (single, $200k W-2, `nol_carryforward` $50k, TY2024): engine taxable $160,400 (correct: 225,000 − 14,600 − 50,000). Both the 1040 workpaper and recon Part 3 print **"⚠ … off by +$50,000.00"**, and the 1040's visible chain (line 11 $225,000 − line 14 $14,600 ≠ line 15 $160,400) doesn't add up with no explanation.
- Compounding: recon **Part 2 lists the NOL as an above-the-line adjustment** ("8a NOL carryforward deducted" $50,000) plus a spurious "Other adjustments (residual)" of **−$50,000** captioned "Manual above-the-line adjustments (SEP/SIMPLE, alimony, etc.)" — the engine does NOT apply the NOL in the AGI bridge. `schedule1Spec.ts` handles this correctly (8a row is informational and excluded from sums; its ties stay green) — the recon/1040 builders contradict their sibling.
- Impact: the pipeline AUTO-loads NOL carryforwards from the prior year (CF2), so every NOL client's packet leads with a false alarm on its two headline tie-outs — exactly inverted from the worksheet's promise ("⚠ rows demand review"). Same falseness in `pdfExport.ts` lines 104 ("NOL carryforward deducted (Sched 1 L8a)" listed under above-the-line adjustments).

### H2. Form 1040-X line numbers are off-by-one vs the official form through the entire payments/settlement half (confidence: high)
- File: `form1040x.ts` (~322–352).
- Official Form 1040-X (stable across revisions incl. Rev. Feb 2024): 9 = *Reserved*, 10 = Other taxes, 11 = Total tax, 12 = Withholding, 13 = Estimated payments, 14 = EIC, 15 = Refundable credits, 16 = Amount paid with extension/original return, 17 = Total payments, 18 = Overpayment on original return, 19 = 17−18, 20 = Amount you owe, 21 = Overpaid/refund.
- Builder emits: `"9"` Other taxes, `"10"` Total tax, `"11"` Withholding, `"13"` EITC, `"14"` Refundable credits, `"16"` Total payments, `"17"` Overpayment per original, `"18"` Tax paid with original, `"19"` Amount you owe, `"20"` Refund — i.e. every one of those is one line LOW (and "13" lands EITC on the official *estimated payments* line; the in-code comment even asserts tax-paid-with-original is "official Form 1040-X Line 15", which is the refundable-credits line). A CPA transcribing `lineRef`s onto the real 1040-X mis-files every payments-section entry.
- Math itself is sound: round-each-column rule ✓ (`round(c) − round(a)`); settlement invariant Line20−Line19 == netFederalRefundChange ✓ (verified algebraically against the engine's refund identity).

### H3. Form 1040-X "Tax" vs "Other taxes" bucket split omits §72(t), HSA excise, Schedule H, and excess-APTC
- File: `form1040x.ts` (~236–246, 334–337) + `FiledSnapshot` (~46–90).
- `otherTaxes = SE + NIIT + AddlMedicare` only. The engine's `federalTaxLiability` also bundles `earlyWithdrawalPenalty`, `hsaExcessExcise`, `scheduleH.total`, and the excess-APTC repayment — so the builder's "line 6 Tax (regular + AMT), before nonrefundable credits" silently CONTAINS all four, and the other-taxes line excludes the three Schedule-2-Part-II ones that officially belong there (Sch H is officially Schedule 2 line 9 → 1040-X other taxes). Total-tax line is unaffected; the 6 / 9(10) split a CPA copies is wrong for any filer with those taxes.
- Root cause: `FiledSnapshot.fields` never captures the four components, so an amendment changing only (say) the §72(t) penalty shows the delta on "Tax (regular + AMT)". Snapshot is additive-versioned — fields can be added without breaking old snapshots.

### H4. Form 4868 Lines 4 and 5 are each overstated by the nonrefundable credits applied
- File: `form4868.ts` (~88–111; PDF labels ~236–238). CLAUDE.md documents the same derivation, so this is designed-in, but it's wrong on the official form's terms.
- `line4 = ret.federalTaxLiability` — the engine value is PRE-nonrefundable-credit; official 4868 Line 4 = "estimate of total tax liability" = 1040 line 24, which is NET of nonrefundable credits. `line5 = federalTaxLiability + federalRefundOrOwed` — that identity equals official Line-33 payments PLUS `totalNonRefundableApplied` (engine refund = withheld + nonref + refundables − liability). Both lines are grossed up by the same amount; Line 6 (balance due) is correct.
- Impact: any client with a CTC/FTC/dep-care/education credit (very common) gets a substitute 4868 whose Lines 4/5 don't match what the eventual 1040 will show — and the PDF labels them "(Form 1040 Line 33)". The 1040-X module already back-outs `totalNonRefundableApplied` (FORM-02); 4868 never got the same fix. Fix: line4 −= totalNonRefundableApplied; line5 −= totalNonRefundableApplied (balance unchanged).

### H5. IRS Form 1040 template filler (`irsForm1040Pdf.ts`) writes several wrong values onto the REAL IRS form
- File: `irsForm1040Pdf.ts` (~203–296). This artifact fills the actual IRS fillable f1040-2024.pdf — the highest copy-risk artifact in the subsystem. The substitute workpaper (`form1040Spec.ts`) gets all of these right; the pdf-lib filler is its stale sibling.
  1. **Line 3a = `ret.preferentialIncome`** — that is LTCG + qualified dividends. Official 3a is qualified dividends ONLY. An investor with $50k LTCG + $3k QDIV shows $53k "qualified dividends" on the real form.
  2. **Line 3b = `form1099Summary.ordinaryDividends`** — the engine field is the NON-qualified remainder; official 3b is box-1a TOTAL (incl. qualified). Understated by the qualified portion (the workpaper recombines; this doesn't).
  3. **Line 7 = full `netCapitalGainLoss`** even when a net loss — official line 7 caps the loss at −$3,000/−$1,500 (Schedule D line 21). A −$20k net loss prints −20,000 instead of −3,000.
  4. **Line 1a "wages" residual** = totalIncome − interest − ordinaryDividends(non-qual) − retirement − netCapitalGainLoss: leaves qualified dividends, taxable SS (which is ALSO printed on 6b → double-shown), SE/K-1/misc/unemployment income inside "wages"; over/under-states 1a for anything beyond a pure W-2 return, and the loss subtraction in (3) inflates it further.
  5. **Lines 16/23 split**: line 16 residual subtracts only AMT/NIIT/SE/AddlMedicare — §72(t), HSA excise, Schedule H, excess-APTC remain inside line 16; line 23 = SE+NIIT+AddlMedicare omits §72(t)/HSA/Sch-H (officially Sch 2 line 21); line 17 admits to ignoring APTC repayment. Line 24 is correct.
  6. **Line 25a = total `federalTaxWithheld`** (includes 1099 + manual withholding) and 25d = same total — official 25a is W-2-only; 1099 withholding belongs on 25b.
  7. **Line 33 omits `manualCreditsApplied` and the refundable adoption portion** → for those filers line 33 − line 24 ≠ line 34/37 (which are engine-correct).
- Confidence: code-reading certain (field semantics verified against engine source). Severity HIGH because values land on the genuine IRS layout for client-facing review.

### H6. Summary PDF "Standard / itemized deduction" line shows the STANDARD deduction even when the return itemized
- File: `pdfExport.ts` (~92–96): `["Standard / itemized deduction", fmt(ret.standardDeduction)]` always. For an itemizer (engine used `itemizedDeductions`), the headline Deductions line shows the unused standard amount and the AGI→taxable chain visibly doesn't reconcile. (The Schedule A section further down does show the itemized total, with no flag that THAT is the one in use.) Fix: `fmt(ret.itemizedDeductions ?? ret.standardDeduction)`.

### H7. Summary PDF "regular tax" netting (PDF2) misses the excess-APTC repayment
- File: `pdfExport.ts` (~164–177): nets out AMT/NIIT/SE/AddlMedicare/§72(t)/HSA/Sch-H but NOT `max(0, −premiumTaxCredit.netPtc)`, which the engine bundles into `federalTaxLiability` (taxReturnEngine 3919). For an ACA filer repaying APTC, "Federal income tax (regular, 1040 L16)" is overstated by the repayment, while the same amount also prints as its own "Excess Advance APTC (Sched 2 L2)" row — double-displayed; rows no longer sum to the L24 total. This is precisely the class of bug PDF2 fixed for §72(t)/HSA/Sch-H — APTC was missed. (The workpaper 1040/Schedule-2 builders handle it correctly.)

---

## MEDIUM findings

### M1. Reconciliation Part 1 "1099-MISC" row double-counts rents + royalties — REPRODUCED
- File: `forms/reconciliationWorksheet.ts` (~74): `f99.miscIncome + f99.rents + f99.royalties`. Per `Form1099Summary` (engine 660–700), `rents`/`royalties` are SUBSETS of `miscIncome`. Repro: MISC with rents 10,000 / royalties 5,000 / other 2,000 → row prints **$32,000** (actual $17,000) and a spurious negative residual appears. The total row (line 9) is still engine-correct; the itemized dollar a CPA traces is wrong. (`schedule1Spec` uses plain `miscIncome` ✓.)

### M2. Reconciliation Part 1 "3b Ordinary dividends" shows the non-qualified remainder; qualified dividends are missing from the itemization — REPRODUCED
- File: `forms/reconciliationWorksheet.ts` (~66). `f99.ordinaryDividends` is the box-1a-minus-1b remainder; Form 1040 line 3b / Schedule B line 6 = box-1a TOTAL. Repro: $8,000 box 1a / $3,000 qualified → recon "3b" prints $5,000 while the 1040 workpaper correctly prints $8,000 in the same packet. Qualified dividends (1099 + K-1) appear nowhere in Part 1's itemization and silently inflate the residual. Misleading vs the official line and internally inconsistent across forms in one packet.

### M3. Reconciliation Part 2 lists FEIE as an above-the-line adjustment; engine nets it inside total income
- File: `forms/reconciliationWorksheet.ts` (~121). Engine (2594–2656): `feieGrossForeignIncome − feieExclusion` are both inside `ordinaryAdditionalIncome` (total income), NOT in `aboveTheLineAdjustments`. For an FEIE filer, Part 2's "8d FEIE" row inflates the listed adjustments and forces an equal negative residual mislabeled "Manual above-the-line adjustments (SEP/SIMPLE, alimony, etc.)". Same family as H1's NOL misplacement (and `schedule1Spec` places FEIE correctly in Part I).

### M4. Reconciliation Part 5 lists UNCAPPED credit amounts and false-⚠s whenever the tax-liability cap binds — REPRODUCED
- File: `forms/reconciliationWorksheet.ts` (~208–231). FTC/dep-care/education/Saver's rows use the calc-level amounts (`ret.foreignTaxCredit.credit`, `ret.dependentCareCredit.appliedCredit`, `aocNonRefundable + llcApplied`, `saversCredit.appliedCredit`) and "S3-5" uses `residentialEnergyCredits.total` — all PRE-liability-cap; the engine's `totalNonRefundableApplied` sums the post-`Math.min(·, remainingTax)` amounts (engine 3609–3736). Repro (single $24k W-2 + $3k dep-care + $10k LLC): rows print $900 + $2,000, total $940, and **"⚠ Nonrefundable components tie: off by +$1,960.00"** — a false alarm on a perfectly correct return. Common for low-income filers with credits. (The per-form builders 2441/8863/8880 reconstruct the caps correctly and disclose binding; the recon should use the same reconstruction or the engine's applied components.)

### M5. checkLine / notes glyphs (✓ ⚠ − → ≤ ≥ └) are not WinAnsi-encodable — they render as garbage pairs in every pdfkit artifact — REPRODUCED at the byte level
- Files: `forms/formSpec.ts` (checkLine builds "✓"/"⚠"/"−"), all 40+ spec builders' notes (U+2212 minus in `usd()` of scheduleDSpec/form8949Spec, "→", "≤", "≥"), `pdfExport.ts` ("└─" rows), `form1040x.ts`, `form4868.ts`, `form8824.ts` ("≤ 45 days"), `form8990.ts`.
- pdfkit standard-14 Helvetica is WinAnsi: probe shows U+2713 ✓ emitted as bytes `27 13` (renders `'` + invisible), U+26A0 ⚠ as `26 A0` (renders `& `), U+2212 − as `22 12` (renders `"` + invisible — **the minus sign disappears**, so "−$50,000.00" displays as `"$50,000.00`), U+2192 → as `! ’`, └─ as `% `+ctrl.
- Worst effect: negative amounts in Schedule D / 8949 notes and check-row "off by −$X" lose their sign — a negative can be misread as positive. The ✓/⚠ tie-out markers (the packet's core device) degrade to `'` and `&`. `organizerPdf.ts` lines 56–63 explicitly KNOWS this limitation and vector-draws its checkmark — the workpaper renderer never got the same treatment. Fix: ASCII-map in `fmtValue`/`renderLine` (e.g. "OK"/"REVIEW"/"-") or embed a Unicode font.
- Page-level rendering otherwise verified CLEAN: full packet renders, watermark on every page, page count sane (no footer page-fork; bottom-margin zeroing works), 8949 row cap + overflow rows fine.

### M6. Form 8824 substitute PDF line numbers mislabeled vs the official form (confidence: high)
- File: `form8824.ts` (~53–65, 270–305): labels "Line 12. FMV of like-kind property received" (officially **line 16**; official 12 = FMV of *other* property GIVEN UP), "Line 13. Adjusted basis of property given up" (officially **line 18**), "Line 18. Realized gain" (officially **line 19**), "Line 22. Recognized gain" (officially **line 23**; 22 is only the post-recapture capital portion). Lines 15/24/25 are correct. The PDF instructs "CPA: transcribe these line values to the official IRS Form 8824" — transcription by lineRef mis-files four entries.
- Also: the footnote routes the recognized gain to "Schedule D Line 13" — Schedule D line 13 is 1099-DIV capital-gain *distributions*; Form 8824 gains go to **line 11** (the `scheduleDSpec` workpaper places §1031 on line 11 correctly).

### M7. Form 8995-A Part II rows use wrong official line numbers (confidence: medium-high)
- File: `forms/form8995Spec.ts` (~153–177): per-business "greater of 50% wages or 25%+2.5% UBIA" is labeled line **9** (officially line **10**; 9 = 25%+2.5% sum only) and "QBI component after wage/UBIA limit" labeled line **12** (officially the phased-in reduction; the per-business component is line **15/16**). Part IV (27/32/33/34/35/36/37/39) is correct, and the line 33/34 derivations (re-adding QBI + OBBBA; pre-§163(d)(4)(B)-election preferential) match the engine exactly.

### M8. Schedule 3 line "6m" used for the Form 8911 §30C credit; official letter is 6j (confidence: medium-high)
- File: `forms/schedule3Spec.ts` (~47). Internal contradiction: `form5695Spec.ts` footnote says "officially Form 8911 (Schedule 3 line 6j)" — one of the two is wrong, and the official TY2024 Schedule 3 maps 8911 to 6j (6m = previously-owned clean vehicles, Form 8936).

### M9. Coverage gating — two misses
1. **Schedule A**: gate is `nz(ret.scheduleA.totalItemized)`. A return itemizing purely via the legacy single-number override (`additionalDeductions`) or purely via the §163(d) investment-interest fold-in has `totalItemized == 0` but `ret.itemizedDeductions != null` → Form 1040 line 12 reads "Itemized deductions (Schedule A)" while the packet contains NO Schedule A. (`scheduleASpec.ts` ~54.)
2. **Schedule B**: `scheduleBRequired` (engine 755–759) counts only 1099-INT/DIV; K-1 portfolio interest/dividends (which officially belong on Schedule B and count toward the $1,500 trigger) are excluded — a filer with $2k of K-1 interest and no 1099-INT gets no Schedule B and no required-flag. Partially disclosed in footnotes ("other mandatory triggers not modeled") but the K-1 miss isn't named.

### M10. Exports (`taxReturnExports.ts`) — label/parity defects
- `federalTaxWithheld` mapped to "1040-L25a" / labeled "Federal Income Tax Withheld (W-2)" but the value includes 1099 + manual withholding (line 25d).
- `aocCredit` (the TOTAL AOC, `aocApplied`) mapped to "8863-L8" — official line 8 is the REFUNDABLE 40% only; the total is line 7. `llcCredit` mapped to "8863-L19" — line 19 is total nonrefundable education credits (AOC-nonref + LLC), not LLC alone.
- Curated CSV/.gen rows have **no rows for** Schedule H, §72(t) penalty, HSA excise, excess-APTC repayment, state mandate penalty, adoption credit, OBBBA 1-A, §1250/28% buckets, investment interest, Form 4797 — so the CSV's components cannot reconcile to its own `1040-L24` value for those filers (JSON is fine via `fullResult`).
- CSV injection: CLEAN — `csvEscape` neutralizes leading `= + - @ \t \r` (numbers exempted) and quotes correctly. The `.gen`/TXT export does NOT escape client name/email (newline injection into the key=value stream possible) — LOW-risk.

### M11. Summary PDF credit list incomplete + one wrong line ref
- `pdfExport.ts`: missing rows for adoption credit (nonref + refundable), Form 8801 AMT credit, §38 GBC (R&D/WOTC/FMLA), state-refundable package — refund line can't be explained from the rows shown for those filers; "Net Premium Tax Credit (Sched 3 L8)" should be **line 9**; AOC row uses `aocApplied` (incl. refundable 40%) labeled "Sched 3 L3a".

---

## LOW findings

- **L1.** `form1040Spec.ts` line 1a / 25a sum `inputs.w2s` WITHOUT the tax-year filter the engine (1485) and `schedule1Spec`/recon use — multi-year `w2s` arrays would overstate 1a/25a (live route pre-filters by year, so prod-safe; test/Haven callers may not).
- **L2.** `form1040Spec.ts` uses "13a/13b" (the TY2025 OBBBA layout) even for TY2024 returns, where the official form has a single line 13; header claims "TY2024 official layout". Disclosed nowhere.
- **L3.** `schedule1Spec.ts` line 9 label "sum of lines 8a–8z as itemized above" while the 8a NOL row is excluded from the sum (footnoted, but the label itself contradicts).
- **L4.** `form4952Spec.ts` labels net investment income "4a" (official 4a = gross income from property; NII is line 6) and folds the prior-year carryforward into "line 1" (official line 2).
- **L5.** `pdfExport.ts`: `${client.email}` prints literal "null" when email is null; the hardcoded "Above-the-line adjustments — —" row in the Income section; `scheduleCExpenses` listed under "Above-the-line adjustments".
- **L6.** `statePa40Spec.ts` anchors "9 taxable compensation" — PA-40 line 9 is *Total PA Taxable Income* (compensation is 1a). Cosmetic anchor blur; values are engine aggregates.
- **L7.** `form1040x.ts` `deduction() = max(std, itemized)`: when a CPA FORCES itemized below the standard deduction (`useItemizedDeductions: true` override), the line-2 figure shows std while the return used itemized; also lines 3→5 don't foot for NOL/OBBBA filers (no NOL/1-A line; no check row, so silent).
- **L8.** `irsForm1040Pdf.ts` SSN helper dead (`void fmtSsn`) and `globalThis.__dirname ?? ""` pathing — fragile under non-bundled execution (works in esbuild bundle).
- **L9.** Recon Part 1 includes "8 K-1 pass-through (non-capital buckets)" without K-1 qualified dividends (consistent with M2; they land in the residual).

## Verified CLEAN (explicitly checked against engine source / official line layouts)

- **Form 1040 workpaper core math**: line 16/17/23 residual decomposition exactly inverts `totalFederalLiabilityWithRepayment` (engine 3598–3919); line 22 floor provably never binds (footnoted correctly); settlement identity ties (repro ✓); 3a/3b recombination correct; line 7 net-loss capped at `capitalLossDeducted` ✓.
- **Schedules 1/2/3**: line numbering matches official TY2024 (S1: 1/3/4/5/7/8a/8d/8k/8p/8z/9/10, Part II 11/13/15/17/18/20/21/24z/25; S2: 1/2/3/4/8/9/11/12/21; S3: 1/2/3/4/5a/5b/6a/6b/6c/8/9/13z — except M8's 6m). Schedule 1's NOL/FEIE/§179 engine-deviation disclosures are accurate and its tie-outs stay green in repro.
- **Schedule A**: medical 7.5% floor, SALT max(income, sales)+property and year-indexed cap, charitable split gating, line 17 = components + 4952 fold-in — all match `calculateScheduleA` exactly; legacy-override divergence disclosed loudly.
- **Schedule D + 8949**: line 7/15/16 decompositions are term-for-term identical to the engine's netting (engine 2360–2425); box bucketing (null→A, unrecognized→dropped) mirrors engine 1543–1550 including the empty-string edge; lines 17–22 flow matches the official form; 18/19 are post-absorption subsets with correct flat-25%/28% notes; wash-sale gating of per-bucket ties is sound; 1099-DIV 2a excluded from 8949 ties ✓.
- **Schedule SE / Schedule H / 8959 / 8960 / 8812 / 8863 / 8880 / 2441 / 8962 / 8839 / 1116 / 6251 / 5329 / 8615 / 8582 / 4797 / 4562 / 2555 / 7206 / 8283**: line numbers match the official 2024 layouts; credit-limit-worksheet reconstructions (8812 line 13; 2441 line 10; 8863; 8880 line 11) are exact inversions of the engine's sequential-min pipeline; 8812's pre-CTC residual subtracts §53/§41/§38 correctly per the C1 ordering; 6251's 2a–2t component letters are right (2a covers std-ded addback for non-itemizers ✓) with the FTC-on-line-10 caveat disclosed; 4797 §1245/§1250/§1231(c) per-property re-derivations match `lib/form4797.ts`.
- **Reconciliation Parts 4/6/7/8**: federal-tax composition and refund settlement are EXACT engine identities (repro ties); state settlement formula mirrors engine line 4080 term-for-term; carryforward list covers all 16 carryforward outputs on `ComputedTaxReturn` (incl. Schedule-1-A-era fields).
- **Renderer/packet**: DRAFT watermark on every page (pageAdded + explicit cover call); footer pass uses the bottom-margin-zero fix — packet renders 11 pages for 9 logical units, no doubling; `pdfBrand.applyBrandFooters` used by organizer + planning report (both `bufferPages: true`); ensureRoom/continued-page headers fine; multi-page 8949 capped at 40 rows/part with overflow disclosure.
- **Exports**: CSV injection defended (OWASP-style neutralization, numeric passthrough); JSON has full engine parity via `fullResult`; `.gen` honestly disclaims UltraTax import.
- **PDF determinism**: only intentional generated-at timestamps (workpaper packet's is injectable); no other Date/random content.
- **Form 8990**: line refs (1/2/3/4/22/25/26/30/31, Schedule B 50–51) match the official form regions; ATI-proxy limitation disclosed.
- **Form 4868 line 6/7**: balance-due bottom line and payment default are correct (the Line 4/5 gross-up is H4).
- **NY IT-201 / NJ-1040 / MA Form 1 / CA 540 summaries**: spot-checked line anchors (IT-201 19/26/27/29/39/41/46/47/47a/48/54b/55/63/65/69/70/72; NJ 15/28a/42/43/44/53c/55/56/58/64; MA 22) are correct; per-state refunds correctly NOT rendered (aggregate-settlement philosophy consistently applied with pointers to recon Part 7).

## Repro artifacts
- `/tmp/audit-recon-repro.ts` — H1/M1/M2/M3 (NOL false-⚠, MISC double count, 3b, Part-2 misplacement).
- `/tmp/audit-credits-repro.ts` — M4 (Part-5 false-⚠ with capped credits).
- `/tmp/audit-glyph-test.ts` + inline probes — M5 (byte-level WinAnsi proof) and the packet page-count check.
