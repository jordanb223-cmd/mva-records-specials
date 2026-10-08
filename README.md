# MVA Records and Specials

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jordanb223)

An Obsidian plugin for tracking a motor vehicle accident case's records requests, medical specials, and the step-by-step process for getting each kind of record.

All data lives in your notes as plain YAML inside fenced code blocks. You can read and edit it without the plugin, it syncs with your vault, and nothing is sent anywhere.

## Features

**Records requests, tracked as packets.** A `mva-requests` block in a case note renders as a table. Each request records:

- who it went to and the record type
- the scope: date range (defaults to the case's `doi` frontmatter) and the categories asked for
- the enclosures that went with it (letter of representation, HIPAA, the provider's own form, photo ID, ...)
- how it was sent and how the records should come back (encrypted email, mail, ...)
- the date sent, the production deadline in the letter, and your own follow-up date

**Partial productions.** Records often come back incomplete. Recording a production asks whether it is complete. If not, you list what is missing. The request stays open as *Partial*, and the missing list becomes your follow-up.

Status is one of *Pending*, *Due today*, *Overdue* (follow-up or deadline passed), *Partial*, or *Complete*.

**Encounter-level specials.** A `mva-specials` block holds one row per date of service, with:

- whether you have the treatment records and whether you have the bill. Rows billed with no records, or treated with no bill, are flagged.
- relatedness (related, not related, unknown) and the reason, so exclusions can be explained
- billed, paid by health plan, paid by patient, adjusted, lien holder and amount, and any collections agency

Totals are split into related, unknown, and not related (excluded), so carved-out charges stay visible.

**Process playbooks.** Each note in your playbook folder (`MVA Playbooks` by default) is a playbook, and its task list is the checklist. Playbook frontmatter can set `record_type`, `method`, `delivery`, and `enclosures`. Applying a playbook inserts a fresh checklist into the case note and opens a pre-filled request form. Run **Create sample playbooks** to get three editable starters.

**Attachments.** Requests and encounters can carry files: upload a PDF or image from your computer (it is copied into the case's files folder) or link one already in the vault. Each attachment has a type (letter of representation, HIPAA, records, bill, receipt, invoice, ...) and an "include in packets" checkbox. When you record a production as received, you can attach the records right there.

**Packets and reports.** Everything prints as a PDF saved in the case's `Reports` folder and opened in Obsidian, ready to view or print:

- **Request packet** (printer icon on a request): a cover sheet with scope, return method, and deadline, followed by the attachments marked for the packet.
- **Case report** ("Case report…" button, or the command): a dated update for the attorney with firm name, preparer, and your notes at the top. Pick the sections: summary, request log, still missing, medical specials, documentation gaps, fees and receipts, and an index of documents. Optionally append every included document. *Request log* and *Specials summary* are presets.

Password-protected PDFs and missing files are not silently dropped: they get a placeholder page and a notice.

**Dashboard.** A sidebar view lists every request across the vault, soonest due first, with Open, Overdue, Partial, and All filters. It also lists documentation gaps across cases, and has a case list with each case's totals, a link to its latest report, and a button to build a new one.

## Commands

| Command | What it does |
| --- | --- |
| Open records dashboard | Opens the sidebar dashboard |
| Add records request to this note | Opens the request form; creates the block if the note has none |
| Add encounter (date of service) to this note | Opens the encounter form; creates the block if the note has none |
| Insert records playbook in this note | Inserts a playbook checklist and optionally a pre-filled request |
| Build case report for this note | Opens the report dialog for the current (or last opened) case note |
| Create sample playbooks | Writes three sample playbooks into the playbook folder |

## Data format

````markdown
```mva-requests
- id: a1
  provider: Riverside General Hospital
  type: Medical records and billing
  method: Fax
  delivery: Encrypted email
  requested: "2026-08-01"
  deadline: "2026-08-21"
  followup: "2026-08-31"
  scope_from: "2026-02-10"
  categories: Chart notes, ER records, itemized billing
  enclosures: [Letter of representation, Provider's own authorization form, Photo ID]
  state: partial          # sent | partial | complete
  received: "2026-09-02"
  missing:
    - 03/14/2026 visit notes
```

```mva-specials
- id: b1
  date: "2026-02-10"
  provider: Riverside General Hospital
  service: ER visit
  related: yes            # yes | no | unknown
  related_reason: ""
  records: true
  bill: true
  billed: 8420.50
  plan_paid: 3100
  patient_paid: 250
  adjusted: 2200
  lien_holder: Sample Health Plan
  lien_amount: 3100
  collections: ""
```
````

The dashboard uses the note's `client` or `case` frontmatter field as the case name, and falls back to the file name. New requests take their scope start date from a `doi` field (YYYY-MM-DD) if the note has one.

If a block has a YAML error, the plugin shows the error and does not write to that block until it is fixed.

## Settings

- Default follow-up interval (days)
- Currency code for amounts
- Playbook folder
- Record types, send methods, return methods, and enclosure types shown in the forms
- Firm name, prepared-by name, and page size (Letter or A4) for reports
- Case files folder, next to the case note (default `{case} files`)

## Notice

This plugin is a record-keeping tool. It does not contain jurisdiction-specific rules, deadlines, or fee limits. It does not give legal advice. The sample playbooks are generic starting points to adapt to your office's practice.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check and production build
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/mva-records-specials/` to test. The `test-vault/` folder contains made-up sample cases.

## Credits

PDF generation uses [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT). All PDFs are built on your device; nothing is uploaded.

## Support

If this plugin saves you time, you can [buy me a coffee](https://buymeacoffee.com/jordanb223). It is free either way.

## License

MIT
