---
name: mercaso-admin-readonly-browser-test
description: Use when the user explicitly requests a Mercaso Admin Web SAT or PROD readonly browser smoke run based on the repository checklist. Do not use for code changes, Playwright authoring, exports, or data mutation.
---

# Mercaso Admin Readonly Browser Test

Only checklist-backed readonly inspection is permitted. SAT and PROD share the same no-write boundary.

## Required sources

Read `PROD_READONLY_CHECKLIST.md` and `PROD_READONLY_TEST_RUNS.md` in `mercaso-admin-web`. Stop if either is missing. The checklist defines executable IDs and unsafe actions; the run log is append-only evidence.

Confirm the requested environment and checklist IDs. Use a new `SAT-YYYY-MM-DD-NN` or `PROD-YYYY-MM-DD-NN` run ID derived from the existing log.

## Allowed

Execute only named readonly steps: login, navigation, visibility, search/filter/tab/pagination, readonly details, and message viewing. Switch context only when it cannot change backend state.

## Stop before action

Do not click save, submit, apply, set, edit, update, delete, deactivate, duplicate, create, import, upload, export, download, accept, reject, mark, resolve, send, reply, file-picker, or mutating confirmations. Unclear controls are unsafe.

Access is not mutation authorization. If a step reaches an unsafe action, record `BLOCKED` and continue only with unrelated safe IDs.

## Evidence

Record each ID as `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `INFO`. Append one run section using the existing template with environment, URL, account, visible version, counts, ID results, and findings. Never overwrite history or the static checklist.

Do not use this skill for UI implementation, general browser automation, Playwright test authoring, or any request whose goal is to change admin data.
