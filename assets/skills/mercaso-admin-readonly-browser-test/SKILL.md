---
name: mercaso-admin-readonly-browser-test
description: Use when running or planning Mercaso Admin Web readonly browser smoke tests for SAT or PROD, including "Admin Web 只读测试", "SAT 验证 checklist", "PROD readonly smoke", or using the browser to inspect admin.sat.mercaso.tech/admin production without mutating data. This skill enforces the repo checklist, run log, and no-write browser boundaries.
---

# Mercaso Admin Readonly Browser Test

This skill is for temporary Mercaso Admin Web browser-based readonly testing. It exists to reduce manual waste without handing write authority to an agent.

## Required Sources

Before any browser action, read these repo files from `mercaso-admin-web`:

- `PROD_READONLY_CHECKLIST.md` defines allowed readonly scope and blocked/export-risk IDs.
- `PROD_READONLY_TEST_RUNS.md` records SAT/PROD execution history.

If either file is missing, stop and ask to create or restore it before testing.

## Core Rule

SAT and PROD behavior is identical: both are readonly.

- SAT is not a write sandbox.
- PROD is not allowed to run anything beyond the same readonly boundary.
- The only difference is the run label and risk context in the run log.

## Allowed Actions

Only execute checklist IDs from `产线可执行只读清单`.

Allowed browser behavior:

- Login, navigation, page load checks.
- List/table/control visibility checks.
- Search, filter, tab switch, pagination, clear local filters.
- Readonly detail page viewing.
- Chat open/close, channel selection, message viewing.
- Store/context switch only when it does not save, submit, send, or modify backend data.

## Forbidden Actions

Never click or complete these actions in SAT or PROD unless the user gives a new, explicit, action-specific approval:

- `Save`, `Submit`, `Apply`, `Set`, `Edit`, `Update`
- `Delete`, `Deactivate`, `Duplicate`, `Create`
- `Import`, `Upload`, file picker interactions
- `Export`, `Download CSV`
- `Accept`, `Reject`
- `Mark as seen`, `Mark as resolved`
- `Send`, `Reply`, sending image/video/file messages
- Any confirmation modal for a mutating action

If a checklist step unexpectedly requires one of these, stop that step and record `BLOCKED`.

## Execution Workflow

1. Read `PROD_READONLY_CHECKLIST.md` and identify the requested IDs or module.
2. Read `PROD_READONLY_TEST_RUNS.md` and choose a new run ID:
   - `SAT-YYYY-MM-DD-NN` for SAT.
   - `PROD-YYYY-MM-DD-NN` for PROD.
3. Confirm the target environment from the URL:
   - SAT: `https://admin.sat.mercaso.tech/`
   - PROD: production admin URL provided by the user or visible in browser.
4. Use the user's browser only for readonly steps.
5. For each executed checklist ID, record one result:
   - `PASS`: readonly check completed and matched expectation.
   - `FAIL`: check completed but behavior/data/UI was wrong.
   - `BLOCKED`: not executed due to permission, data, environment, or safety boundary.
   - `NOT RUN`: intentionally skipped.
   - `INFO`: observation without pass/fail judgment.
6. Append a new run section to `PROD_READONLY_TEST_RUNS.md`; never overwrite old runs.

## Browser Safety Protocol

Before clicking, classify the target:

- Safe: navigation link, readonly tab, readonly filter, readonly pagination, readonly detail link.
- Risky: button/menu item with unclear text, export/download, modal opener, form submitter, status/action menu.
- Forbidden: any action listed in "Forbidden Actions".

For risky or forbidden targets:

- Do not click.
- Record why the step is blocked or needs human decision.
- If the UI exposes a disabled item as a link, record it as a finding instead of forcing navigation.

## Result Logging Format

Append to `PROD_READONLY_TEST_RUNS.md` using the existing template. Each entry must include:

- Run ID, environment, URL, account, visible version if available.
- Summary counts.
- Checklist ID-level results.
- Finding table for `FAIL` or important `INFO`.

Do not write results into `PROD_READONLY_CHECKLIST.md`; that file is the static source of truth for scope and boundaries.

## Anti-Triggers

Do not use this skill for:

- Implementing UI code or fixing bugs.
- Writing Playwright tests.
- General browser automation unrelated to Mercaso Admin Web readonly testing.
- Any task where the user asks to mutate admin data, import/export files, send chat messages, or change settings.
