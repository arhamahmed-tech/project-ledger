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
  assert.ok(
    fs.existsSync(path.join(dir, "scripts/.project-ledger/ledger.mjs")),
    "vendored CLI body should exist",
  );
  assert.ok(fs.existsSync(path.join(dir, "docs/agent-protocol.md")));
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(dir, ".cursor/rules/security-review.mdc")));
  assert.ok(fs.existsSync(path.join(dir, ".engineering/agent-runs/README.md")));
  assert.ok(fs.existsSync(path.join(dir, ".project/schemas/EPIC.json")));
  assert.ok(fs.existsSync(path.join(dir, ".cursor/skills/find-skills/SKILL.md")), "find-skills Cursor");
  assert.ok(fs.existsSync(path.join(dir, ".claude/skills/find-skills/SKILL.md")), "find-skills Claude");
  assert.ok(fs.existsSync(path.join(dir, "docs/product/sources/sow/README.md")), "product sources");
  assert.ok(fs.existsSync(path.join(dir, "docs/product/sources/specs/README.md")));
  assert.ok(fs.existsSync(path.join(dir, ".project/conventions.yaml")), "conventions.yaml");
  assert.ok(fs.existsSync(path.join(dir, "docs/conventions/code-style.md")), "code-style doc");

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

test("audit chain detects tampering", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "audit"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(runLocal(["event", "test.ping", "PROJECT-001"]).status, 0);
  assert.equal(runLocal(["validate"]).status, 0);

  const auditPath = path.join(dir, ".audit/events.jsonl");
  const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
  const last = JSON.parse(lines[lines.length - 1]);
  last.event_hash = "0000000000000000";
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(auditPath, lines.join("\n") + "\n");

  const val = runLocal(["validate"]);
  assert.notEqual(val.status, 0);
  assert.match(val.stderr + val.stdout, /AUDIT_HASH_MISMATCH|VALIDATE FAIL/);
});

test("new task without plan fails; revise unknown fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "fail"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });

  const task = runLocal(["new", "task", "Nope"]);
  assert.notEqual(task.status, 0);
  assert.match(task.stderr + task.stdout, /requires --plan/);

  const rev = runLocal(["revise", "SPEC-9999"]);
  assert.notEqual(rev.status, 0);
});

test("hooks install writes pre-commit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "hooks"], dir).status, 0);
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  const bin = path.join(dir, "scripts/ledger.mjs");
  const out = spawnSync(process.execPath, [bin, "hooks", "install"], { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  const hook = path.join(dir, ".git/hooks/pre-commit");
  assert.ok(fs.existsSync(hook));
  assert.match(fs.readFileSync(hook, "utf8"), /ledger\.mjs validate/);
});

test("init installs CI workflow", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "ci"], dir).status, 0);
  assert.ok(fs.existsSync(path.join(dir, ".github/workflows/project-ledger.yml")));
});

test("doctor fails when .cursorignore hides ledger (WRONG)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "ign"], dir).status, 0);
  fs.writeFileSync(path.join(dir, ".cursorignore"), ".cursor/\ndocs/\nAGENTS.md\n");
  const bin = path.join(dir, "scripts/ledger.mjs");
  // init/upgrade patches cursorignore; rewrite after to simulate broken project
  fs.writeFileSync(path.join(dir, ".cursorignore"), ".cursor/\ndocs/\n");
  const doc = spawnSync(process.execPath, [bin, "doctor"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
  assert.notEqual(doc.status, 0);
  assert.match(doc.stderr + doc.stdout, /WRONG|cursorignore|FAIL/);
});

test("only one alwaysApply Cursor rule after init", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "rules"], dir).status, 0);
  const rulesDir = path.join(dir, ".cursor/rules");
  const always = fs
    .readdirSync(rulesDir)
    .filter((n) => n.endsWith(".mdc"))
    .filter((n) => /alwaysApply:\s*true/.test(fs.readFileSync(path.join(rulesDir, n), "utf8")));
  assert.equal(always.length, 1, `expected 1 alwaysApply, got ${always.join(",")}`);
  assert.equal(always[0], "project-ledger.mdc");
});

