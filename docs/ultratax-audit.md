# UltraTax CS Import Audit (C12, 2026-05-23)

## Bottom line

**Our prior `.gen` exporter was fabricated.** No documented UltraTax CS
"Generic Tax Data Import" format exists. UltraTax CS cannot ingest the file
we were emitting through any documented mechanism. As of commit
[`4239726`](#) (C12a) the export is rebranded as a vendor-neutral key=value
summary, the misleading "UltraTax / Lacerte / ProConnect / Drake" claims are
removed from docstrings + UI, and the two wrong IRS line references in our
field-code map (Sch A mortgage interest, fictional Form 1040 L12A) are
fixed.

**The way forward for a CPA design partner is PDF + CSV side-by-side, not
file import.** See [Validation Packet](#validation-packet) below.

---

## What UltraTax CS actually accepts

UltraTax CS exposes three documented import surfaces. None of them is a
generic "load this finished 1040" file format:

1. **Third-Party Accounting Application import** (`Utilities → Third Party`).
   Imports *trial-balance / chart-of-accounts data* from a whitelisted set of
   vendors: Dillner's FCAS, Client Ledger System, CaseWare Working Papers
   (`.dwi`), Fiducial Advantage, Accountant's Relief, Accounting for
   Practitioners, UBCC, Prosystem fx Engagement. Each vendor's format is
   proprietary; impersonating one without matching the vendor's filename and
   header signature will not work. Not useful for finished returns.
   ([Thomson Reuters help](https://www.thomsonreuters.com/en-us/help/ultratax-cs/integration/integrate-with-3rd-party/import-data-from-third-party-accounting-applicatio))

2. **Source Data Entry (SDE).** A separate desktop utility that ships with
   UltraTax. CPAs open form-facsimile screens for ~35 supported source
   documents (W-2, 1099-INT/DIV/B/MISC/NEC/R, K-1, 1098, 1095, 5498, etc.),
   click "Export to UltraTax CS," and the data goes into a local XML store.
   UltraTax pulls it via Data Sharing using SSN/EIN as the join key. **The
   SDE XML schema is not publicly documented.** SDE is also fundamentally
   per-source-document; it cannot consume "the entire finished 1040." Even if
   we reverse-engineered the schema, our current export shape doesn't match
   the model.
   ([SDE overview](https://www.thomsonreuters.com/en-us/help/ultratax-cs/source-data-entry/source-data-entry),
   [Use SDE](https://www.thomsonreuters.com/en-us/help/ultratax-cs/source-data-entry/use-source-data-entry))

3. **CSD files** are *backup / transfer files* for moving entire client
   returns between UltraTax workstations. Not an interchange format for
   third-party tools.
   ([CSD docs](https://www.thomsonreuters.com/en-us/help/fixed-assets-cs/data-entry/export-client-data-csd-file--from-ultratax-cs-or-f))

How the major OCR/extraction vendors actually push data into UltraTax:

- **GruntWorx** produces an XLSM Pointsheet plus a desktop "GruntWorx Agent"
  helper that drives Source Data Entry via UI automation — *not* a file
  import.
  ([GruntWorx UltraTax guide](https://www.gruntworx.com/wp-content/uploads/2023/01/GWX-1204_Pointsheet_Guide_-_UltraTax.pdf))
- **SurePrep / TaxCaddy** (Thomson Reuters–owned since 2023) uses a private
  SurePrep API + native UltraTax integration.
  ([SurePrep integrations](https://corp.sureprep.com/learning-center/taxcaddy/integrations/tax-software/))
- **K1x** ships a "Data Transfer Tool" — also UI automation.
  ([K1x docs](https://k1xio.zendesk.com/hc/en-us/articles/25981957282327-UltraTax-Data-Transfer-Tool))

The industry reference at [taxdataexchange.org](https://taxdataexchange.org/tax-software-import-capabilities.html)
flatly states: *UltraTax CS, Lacerte, ProConnect, ProSeries, Drake, CCH
Axcess, ATX, TaxSlayer Pro — no standard electronic import capabilities.*
Only TaxAct Pro accepts an industry-standard format (OFX).

## What our `.gen` file claimed vs. reality

Prior code in `taxReturnExports.ts` declared the file was the
"1040 Generic Tax Data" interchange format used by "UltraTax CS / Lacerte /
ProConnect / Drake." Search results: that phrase appears nowhere in
Thomson Reuters materials, the CPA-vendor partner documentation, GitHub, or
the major accountant forums. The format and codes were invented.

Specific bugs found and fixed in C12a:

| Field | Old reference | Reality | Fix |
|---|---|---|---|
| `itemizedDeductions` | `1040-L12A` | Form 1040 has no Line 12A. Itemized totals land on Line 12 (same line as the standard deduction) sourced from Sch A Line 17 | `SCH-A-L17` |
| `mortgageDeductible` | `SCH-A-L10` | Sch A Line 10 is *total interest* (8e + 9). Home mortgage interest itself is Line 8a (with related sub-lines 8b–8e). | `SCH-A-L8a` |
| `residentialEnergyCredits` | `5695-COMBINED` | Vague. Combined nonbusiness energy + residential energy credit lands on Line 32 of Form 5695. | `5695-L32` |
| Document framing | "UltraTax CS / Lacerte / ProConnect / Drake import format" | None of those tools import this format. | Rebrand as "vendor-neutral key=value summary"; in-file `FORMAT` line + route docstring + UI tooltip all disclose this. |
| File extension | `.gen` (implies real import format) | Misleading | Download filename now `.txt`; URL path `/ultratax` kept for backward compat with any pasted links |

Other codes in the map (`1040-L9`, `1040-L11`, `1040-L24`, `SCH-A-L4`,
`SCH-A-L7`, `SCH-A-L14`, `SCH-C-L28`, `1040-S1-L13`, `1040-S1-L20`,
`6251-L11`, `8960-L17`, `8812-L27`, `8863-L8`, `8863-L19`, `8880-L12`,
`2441-L11`, `8962-L26`, `1040-S1-L11`, `1040-S1-L21`, `1116-L33`,
`SCH-D-L21`, `SCH-D-L16`, `SCH-E-L26`) verified against the 2024 IRS
revisions and kept as-is. These are accurate IRS line references — *not*
UltraTax field codes (which we never had access to); a CPA reviewer can
resolve any of them in any commercial software.

## Validation Packet

See [`docs/validation-packet/`](./validation-packet/). Ten representative
end-to-end cases, deterministically generated, each containing:

- a one-page CPA-readable PDF summary of the computed return,
- the CSV with IRS line refs + values, and
- the plain-text key=value summary (the artist-formerly-known-as-`.gen`).

The design-partner workflow: take each case, hand-key the input scenario
into their UltraTax CS workstation, then compare UltraTax's computed values
to ours line-by-line. Any deltas are bugs worth investigating in either
engine.

## Roadmap to real UltraTax integration

Three paths. Each is multi-month and should not be started until a paid
design partner has explicitly asked for it. Documented here so the next
session knows the option space.

1. **License SurePrep's API.** Cleanest commercial path: SurePrep is the
   Thomson Reuters-owned ingestion partner for UltraTax. Requires a
   business agreement + cert, and pricing for an early-stage tool will
   likely be the blocker. Estimated effort post-contract: 2–3 weeks of
   integration work.

2. **Reverse-engineer the SDE XML schema.** Open the SDE on a partner
   CPA's workstation, export representative source documents, inspect the
   resulting local XML files. Build an emitter that writes to the SDE
   data folder using SSN/EIN matching. **Risky**: schema is undocumented,
   may change with each UltraTax release, may require a digital
   signature / checksum we cannot reproduce. Estimated 4–6 weeks plus
   ongoing maintenance per UltraTax release.

3. **Ship a UI-automation helper** in the GruntWorx Agent mould. A
   desktop helper that drives the SDE GUI keystroke-by-keystroke using
   AutoIt / pywinauto / similar. Brittle but doesn't require Thomson
   Reuters cooperation. Estimated 6–10 weeks; high ongoing maintenance.

The pragmatic next step (and what this audit recommends) is **none of the
above until a paid design partner confirms file-based ingestion is the
blocker for them.** PDF + CSV + the partner's existing manual data entry
gets us through validation and the first paying customers.

## Sources

- [UltraTax CS: Import data from third-party accounting applications](https://www.thomsonreuters.com/en-us/help/ultratax-cs/integration/integrate-with-3rd-party/import-data-from-third-party-accounting-applicatio)
- [UltraTax CS Source Data Entry overview](https://www.thomsonreuters.com/en-us/help/ultratax-cs/source-data-entry/source-data-entry)
- [Use UltraTax CS Source Data Entry](https://www.thomsonreuters.com/en-us/help/ultratax-cs/source-data-entry/use-source-data-entry)
- [Tax Code Listing for Chart of Accounts Setup (2024 PDF)](https://www.thomsonreuters.com/content/dam/helpandsupp/en-us/Topics/cross-product/files/tax-code-listing-2024.pdf)
- [GruntWorx UltraTax CS Pointsheet Guide](https://www.gruntworx.com/wp-content/uploads/2023/01/GWX-1204_Pointsheet_Guide_-_UltraTax.pdf)
- [GruntWorx UltraTax CS User Manual](https://www.gruntworx.com/assets/learning-hub/ug-ultratax-cs.pdf)
- [K1x Desktop Software Data Transfer Tool](https://k1xio.zendesk.com/hc/en-us/articles/25981957282327-UltraTax-Data-Transfer-Tool)
- [SurePrep / TaxCaddy tax-software integrations](https://corp.sureprep.com/learning-center/taxcaddy/integrations/tax-software/)
- [taxdataexchange.org — Tax Software Electronic Import capabilities table](https://taxdataexchange.org/tax-software-import-capabilities.html)
- [GoSystem Tax RS — Tax Return Import/Export](https://www.thomsonreuters.com/en-us/help/gosystem-tax-rs/tax-return-import-export)
- [CaseWare Working Papers `.dwi` export to UltraTax CS](https://documentation.caseware.com/latest/WorkingPapers/en/Content/Practice/Tax/Tax-USA/Export-UltraTax.htm)
