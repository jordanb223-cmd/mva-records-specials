---
client: Jane Doe (sample)
doi: 2026-02-10
---
Sample case with made-up data for trying the plugin. Every name, provider, and amount here is invented.

## Records requests

```mva-requests
- id: a1
  provider: Riverside General Hospital
  type: Medical records and billing
  method: Fax
  delivery: Encrypted email
  requested: "2026-08-01"
  followup: "2026-08-31"
  deadline: "2026-08-21"
  scope_from: "2026-02-10"
  categories: Chart notes, ER records, imaging reports, itemized billing
  enclosures:
    - Letter of representation
    - Provider's own authorization form
    - Photo ID
  state: sent
  attachments:
    - file: Cases/Doe, Jane - 2026 MVA files/Sample LOR - Riverside.pdf
      kind: Letter of representation
      include: true
    - file: Cases/Doe, Jane - 2026 MVA files/Sample HIPAA - Riverside.pdf
      kind: HIPAA authorization
      include: true
- id: a2
  provider: Lakeview Medical Group
  type: Medical records
  method: Mail
  delivery: Encrypted email
  requested: "2026-07-15"
  followup: "2026-10-30"
  scope_from: "2026-02-10"
  enclosures:
    - Letter of representation
    - HIPAA authorization
  state: partial
  received: "2026-09-02"
  missing:
    - 03/14/2026 visit notes (billed, no chart)
    - 05/02/2026 X-ray report
  attachments:
    - file: Cases/Doe, Jane - 2026 MVA files/Lakeview partial production.pdf
      kind: Records
      include: true
- id: a3
  provider: Northside Physical Therapy
  type: Itemized bill
  method: Email
  requested: "2026-07-10"
  followup: "2026-08-09"
  state: complete
  received: "2026-08-02"
  cost: 25
  attachments:
    - file: Cases/Doe, Jane - 2026 MVA files/Copy fee receipt (sample).png
      kind: Receipt
      include: true
```

## Medical specials

```mva-specials
- id: b1
  date: "2026-02-10"
  provider: Riverside General Hospital
  service: ER visit, neck and back pain
  related: yes
  records: true
  bill: true
  billed: 8420.5
  plan_paid: 3100
  patient_paid: 250
  adjusted: 2200
  lien_holder: Sample Health Plan
  lien_amount: 3100
  attachments:
    - file: Cases/Doe, Jane - 2026 MVA files/Riverside itemized bill.pdf
      kind: Bill / ledger
      include: true
- id: b2
  date: "2026-03-14"
  provider: Lakeview Medical Group
  service: Follow-up, neck pain
  related: yes
  records: false
  bill: true
  billed: 376
  plan_paid: 210
- id: b3
  date: "2026-04-20"
  provider: Open Imaging Center
  service: Cervical MRI (cash pay)
  related: yes
  records: true
  bill: false
- id: b4
  date: "2026-05-30"
  provider: Riverside General Hospital
  service: Urgent care, cough
  related: no
  related_reason: Respiratory illness, unrelated to collision
  records: true
  bill: true
  billed: 410
  plan_paid: 300
- id: b5
  date: "2026-06-11"
  provider: Lakeview Medical Group
  service: Dizziness evaluation
  related: unknown
  records: true
  bill: true
  billed: 290
  collections: Sample Collections Co.
```
