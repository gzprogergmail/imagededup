import { describe, expect, it } from "vitest";

import { sanitizeForLog, toLogEntry } from "../../src/shared/logging";

describe("shared logging helpers", () => {
  it("normalizes errors, dates, arrays, objects, and bigints", () => {
    const date = new Date("2026-04-14T00:00:00.000Z");
    const sanitized = sanitizeForLog({
      count: 10n,
      date,
      error: new Error("bad"),
      list: [date, 20n]
    }) as Record<string, unknown>;

    expect(sanitized.date).toBe("2026-04-14T00:00:00.000Z");
    expect(sanitized.count).toBe("10");
    expect(sanitized.list).toEqual(["2026-04-14T00:00:00.000Z", "20"]);
    expect(sanitized.error).toMatchObject({ message: "bad", name: "Error" });
  });

  it("creates timestamped log entries", () => {
    const entry = toLogEntry("renderer", "scan.started", { mode: "fast" }, "warn");
    expect(entry.scope).toBe("renderer");
    expect(entry.event).toBe("scan.started");
    expect(entry.level).toBe("warn");
    expect(entry.details).toEqual({ mode: "fast" });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
