import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("static analysis coverage", () => {
  it("typecheck script targets tsconfig.typecheck.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toContain("tsconfig.typecheck.json");
  });

  it("lint script includes scripts directory", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.lint).toContain("scripts/");
  });
});
