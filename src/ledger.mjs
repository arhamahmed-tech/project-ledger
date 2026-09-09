#!/usr/bin/env node
/**
 * Project Ledger CLI + local UI
 * project-ledger <command> [args]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** Target project root — cwd, or LEDGER_ROOT override */
const ROOT = path.resolve(process.env.LEDGER_ROOT || process.cwd());
const PORT = Number(process.env.LEDGER_PORT || 3847);

function resolvePkgRoot() {
  const candidates = [
    process.env.LEDGER_PKG_ROOT,
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "../.."),
    path.join(ROOT, "node_modules/project-ledger"),
    path.resolve(ROOT, "../project-ledger"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, "scaffold", ".project", "schemas")) ||
      fs.existsSync(path.join(c, "scaffold", ".project", "project.yaml"))
    ) {
      return path.resolve(c);
    }
  }
  return path.resolve(__dirname, "..");
}

const PKG_ROOT = resolvePkgRoot();

function abs(p) {
  return path.join(ROOT, p);
}
function read(p) {
  return fs.readFileSync(abs(p), "utf8");
}
function write(p, s) {
  fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
  fs.writeFileSync(abs(p), s);
}
function exists(p) {
  return fs.existsSync(abs(p));
}
function append(p, line) {
  fs.appendFileSync(abs(p), line.endsWith("\n") ? line : line + "\n");
}

function listFiles(rel, filter = () => true) {
  const base = abs(rel);
  if (!fs.existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (filter(ent.name, full)) out.push(path.relative(ROOT, full));
    }
  };
  walk(base);
  return out.sort();
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { meta: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { meta: {}, body: text };
  const raw = text.slice(4, end);
  const meta = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v === "null") v = null;
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (/^\d+$/.test(v)) v = Number(v);
    else if (v.startsWith("[") && v.endsWith("]")) {
      v = v
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      v = v.replace(/^["']|["']$/g, "");
    }
    meta[m[1]] = v;
  }
  return { meta, body: text.slice(end + 5) };
}

function loadMd(globDir, prefix) {
  return listFiles(globDir, (n) => n.startsWith(prefix) && n.endsWith(".md")).map((f) => {
    const { meta, body } = parseFrontmatter(read(f));
    return { path: f, meta, body };
  });
}

