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
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
}

test("auto dry-run plans sources_only without writing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-auto-"));
  assert.equal(run(["init", "--name", "auto"], dir).status, 0);
  const sow = path.join(dir, "docs/product/sources/sow/Smart Basket.md");
  fs.writeFileSync(sow, "# Smart Basket\n\nBuild a cart.\n");
  const bin = path.join(dir, "scripts/ledger.mjs");
  const out = spawnSync(process.execPath, [bin, "auto"], { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  assert.match(out.stdout, /phase: sources_only/);
  assert.match(out.stdout, /dry-run|--yes/i);
  assert.match(out.stdout, /new sow/i);
  assert.ok(!fs.existsSync(path.join(dir, "docs/product/requirements/REQ-0001.md")));
});

test("auto --yes formalizes from sources without rewriting originals", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-auto-"));
  assert.equal(run(["init", "--name", "autoyes"], dir).status, 0);
  const sowSrc = path.join(dir, "docs/product/sources/sow/Smart Basket.md");
  const original = "# Smart Basket\n\nBuild a cart.\n";
  fs.writeFileSync(sowSrc, original);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const out = spawnSync(process.execPath, [bin, "auto", "--yes"], { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  assert.equal(fs.readFileSync(sowSrc, "utf8"), original, "source must be untouched");
  assert.ok(fs.existsSync(path.join(dir, "docs/product/requirements/REQ-0001.md")));
  assert.ok(fs.existsSync(path.join(dir, "docs/product/specs/SPEC-0001/v1.md")));
  assert.ok(fs.existsSync(path.join(dir, "docs/plans/tasks/TASK-0001.md")));
  const plan = fs.readFileSync(path.join(dir, "docs/plans/features/PLAN-0001.md"), "utf8");
  assert.match(plan, /status: approved/);
  const sowRev = fs.readFileSync(path.join(dir, "docs/product/sow/v1.md"), "utf8");
  assert.match(sowRev, /Derived from sources/);
  assert.match(sowRev, /Smart Basket/);
});

test("auto blockers when bootstrapped with no sources", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-auto-"));
  assert.equal(run(["init", "--name", "empty"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const out = spawnSync(process.execPath, [bin, "auto"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /BLOCKER|No product sources/i);
});

test("style tooling advisory appears in doctor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-style-"));
  assert.equal(run(["init", "--name", "style"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const doc = spawnSync(process.execPath, [bin, "doctor"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
  assert.equal(doc.status, 0, doc.stderr || doc.stdout);
  assert.match(doc.stdout, /host style tooling/i);
});
