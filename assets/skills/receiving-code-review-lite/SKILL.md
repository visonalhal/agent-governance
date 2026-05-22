---
name: receiving-code-review-lite
description: Use when handling code review feedback, requested changes, PR comments, or critique where the feedback may be incomplete, ambiguous, or technically wrong.
---

# Receiving Code Review Lite

Treat review feedback as evidence to evaluate, not instructions to obey blindly.

## Flow

1. Identify the concrete claim in each comment.
2. Check whether the claim is true in the current code.
3. Accept, narrow, or reject the change with evidence.
4. Implement accepted changes without unrelated refactors.
5. Verify the affected behavior.

## Anti-Triggers

- Do not use for ordinary user requests that are not review feedback.
- Do not mechanically apply suggestions that break project rules.
- Do not broaden review fixes into opportunistic cleanup.