function loadYamlishProject() {
  const text = read(".project/project.yaml");
  return {
    id: text.match(/^\s*id:\s*(.+)$/m)?.[1]?.trim(),
    name: text.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim(),
    version: text.match(/^\s*version:\s*(.+)$/m)?.[1]?.trim(),
    ledger_version: text.match(/^\s*ledger_version:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim(),
  };
}

function yamlScalar(v) {
  if (v == null || v === "null") return null;
  const s = String(v).trim();
  if (s === "null" || s === "") return null;
  return s.replace(/^["']|["']$/g, "");
}

function loadRules() {
  if (!exists(".project/project.yaml")) return {};
  const text = read(".project/project.yaml");
  const rules = {};
  let inRules = false;
  for (const line of text.split("\n")) {
    if (/^rules:\s*$/.test(line)) {
      inRules = true;
      continue;
    }
    if (inRules) {
      if (/^[a-z_]+:\s*/.test(line) && !/^\s/.test(line)) break;
      const m = line.match(/^\s+([a-z_]+):\s*(.+)$/);
      if (m) rules[m[1]] = m[2].trim() === "true";
    }
  }
  return rules;
}

function loadContext() {
  const empty = {
    current_epic: null,
    current_plan: null,
    current_task: null,
    current_spec: null,
    current_req: null,
    notes: null,
    updated_at: null,
    updated_by: null,
  };
  if (!exists(".project/context.yaml")) return empty;
  const text = read(".project/context.yaml");
  const ctx = { ...empty };
  for (const key of Object.keys(empty)) {
    const m = text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    if (m) ctx[key] = yamlScalar(m[1]);
  }
  return ctx;
}

function saveContext(ctx) {
  const lines = [
    "# Active work pointer — any harness agent: run `ledger context` first in a new chat.",
    '# Update with: ledger focus <EPIC-|PLAN-|TASK-|SPEC-|REQ- id> [--notes "..."]',
    `current_epic: ${ctx.current_epic ?? "null"}`,
    `current_plan: ${ctx.current_plan ?? "null"}`,
    `current_task: ${ctx.current_task ?? "null"}`,
    `current_spec: ${ctx.current_spec ?? "null"}`,
    `current_req: ${ctx.current_req ?? "null"}`,
    `notes: ${ctx.notes == null ? "null" : JSON.stringify(String(ctx.notes))}`,
    `updated_at: ${ctx.updated_at ?? "null"}`,
    `updated_by: ${ctx.updated_by ?? "null"}`,
    "",
  ];
  write(".project/context.yaml", lines.join("\n"));
}

function nextId(prefix, items) {
  const nums = items
    .map((it) => Number(String(it.meta?.id || it.id || "").replace(new RegExp(`^${prefix}-`), "")))
    .filter((n) => !Number.isNaN(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

function loadPeople() {
  if (!exists(".project/people.yaml")) return [];
  const text = read(".project/people.yaml");
  const people = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.match(/^\s*-\s*id:\s*(.+)/)) {
      if (cur) people.push(cur);
      cur = { id: line.match(/^\s*-\s*id:\s*(.+)/)[1].trim() };
    } else if (cur) {
      const m = line.match(/^\s{2,}([a-z_]+):\s*(.+)$/);
      if (m) cur[m[1]] = m[2].trim() === "null" ? null : m[2].trim();
    }
  }
  if (cur) people.push(cur);
  return people;
}

function events() {
  if (!exists(".audit/events.jsonl")) return [];
  return read(".audit/events.jsonl")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at line ${i + 1} in .audit/events.jsonl`);
      }
    });
}

function graph() {
  return {
    project: loadYamlishProject(),
    people: loadPeople(),
    epics: loadMd("docs/plans/epics", "EPIC-"),
    requirements: loadMd("docs/product/requirements", "REQ-"),
    specs: listFiles("docs/product/specs", (n) => n === "index.md").map((f) => {
      const { meta, body } = parseFrontmatter(read(f));
      return { path: f, meta, body };
    }),
    revisions: listFiles("docs/product/specs", (n) => /^v\d+\.md$/.test(n)).map((f) => {
      const { meta, body } = parseFrontmatter(read(f));
      return { path: f, meta, body };
    }),
    decisions: loadMd("docs/architecture/adr", "ADR-"),
    plans: loadMd("docs/plans/features", "PLAN-"),
    tasks: loadMd("docs/plans/tasks", "TASK-"),
    runs: loadMd(".engineering/agent-runs", "RUN-"),
    changes: loadMd(".engineering/change-records", "CHG-"),
    evidence: loadMd(".engineering/evidence", "EVD-"),
    tests: loadMd(".engineering/tests", "TEST-"),
    releases: loadMd(".engineering/releases", "REL-"),
    events: events(),
    context: loadContext(),
    rules: loadRules(),
  };
}

function counts(g = graph()) {
  return {
    epics: g.epics.length,
    requirements: g.requirements.length,
    sow_revisions: listFiles("docs/product/sow", (n) => /^v\d+\.md$/.test(n)).length,
    specifications: g.specs.length,
    spec_revisions: g.revisions.length,
    decisions: g.decisions.length,
    plans: g.plans.length,
    tasks: g.tasks.length,
    agent_runs: g.runs.length,
    changes: g.changes.length,
    evidence: g.evidence.length,
    tests: g.tests.length,
    releases: g.releases.length,
    events: g.events.length,
  };
}

function asArr(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function fileMatches(files, norm) {
  return asArr(files).some((f) => {
    const clean = f.replace(/\/$/, "");
    return norm === f || norm === clean || norm.startsWith(clean + "/") || norm.startsWith(f);
  });
}

function findFileHits(g, norm) {
  const hitTasks = g.tasks.filter((t) => fileMatches(t.meta.files, norm) || t.body.includes(norm));
  const hitChanges = g.changes.filter((c) => fileMatches(c.meta.files, norm) || c.body.includes(norm));
  return { hitTasks, hitChanges };
}

function resolveChain(g, task, change) {
  const runId = asArr(task?.meta?.agent_runs)[0] || change?.meta?.agent_run;
  const run = g.runs.find((r) => r.meta.id === runId);
  const planId = task?.meta?.plan || run?.meta?.plan;
  const plan = g.plans.find((p) => p.meta.id === planId);
  const epicId = yamlScalar(task?.meta?.epic) || yamlScalar(plan?.meta?.epic);
  const epic = g.epics.find((e) => e.meta.id === epicId);
  const specRef = plan?.meta?.spec || run?.meta?.spec;
  const specId = specRef?.split("@")[0];
  const rev = Number(specRef?.split("@")[1] || 0);
  const spec = g.specs.find((s) => s.meta.id === specId);
  const req =
    g.requirements.find((r) => asArr(r.meta.specs).includes(specId)) ||
    g.requirements.find((r) => yamlScalar(r.meta.epic) === epicId);
  const adrIds = asArr(plan?.meta?.decisions);
  const adrs = g.decisions.filter((a) => adrIds.includes(a.meta.id));
  const evidence = g.evidence.filter((e) => e.meta.agent_run === runId || asArr(run?.meta?.evidence).includes(e.meta.id));
  return { run, plan, epic, epicId, specRef, specId, rev, spec, req, adrs, evidence };
}

function computeDrift(g = graph()) {
  const issues = [];

  for (const run of g.runs) {
    const specRef = run.meta.spec;
    if (!specRef || !String(specRef).includes("@")) {
      issues.push({ level: "warn", code: "RUN_NO_SPEC_PIN", msg: `${run.meta.id} has no SPEC@rev pin` });
      continue;
    }
    const [sid, revS] = String(specRef).split("@");
    const rev = Number(revS);
    const spec = g.specs.find((s) => s.meta.id === sid);
    if (!spec) {
      issues.push({ level: "error", code: "RUN_SPEC_MISSING", msg: `${run.meta.id} pins missing ${sid}` });
      continue;
    }
    if (Number(spec.meta.current_revision) > rev) {
      issues.push({
        level: "warn",
        code: "STALE_RUN",
        msg: `${run.meta.id} implemented ${specRef} but current is ${sid}@${spec.meta.current_revision} — implementation may be out of date`,
      });
    }
  }

  for (const req of g.requirements) {
    if (req.meta.status === "active" && !asArr(req.meta.specs).length) {
      issues.push({ level: "warn", code: "REQ_NO_SPEC", msg: `${req.meta.id} is active but has no specs` });
    }
    for (const sid of asArr(req.meta.specs)) {
      if (!g.specs.some((s) => s.meta.id === sid)) {
        issues.push({ level: "error", code: "REQ_SPEC_MISSING", msg: `${req.meta.id} references missing ${sid}` });
      }
    }
  }

  for (const plan of g.plans) {
    const specRef = plan.meta.spec;
    if (specRef) {
      const sid = String(specRef).split("@")[0];
      if (!g.specs.some((s) => s.meta.id === sid)) {
        issues.push({ level: "error", code: "PLAN_SPEC_MISSING", msg: `${plan.meta.id} references missing ${sid}` });
      }
    }
    for (const tid of asArr(plan.meta.tasks)) {
      if (!g.tasks.some((t) => t.meta.id === tid)) {
        issues.push({ level: "error", code: "PLAN_TASK_MISSING", msg: `${plan.meta.id} references missing ${tid}` });
      }
    }
    for (const did of asArr(plan.meta.decisions)) {
      if (!g.decisions.some((d) => d.meta.id === did)) {
        issues.push({ level: "error", code: "PLAN_ADR_MISSING", msg: `${plan.meta.id} references missing ${did}` });
      }
    }
  }

  for (const task of g.tasks) {
    if (task.meta.plan && !g.plans.some((p) => p.meta.id === task.meta.plan)) {
      issues.push({ level: "error", code: "TASK_PLAN_MISSING", msg: `${task.meta.id} references missing ${task.meta.plan}` });
    }
    const epicId = yamlScalar(task.meta.epic);
    if (epicId && !g.epics.some((e) => e.meta.id === epicId)) {
      issues.push({ level: "error", code: "TASK_EPIC_MISSING", msg: `${task.meta.id} references missing ${epicId}` });
    }
  }

  for (const plan of g.plans) {
    const epicId = yamlScalar(plan.meta.epic);
    if (epicId && !g.epics.some((e) => e.meta.id === epicId)) {
      issues.push({ level: "error", code: "PLAN_EPIC_MISSING", msg: `${plan.meta.id} references missing ${epicId}` });
    }
  }

  for (const epic of g.epics) {
    for (const pid of asArr(epic.meta.plans)) {
      if (!g.plans.some((p) => p.meta.id === pid)) {
        issues.push({ level: "error", code: "EPIC_PLAN_MISSING", msg: `${epic.meta.id} references missing ${pid}` });
      }
    }
    for (const rid of asArr(epic.meta.requirements)) {
      if (!g.requirements.some((r) => r.meta.id === rid)) {
        issues.push({ level: "error", code: "EPIC_REQ_MISSING", msg: `${epic.meta.id} references missing ${rid}` });
      }
    }
  }

  for (const req of g.requirements) {
    const epicId = yamlScalar(req.meta.epic);
    if (epicId && !g.epics.some((e) => e.meta.id === epicId)) {
      issues.push({ level: "error", code: "REQ_EPIC_MISSING", msg: `${req.meta.id} references missing ${epicId}` });
    }
  }

  const rules = g.rules || {};
  if (rules.implementation_requires_spec) {
    for (const plan of g.plans) {
      if (["approved", "in_progress", "done"].includes(plan.meta.status) && !plan.meta.spec) {
        issues.push({
          level: "error",
          code: "RULE_SPEC_REQUIRED",
          msg: `${plan.meta.id} status=${plan.meta.status} but rules.implementation_requires_spec`,
        });
      }
    }
  }
  if (rules.implementation_requires_plan) {
    for (const task of g.tasks) {
      if (["in_progress", "done"].includes(task.meta.status) && !task.meta.plan) {
        issues.push({
          level: "error",
          code: "RULE_PLAN_REQUIRED",
          msg: `${task.meta.id} status=${task.meta.status} but rules.implementation_requires_plan`,
        });
      }
    }
  }
  if (rules.agent_runs_required) {
    for (const task of g.tasks) {
      if (task.meta.status === "done" && !asArr(task.meta.agent_runs).length) {
        issues.push({
          level: "error",
          code: "RULE_RUN_REQUIRED",
          msg: `${task.meta.id} is done but rules.agent_runs_required and no agent_runs`,
        });
      }
    }
  }
  if (rules.evidence_required) {
    for (const run of g.runs) {
      if (["completed", "done"].includes(run.meta.status) && !asArr(run.meta.evidence).length) {
        const hasEv = g.evidence.some((e) => e.meta.agent_run === run.meta.id);
        if (!hasEv) {
          issues.push({
            level: "warn",
            code: "RULE_EVIDENCE_REQUIRED",
            msg: `${run.meta.id} completed but rules.evidence_required and no evidence linked`,
          });
        }
      }
    }
  }

  for (const d of g.decisions) {
    if (d.meta.status === "proposed") {
      issues.push({ level: "warn", code: "UNRESOLVED_DECISION", msg: `${d.meta.id} is still proposed` });
    }
  }

  const tracedFeatures = g.plans.filter((p) => {
    const tasks = asArr(p.meta.tasks);
    if (!tasks.length) return false;
    return tasks.every((tid) => {
      const t = g.tasks.find((x) => x.meta.id === tid);
      return t && asArr(t.meta.agent_runs).some((rid) => g.runs.some((r) => r.meta.id === rid));
    });
  }).length;

  return { issues, tracedFeatures, totalPlans: g.plans.length };
}

function nextEventId() {
  const ids = events()
    .map((e) => Number(String(e.id).replace("EVT-", "")))
    .filter((n) => !Number.isNaN(n));
  const n = (ids.length ? Math.max(...ids) : 0) + 1;
  return `EVT-${String(n).padStart(6, "0")}`;
}

function bodyHash(rel) {
  const { body } = parseFrontmatter(read(rel));
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
}

function usage() {
  console.log(`Project Ledger

  project-ledger init [--name my-app] [--force]
  project-ledger upgrade          refresh missing scaffold + vendor CLI
  project-ledger doctor
  project-ledger status
  project-ledger validate
  project-ledger check            git diff vs TASK files (CI / pre-commit)
  project-ledger context
  project-ledger focus <EPIC-|PLAN-|TASK-|SPEC-|REQ- id> [--notes "..."] [--actor TYPE:ID]
  project-ledger focus --clear
  project-ledger new <epic|req|spec|sow|plan|task|adr|run|chg|evd|test|rel> <title> [flags]
      flags: --epic ID --plan ID --spec SPEC@rev --req REQ-ID --status S --focus
  project-ledger revise <SPEC-|SOW- id>   new immutable revision + content_hash
  project-ledger hooks install            install .git/hooks/pre-commit
  project-ledger trace <note>             append .agent-trace/traces.jsonl
  project-ledger history <id>
  project-ledger why <path>
  project-ledger who <path>
  project-ledger drift
  project-ledger impact <EPIC-|ADR-|REQ-|SPEC-|SOW- id>
  project-ledger timeline [n]
  project-ledger decisions
  project-ledger event <action> <target> [--spec SPEC@rev]
  project-ledger hash <path>
  project-ledger ui [--port 3847]

New chat / any harness — start with:
  node scripts/ledger.mjs context
`);
}

function copyDir(src, dest, { force = false } = {}) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      n += copyDir(s, d, { force });
    } else {
      if (fs.existsSync(d) && !force) continue;
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      n += 1;
    }
  }
  return n;
}

function patchProjectYaml(name) {
  const rel = ".project/project.yaml";
  if (!exists(rel)) return;
  let text = read(rel);
  text = text.replace(/name:\s*.+/m, `name: ${name}`);
  text = text.replace(/id:\s*PROJECT-001/, "id: PROJECT-001");
  write(rel, text);
}

function ensureGitignoreEntries() {
  const snippet = `
# Project Ledger — keep protocol tracked; ignore local agent traces
.agent-trace/*
!.agent-trace/README.md
`;
  const gi = abs(".gitignore");
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, snippet.trimStart());
    return;
  }
  const cur = fs.readFileSync(gi, "utf8");
  if (!cur.includes(".agent-trace/*")) {
    fs.appendFileSync(gi, "\n" + snippet.trimStart());
  }
}

function mergePackageJsonScripts() {
  const pkgPath = abs("package.json");
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.scripts = pkg.scripts || {};
    let changed = false;
    const add = {
      ledger: "node scripts/ledger.mjs",
      "ledger:status": "node scripts/ledger.mjs status",
      "ledger:validate": "node scripts/ledger.mjs validate",
      "ledger:check": "node scripts/ledger.mjs check",
      "ledger:drift": "node scripts/ledger.mjs drift",
      "ledger:doctor": "node scripts/ledger.mjs doctor",
      "ledger:context": "node scripts/ledger.mjs context",
      "ledger:upgrade": "node scripts/ledger.mjs upgrade",
      "ledger:ui": "node scripts/ledger.mjs ui",
    };
    for (const [k, v] of Object.entries(add)) {
      if (!pkg.scripts[k]) {
        pkg.scripts[k] = v;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      console.log("Updated package.json scripts (ledger*).");
    }
  } catch (e) {
    console.warn("Could not update package.json:", e.message);
  }
}

function vendorCli() {
  const from = path.join(PKG_ROOT, "src/ledger.mjs");
  if (!fs.existsSync(from)) {
    console.warn("Could not vendor CLI (src/ledger.mjs missing). Set LEDGER_PKG_ROOT.");
    return false;
  }
  const dest = abs("scripts/ledger.mjs");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
  return true;
}

function cmdDoctor() {
  const checks = [];
  const ok = (label, pass, hint = "") => checks.push({ label, pass, hint });

  ok(".project/project.yaml", exists(".project/project.yaml"), "Run: project-ledger init");
  ok(".project/context.yaml", exists(".project/context.yaml"), "Run: project-ledger init (or create context.yaml)");
  ok("docs/agent-protocol.md", exists("docs/agent-protocol.md"));
  ok("AGENTS.md", exists("AGENTS.md"));
  ok("scripts/ledger.mjs", exists("scripts/ledger.mjs"), "Re-run init to vendor local CLI");
  ok(".project/harness/validate-on-stop.sh", exists(".project/harness/validate-on-stop.sh"));
  ok("Cursor rule", exists(".cursor/rules/project-ledger.mdc"));
  ok("find-skills (Cursor)", exists(".cursor/skills/find-skills/SKILL.md"), "Run: project-ledger init --force");
  ok("find-skills (Claude)", exists(".claude/skills/find-skills/SKILL.md"), "Run: project-ledger init --force");
  ok("Claude adapter", exists("CLAUDE.md"));
  ok("security-review", exists(".cursor/rules/security-review.mdc") || exists(".claude/rules/security-review.md"));
  ok("codebase-style", exists(".cursor/rules/codebase-style.mdc") || exists(".claude/rules/codebase-style.md"));
  ok(`scaffold at PKG_ROOT`, fs.existsSync(path.join(PKG_ROOT, "scaffold")), "npm i -D /path/to/project-ledger or LEDGER_PKG_ROOT");
  ok("docs/plans/epics", exists("docs/plans/epics"), "Run: project-ledger init --force");

  console.log("Project Ledger doctor\n");
  console.log(`ROOT      ${ROOT}`);
  console.log(`PKG_ROOT  ${PKG_ROOT}\n`);
  let failed = 0;
  for (const c of checks) {
    console.log(`${c.pass ? "OK  " : "FAIL"} ${c.label}`);
    if (!c.pass) {
      failed++;
      if (c.hint) console.log(`     → ${c.hint}`);
    }
  }
  console.log("");
  if (failed) {
    console.log(`${failed} issue(s).`);
    process.exit(1);
  }
  cmdValidate();
}

function cmdInit(args) {
  const force = args.includes("--force");
  const nameIdx = args.indexOf("--name");
  const name =
    (nameIdx >= 0 && args[nameIdx + 1]) ||
    path.basename(ROOT) ||
    "my-project";

  const scaffold = path.join(PKG_ROOT, "scaffold");
  if (!fs.existsSync(scaffold)) {
    console.error(`Scaffold missing at ${scaffold}`);
    process.exit(1);
  }

  if (exists(".project/project.yaml") && !force) {
    vendorCli();
    console.log("Already initialized (.project/project.yaml present).");
    console.log("Refreshed scripts/ledger.mjs when package CLI is available.");
    console.log("Use: project-ledger init --force   to fill missing scaffold files");
    console.log("Or:  node scripts/ledger.mjs validate");
    return;
  }

  const n = copyDir(scaffold, ROOT, { force: false });
  // Ensure expected dirs exist even if an older tarball omitted empty folders
  for (const d of [
    "docs/product/requirements",
    "docs/product/specs",
    "docs/product/sow",
    "docs/architecture/adr",
    "docs/plans/features",
    "docs/plans/tasks",
    "docs/plans/epics",
    "docs/decisions",
    "docs/conventions",
    ".engineering/agent-runs",
    ".engineering/change-records",
    ".engineering/decision-traces",
    ".engineering/evidence",
    ".engineering/tests",
    ".engineering/releases",
    ".audit",
    ".agent-trace",
    ".cursor/rules",
    ".cursor/hooks",
    ".cursor/skills",
    ".claude/skills",
    ".github/workflows",
    ".project/schemas",
    ".project/templates",
    ".project/harness",
  ]) {
    fs.mkdirSync(abs(d), { recursive: true });
    const keep = path.join(abs(d), "README.md");
    if (!fs.existsSync(keep) && !d.startsWith(".audit") && !d.includes("schemas") && !d.includes("templates") && !d.includes("hooks") && !d.includes("rules")) {
      fs.writeFileSync(
        keep,
        `# ${path.basename(d)}\n\nPlace Project Ledger artifacts here. See \`.project/templates/\`.\n`,
      );
    }
  }
  patchProjectYaml(name);
  ensureGitignoreEntries();
  mergePackageJsonScripts();
  const vendored = vendorCli();

  // bootstrap audit event
  const evPath = abs(".audit/events.jsonl");
  if (!fs.existsSync(evPath) || fs.readFileSync(evPath, "utf8").trim() === "") {
    const ev = {
      id: "EVT-000001",
      timestamp: new Date().toISOString(),
      actor: { type: "agent", id: "AGENT-CURSOR" },
      action: "project.ledger_initialized",
      target: "PROJECT-001",
    };
    fs.mkdirSync(path.dirname(evPath), { recursive: true });
    fs.writeFileSync(evPath, JSON.stringify(ev) + "\n");
  }

  console.log(`Project Ledger initialized in ${ROOT}`);
  console.log(`  project name: ${name}`);
  console.log(`  files written/kept: ${n}+ (skipped existing)`);
  console.log(`  local CLI: ${vendored ? "scripts/ledger.mjs" : "NOT VENDORED"}`);
  console.log("");
  console.log("Next (works offline — no npm registry):");
  console.log("  node scripts/ledger.mjs context");
  console.log("  node scripts/ledger.mjs validate");
  console.log("  node scripts/ledger.mjs doctor");
  console.log("  node scripts/ledger.mjs status");
  console.log("  Edit .project/people.yaml and docs/product/vision.md");
}

function cmdStatus() {
  const g = graph();
  const c = counts(g);
  const drift = computeDrift(g);
  const ctx = g.context;
  console.log(`PROJECT LEDGER — ${g.project.name} (${g.project.id}) v${g.project.version}`);
  console.log(`ledger_version     ${g.project.ledger_version || "?"}`);
  console.log("");
  console.log("FOCUS");
  console.log(`  epic   ${ctx.current_epic || "—"}`);
  console.log(`  plan   ${ctx.current_plan || "—"}`);
  console.log(`  task   ${ctx.current_task || "—"}`);
  console.log(`  spec   ${ctx.current_spec || "—"}`);
  console.log(`  req    ${ctx.current_req || "—"}`);
  if (ctx.notes) console.log(`  notes  ${ctx.notes}`);
  console.log("");
  console.log(`Epics              ${c.epics}`);
  console.log(`Requirements       ${c.requirements}`);
  console.log(`SOW Revisions      ${c.sow_revisions}`);
  console.log(`Specifications     ${c.specifications}`);
  console.log(`Spec Revisions     ${c.spec_revisions}`);
  console.log(`Decisions          ${c.decisions}`);
  console.log(`Plans              ${c.plans}`);
  console.log(`Tasks              ${c.tasks}`);
  console.log(`Agent Runs         ${c.agent_runs}`);
  console.log(`Changes            ${c.changes}`);
  console.log(`Evidence           ${c.evidence}`);
  console.log(`Tests              ${c.tests}`);
  console.log(`Releases           ${c.releases}`);
  console.log(`Events             ${c.events}`);
  console.log("");
  const errs = drift.issues.filter((i) => i.level === "error").length;
  const warns = drift.issues.filter((i) => i.level === "warn").length;
  console.log(`${warns ? "⚠" : "✓"}  ${warns} Drift / warning issues`);
  console.log(`${errs ? "⚠" : "✓"}  ${errs} Integrity errors`);
  console.log(`✓  ${drift.tracedFeatures} Plans fully traced`);
}

function cmdValidate() {
  const errors = [];
  const required = [
    ".project/project.yaml",
    ".project/people.yaml",
    ".project/model.yaml",
    ".project/context.yaml",
    ".project/schemas",
    "docs/product/vision.md",
    "docs/product/requirements",
    "docs/product/sow",
    "docs/product/specs",
    "docs/architecture/adr",
    "docs/plans/epics",
    "docs/plans/features",
    "docs/plans/tasks",
    ".engineering/agent-runs",
    ".engineering/change-records",
    ".engineering/decision-traces",
    ".engineering/evidence",
    ".engineering/tests",
    ".engineering/releases",
    ".project/templates",
    ".audit/events.jsonl",
    ".cursor/rules/project-ledger.mdc",
    "AGENTS.md",
    "docs/agent-protocol.md",
  ];
  for (const p of required) if (!exists(p)) errors.push(`missing: ${p}`);

  for (const s of [
    "PROJECT",
    "PERSON",
    "EPIC",
    "REQUIREMENT",
    "SOW",
    "SOW_REVISION",
    "SPEC",
    "SPEC_REVISION",
    "DECISION",
    "PLAN",
    "TASK",
    "AGENT_RUN",
    "CHANGE",
    "EVIDENCE",
    "TEST",
    "RELEASE",
    "EVENT",
  ]) {
    if (!exists(`.project/schemas/${s}.json`)) errors.push(`missing schema: ${s}.json`);
  }

  for (const indexPath of listFiles("docs/product/sow", (n) => n === "index.md")) {
    const { meta } = parseFrontmatter(read(indexPath));
    if (meta.current_revision) {
      const revPath = path.join(path.dirname(indexPath), `v${meta.current_revision}.md`);
      if (!exists(revPath)) errors.push(`sow missing revision file: ${revPath}`);
    }
  }

  const g = graph();
  for (const spec of g.specs) {
    if (!spec.meta.id || !spec.meta.current_revision) {
      errors.push(`spec index incomplete: ${spec.path}`);
      continue;
    }
    const revPath = path.join(path.dirname(spec.path), `v${spec.meta.current_revision}.md`);
    if (!exists(revPath)) errors.push(`spec missing revision file: ${revPath}`);
  }

  for (const rev of g.revisions) {
    const stored = yamlScalar(rev.meta.content_hash);
    if (stored && stored !== "pending") {
      const actual = bodyHash(rev.path);
      if (stored !== actual) {
        errors.push(`SPEC_HASH_MISMATCH: ${rev.path} has content_hash=${stored} but body hashes to ${actual}`);
      }
    }
  }

  for (const sowRev of listFiles("docs/product/sow", (n) => /^v\d+\.md$/.test(n))) {
    const { meta } = parseFrontmatter(read(sowRev));
    const stored = yamlScalar(meta.content_hash);
    if (stored && stored !== "pending") {
      const actual = bodyHash(sowRev);
      if (stored !== actual) {
        errors.push(`SOW_HASH_MISMATCH: ${sowRev} has content_hash=${stored} but body hashes to ${actual}`);
      }
    }
  }

  for (const [i, ev] of g.events.entries()) {
    if (!ev.id || !/^EVT-\d+$/.test(ev.id)) errors.push(`event ${i + 1}: bad id`);
    if (!ev.action || !ev.target || !ev.timestamp || !ev.actor) errors.push(`event ${i + 1}: missing fields`);
  }

  for (const adr of g.decisions) {
    if (adr.meta.status === "accepted" && adr.meta.immutable !== true) {
      errors.push(`ADR not marked immutable: ${adr.path}`);
    }
  }

  const drift = computeDrift(g);
  for (const issue of drift.issues.filter((i) => i.level === "error")) {
    errors.push(`${issue.code}: ${issue.msg}`);
  }

  if (errors.length) {
    console.error(`VALIDATE FAIL (${errors.length})`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("VALIDATE OK");
  const c = counts(g);
  console.log(
    `entities: EPIC=${c.epics} REQ=${c.requirements} SPEC=${c.specifications} REV=${c.spec_revisions} ADR=${c.decisions} PLAN=${c.plans} TASK=${c.tasks} RUN=${c.agent_runs} EVT=${c.events}`,
  );
  const warns = drift.issues.filter((i) => i.level === "warn");
  if (warns.length) {
    console.log(`warnings: ${warns.length} (see: pnpm ledger drift)`);
  }
}

function summarizeEntity(ent) {
  if (!ent) return null;
  const title = ent.meta.title || ent.meta.summary || "";
  const status = ent.meta.status ? ` [${ent.meta.status}]` : "";
  return `${ent.meta.id}${status} — ${title}\n  path: ${ent.path}`;
}

function cmdContext() {
  const g = graph();
  const ctx = g.context;
  console.log("ACTIVE CONTEXT (.project/context.yaml)\n");
  if (!ctx.current_task && !ctx.current_plan && !ctx.current_epic && !ctx.current_spec && !ctx.current_req) {
    console.log("  (empty) — set with: ledger focus <TASK-|PLAN-|EPIC-|SPEC-|REQ- id>");
    console.log("  or:        ledger new task \"...\" --plan PLAN-0001 --focus");
    return;
  }
  const epic = g.epics.find((e) => e.meta.id === ctx.current_epic);
  const plan = g.plans.find((p) => p.meta.id === ctx.current_plan);
  const task = g.tasks.find((t) => t.meta.id === ctx.current_task);
  const spec = g.specs.find((s) => s.meta.id === String(ctx.current_spec || "").split("@")[0]);
  const req = g.requirements.find((r) => r.meta.id === ctx.current_req);

  if (epic) console.log(`EPIC\n  ${summarizeEntity(epic)}\n`);
  else if (ctx.current_epic) console.log(`EPIC\n  ${ctx.current_epic} (missing file)\n`);

  if (req) console.log(`REQ\n  ${summarizeEntity(req)}\n`);
  else if (ctx.current_req) console.log(`REQ\n  ${ctx.current_req} (missing file)\n`);

  if (spec) {
    console.log(`SPEC\n  ${spec.meta.id}@${spec.meta.current_revision} — ${spec.meta.title || ""}`);
    console.log(`  path: ${spec.path}`);
    const revPath = path.join(path.dirname(spec.path), `v${spec.meta.current_revision}.md`);
    if (exists(revPath)) console.log(`  revision: ${revPath}`);
    console.log("");
  } else if (ctx.current_spec) console.log(`SPEC\n  ${ctx.current_spec} (missing file)\n`);

  if (plan) console.log(`PLAN\n  ${summarizeEntity(plan)}\n`);
  else if (ctx.current_plan) console.log(`PLAN\n  ${ctx.current_plan} (missing file)\n`);

  if (task) {
    console.log(`TASK\n  ${summarizeEntity(task)}`);
    const files = asArr(task.meta.files);
    if (files.length) {
      console.log("  files:");
      for (const f of files) console.log(`    - ${f}`);
    }
    console.log("");
  } else if (ctx.current_task) console.log(`TASK\n  ${ctx.current_task} (missing file)\n`);

  if (ctx.notes) console.log(`NOTES\n  ${ctx.notes}\n`);
  if (ctx.updated_at) console.log(`updated ${ctx.updated_at} by ${ctx.updated_by || "?"}`);
  console.log("\nRead only the paths above — do not rescan all task files.");
}

function cmdFocus(args) {
  if (!args.length || args[0] === "--help") {
    console.error('usage: ledger focus <EPIC-|PLAN-|TASK-|SPEC-|REQ- id> [--notes "..."] [--actor TYPE:ID]');
    console.error("       ledger focus --clear");
    process.exit(1);
  }
  if (args[0] === "--clear") {
    saveContext({
      current_epic: null,
      current_plan: null,
      current_task: null,
      current_spec: null,
      current_req: null,
      notes: null,
      updated_at: new Date().toISOString(),
      updated_by: "agent:ledger",
    });
    console.log("cleared .project/context.yaml");
    return;
  }

  const id = args[0];
  let notes;
  let actor = "agent:ledger";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--notes") notes = args[++i];
    if (args[i] === "--actor") actor = args[++i];
  }

  const g = graph();
  const ctx = { ...g.context };
  const base = id.replace(/@\d+$/, "");

  if (base.startsWith("TASK-")) {
    const task = g.tasks.find((t) => t.meta.id === base);
    if (!task) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    ctx.current_task = base;
    ctx.current_plan = task.meta.plan || ctx.current_plan;
    ctx.current_epic = yamlScalar(task.meta.epic) || ctx.current_epic;
    const plan = g.plans.find((p) => p.meta.id === ctx.current_plan);
    if (plan) {
      ctx.current_epic = yamlScalar(plan.meta.epic) || ctx.current_epic;
      ctx.current_spec = plan.meta.spec || ctx.current_spec;
    }
  } else if (base.startsWith("PLAN-")) {
    const plan = g.plans.find((p) => p.meta.id === base);
    if (!plan) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    ctx.current_plan = base;
    ctx.current_epic = yamlScalar(plan.meta.epic) || ctx.current_epic;
    ctx.current_spec = plan.meta.spec || ctx.current_spec;
    ctx.current_task = null;
  } else if (base.startsWith("EPIC-")) {
    if (!g.epics.some((e) => e.meta.id === base)) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    ctx.current_epic = base;
    ctx.current_plan = null;
    ctx.current_task = null;
  } else if (base.startsWith("SPEC-")) {
    if (!g.specs.some((s) => s.meta.id === base)) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    const spec = g.specs.find((s) => s.meta.id === base);
    ctx.current_spec = `${base}@${spec.meta.current_revision}`;
  } else if (base.startsWith("REQ-")) {
    const req = g.requirements.find((r) => r.meta.id === base);
    if (!req) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    ctx.current_req = base;
    ctx.current_epic = yamlScalar(req.meta.epic) || ctx.current_epic;
  } else {
    console.error("focus supports EPIC-*, PLAN-*, TASK-*, SPEC-*, REQ-*");
    process.exit(1);
  }

  if (notes !== undefined) ctx.notes = notes;
  ctx.updated_at = new Date().toISOString();
  ctx.updated_by = actor;
  saveContext(ctx);
  append(
    ".audit/events.jsonl",
    JSON.stringify({
      id: nextEventId(),
      timestamp: ctx.updated_at,
      actor: { type: actor.split(":")[0] || "agent", id: actor.split(":")[1] || actor },
      action: "context.focus",
      target: base,
    }),
  );
  appendAgentTrace({ action: "focus", target: base, notes: ctx.notes });
  console.log(`focused ${base}`);
  cmdContext();
}

function parseNewFlags(rest) {
  const flags = { epic: null, plan: null, spec: null, req: null, status: null, focus: false, actor: "agent:ledger" };
  const titleParts = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--epic") flags.epic = rest[++i];
    else if (a === "--plan") flags.plan = rest[++i];
    else if (a === "--spec") flags.spec = rest[++i];
    else if (a === "--req") flags.req = rest[++i];
    else if (a === "--status") flags.status = rest[++i];
    else if (a === "--actor") flags.actor = rest[++i];
    else if (a === "--focus") flags.focus = true;
    else titleParts.push(a);
  }
  return { title: titleParts.join(" ").trim(), flags };
}

function appendAgentTrace(entry) {
  const rel = ".agent-trace/traces.jsonl";
  fs.mkdirSync(abs(".agent-trace"), { recursive: true });
  append(rel, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}

function setFrontmatterField(text, key, value) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return text;
  let fm = text.slice(4, end);
  const re = new RegExp(`^${key}:\\s*.*$`, "m");
  if (re.test(fm)) fm = fm.replace(re, `${key}: ${value}`);
  else fm += `\n${key}: ${value}`;
  return `---\n${fm}\n---\n` + text.slice(end + 5);
}

function cmdNew(kind, rest) {
  if (!kind) {
    console.error("usage: ledger new <epic|req|spec|sow|plan|task|adr|run|chg|evd|test|rel> <title> [flags]");
    process.exit(1);
  }
  const { title, flags } = parseNewFlags(rest);
  if (!title) {
    console.error("title required");
    process.exit(1);
  }
  const g = graph();
  const ctx = g.context;
  let rel;
  let id;
  let body;
  const now = new Date().toISOString();

  if (kind === "epic") {
    id = nextId("EPIC", g.epics);
    rel = `docs/plans/epics/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "draft"}
requirements: []
plans: []
---

# ${id} — ${title}

## Outcome

…

## Scope

…
`;
  } else if (kind === "req") {
    id = nextId("REQ", g.requirements);
    const epic = flags.epic || ctx.current_epic || "null";
    rel = `docs/product/requirements/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "draft"}
priority: p2
epic: ${epic}
specs: []
changed_by: USER-001
change_count: 1
---

# ${id} — ${title}

## Statement

…

## Why

…
`;
  } else if (kind === "spec") {
    id = nextId(
      "SPEC",
      g.specs.map((s) => ({ meta: { id: s.meta.id } })),
    );
    const req = flags.req || ctx.current_req;
    if (!req) {
      console.error("spec requires --req REQ-#### (or focus a requirement first)");
      process.exit(1);
    }
    const dir = `docs/product/specs/${id}`;
    fs.mkdirSync(abs(dir), { recursive: true });
    const indexRel = `${dir}/index.md`;
    const revRel = `${dir}/v1.md`;
    const revBody = `---
id: ${id}
spec_revision: 1
content_hash: pending
created_at: ${now}
created_by: USER-001
immutable: true
requirement: ${req}
format: productspec
---

# Product Summary

${title}

## Scope

### In scope

- …

### Out of scope

- …

## Acceptance Criteria

- [ ] …

## AI Evals

- …

## Success Metrics

- …

## Related Artifacts

- …

## Evidence

- …
`;
    write(revRel, revBody);
    const hash = bodyHash(revRel);
    write(revRel, setFrontmatterField(read(revRel), "content_hash", hash));
    write(
      indexRel,
      `---
id: ${id}
title: ${title}
requirement: ${req}
current_revision: 1
status: ${flags.status || "draft"}
format: productspec
---

# ${id} index

| Revision | Path |
|----------|------|
| 1 | [v1.md](./v1.md) |
`,
    );
    rel = indexRel;
    id = id;
    append(
      ".audit/events.jsonl",
      JSON.stringify({
        id: nextEventId(),
        timestamp: now,
        actor: { type: flags.actor.split(":")[0] || "agent", id: flags.actor.split(":")[1] || flags.actor },
        action: "entity.created.spec",
        target: id,
      }),
    );
    appendAgentTrace({ action: "new.spec", target: id, path: indexRel });
    console.log(`created ${indexRel}`);
    console.log(`created ${revRel} (hash ${hash})`);
    if (flags.focus) cmdFocus([`${id}@1`, "--actor", flags.actor]);
    return;
  } else if (kind === "sow") {
    id = nextId(
      "SOW",
      listFiles("docs/product/sow", (n) => n === "index.md").map((f) => {
        const { meta } = parseFrontmatter(read(f));
        return { meta };
      }),
    );
    const indexRel = "docs/product/sow/index.md";
    if (exists(indexRel)) {
      console.error("SOW index already exists — use: ledger revise SOW-####");
      process.exit(1);
    }
    const revRel = "docs/product/sow/v1.md";
    const revBody = `---
id: ${id}
sow_revision: 1
content_hash: pending
created_at: ${now}
created_by: USER-001
immutable: true
status: accepted
title: ${title}
---

# ${id} @1

${title}
`;
    write(revRel, revBody);
    const hash = bodyHash(revRel);
    write(revRel, setFrontmatterField(read(revRel), "content_hash", hash));
    write(
      indexRel,
      `---
id: ${id}
title: ${title}
current_revision: 1
status: ${flags.status || "draft"}
format: sow
specs: []
---

# ${id} index

| Revision | Path |
|----------|------|
| 1 | [v1.md](./v1.md) |
`,
    );
    append(
      ".audit/events.jsonl",
      JSON.stringify({
        id: nextEventId(),
        timestamp: now,
        actor: { type: flags.actor.split(":")[0] || "agent", id: flags.actor.split(":")[1] || flags.actor },
        action: "entity.created.sow",
        target: id,
      }),
    );
    appendAgentTrace({ action: "new.sow", target: id, path: indexRel });
    console.log(`created ${indexRel}`);
    console.log(`created ${revRel} (hash ${hash})`);
    return;
  } else if (kind === "plan") {
    id = nextId("PLAN", g.plans);
    const epic = flags.epic || ctx.current_epic || "null";
    const spec = flags.spec || ctx.current_spec || "SPEC-0000@1";
    rel = `docs/plans/features/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "draft"}
epic: ${epic}
spec: ${spec}
decisions: []
tasks: []
---

# ${id} — ${title}

## Goal

…

## Tasks

1. …
`;
  } else if (kind === "task") {
    id = nextId("TASK", g.tasks);
    const plan = flags.plan || ctx.current_plan;
    if (!plan) {
      console.error("task requires --plan PLAN-#### (or set focus with a current plan)");
      process.exit(1);
    }
    const epic = flags.epic || ctx.current_epic || "null";
    rel = `docs/plans/tasks/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "todo"}
epic: ${epic}
plan: ${plan}
agent_runs: []
files: []
---

# ${id}

${title}
`;
  } else if (kind === "adr") {
    id = nextId("ADR", g.decisions);
    rel = `docs/architecture/adr/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "proposed"}
immutable: false
supersedes: null
superseded_by: null
---

# ${id} — ${title}

## Context

…

## Decision

…

## Consequences

…
`;
  } else if (kind === "run") {
    id = nextId("RUN", g.runs);
    const plan = flags.plan || ctx.current_plan || "null";
    const spec = flags.spec || ctx.current_spec || "null";
    rel = `.engineering/agent-runs/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "in_progress"}
agent: AGENT-CURSOR
plan: ${plan}
spec: ${spec}
evidence: []
commits: []
---

# ${id}

${title}
`;
  } else if (kind === "chg") {
    id = nextId("CHG", g.changes);
    rel = `.engineering/change-records/${id}.md`;
    body = `---
id: ${id}
summary: ${title}
agent_run: null
files: []
commits: []
---

# ${id}

${title}
`;
  } else if (kind === "evd") {
    id = nextId("EVD", g.evidence);
    rel = `.engineering/evidence/${id}.md`;
    body = `---
id: ${id}
title: ${title}
kind: note
agent_run: null
---

# ${id}

${title}
`;
  } else if (kind === "test") {
    id = nextId("TEST", g.tests);
    rel = `.engineering/tests/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "planned"}
spec: ${flags.spec || ctx.current_spec || "null"}
---

# ${id}

${title}
`;
  } else if (kind === "rel") {
    id = nextId("REL", g.releases);
    rel = `.engineering/releases/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "draft"}
version: 0.0.0
---

# ${id}

${title}
`;
  } else {
    console.error("unknown kind; use epic|req|spec|sow|plan|task|adr|run|chg|evd|test|rel");
    process.exit(1);
  }

  if (exists(rel)) {
    console.error(`already exists: ${rel}`);
    process.exit(1);
  }
  write(rel, body);
  append(
    ".audit/events.jsonl",
    JSON.stringify({
      id: nextEventId(),
      timestamp: now,
      actor: { type: flags.actor.split(":")[0] || "agent", id: flags.actor.split(":")[1] || flags.actor },
      action: `entity.created.${kind}`,
      target: id,
    }),
  );
  appendAgentTrace({ action: `new.${kind}`, target: id, path: rel });
  console.log(`created ${rel}`);

  if (flags.focus || kind === "task") {
    cmdFocus([id, "--actor", flags.actor]);
  }
}

function cmdRevise(id) {
  if (!id) {
    console.error("usage: ledger revise <SPEC-|SOW- id>");
    process.exit(1);
  }
  const base = id.replace(/@\d+$/, "");
  const now = new Date().toISOString();

  if (base.startsWith("SPEC-")) {
    const indexPath = listFiles("docs/product/specs", (n) => n === "index.md").find((f) => {
      const { meta } = parseFrontmatter(read(f));
      return meta.id === base;
    });
    if (!indexPath) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    const { meta } = parseFrontmatter(read(indexPath));
    const next = Number(meta.current_revision || 0) + 1;
    const dir = path.dirname(indexPath);
    const prevRel = path.join(dir, `v${meta.current_revision}.md`);
    const nextRel = path.join(dir, `v${next}.md`);
    let body;
    if (exists(prevRel)) {
      body = read(prevRel);
      body = setFrontmatterField(body, "spec_revision", next);
      body = setFrontmatterField(body, "content_hash", "pending");
      body = setFrontmatterField(body, "created_at", now);
      body = setFrontmatterField(body, "immutable", "true");
    } else {
      body = `---
id: ${base}
spec_revision: ${next}
content_hash: pending
created_at: ${now}
created_by: USER-001
immutable: true
requirement: ${meta.requirement || "null"}
format: productspec
---

# ${base} @${next}

…
`;
    }
    write(nextRel, body);
    const hash = bodyHash(nextRel);
    write(nextRel, setFrontmatterField(read(nextRel), "content_hash", hash));
    write(indexPath, setFrontmatterField(read(indexPath), "current_revision", next));
    // refresh revision table row lightly
    let idx = read(indexPath);
    if (!idx.includes(`| ${next} |`)) {
      idx = idx.trimEnd() + `\n| ${next} | [v${next}.md](./v${next}.md) |\n`;
      write(indexPath, idx);
    }
    append(
      ".audit/events.jsonl",
      JSON.stringify({
        id: nextEventId(),
        timestamp: now,
        actor: { type: "agent", id: "ledger" },
        action: "spec.revised",
        target: base,
        revision: next,
      }),
    );
    appendAgentTrace({ action: "revise.spec", target: `${base}@${next}`, path: nextRel });
    console.log(`created ${nextRel} (hash ${hash})`);
    console.log(`index current_revision → ${next}`);
    return;
  }

  if (base.startsWith("SOW-")) {
    const indexPath = "docs/product/sow/index.md";
    if (!exists(indexPath)) {
      console.error("missing docs/product/sow/index.md — create with: ledger new sow \"...\"");
      process.exit(1);
    }
    const { meta } = parseFrontmatter(read(indexPath));
    if (meta.id && meta.id !== base) {
      console.error(`SOW index id is ${meta.id}, not ${base}`);
      process.exit(1);
    }
    const next = Number(meta.current_revision || 0) + 1;
    const prevRel = `docs/product/sow/v${meta.current_revision}.md`;
    const nextRel = `docs/product/sow/v${next}.md`;
    let body;
    if (exists(prevRel)) {
      body = read(prevRel);
      body = setFrontmatterField(body, "sow_revision", next);
      body = setFrontmatterField(body, "content_hash", "pending");
      body = setFrontmatterField(body, "created_at", now);
    } else {
      body = `---
id: ${meta.id || base}
sow_revision: ${next}
content_hash: pending
created_at: ${now}
created_by: USER-001
immutable: true
status: accepted
title: ${meta.title || base}
---

# ${meta.id || base} @${next}

…
`;
    }
    write(nextRel, body);
    const hash = bodyHash(nextRel);
    write(nextRel, setFrontmatterField(read(nextRel), "content_hash", hash));
    write(indexPath, setFrontmatterField(read(indexPath), "current_revision", next));
    let idx = read(indexPath);
    if (!idx.includes(`| ${next} |`)) {
      idx = idx.trimEnd() + `\n| ${next} | [v${next}.md](./v${next}.md) |\n`;
      write(indexPath, idx);
    }
    append(
      ".audit/events.jsonl",
      JSON.stringify({
        id: nextEventId(),
        timestamp: now,
        actor: { type: "agent", id: "ledger" },
        action: "sow.revised",
        target: meta.id || base,
        revision: next,
      }),
    );
    appendAgentTrace({ action: "revise.sow", target: `${meta.id || base}@${next}`, path: nextRel });
    console.log(`created ${nextRel} (hash ${hash})`);
    console.log(`index current_revision → ${next}`);
    return;
  }

  console.error("revise supports SPEC-* and SOW-*");
  process.exit(1);
}

function cmdCheck() {
  const opts = { cwd: ROOT, encoding: "utf8" };
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], opts);
  if (inside.status !== 0) {
    console.error("CHECK FAIL: not a git repository (or git missing)");
    process.exit(1);
  }

  let files = [];
  const range = process.env.LEDGER_DIFF_RANGE;
  if (range) {
    const d = spawnSync("git", ["diff", "--name-only", range], opts);
    files = String(d.stdout || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  } else {
    const a = spawnSync("git", ["diff", "--name-only", "HEAD"], opts);
    const b = spawnSync("git", ["diff", "--cached", "--name-only"], opts);
    const c = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], opts);
    files = [
      ...new Set(
        [a.stdout, b.stdout, c.stdout].flatMap((s) =>
          String(s || "")
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ),
    ].sort();
  }

  const skipPrefixes = [
    ".project/",
    ".audit/",
    ".agent-trace/",
    ".engineering/",
    "docs/",
    "AGENTS.md",
    "CLAUDE.md",
    "scripts/ledger.mjs",
    ".cursor/",
    ".claude/",
    ".github/",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "README.md",
    "LICENSE",
  ];
  const codeFiles = files.filter((f) => !skipPrefixes.some((p) => f === p || f.startsWith(p)));

  if (!codeFiles.length) {
    console.log("CHECK OK — no implementation files changed");
    return;
  }

  const g = graph();
  const errors = [];
  const warns = [];
  const activeTasks = g.tasks.filter((t) => ["todo", "in_progress", "blocked", "done"].includes(t.meta.status));

  for (const f of codeFiles) {
    const hits = [
      ...activeTasks.filter((t) => fileMatches(t.meta.files, f) || t.body.includes(f)),
      ...g.changes.filter((c) => fileMatches(c.meta.files, f) || c.body.includes(f)),
    ];
    if (!hits.length) {
      errors.push(`UNTRACED_FILE: ${f} not listed on any TASK/CHG files:`);
    }
  }

  const ctx = g.context;
  if (!ctx.current_task && codeFiles.length && !range) {
    warns.push("NO_FOCUS: code changed but context.current_task is empty — run ledger focus TASK-####");
  }

  const rules = g.rules || {};
  if (rules.implementation_requires_plan && codeFiles.length && ctx.current_task) {
    const focused = g.tasks.find((t) => t.meta.id === ctx.current_task);
    if (focused && !focused.meta.plan) {
      errors.push(`RULE_PLAN_REQUIRED: focused ${focused.meta.id} has no plan`);
    }
  }

  for (const w of warns) console.log(`WARN  ${w}`);
  if (errors.length) {
    console.error(`CHECK FAIL (${errors.length})`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error("\nFix: add path to TASK frontmatter files: [] or create a CHG covering these files.");
    process.exit(1);
  }
  console.log(`CHECK OK — ${codeFiles.length} file(s) traced to tasks/changes`);
}

function cmdUpgrade() {
  const scaffold = path.join(PKG_ROOT, "scaffold");
  if (!fs.existsSync(scaffold)) {
    console.error(`Scaffold missing at ${scaffold}`);
    process.exit(1);
  }
  if (!exists(".project/project.yaml")) {
    console.error("Not initialized — run: project-ledger init");
    process.exit(1);
  }
  const n = copyDir(scaffold, ROOT, { force: false });
  for (const d of ["docs/plans/epics", ".cursor/skills", ".claude/skills", ".github/workflows"]) {
    fs.mkdirSync(abs(d), { recursive: true });
  }
  // refresh always-overwrite critical agent policy + CLI
  for (const rel of [
    "AGENTS.md",
    "docs/agent-protocol.md",
    ".cursor/rules/project-ledger.mdc",
    ".claude/rules/project-ledger.md",
    ".project/harness/validate-on-stop.sh",
    ".project/harness/toolkit-reminder.sh",
    ".project/harness/pre-commit.sh",
    ".github/workflows/project-ledger.yml",
    ".cursor/skills/find-skills/SKILL.md",
    ".claude/skills/find-skills/SKILL.md",
  ]) {
    const src = path.join(scaffold, rel);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
      fs.copyFileSync(src, abs(rel));
    }
  }
  if (exists(".project/project.yaml")) {
    let text = read(".project/project.yaml");
    if (/ledger_version:/.test(text)) {
      text = text.replace(/ledger_version:\s*["']?[\d.]+["']?/, 'ledger_version: "0.5"');
    } else {
      text = text.replace(/(version:\s*.+)/, `$1\n  ledger_version: "0.5"`);
    }
    if (!/active_context:/.test(text)) {
      text = text.replace(
        /(audit_log:\s*.+)/,
        `$1\n  active_context: .project/context.yaml\n  epics: docs/plans/epics`,
      );
    }
    if (!/^\s*EPIC:/m.test(text)) {
      text = text.replace(/(id_prefixes:\s*\n)/, `$1  EPIC: EPIC\n`);
    }
    write(".project/project.yaml", text);
  }
  if (!exists(".project/context.yaml")) {
    const src = path.join(scaffold, ".project/context.yaml");
    if (fs.existsSync(src)) fs.copyFileSync(src, abs(".project/context.yaml"));
  }
  ensureGitignoreEntries();
  mergePackageJsonScripts();
  const vendored = vendorCli();
  console.log(`Upgrade complete (+${n} missing scaffold files)`);
  console.log(`  local CLI: ${vendored ? "scripts/ledger.mjs refreshed" : "NOT VENDORED"}`);
  console.log("  ledger_version → 0.5");
  console.log("Next: node scripts/ledger.mjs doctor && node scripts/ledger.mjs validate");
}

function cmdHooksInstall() {
  const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, encoding: "utf8" });
  if (gitDir.status !== 0) {
    console.error("Not a git repo");
    process.exit(1);
  }
  const hookDir = path.join(ROOT, gitDir.stdout.trim(), "hooks");
  fs.mkdirSync(hookDir, { recursive: true });
  const hookPath = path.join(hookDir, "pre-commit");
  const script = `#!/usr/bin/env bash
# Installed by: project-ledger hooks install
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if [ -f scripts/ledger.mjs ]; then
  node scripts/ledger.mjs validate
  node scripts/ledger.mjs check
elif [ -f .project/harness/pre-commit.sh ]; then
  bash .project/harness/pre-commit.sh
else
  echo "project-ledger pre-commit: no CLI found" >&2
  exit 1
fi
`;
  fs.writeFileSync(hookPath, script, { mode: 0o755 });
  // also ensure harness copy exists
  const harness = abs(".project/harness/pre-commit.sh");
  fs.mkdirSync(path.dirname(harness), { recursive: true });
  fs.writeFileSync(
    harness,
    `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node scripts/ledger.mjs validate
node scripts/ledger.mjs check
`,
    { mode: 0o755 },
  );
  console.log(`installed ${path.relative(ROOT, hookPath)}`);
  console.log("Runs: ledger validate + ledger check on every commit");
}

function cmdTrace(args) {
  const note = args.join(" ").trim();
  if (!note) {
    console.error('usage: ledger trace <note>');
    process.exit(1);
  }
  const ctx = loadContext();
  appendAgentTrace({
    action: "note",
    note,
    current_task: ctx.current_task,
    current_plan: ctx.current_plan,
    current_epic: ctx.current_epic,
  });
  console.log("appended .agent-trace/traces.jsonl");
}

function cmdHistory(id) {
  if (!id) {
    console.error("usage: ledger history <id>");
    process.exit(1);
  }
  const needle = id.replace(/@\d+$/, "");
  const matched = events().filter(
    (e) => e.target === id || e.target === needle || e.spec === id || String(e.target || "").startsWith(needle),
  );
  if (!matched.length) {
    console.log(`No audit events for ${id}`);
    return;
  }
  for (const e of matched) {
    console.log(
      `${e.timestamp}  ${e.id}  ${e.action}  ${e.target}${e.revision != null ? ` rev=${e.revision}` : ""}${e.spec ? ` spec=${e.spec}` : ""}  actor=${e.actor.type}:${e.actor.id}`,
    );
  }
}

function cmdWhy(filePath) {
  if (!filePath) {
    console.error("usage: ledger why <path>");
    process.exit(1);
  }
  const norm = filePath.replace(/^\.\//, "");
  const g = graph();
  const hitTasks = g.tasks
    .filter((t) => fileMatches(t.meta.files, norm) || t.body.includes(norm))
    .sort((a, b) => String(b.meta.id).localeCompare(String(a.meta.id)));
  const hitChanges = g.changes
    .filter((c) => fileMatches(c.meta.files, norm) || c.body.includes(norm))
    .sort((a, b) => String(b.meta.id).localeCompare(String(a.meta.id)));
  console.log(`FILE\n  ${norm}\n`);
  if (!hitTasks.length && !hitChanges.length) {
    console.log("STATUS\n  ⚠️  NOT TRACED in Project Ledger\n");
    return;
  }
  const task = hitTasks[0];
  const change = hitChanges[0];
  // Prefer chain from newest task when available
  const chain = resolveChain(g, task || null, change || null);
  if (chain.req) console.log(`REQUIREMENT\n  ${chain.req.meta.id} — ${chain.req.meta.title}\n`);
  if (chain.epic) console.log(`EPIC\n  ${chain.epic.meta.id} — ${chain.epic.meta.title}\n`);
  if (chain.specRef) {
    console.log(`SPEC\n  ${chain.specRef}`);
    if (chain.spec && Number(chain.spec.meta.current_revision) > chain.rev) {
      console.log(`  (current ${chain.specId}@${chain.spec.meta.current_revision})`);
    }
    console.log("");
  }
  if (chain.adrs.length) {
    console.log("ARCHITECTURE");
    for (const a of chain.adrs) console.log(`  ${a.meta.id} — ${a.meta.title}`);
    console.log("");
  }
  if (chain.plan) console.log(`PLAN\n  ${chain.plan.meta.id} — ${chain.plan.meta.title}\n`);
  if (task) console.log(`TASK\n  ${task.meta.id} — ${task.meta.title}\n`);
  if (chain.run) {
    console.log(`AGENT RUN\n  ${chain.run.meta.id} (${chain.run.meta.status}) agent=${chain.run.meta.agent}\n`);
    const person = g.people.find((p) => p.id === chain.run.meta.agent);
    if (person) console.log(`AGENT\n  ${person.name} (${person.type})\n`);
  }
  if (change) console.log(`CHANGE\n  ${change.meta.id} — ${change.meta.summary || ""}\n`);
  if (asArr(change?.meta?.commits).length || asArr(chain.run?.meta?.commits).length) {
    console.log("COMMITS");
    for (const c of [...asArr(change?.meta?.commits), ...asArr(chain.run?.meta?.commits)]) console.log(`  ${c}`);
    console.log("");
  }
  if (chain.evidence.length) {
    console.log("EVIDENCE");
    for (const e of chain.evidence) console.log(`  ${e.meta.id} ${e.meta.result || ""} ${e.meta.path || ""}`);
    console.log("");
  }
  if (chain.spec && Number(chain.spec.meta.current_revision) > chain.rev) {
    console.log("STATUS\n  ⚠️  IMPLEMENTATION MAY BE OUT OF DATE\n");
  } else {
    console.log("STATUS\n  ✓ traced\n");
  }
}

function cmdWho(filePath) {
  if (!filePath) {
    console.error("usage: ledger who <path>");
    process.exit(1);
  }
  const norm = filePath.replace(/^\.\//, "");
  const g = graph();
  const { hitTasks, hitChanges } = findFileHits(g, norm);
  const actors = new Map();

  for (const t of hitTasks) {
    for (const rid of asArr(t.meta.agent_runs)) {
      const run = g.runs.find((r) => r.meta.id === rid);
      if (run?.meta?.agent) actors.set(run.meta.agent, { via: `run ${rid}`, role: "agent" });
    }
  }
  for (const c of hitChanges) {
    const run = g.runs.find((r) => r.meta.id === c.meta.agent_run);
    if (run?.meta?.agent) actors.set(run.meta.agent, { via: `change ${c.meta.id}`, role: "agent" });
  }
  for (const e of g.events) {
    if (String(e.target || "").includes(norm) || JSON.stringify(e).includes(norm)) {
      actors.set(e.actor.id, { via: `event ${e.id}`, role: e.actor.type });
    }
  }

  // Also attribute from related requirement changed_by
  for (const t of hitTasks) {
    const chain = resolveChain(g, t, null);
    if (chain.req?.meta?.changed_by) {
      actors.set(chain.req.meta.changed_by, { via: `requirement ${chain.req.meta.id}`, role: "human" });
    }
    if (chain.revisions) {
      /* noop */
    }
    const rev = g.revisions.find((r) => r.meta.id === chain.specId && r.meta.spec_revision === chain.spec?.meta?.current_revision);
    if (rev?.meta?.created_by) actors.set(rev.meta.created_by, { via: `spec ${rev.meta.id}@${rev.meta.spec_revision}`, role: "human" });
  }

  console.log(`FILE\n  ${norm}\n`);
  if (!actors.size) {
    console.log("No actors found via ledger links.\n");
    return;
  }
  console.log("ACTORS");
  for (const [id, info] of actors) {
    const person = g.people.find((p) => p.id === id);
    const label = person ? `${person.name} (${person.type})` : id;
    console.log(`  ${id}  ${label}  via ${info.via}`);
  }
  console.log("");
}

function cmdDrift() {
  const drift = computeDrift();
  if (!drift.issues.length) {
    console.log("No drift issues.");
    return;
  }
  for (const i of drift.issues) {
    console.log(`${i.level.toUpperCase().padEnd(5)} ${i.code.padEnd(22)} ${i.msg}`);
  }
  console.log(`\n${drift.issues.length} issue(s). Traced plans: ${drift.tracedFeatures}/${drift.totalPlans}`);
  if (drift.issues.some((i) => i.level === "error")) process.exit(1);
}

function cmdImpact(id) {
  if (!id) {
    console.error("usage: ledger impact <EPIC-|ADR-|REQ-|SPEC-|SOW- id>");
    process.exit(1);
  }
  const g = graph();
  const base = id.replace(/@\d+$/, "");
  console.log(`IMPACT ${id}\n`);

  if (base.startsWith("EPIC-")) {
    const epic = g.epics.find((e) => e.meta.id === base);
    if (!epic) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    console.log(`EPIC\n  ${epic.meta.id} — ${epic.meta.title}\n`);
    console.log("REQUIREMENTS");
    const reqs = [
      ...g.requirements.filter((r) => yamlScalar(r.meta.epic) === base),
      ...asArr(epic.meta.requirements)
        .map((rid) => g.requirements.find((r) => r.meta.id === rid))
        .filter(Boolean),
    ];
    const seenR = new Set();
    for (const r of reqs) {
      if (seenR.has(r.meta.id)) continue;
      seenR.add(r.meta.id);
      console.log(`  ${r.meta.id} — ${r.meta.title}`);
    }
    if (!seenR.size) console.log("  (none)");
    console.log("\nPLANS");
    const plans = [
      ...g.plans.filter((p) => yamlScalar(p.meta.epic) === base),
      ...asArr(epic.meta.plans)
        .map((pid) => g.plans.find((p) => p.meta.id === pid))
        .filter(Boolean),
    ];
    const seenP = new Set();
    for (const p of plans) {
      if (seenP.has(p.meta.id)) continue;
      seenP.add(p.meta.id);
      console.log(`  ${p.meta.id} — ${p.meta.title}`);
    }
    if (!seenP.size) console.log("  (none)");
    console.log("\nTASKS");
    const tasks = g.tasks.filter((t) => yamlScalar(t.meta.epic) === base || seenP.has(t.meta.plan));
    for (const t of tasks) console.log(`  ${t.meta.id} — ${t.meta.title}`);
    if (!tasks.length) console.log("  (none)");
    return;
  }

  if (base.startsWith("SOW-")) {
    const sowIdx = listFiles("docs/product/sow", (n) => n === "index.md").map((f) => {
      const { meta } = parseFrontmatter(read(f));
      return { path: f, meta };
    });
    const sow = sowIdx.find((s) => s.meta.id === base) || sowIdx[0];
    console.log(`SOW\n  ${base} @${sow?.meta?.current_revision ?? "?"}\n`);
    console.log("REVISIONS");
    for (const r of listFiles("docs/product/sow", (n) => /^v\d+\.md$/.test(n))) {
      const { meta } = parseFrontmatter(read(r));
      console.log(`  v${meta.sow_revision ?? "?"}  ${r}`);
    }
    console.log("\nREQUIREMENTS");
    for (const req of g.requirements.filter((r) => String(r.meta.sow || "").startsWith(base))) {
      console.log(`  ${req.meta.id} — ${req.meta.title}`);
    }
    console.log("\nSPECS");
    for (const s of g.specs.filter((s) => s.meta.sow === base || String(s.meta.sow || "").startsWith(base))) {
      console.log(`  ${s.meta.id}@${s.meta.current_revision} — ${s.meta.title}`);
    }
    return;
  }

  if (base.startsWith("ADR-")) {
    const plans = g.plans.filter((p) => asArr(p.meta.decisions).includes(base));
    console.log("PLANS");
    for (const p of plans) console.log(`  ${p.meta.id} — ${p.meta.title}`);
    if (!plans.length) console.log("  (none)");
    console.log("");
    const tasks = g.tasks.filter((t) => plans.some((p) => p.meta.id === t.meta.plan));
    console.log("TASKS");
    for (const t of tasks) console.log(`  ${t.meta.id} — ${t.meta.title}`);
    if (!tasks.length) console.log("  (none)");
    console.log("");
    const files = new Set();
    for (const t of tasks) for (const f of asArr(t.meta.files)) files.add(f);
    for (const c of g.changes) {
      if (tasks.some((t) => asArr(t.meta.agent_runs).includes(c.meta.agent_run))) {
        for (const f of asArr(c.meta.files)) files.add(f);
      }
    }
    console.log("FILES");
    for (const f of [...files].sort()) console.log(`  ${f}`);
    if (!files.size) console.log("  (none)");
    return;
  }

  if (base.startsWith("REQ-")) {
    const req = g.requirements.find((r) => r.meta.id === base);
    if (!req) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    console.log(`REQUIREMENT\n  ${req.meta.id} — ${req.meta.title}\n`);
    console.log("SPECS");
    for (const sid of asArr(req.meta.specs)) {
      const s = g.specs.find((x) => x.meta.id === sid);
      console.log(`  ${sid}@${s?.meta?.current_revision ?? "?"} — ${s?.meta?.title || ""}`);
    }
    const plans = g.plans.filter((p) => asArr(req.meta.specs).some((sid) => String(p.meta.spec || "").startsWith(sid)));
    console.log("\nPLANS");
    for (const p of plans) console.log(`  ${p.meta.id} — ${p.meta.title}`);
    return;
  }

  if (base.startsWith("SPEC-")) {
    const s = g.specs.find((x) => x.meta.id === base);
    if (!s) {
      console.error(`Unknown ${base}`);
      process.exit(1);
    }
    console.log(`SPEC\n  ${s.meta.id} @${s.meta.current_revision} — ${s.meta.title}\n`);
    console.log("REVISIONS");
    for (const r of g.revisions.filter((r) => r.meta.id === base || path.dirname(r.path).endsWith(base))) {
      console.log(`  v${r.meta.spec_revision}  ${r.path}  hash=${r.meta.content_hash || "?"}`);
    }
    console.log("\nPLANS");
    for (const p of g.plans.filter((p) => String(p.meta.spec || "").startsWith(base))) {
      console.log(`  ${p.meta.id} — ${p.meta.title} (${p.meta.spec})`);
    }
    console.log("\nRUNS");
    for (const r of g.runs.filter((r) => String(r.meta.spec || "").startsWith(base))) {
      console.log(`  ${r.meta.id} — ${r.meta.spec} (${r.meta.status})`);
    }
    return;
  }

  console.error("impact supports EPIC-*, ADR-*, REQ-*, SPEC-*, SOW-*");
  process.exit(1);
}

function cmdTimeline(nArg) {
  const n = Number(nArg || 20);
  const evs = events().slice(-n);
  console.log("Timeline\n");
  for (const e of evs) {
    const day = e.timestamp?.slice(0, 10) || "?";
    console.log(`${day}  ${e.target}`);
    console.log(`        ${e.action} — ${e.actor.type}:${e.actor.id}`);
    console.log("");
  }
}

function cmdDecisions() {
  const g = graph();
  for (const d of g.decisions) {
    console.log(`${d.meta.id}  [${d.meta.status}]  ${d.meta.title}`);
    if (d.meta.superseded_by) console.log(`  superseded_by: ${d.meta.superseded_by}`);
    if (d.meta.supersedes) console.log(`  supersedes: ${d.meta.supersedes}`);
  }
}

function cmdEvent(action, target, rest) {
  if (!action || !target) {
    console.error("usage: ledger event <action> <target> [--spec SPEC@rev] [--actor TYPE:ID]");
    process.exit(1);
  }
  let spec;
  let actor = { type: "agent", id: "AGENT-CURSOR" };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--spec") spec = rest[++i];
    if (rest[i] === "--actor") {
      const [type, id] = String(rest[++i]).split(":");
      actor = { type, id };
    }
  }
  const ev = {
    id: nextEventId(),
    timestamp: new Date().toISOString(),
    actor,
    action,
    target,
  };
  if (spec) ev.spec = spec;
  append(".audit/events.jsonl", JSON.stringify(ev));
  console.log(`appended ${ev.id}`);
}

function cmdHash(rel) {
  if (!rel) {
    console.error("usage: ledger hash <path>");
    process.exit(1);
  }
  console.log(bodyHash(rel));
}

function renderDashboard(g, drift, c) {
  const warns = drift.issues.filter((i) => i.level === "warn");
  const errs = drift.issues.filter((i) => i.level === "error");
  const timeline = g.events
    .slice(-15)
    .reverse()
    .map(
      (e) =>
        `<div class="ev"><div class="d">${esc(e.timestamp?.slice(0, 10))}</div><div class="t">${esc(e.target)}</div><div class="a">${esc(e.action)} — ${esc(e.actor.type)}:${esc(e.actor.id)}</div></div>`,
    )
    .join("");
  const issues = drift.issues
    .map((i) => `<li class="${i.level}"><code>${esc(i.code)}</code> ${esc(i.msg)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Project Ledger — ${esc(g.project.name)}</title>
<style>
  :root { --bg:#0f1419; --panel:#1a2332; --text:#e7ecf3; --muted:#9aa8bc; --ok:#3dd68c; --warn:#f5a524; --err:#f76e6e; --line:#2a3548; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:920px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:.02em; }
  .sub { color:var(--muted); margin-bottom:24px; }
  .focus { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:18px; }
  .focus h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0 0 8px; }
  .focus code { color:var(--ok); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px; margin-bottom:22px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px; }
  .card .n { font-size:28px; font-weight:700; }
  .card .l { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .flags { display:grid; gap:8px; margin-bottom:28px; }
  .flag { padding:12px 14px; border-radius:10px; border:1px solid var(--line); background:var(--panel); }
  .flag.warn { border-color:#5c4318; }
  .flag.ok { border-color:#1f4d38; }
  .flag .k { font-weight:600; }
  h2 { font-size:15px; margin:28px 0 12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
  .ev { display:grid; grid-template-columns:90px 1fr; gap:2px 14px; padding:10px 0; border-bottom:1px solid var(--line); }
  .ev .d { color:var(--muted); }
  .ev .t { font-weight:600; }
  .ev .a { grid-column:2; color:var(--muted); font-size:13px; }
  ul { padding-left:18px; }
  li.warn { color:var(--warn); }
  li.error { color:var(--err); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>PROJECT LEDGER</h1>
  <div class="sub">${esc(g.project.name)} · ${esc(g.project.id)} · v${esc(g.project.version)} · ledger ${esc(g.project.ledger_version || "0.4")}</div>
  <div class="focus">
    <h2>Active context</h2>
    <div>task <code>${esc(g.context?.current_task || "—")}</code>
    · plan <code>${esc(g.context?.current_plan || "—")}</code>
    · epic <code>${esc(g.context?.current_epic || "—")}</code>
    · spec <code>${esc(g.context?.current_spec || "—")}</code></div>
    ${g.context?.notes ? `<div class="sub" style="margin:8px 0 0">${esc(g.context.notes)}</div>` : ""}
  </div>
  <div class="grid">
    ${stat("Epics", c.epics || 0)}
    ${stat("Requirements", c.requirements)}
    ${stat("SOW Revisions", c.sow_revisions || 0)}
    ${stat("Specifications", c.specifications)}
    ${stat("Decisions", c.decisions)}
    ${stat("Plans", c.plans)}
    ${stat("Agent Runs", c.agent_runs)}
    ${stat("Spec Revisions", c.spec_revisions)}
    ${stat("Tasks", c.tasks)}
    ${stat("Events", c.events)}
  </div>
  <div class="flags">
    <div class="flag ${warns.length ? "warn" : "ok"}"><span class="k">${warns.length ? "⚠" : "✓"} ${warns.length} Drift Issues</span></div>
    <div class="flag ${errs.length ? "warn" : "ok"}"><span class="k">${errs.length ? "⚠" : "✓"} ${errs.length} Integrity Errors</span></div>
    <div class="flag ok"><span class="k">✓ ${drift.tracedFeatures} Plans Fully Traced</span></div>
  </div>
  <h2>Issues</h2>
  ${issues ? `<ul>${issues}</ul>` : "<p class='sub'>None</p>"}
  <h2>Timeline</h2>
  ${timeline || "<p class='sub'>No events</p>"}
</main>
</body>
</html>`;
}

function stat(label, n) {
  return `<div class="card"><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cmdUi(args) {
  let port = PORT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") port = Number(args[++i]);
  }
  const server = http.createServer((_req, res) => {
    try {
      const g = graph();
      const html = renderDashboard(g, computeDrift(g), counts(g));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(e.stack || e));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Project Ledger UI → http://127.0.0.1:${port}`);
  });
}

