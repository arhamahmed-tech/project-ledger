import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PKG, "bin/project-ledger.js");

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}

test("init scaffolds, vendors CLI, validate + doctor pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  const init = run(["init", "--name", "demo"], dir);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  assert.ok(fs.existsSync(path.join(dir, ".project/project.yaml")));
  assert.ok(fs.existsSync(path.join(dir, "scripts/ledger.mjs")), "CLI should be vendored");
  assert.ok(fs.existsSync(path.join(dir, "docs/agent-protocol.md")));
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(dir, ".cursor/rules/security-review.mdc")));
  assert.ok(fs.existsSync(path.join(dir, ".engineering/agent-runs/README.md")));

  const local = spawnSync(process.execPath, [path.join(dir, "scripts/ledger.mjs"), "validate"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(local.status, 0, local.stderr || local.stdout);
  assert.match(local.stdout, /VALIDATE OK/);

  const doc = spawnSync(process.execPath, [path.join(dir, "scripts/ledger.mjs"), "doctor"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
  assert.equal(doc.status, 0, doc.stderr || doc.stdout);
  assert.match(doc.stdout, /OK/);
});

test("validate-on-stop uses local CLI not npm registry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "hook"], dir).status, 0);
  const hook = path.join(dir, ".project/harness/validate-on-stop.sh");
  assert.ok(fs.existsSync(hook));
  const out = spawnSync("bash", [hook], { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  assert.match(out.stdout.trim(), /^\{\}$/);
  assert.doesNotMatch(out.stdout + out.stderr, /E404|registry\.npmjs/);
});