test("sources lists user originals", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "src"], dir).status, 0);
  fs.writeFileSync(path.join(dir, "docs/product/sources/sow/client-sow.md"), "# Original SOW\n");
  fs.writeFileSync(path.join(dir, "docs/product/sources/specs/prd.md"), "# PRD\n");
  const bin = path.join(dir, "scripts/ledger.mjs");
  const out = spawnSync(process.execPath, [bin, "sources"], { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  assert.match(out.stdout, /client-sow\.md/);
  assert.match(out.stdout, /prd\.md/);
  assert.match(out.stdout, /2 source file/);
});

test("preflight fails without SPEC pin; passes with scope", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "pf"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });

  assert.equal(runLocal(["new", "req", "Need refund"]).status, 0);
  assert.equal(runLocal(["new", "spec", "Refunds", "--req", "REQ-0001"]).status, 0);
  assert.equal(runLocal(["new", "plan", "Impl", "--spec", "SPEC-0001@1", "--status", "approved"]).status, 0);
  assert.equal(runLocal(["new", "task", "Do it", "--plan", "PLAN-0001"]).status, 0);

  let pf = runLocal(["preflight", "TASK-0001"]);
  assert.equal(pf.status, 0, pf.stderr || pf.stdout);
  assert.match(pf.stdout, /PREFLIGHT OK|OUT OF SCOPE|IN SCOPE/);
  assert.match(pf.stdout, /CODE STYLE \(mandatory before editing/);
  assert.match(pf.stdout, /camelCase/);
  assert.match(pf.stdout, /SPEC existence alone is not approval|plan approval/);

  // draft plan must not pass when approval required
  assert.equal(runLocal(["new", "plan", "Drafty", "--spec", "SPEC-0001@1", "--status", "draft"]).status, 0);
  assert.equal(runLocal(["new", "task", "Blocked by draft", "--plan", "PLAN-0002"]).status, 0);
  const pfDraft = runLocal(["preflight", "TASK-0002"]);
  assert.notEqual(pfDraft.status, 0);
  assert.match(pfDraft.stderr + pfDraft.stdout, /PLAN_NOT_APPROVED/);
  assert.match(pfDraft.stderr + pfDraft.stdout, /fix:/);

  assert.equal(runLocal(["new", "task", "First", "--plan", "PLAN-0001"]).status, 0);
  const t3 = path.join(dir, "docs/plans/tasks/TASK-0003.md");
  let body = fs.readFileSync(t3, "utf8");
  body = body.replace("depends_on: []", "depends_on: [TASK-9999]");
  fs.writeFileSync(t3, body);
  pf = runLocal(["preflight", "TASK-0003"]);
  assert.notEqual(pf.status, 0);
  assert.match(pf.stderr + pf.stdout, /DEP_MISSING|PREFLIGHT FAIL/);
});

