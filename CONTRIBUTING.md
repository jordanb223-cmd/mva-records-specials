# Contributing

Thanks for helping improve MVA Records and Specials.

## Reporting a problem

Open an issue on GitHub with:

- what you did, what you expected, and what happened instead
- your Obsidian version and platform (desktop or mobile)
- any error from the developer console (View → Toggle developer tools → Console)

**Never include real client information.** No names, dates of birth, medical record numbers, addresses, or case details, in issues, screenshots, or sample files. Recreate the problem with made-up data, such as the sample cases in `test-vault/`.

## Making a change

1. Install dependencies with `npm ci` (do not use `--legacy-peer-deps`; the directory's review installs strictly).
2. `npm run dev` rebuilds on save. Copy `main.js`, `manifest.json`, and `styles.css` into `test-vault/.obsidian/plugins/mva-records-specials/` and open `test-vault` as a vault to try it.
3. Before opening a pull request, run `npm run lint` and `npm run build`. Both must pass with no errors.
4. Keep data in plain YAML inside the notes, and keep everything on the user's device: no network requests.

## Scope

The plugin is a record-keeping tool. Please don't add jurisdiction-specific legal rules, deadlines, or fee limits; those vary by state and belong in each office's own playbooks.
