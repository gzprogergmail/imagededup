# Fixture Maintenance

Use this skill when test images need to be regenerated or expanded.

## Workflow

1. Run `.\tools\Generate-TestFixtures.ps1`.
2. Review the generated corpus under `tests\.generated`.
3. Update tests if a new variant should be asserted.

## Notes

- Fixtures are created locally with `sharp` from SVG templates.
- The corpus includes exact-like, rotated, tinted, resized, cropped, and unique images.
