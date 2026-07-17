---
name: Feature or fix
about: Submit a contribution to StepFi-API
title: ''
labels: ''
assignees: ''
---

## Problem

Describe the problem this PR solves.

## Before Starting

Read ALL of these before writing any code:

- context/architecture-context.md
- context/code-standards.md
- context/progress-tracker.md
- context/ai-workflow-rules.md

Your PR will be rejected if it conflicts with
anything in the context files regardless of
whether CI passes.

## What To Build

Describe exactly what needs to be built.

## Files To Touch

List the files that need to be changed.

## Acceptance Criteria

- [ ] Describe expected behavior 1
- [ ] Describe expected behavior 2

## Mandatory Checks Before Opening PR

- [ ] All context/ files read and understood
- [ ] Code follows context/code-standards.md exactly
- [ ] context/progress-tracker.md updated
- [ ] npm run build passes with zero TypeScript errors
- [ ] npm test passes with all tests passing
- [ ] Test count has NOT decreased from baseline
- [ ] No new any types introduced
- [ ] No files outside src/ or test/ added
- [ ] PR template filled out completely
- [ ] PR references this issue number

PRs that fail any check above will be closed
without review. No exceptions.
