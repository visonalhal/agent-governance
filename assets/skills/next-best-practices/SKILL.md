---
name: next-best-practices
description: Next.js best practices for file conventions, RSC boundaries, data patterns, async APIs, metadata, error handling, route handlers, image and font optimization, and bundling. Use when implementing, reviewing, or refactoring Next.js App Router code, especially when the user mentions layouts, route handlers, metadata, Suspense, scripts, runtime selection, self-hosting, or parallel routes.
---

# Next Best Practices

Apply these guidelines when working in a Next.js codebase, especially with the App Router.

## Core Principles

- Follow the existing repo conventions before introducing new patterns
- Prefer Server Components by default and push client boundaries to the leaves
- Keep routing, metadata, and runtime decisions explicit
- Use framework primitives instead of generic React or browser workarounds when Next.js already solves the problem

## Review And Implementation Flow

1. Confirm whether the target uses the App Router and how the repo already structures routes
2. Check whether the change should stay server-side, move client-side, or split across boundaries
3. Use the narrowest relevant reference file instead of loading all guidance
4. Verify the change still matches the runtime, metadata, and routing constraints of Next.js

## Reference Files

- `metadata.md` for `metadata` and `generateMetadata`
- `parallel-routes.md` for parallel and intercepting routes
- `route-handlers.md` for `route.ts`
- `runtime-selection.md` for Node.js vs Edge decisions
- `scripts.md` for third-party scripts
- `self-hosting.md` for standalone output and deployment concerns
- `suspense-boundaries.md` for `useSearchParams` and CSR bailout issues

## Defaults

- Default to the Node.js runtime unless the project already uses Edge or the requirement is explicit
- Default to Server Components unless interactive client behavior is required
- Default to `next/script`, built-in metadata APIs, and route conventions instead of custom alternatives

## What To Catch

- Metadata added inside Client Components
- Route handler placement mistakes
- Missing Suspense around client hooks that force CSR bailouts
- Edge runtime used without a real need
- Patterns that fight App Router conventions instead of using them
