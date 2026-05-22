---
name: intent-routing
description: Use when starting work in a governed project, especially when the request may be a direct command, configuration question, code change, bug investigation, design task, review, or external-tool task.
---

# Intent Routing

Classify the user's request before choosing skills, tools, or code-reading depth.

## Route

- Direct command: run the narrow command and report the result.
- Governance/config: inspect the named config and references; do not debug runtime behavior unless there is an actual failure.
- Code change: read the smallest relevant code path, edit in the existing pattern, run targeted verification.
- Bug/test failure/CI failure/runtime error: use debugging workflow.
- Product/design uncertainty: clarify intent or use product/design skills.
- External tool: use the tool plugin only when the user asks for that context or write.

## Anti-Triggers

- Do not turn meta questions about AI behavior into system debugging.
- Do not treat local file paths, localhost, or project URLs as external web sources.
- Do not load multiple workflow skills because a task is merely large.
- Do not start with logs, DB, or root-cause tracing unless there is a reproducible failure.

## Output

Name the route in your own reasoning, then act. Only tell the user when the route affects scope or risk.
