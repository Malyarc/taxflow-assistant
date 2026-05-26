# 12-Minute Live Demo Script

Pre-flight (do BEFORE the Zoom):
- Open http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com in a
  fresh browser window
- Have 1 sample W-2 PDF + 1 sample 1099-INT PDF ready on your desktop
- Pre-create a demo client "Sarah Johnson, Single, CA, TY2024, 1 child"
  to avoid spending demo time on the new-client form
- Have `docs/validation-packet/` open in a 2nd tab to grab the
  hand-keyable cases if they want to test their software offline

## Script

**(0:00 – 1:00) Pitch the workflow in one minute**

> "Here's what I want to show you. We're going to upload a client's
> W-2 PDF, AI extracts every field, you review them on a per-field
> diff against what the AI guessed, you approve. The values land on
> the client record with a full audit trail. Engine recomputes the
> 1040, you export PDF/CSV/.gen. You then plug that into UltraTax or
> whatever you use for the actual filing.
>
> The model never changes the client record. It proposes — you
> approve. Twelve minutes, watch."

**(1:00 – 3:00) Upload + extract**

- Click "Sarah Johnson" → Documents tab
- Drop the W-2 PDF
- Watch the "pending_review" badge appear
- Point out the 8MB cap, 50-doc queue limit, audit log

> "You can drop in W-2, 1099-NEC, 1099-INT/DIV/B/R/G/K/MISC, 1098-E,
> 1098, K-1, and SSA-1099 today. Gemini Flash extracts. Real W-2 F1
> 0.865 on our benchmark. Whether the AI gets it right or wrong
> doesn't matter for the engine — you're going to confirm every
> field."

**(3:00 – 6:00) Review modal — the diff column**

- Click "Review" on the W-2 row
- The review modal opens with the PDF on the left, extracted fields
  on the right, bounding boxes overlaid
- Point at each diff indicator:
  - ✓ green = AI value matches what's on the doc, kept
  - ✎ amber = CPA changed it (shows AI value struck-through →
    your value)
  - + sky blue = field AI didn't extract but CPA added
  - ⊘ amber clear = AI guessed something CPA wiped

> "Here's the box I make. Every field is shown to you. You can
> compare against the PDF on the left — bounding boxes are exact. If
> the AI got it right, ✓, you keep moving. If it's wrong, you fix it.
> If you don't see something the AI extracted that you need on the
> return, you type it in.
>
> Critically: nothing has touched the client record yet. Only after
> you click Approve. Look at the audit log — every approval is
> stamped with the AI's value AND your final value AND a timestamp.
> If a client ever questions a number, you can prove what the AI
> proposed vs. what you approved."

- Click "Approve" — the row turns green
- Switch to the Tax Calculator tab to show the engine has updated

**(6:00 – 8:00) The calculator**

- Show federal + state breakdown
- Click "Tax Returns" sidebar — show the engine values updated

> "Engine computes federal + state in under 50 milliseconds. Every
> line on Form 1040, every credit, Schedule A, AMT (Form 6251 Part
> III preferential LTCG rates), NIIT, Additional Medicare (Form
> 8959), SE tax with Sch SE Line 9 shared SS wage base, §121
> home-sale exclusion, SS taxability worksheet 0/50/85% — all of it.
>
> Here's the disclosure I make up front. The engine has 1,584
> hand-calculated test assertions across 26 suites with 0 failures.
> I'll send you the audit report after this call. There are six
> federal-engine gaps I haven't built yet — kiddie tax, FEIE for
> expats, NOL carryforward, §1202 QSBS for tech founders. If you hit
> one I haven't built, I prioritize it and ship it inside two weeks."

**(8:00 – 10:00) Exports**

- Click "Tax Return (PDF)" — show the PDF summary
- Click "IRS Form 1040 (PDF)" — show the filled IRS form
- Click "CSV" — show the IRS-line-reference format
- Click ".gen" — show the vendor-neutral summary

> "You can take any of these into your existing software. The PDF is
> a clean one-page summary you can email the client. The IRS Form
> 1040 PDF is the actual IRS-published form filled with our numbers
> — for client signature review. The CSV has IRS line references
> per row. The .gen file is a vendor-neutral text dump organized by
> IRS form / line / value. Hand-keyable into UltraTax in maybe 5
> minutes per return.
>
> I'd love to ship a real UltraTax import file, but the audit I did
> last week confirmed UltraTax CS has no public file-based import
> format for 1040s. So I'm not pretending — PDF/CSV/.gen is the
> workflow. If a paid customer specifically needs file-based
> ingestion, that's a multi-month build I'll commit to."

**(10:00 – 11:30) The validation packet**

- Open docs/validation-packet/ link in the 2nd tab
- Show the README listing the 10 cases

> "Here's what I want to send you home with. Ten hand-keyable cases
> covering single, MFJ, HoH, W-2 only, Sch C, LTCG, ISO bargain AMT,
> EITC, retiree with SS, multi-state. Each one has the inputs as a
> CSV, the expected outputs computed by our engine, and a PDF for
> the client-facing view.
>
> Take these into UltraTax / Lacerte / ProConnect / Drake. Hand-key
> the inputs. Compare the outputs line by line. If the numbers don't
> match yours, I want to know — that's the most valuable feedback
> you can give me. If they do match, you have an independent
> verification against your existing software."

**(11:30 – 12:00) The ask**

> "Two paths from here. One: you take the validation packet, run it
> through your software, send me an email saying 'matches' or 'this
> field is off' on each case. Twenty minutes of your time.
>
> Two: you pilot with $500–$1,000/month for 30 days, cap at 10
> clients. Weekly 30-minute Zoom. I prioritize whatever trips you
> up. If after 30 days you don't see value, you stop paying. If you
> do, I'd appreciate a reference once you're comfortable.
>
> Either way, I'll send you the audit report, the validation packet,
> and the test-suite summary by the end of today. What feels right?"

## After the demo (within 60 minutes)

Send this email:

> Subject: TaxFlow demo follow-up — materials inside
>
> Hi [First name],
>
> Thanks for the 12 minutes. As promised, here's everything to take
> with you:
>
> 1. Audit report: [link to docs/accuracy-audit/deep-audit-2026-05-23.md]
> 2. Validation packet (10 hand-keyable cases): [link / zip attachment]
> 3. Test suite summary: 1,584 hand-calc assertions across 26
>    suites, 0 real failures. 6 federal gaps disclosed.
> 4. Live demo URL: http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com
>    (demo client "Sarah Johnson" is your sandbox — feel free to upload
>    sample docs and approve / reject)
>
> Two next steps, whichever you prefer:
>
> A) Run the validation packet through your software. Email me a
>    "matches" or per-case disagreement. ~20 minutes of your time.
>
> B) Pilot — $500–$1,000/month, cap at 10 clients, 30 days. I'll
>    draft a one-page agreement if you want to go this route.
>
> Either way: any field, line, or workflow that tripped you up in
> the demo, I'd love to hear about it. That's how this gets better.
>
> — John