test("next handoff board note done review", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "pack"], dir).status, 0);
  const bin = path.join(dir, "scripts/ledger.mjs");
  const runLocal = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });

  assert.equal(runLocal(["new", "ms", "Sprint 1"]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, "docs/plans/milestones/MS-0001.md")));
  assert.equal(runLocal(["new", "req", "R"]).status, 0);
  assert.equal(runLocal(["new", "spec", "S", "--req", "REQ-0001"]).status, 0);
  assert.equal(runLocal(["new", "plan", "P", "--spec", "SPEC-0001@1", "--status", "approved"]).status, 0);
  assert.equal(runLocal(["new", "task", "Ready", "--plan", "PLAN-0001", "--ms", "MS-0001"]).status, 0);

  const next = runLocal(["next"]);
  assert.equal(next.status, 0, next.stderr || next.stdout);
  assert.match(next.stdout, /TASK-0001/);

  const hand = runLocal(["handoff"]);
  assert.equal(hand.status, 0);
  assert.match(hand.stdout, /HANDOFF/);

  const board = runLocal(["board"]);
  assert.equal(board.status, 0);
  assert.match(board.stdout, /MS-0001/);
  assert.match(board.stdout, /TASK-0001/);

  assert.equal(runLocal(["focus", "TASK-0001"]).status, 0);
  const note = runLocal(["note", "edge case noted"]);
  assert.equal(note.status, 0, note.stderr || note.stdout);
  assert.match(fs.readFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), "utf8"), /edge case noted/);

  // done should fail without run/evidence/tests under default rules
  const doneFail = runLocal(["done", "TASK-0001"]);
  assert.notEqual(doneFail.status, 0);

  // relax rules for done success path
  let py = fs.readFileSync(path.join(dir, ".project/project.yaml"), "utf8");
  py = py
    .replace(/agent_runs_required:\s*true/, "agent_runs_required: false")
    .replace(/evidence_required:\s*true/, "evidence_required: false")
    .replace(/tests_required:\s*true/, "tests_required: false");
  fs.writeFileSync(path.join(dir, ".project/project.yaml"), py);
  const doneOk = runLocal(["done", "TASK-0001"]);
  assert.equal(doneOk.status, 0, doneOk.stderr || doneOk.stdout);
  assert.match(fs.readFileSync(path.join(dir, "docs/plans/tasks/TASK-0001.md"), "utf8"), /status: done/);

  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  const rev = runLocal(["review"]);
  // review may fail check if untracked code — should still run validate
  assert.match(rev.stdout + rev.stderr, /REVIEW/);
});

test("onboard detects sources-only phase after init", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  assert.equal(run(["init", "--name", "basket"], dir).status, 0);
  const sowDir = path.join(dir, "docs/product/sources/sow");
  fs.mkdirSync(sowDir, { recursive: true });
  fs.writeFileSync(path.join(sowDir, "Smart Basket App - SOW.md"), "# SOW\n");

  const bin = path.join(dir, "scripts/ledger.mjs");
  const onboard = spawnSync(process.execPath, [bin, "onboard"], { cwd: dir, encoding: "utf8" });
  assert.equal(onboard.status, 0, onboard.stderr || onboard.stdout);
  assert.match(onboard.stdout, /phase: sources_only/);
  assert.match(onboard.stdout, /very start/);
  assert.match(onboard.stdout, /Smart Basket App - SOW\.md/);
  assert.match(onboard.stdout, /new sow/);
  assert.match(onboard.stdout, /0 epics \/ 0 milestones \/ 0 plans \/ 0 tasks/);
});

test("adopt seeds sources and inventory for mid-build repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  fs.writeFileSync(path.join(dir, "README.md"), "# Existing App\n\nProduct notes.\n");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/prd.md"), "# PRD\nCheckout flow\n");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/app.js"), "console.log(1)\n");

  const ad = spawnSync(process.execPath, [BIN, "adopt", "--name", "existing"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LEDGER_PKG_ROOT: PKG },
  });
  assert.equal(ad.status, 0, ad.stderr || ad.stdout);
  assert.ok(fs.existsSync(path.join(dir, ".project/project.yaml")));
  assert.ok(fs.existsSync(path.join(dir, "docs/product/sources/briefs/imported-README.md")));
  assert.ok(fs.existsSync(path.join(dir, "docs/product/sources/specs/imported-prd.md")));
  assert.ok(fs.existsSync(path.join(dir, "docs/product/sources/briefs/ADOPTION-CHECKLIST.md")));
  assert.match(ad.stdout, /INVENTORY|untraced|ADOPT/i);

  const inv = spawnSync(process.execPath, [path.join(dir, "scripts/ledger.mjs"), "inventory"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(inv.status, 0, inv.stderr || inv.stdout);
  assert.match(inv.stdout, /src\//);
});
