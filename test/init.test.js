import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG, "bin/project-ledger.js");

test("init scaffolds and validate passes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  const init = spawnSync(process.execPath, [BIN, "init", "--name", "demo"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  assert.ok(fs.existsSync(path.join(dir, ".project/project.yaml")));
  assert.ok(fs.existsSync(path.join(dir, ".cursor/rules/security-review.mdc")));
  assert.ok(fs.existsSync(path.join(dir, ".cursor/rules/codebase-style.mdc")));

  const val = spawnSync(process.execPath, [BIN, "validate"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(val.status, 0, val.stderr || val.stdout);
  assert.match(val.stdout, /VALIDATE OK/);
});
