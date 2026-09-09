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
  assert.ok(fs.existsSync(path.join(dir, ".project/context.yaml")), "context.yaml");
  assert.ok(fs.existsSync(path.join(dir, "docs/plans/epics/README.md")), "epics dir");
  assert.ok(fs.existsSync(path.join(dir, "scripts/ledger.mjs")), "CLI should be vendored");
  assert.ok(fs.existsSync(path.join(dir, "docs/agent-protocol.md")));
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(dir, ".cursor/rules/security-review.mdc")));
  assert.ok(fs.existsSync(path.join(dir, ".engineering/agent-runs/README.md")));
  assert.ok(fs.existsSync(path.join(dir, ".project/schemas/EPIC.json")));
  assert.ok(fs.existsSync(path.join(dir, ".cursor/skills/find-skills/SKILL.md")), "find-skills Cursor");
  assert.ok(fs.existsSync(path.join(dir, ".claude/skills/find-skills/SKILL.md")), "find-skills Claude");

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

test("new epic/plan/task + focus/context handoff", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "ctx"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });

  const epic = runLocal(["new", "epic", "Checkout hardening"]);
  assert.equal(epic.status, 0, epic.stderr || epic.stdout);
  assert.match(epic.stdout, /EPIC-0001/);

  const plan = runLocal(["new", "plan", "Refund flow", "--epic", "EPIC-0001", "--spec", "SPEC-0001@1"]);
  assert.equal(plan.status, 0, plan.stderr || plan.stdout);
  assert.ok(fs.existsSync(path.join(dir, "docs/plans/features/PLAN-0001.md")));

  const task = runLocal(["new", "task", "Wire refund API", "--plan", "PLAN-0001", "--epic", "EPIC-0001"]);
  assert.equal(task.status, 0, task.stderr || task.stdout);
  assert.match(task.stdout, /focused TASK-0001|TASK-0001/);

  const ctx = runLocal(["context"]);
  assert.equal(ctx.status, 0, ctx.stderr || ctx.stdout);
  assert.match(ctx.stdout, /TASK-0001/);
  assert.match(ctx.stdout, /PLAN-0001/);
  assert.match(ctx.stdout, /EPIC-0001/);

  const focus = runLocal(["focus", "EPIC-0001", "--notes", "resume later"]);
  assert.equal(focus.status, 0, focus.stderr || focus.stdout);
  const yaml = fs.readFileSync(path.join(dir, ".project/context.yaml"), "utf8");
  assert.match(yaml, /current_epic: EPIC-0001/);
  assert.match(yaml, /resume later/);

  const impact = runLocal(["impact", "EPIC-0001"]);
  assert.equal(impact.status, 0, impact.stderr || impact.stdout);
  assert.match(impact.stdout, /PLAN-0001/);
  assert.match(impact.stdout, /TASK-0001/);

  assert.ok(fs.existsSync(path.join(dir, ".agent-trace/traces.jsonl")));
});

test("new req/spec/sow + revise + content_hash validate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "spec"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });

  assert.equal(runLocal(["new", "req", "Must refund", "--epic", "null"]).status, 0);
  const spec = runLocal(["new", "spec", "Refund productspec", "--req", "REQ-0001"]);
  assert.equal(spec.status, 0, spec.stderr || spec.stdout);
  assert.ok(fs.existsSync(path.join(dir, "docs/product/specs/SPEC-0001/v1.md")));
  const v1 = fs.readFileSync(path.join(dir, "docs/product/specs/SPEC-0001/v1.md"), "utf8");
  assert.match(v1, /content_hash: [a-f0-9]{16}/);

  const sow = runLocal(["new", "sow", "Engagement"]);
  assert.equal(sow.status, 0, sow.stderr || sow.stdout);

  // plan must pin real spec for validate
  assert.equal(runLocal(["new", "plan", "Impl", "--spec", "SPEC-0001@1", "--status", "draft"]).status, 0);

  let val = runLocal(["validate"]);
  assert.equal(val.status, 0, val.stderr || val.stdout);

  const rev = runLocal(["revise", "SPEC-0001"]);
  assert.equal(rev.status, 0, rev.stderr || rev.stdout);
  assert.ok(fs.existsSync(path.join(dir, "docs/product/specs/SPEC-0001/v2.md")));

  val = runLocal(["validate"]);
  assert.equal(val.status, 0, val.stderr || val.stdout);

  // corrupt hash → fail
  const v2path = path.join(dir, "docs/product/specs/SPEC-0001/v2.md");
  let bad = fs.readFileSync(v2path, "utf8");
  bad = bad.replace(/content_hash: [a-f0-9]+/, "content_hash: deadbeefdeadbeef");
  fs.writeFileSync(v2path, bad);
  val = runLocal(["validate"]);
  assert.notEqual(val.status, 0);
  assert.match(val.stderr + val.stdout, /SPEC_HASH_MISMATCH|VALIDATE FAIL/);
});

test("upgrade refreshes CLI and context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "up"], dir).status, 0);
  fs.unlinkSync(path.join(dir, ".project/context.yaml"));
  const up = spawnSync(process.execPath, [BIN, "upgrade"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
  assert.equal(up.status, 0, up.stderr || up.stdout);
  assert.ok(fs.existsSync(path.join(dir, ".project/context.yaml")));
  assert.ok(fs.existsSync(path.join(dir, ".github/workflows/project-ledger.yml")));
});

test("check fails on untraced code file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "chk"], dir).status, 0);
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/app.js"), "console.log(1)\n");
  const bin = path.join(dir, "scripts/ledger.mjs");
  const chk = spawnSync(process.execPath, [bin, "check"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(chk.status, 0);
  assert.match(chk.stderr + chk.stdout, /UNTRACED_FILE|CHECK FAIL/);
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
