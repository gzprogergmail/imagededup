# Quality Ops

Use this skill when validating the project after changes.

## Workflow

1. Run `npm run lint`.
2. Run `npm run test:unit`.
3. Run `npm run test:e2e`.
4. Run `npm run perf`.
5. Run `npm run coverage:check`.

## Notes

- Unit coverage is enforced at 90%+ for statements, lines, and functions.
- The performance suite is focused on renderer markup generation speed.
