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

function setupTaskRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-gates-"));
  assert.equal(run(["init", "--name", "gates"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(runLocal(["new", "req", "R"]).status, 0);
  assert.equal(runLocal(["new", "spec", "S", "--req", "REQ-0001"]).status, 0);
  assert.equal(runLocal(["new", "plan", "P", "--spec", "SPEC-0001@1", "--status", "approved"]).status, 0);
  assert.equal(runLocal(["new", "task", "Small fix", "--plan", "PLAN-0001"]).status, 0);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/fix.js"), "export const x = 1;\n");
  let task = fs.readFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), "utf8");
  task = task.replace("files: []", "files: [src/fix.js]");
  fs.writeFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), task);

  return { dir, runLocal };
}

test("small fix completes with fresh pass evidence without re-setup", () => {
  const { dir, runLocal } = setupTaskRepo();
  assert.equal(runLocal(["preflight", "TASK-0001"]).status, 0);
  assert.equal(runLocal(["new", "run", "work", "--plan", "PLAN-0001"]).status, 0);
  const ev = runLocal(["new", "evd", "node -c", "--run", "RUN-0001", "--result", "pass", "--task", "TASK-0001"]);
  assert.equal(ev.status, 0, ev.stderr || ev.stdout);
  assert.match(fs.readFileSync(path.join(dir, ".engineering/evidence/EVD-0001.md"), "utf8"), /code_state:/);
  assert.equal(runLocal(["new", "test", "T", "--task", "TASK-0001"]).status, 0);
  // mention TEST in task already via frontmatter task field — tests_required accepts linked TEST
  const done = runLocal(["done", "TASK-0001"]);
  assert.equal(done.status, 0, done.stderr || done.stdout);
  assert.match(fs.readFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), "utf8"), /status: done/);
});

test("missing evidence and fail/not_run do not complete", () => {
  const { runLocal } = setupTaskRepo();
  assert.equal(runLocal(["new", "run", "work", "--plan", "PLAN-0001"]).status, 0);
  let done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /EVIDENCE_MISSING|fix:/);

  assert.equal(runLocal(["new", "evd", "failed", "--run", "RUN-0001", "--result", "fail", "--task", "TASK-0001"]).status, 0);
  done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /EVIDENCE_FAILED/);

  assert.equal(runLocal(["new", "evd", "skip", "--run", "RUN-0001", "--result", "not_run", "--task", "TASK-0001"]).status, 0);
  done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /EVIDENCE_NOT_RUN|EVIDENCE_FAILED/);
});

test("code change after pass evidence makes done fail; recording EVD does not self-invalidate", () => {
  const { dir, runLocal } = setupTaskRepo();
  assert.equal(runLocal(["new", "run", "work", "--plan", "PLAN-0001"]).status, 0);
  assert.equal(runLocal(["new", "test", "T", "--task", "TASK-0001"]).status, 0);
  assert.equal(
    runLocal(["new", "evd", "ok", "--run", "RUN-0001", "--result", "pass", "--task", "TASK-0001"]).status,
    0,
  );
  const before = fs.readFileSync(path.join(dir, ".engineering/evidence/EVD-0001.md"), "utf8");
  const codeState = before.match(/code_state:\s*(\S+)/)[1];
  assert.notEqual(codeState, "no-files");

  // Changing only evidence body / re-read should still match (already recorded)
  let done = runLocal(["done", "TASK-0001"]);
  assert.equal(done.status, 0, done.stderr || done.stdout);

  // reset task to todo for second scenario
  let task = fs.readFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), "utf8");
  task = task.replace(/status: done/, "status: todo");
  fs.writeFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), task);

  fs.writeFileSync(path.join(dir, "src/fix.js"), "export const x = 2;\n");
  done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /EVIDENCE_STALE/);
  assert.match(done.stderr, /fix:/);
});

test("legacy evidence without code_state is not fresh; draft plan is not approval", () => {
  const { dir, runLocal } = setupTaskRepo();
  assert.equal(runLocal(["new", "run", "work", "--plan", "PLAN-0001"]).status, 0);
  assert.equal(runLocal(["new", "test", "T", "--task", "TASK-0001"]).status, 0);
  // hand-write legacy EVD
  fs.writeFileSync(
    path.join(dir, ".engineering/evidence/EVD-0001.md"),
    `---
id: EVD-0001
kind: test
agent_run: RUN-0001
result: pass
path: .engineering/evidence/EVD-0001.md
---

# legacy
`,
  );
  let runMd = fs.readFileSync(path.join(dir, ".engineering/agent-runs/RUN-0001.md"), "utf8");
  runMd = runMd.replace("evidence: []", "evidence: [EVD-0001]");
  fs.writeFileSync(path.join(dir, ".engineering/agent-runs/RUN-0001.md"), runMd);
  let task = fs.readFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), "utf8");
  task = task.replace("agent_runs: []", "agent_runs: [RUN-0001]");
  fs.writeFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), task);

  let done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /EVIDENCE_NO_CODE_STATE/);

  // draft plan blocks preflight even with SPEC
  assert.equal(runLocal(["new", "plan", "Draft", "--spec", "SPEC-0001@1"]).status, 0);
  assert.equal(runLocal(["new", "task", "X", "--plan", "PLAN-0002"]).status, 0);
  const pf = runLocal(["preflight", "TASK-0002"]);
  assert.notEqual(pf.status, 0);
  assert.match(pf.stderr + pf.stdout, /PLAN_NOT_APPROVED/);
  assert.match(pf.stderr + pf.stdout, /SPEC pin is not approval|not approval/i);
});