const [cmd, ...argv] = process.argv.slice(2);
switch (cmd) {
  case "init":
    cmdInit(argv);
    break;
  case "upgrade":
    cmdUpgrade();
    break;
  case "doctor":
    cmdDoctor();
    break;
  case "status":
    cmdStatus();
    break;
  case "validate":
    cmdValidate();
    break;
  case "check":
    cmdCheck();
    break;
  case "context":
    cmdContext();
    break;
  case "focus":
    cmdFocus(argv);
    break;
  case "new":
    cmdNew(argv[0], argv.slice(1));
    break;
  case "revise":
    cmdRevise(argv[0]);
    break;
  case "hooks":
    if (argv[0] === "install") cmdHooksInstall();
    else {
      console.error("usage: ledger hooks install");
      process.exit(1);
    }
    break;
  case "trace":
    cmdTrace(argv);
    break;
  case "history":
    cmdHistory(argv[0]);
    break;
  case "why":
    cmdWhy(argv[0]);
    break;
  case "who":
    cmdWho(argv[0]);
    break;
  case "drift":
    cmdDrift();
    break;
  case "impact":
    cmdImpact(argv[0]);
    break;
  case "timeline":
    cmdTimeline(argv[0]);
    break;
  case "decisions":
    cmdDecisions();
    break;
  case "event":
    cmdEvent(argv[0], argv[1], argv.slice(2));
    break;
  case "hash":
    cmdHash(argv[0]);
    break;
  case "ui":
    cmdUi(argv);
    break;
  default:
    usage();
    process.exit(cmd ? 1 : 0);
}
