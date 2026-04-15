# Testing

## Unit

- Vitest covers fast pass, slow pass, discovery, renderer view logic, renderer app wiring, and union-find.
- Generated fixtures come from local SVG templates rendered with `sharp`.
- Current enforced thresholds are 90%+ for statements, lines, and functions.

## End-to-End

- Playwright launches Electron directly from the built main-process bundle.
- The e2e flow fills the folder path, runs both passes, and checks visible results.

## Performance

- A dedicated Vitest suite checks renderer markup generation time for 500 duplicate groups.

## Fixture Generation

- `scripts/image-fixtures.mjs` defines the fixture corpus.
- `scripts/generate-test-images.mjs` writes the corpus to a target directory.
- `.\tools\Generate-TestFixtures.ps1` is the maintenance entrypoint.
