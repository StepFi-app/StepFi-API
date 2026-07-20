## Summary

Closes #[issue number]

Briefly describe what this PR does in 2-3 sentences.

## This repo is for the NestJS backend API only

Before submitting, confirm your changes belong here:

- [ ] My changes are inside src/ or test/
- [ ] I have NOT added React, React Native,
      or frontend component files
- [ ] I have NOT added Rust or Soroban contract code
- [ ] This is NestJS/TypeScript backend work

## Type of change

- [ ] Bug fix
- [ ] New endpoint
- [ ] New service or module
- [ ] Database migration
- [ ] Background job
- [ ] Test coverage

## Testing

- [ ] npm run build passes with zero TypeScript errors
- [ ] npm test passes — all 184+ existing tests pass
- [ ] No new `any` types introduced anywhere
- [ ] Swagger decorators added to every new endpoint
- [ ] Migration file created for any schema changes
- [ ] New unit tests written for new service methods

## Context files reviewed

- [ ] context/architecture-context.md
- [ ] context/code-standards.md
- [ ] context/progress-tracker.md updated

## Mandatory before requesting review

Running these must all exit 0:
npm run build
npm test

If either fails, fix it before opening this PR.
PRs with failing CI checks will be closed without review.
PRs that reduce the test count will be rejected.
