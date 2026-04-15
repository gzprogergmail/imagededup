import { readFile } from "node:fs/promises";

const summaryPath = new URL("../coverage/coverage-summary.json", import.meta.url);
const raw = await readFile(summaryPath, "utf8");
const summary = JSON.parse(raw);
const minimum = 60;
const metrics = ["lines", "statements", "functions", "branches"];

for (const metric of metrics) {
  const value = summary.total[metric].pct;
  if (value < minimum) {
    throw new Error(`Coverage gate failed for ${metric}: ${value}% < ${minimum}%`);
  }
}

console.log(`Coverage gate passed at >= ${minimum}%.`);