test("spec revise preserves old revision; historical pin remains", () => {
  const { dir, runLocal } = setupTaskRepo();
  assert.equal(runLocal(["revise", "SPEC-0001"]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, "docs/product/specs/SPEC-0001/v1.md")));
  assert.ok(fs.existsSync(path.join(dir, "docs/product/specs/SPEC-0001/v2.md")));
  const idx = fs.readFileSync(path.join(dir, "docs/product/specs/SPEC-0001/index.md"), "utf8");
  assert.match(idx, /current_revision:\s*2/);
  const plan = fs.readFileSync(path.join(dir, "docs/plans/features/PLAN-0001.md"), "utf8");
  assert.match(plan, /SPEC-0001@1/); // old pin preserved on plan until intentionally updated
});

test("empty task.files blocks done even with pass evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-gates-"));
  assert.equal(run(["init", "--name", "emptyfiles"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(runLocal(["new", "req", "R"]).status, 0);
  assert.equal(runLocal(["new", "spec", "S", "--req", "REQ-0001"]).status, 0);
  assert.equal(runLocal(["new", "plan", "P", "--spec", "SPEC-0001@1", "--status", "approved"]).status, 0);
  assert.equal(runLocal(["new", "task", "No files", "--plan", "PLAN-0001"]).status, 0);
  assert.equal(runLocal(["new", "run", "work", "--plan", "PLAN-0001"]).status, 0);
  assert.equal(runLocal(["new", "test", "T", "--task", "TASK-0001"]).status, 0);
  assert.equal(
    runLocal(["new", "evd", "ok", "--run", "RUN-0001", "--result", "pass", "--task", "TASK-0001"]).status,
    0,
  );
  const done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /TASK_FILES_EMPTY/);
  assert.match(done.stderr, /fix:/);
});

test("blocked evidence does not count as pass", () => {
  const { runLocal } = setupTaskRepo();
  assert.equal(runLocal(["new", "run", "work", "--plan", "PLAN-0001"]).status, 0);
  assert.equal(runLocal(["new", "test", "T", "--task", "TASK-0001"]).status, 0);
  assert.equal(
    runLocal(["new", "evd", "env", "--run", "RUN-0001", "--result", "blocked", "--task", "TASK-0001"]).status,
    0,
  );
  const done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /EVIDENCE_BLOCKED/);
});

test("postflight fails on drift; passes when files covered", () => {
  const { dir, runLocal } = setupTaskRepo();
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["add", "-A"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir, encoding: "utf8" });

  assert.equal(runLocal(["new", "run", "work", "--plan", "PLAN-0001"]).status, 0);
  assert.equal(runLocal(["new", "test", "T", "--task", "TASK-0001"]).status, 0);
  // change listed file + record evidence
  fs.writeFileSync(path.join(dir, "src/fix.js"), "export const x = 3;\n");
  assert.equal(
    runLocal(["new", "evd", "ok", "--run", "RUN-0001", "--result", "pass", "--task", "TASK-0001"]).status,
    0,
  );
  let pf = runLocal(["postflight", "TASK-0001"]);
  assert.equal(pf.status, 0, pf.stderr || pf.stdout);
  assert.match(pf.stdout, /POSTFLIGHT OK/);

  // drift: edit unlisted file
  fs.writeFileSync(path.join(dir, "src/other.js"), "export const y = 1;\n");
  pf = runLocal(["postflight", "TASK-0001"]);
  assert.notEqual(pf.status, 0);
  assert.match(pf.stderr, /POSTFLIGHT_DRIFT/);
  assert.match(pf.stderr, /fix:/);

  const done = runLocal(["done", "TASK-0001"]);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /POSTFLIGHT_DRIFT/);
});

test("doctor fails without pre-commit in git repo; hooks install fixes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-doc-"));
  assert.equal(run(["init", "--name", "dochook", "--no-hooks"], dir).status, 0);
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  const bin = path.join(dir, "scripts/ledger.mjs");
  let doc = spawnSync(process.execPath, [bin, "doctor"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
  assert.notEqual(doc.status, 0);
  assert.match(doc.stdout + doc.stderr, /pre-commit/);

  assert.equal(spawnSync(process.execPath, [bin, "hooks", "install"], { cwd: dir, encoding: "utf8" }).status, 0);
  doc = spawnSync(process.execPath, [bin, "doctor"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
  assert.equal(doc.status, 0, doc.stderr || doc.stdout);
});

test("stop hook hard-fails by default; LEDGER_STRICT=0 softens", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-strict-"));
  assert.equal(run(["init", "--name", "strict"], dir).status, 0);
  // break validate
  fs.unlinkSync(path.join(dir, "AGENTS.md"));
  const hook = path.join(dir, ".project/harness/validate-on-stop.sh");
  let out = spawnSync("bash", [hook], { cwd: dir, encoding: "utf8" });
  assert.notEqual(out.status, 0);
  out = spawnSync("bash", [hook], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_STRICT: "0" },
  });
  assert.equal(out.status, 0, out.stderr || out.stdout);
});
