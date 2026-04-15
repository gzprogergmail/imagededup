import { generateFixtureSet } from "./image-fixtures.mjs";

const targetDir = process.argv[2];
if (!targetDir) {
  throw new Error("Usage: node scripts/generate-test-images.mjs <target-dir>");
}

await generateFixtureSet(targetDir);
