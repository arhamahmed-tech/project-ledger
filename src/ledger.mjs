#!/usr/bin/env node
/**
 * Project Ledger CLI + local UI
 * project-ledger <command> [args]
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, PORT, PKG_ROOT, abs, read, write, exists, append, listFiles } from "./lib/paths.mjs";
import {
  parseFrontmatter,
  yamlScalar,
  loadContext,
  loadConventions,
  loadRules,
  saveContext,
  events,
  nextId,
  asArr,
  setFrontmatterField,
  bodyHash,
  nextEventId,
  appendAgentTrace,
  appendAuditEvent,
  hashEvent,
} from "./lib/parse.mjs";
import {
  graph,
  counts,
  fileMatches,
  findFileHits,
  resolveChain,
  computeDrift,
  computeOnboard,
} from "./lib/model.mjs";
import {
  computeTaskCodeState,
  planIsApprovedForImpl,
  evaluateDoneEvidence,
  evaluateDoneTests,
  printGateErrors,
  redactSecrets,
  normalizeResult,
} from "./lib/gates.mjs";

function usage() {
  console.log(`Project Ledger

  project-ledger init [--name my-app] [--force]
  project-ledger adopt [--name my-app]   mid-build / existing repo onboarding
  project-ledger upgrade
  project-ledger inventory               code paths not covered by TASK files
  project-ledger doctor | status | onboard | validate | check | sources | board
  project-ledger context | preflight [TASK] | next [--focus] | handoff
  project-ledger focus <id> | focus --clear
  project-ledger note <text>          append note to focused task
  project-ledger done <TASK-id>       mark done if quality rules pass
  project-ledger review               validate+check+preflight gate before PR
  project-ledger new <epic|ms|req|spec|sow|plan|task|adr|run|chg|evd|test|rel> <title>
      flags: --epic --plan --spec --req --ms|--milestone --release --status --focus
             --run --result --task --command   (evd)
  project-ledger revise <SPEC-|SOW- id>
  project-ledger hooks install | trace <note> | history | why | who | drift | impact | timeline | decisions | event | hash | ui

Lifecycle (not 13 manual steps every time):
  Setup / product change:  sources → formalize → ADR if needed → plans/tasks
  Normal task:             context → focus/next → preflight → implement → verify → done → review
  Safeguards:              hooks/CI → validate/check (bypassable locally; CI when configured)

Existing/mid-build repo:
  node /path/to/project-ledger/bin/project-ledger.js adopt --name my-app
New chat:  node scripts/ledger.mjs context   # onboard only if phase/setup unclear
Before code: node scripts/ledger.mjs preflight
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

/** Paths Cursor/agents must be able to read for Project Ledger to work. */
const LEDGER_MUST_READ = [
  "AGENTS.md",
  "docs/agent-protocol.md",
  "docs/product/sources/README.md",
  ".project/project.yaml",
  ".project/context.yaml",
  ".cursor/rules/project-ledger.mdc",
  ".cursor/hooks.json",
  "scripts/ledger.mjs",
];

function gitignorePatternMatches(pattern, relPath) {
  let p = String(pattern || "").trim();
  if (!p || p.startsWith("#") || p.startsWith("!")) return false;
  const rooted = p.startsWith("/");
  if (rooted) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  // Escape regex specials except * and ?
  let reSrc = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  if (rooted) {
    const re = new RegExp(`^${reSrc}(/|$)`);
    return re.test(relPath);
  }
  // Unrooted: match any path segment prefix or full path
  const re = new RegExp(`(^|/)${reSrc}(/|$)`);
  return re.test(relPath);
}

function collectIgnoreConflicts(ignoreFileRel) {
  if (!exists(ignoreFileRel)) return [];
  const lines = read(ignoreFileRel).split("\n");
  const issues = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    for (const must of LEDGER_MUST_READ) {
      if (gitignorePatternMatches(line, must) || gitignorePatternMatches(line, path.dirname(must))) {
        issues.push({ file: ignoreFileRel, pattern: line, blocks: must });
      }
      // blocking entire trees
      if (
        (line === ".cursor" || line === ".cursor/" || line === "/.cursor" || line === "/.cursor/") &&
        must.startsWith(".cursor/")
      ) {
        issues.push({ file: ignoreFileRel, pattern: line, blocks: must });
      }
      if ((line === "docs" || line === "docs/" || line === "/docs" || line === "/docs/") && must.startsWith("docs/")) {
        issues.push({ file: ignoreFileRel, pattern: line, blocks: must });
      }
      if (
        (line === ".project" || line === ".project/" || line === "/.project" || line === "/.project/") &&
        must.startsWith(".project/")
      ) {
        issues.push({ file: ignoreFileRel, pattern: line, blocks: must });
      }
    }
  }
  // de-dupe
  const seen = new Set();
  return issues.filter((i) => {
    const k = `${i.file}|${i.pattern}|${i.blocks}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function reportCursorIgnoreWrong({ hard = false } = {}) {
  const issues = [...collectIgnoreConflicts(".cursorignore"), ...collectIgnoreConflicts(".gitignore")].filter((i) => {
    // .gitignore ignoring scripts is often OK for build artifacts — only fail cursorignore + critical gitignore of .cursor/docs/.project/AGENTS
    if (i.file === ".gitignore" && (i.blocks.startsWith("scripts/") || i.blocks === "scripts/ledger.mjs")) return false;
    return true;
  });
  if (!issues.length) return true;
  console.error("");
  console.error("WRONG: ignore rules hide Project Ledger / Cursor adapters.");
  console.error("Cursor will not load rules or the agent cannot read the protocol.");
  console.error("Fix .cursorignore (and .gitignore if needed) — do NOT ignore:");
  console.error("  AGENTS.md  docs/  .project/  .cursor/rules/  .cursor/hooks.json  scripts/ledger.mjs");
  for (const i of issues) {
    console.error(`  - ${i.file} pattern "${i.pattern}" blocks ${i.blocks}`);
  }
  console.error("Then: node scripts/ledger.mjs doctor");
  console.error("");
  if (hard) process.exit(1);
  return false;
}

function ensureCursorIgnoreSafe() {
  // If .cursorignore exists and is wrong, leave it but report; also write un-ignore hints when creating new file
  if (!exists(".cursorignore")) return;
  // Append rescue negations only if missing and conflicts exist
  const issues = collectIgnoreConflicts(".cursorignore");
  if (!issues.length) return;
  let text = read(".cursorignore");
  const rescue = `
# --- Project Ledger (AUTO) — these must NOT be ignored by Cursor ---
!.cursor/
!.cursor/**
!AGENTS.md
!docs/
!docs/**
!.project/
!.project/**
!scripts/ledger.mjs
!scripts/.project-ledger/
!scripts/.project-ledger/**
`;
  if (!text.includes("Project Ledger (AUTO)")) {
    write(".cursorignore", text.trimEnd() + "\n" + rescue);
    console.log("Patched .cursorignore with Project Ledger un-ignore rules (was wrong to hide them).");
  }
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
  const from = path.join(PKG_ROOT, "src");
  if (!fs.existsSync(path.join(from, "ledger.mjs"))) {
    console.warn("Could not vendor CLI (src/ledger.mjs missing). Set LEDGER_PKG_ROOT.");
    return false;
  }
  const destDir = abs("scripts/.project-ledger");
  copyDir(from, destDir, { force: true });
  const wrapper = abs("scripts/ledger.mjs");
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  fs.writeFileSync(
    wrapper,
    `#!/usr/bin/env node
import "./.project-ledger/ledger.mjs";
`,
  );
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
  ok("scripts/.project-ledger/", exists("scripts/.project-ledger/ledger.mjs"), "Re-run init/upgrade to vendor modules");
  ok("gates module", exists("scripts/.project-ledger/lib/gates.mjs") || exists("src/lib/gates.mjs"), "Re-run upgrade to vendor gates.mjs");
  ok("CI workflow", exists(".github/workflows/project-ledger.yml"), "Run: project-ledger upgrade");
  ok(".project/harness/validate-on-stop.sh", exists(".project/harness/validate-on-stop.sh"));
  ok("Cursor rule", exists(".cursor/rules/project-ledger.mdc"));
  ok("find-skills (Cursor)", exists(".cursor/skills/find-skills/SKILL.md"), "Run: project-ledger init --force");
  ok("find-skills (Claude)", exists(".claude/skills/find-skills/SKILL.md"), "Run: project-ledger init --force");
  ok("Claude adapter", exists("CLAUDE.md"));
  ok("security-review", exists(".cursor/rules/security-review.mdc") || exists(".claude/rules/security-review.md"));
  ok("codebase-style", exists(".cursor/rules/codebase-style.mdc") || exists(".claude/rules/codebase-style.md"));
  ok("conventions.yaml", exists(".project/conventions.yaml"), "Run: project-ledger upgrade");
  ok("code-style doc", exists("docs/conventions/code-style.md"), "Run: project-ledger upgrade");
  ok(`scaffold at PKG_ROOT`, fs.existsSync(path.join(PKG_ROOT, "scaffold")), "npm i -D /path/to/project-ledger or LEDGER_PKG_ROOT");
  ok("docs/plans/epics", exists("docs/plans/epics"), "Run: project-ledger init --force");
  ok("docs/product/sources", exists("docs/product/sources/README.md"), "Run: project-ledger upgrade — user originals folder");

  const ignoreIssues = [
    ...collectIgnoreConflicts(".cursorignore"),
    ...collectIgnoreConflicts(".gitignore").filter(
      (i) =>
        i.blocks.startsWith(".cursor/") ||
        i.blocks.startsWith("docs/") ||
        i.blocks.startsWith(".project/") ||
        i.blocks === "AGENTS.md",
    ),
  ];
  ok(
    ".cursorignore/.gitignore allow ledger paths",
    ignoreIssues.length === 0,
    ignoreIssues.length
      ? `WRONG: ${ignoreIssues.map((i) => `${i.file}:"${i.pattern}"→${i.blocks}`).join("; ")}`
      : "",
  );

  // Only one alwaysApply Cursor rule — too many get silently ignored/downgraded
  if (exists(".cursor/rules/project-ledger.mdc")) {
    const always = listFiles(".cursor/rules", (n) => n.endsWith(".mdc")).filter((f) => {
      const t = read(f);
      return /^alwaysApply:\s*true\s*$/m.test(t);
    });
    ok(
      "single alwaysApply Cursor rule",
      always.length <= 1,
      always.length > 1
        ? `WRONG: ${always.length} alwaysApply rules (${always.join(", ")}) — Cursor often ignores/downgrades these. Keep only project-ledger.mdc as alwaysApply.`
        : "",
    );
  }

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
    reportCursorIgnoreWrong({ hard: false });
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
    console.log("Mid-build / catch up:  project-ledger upgrade");
    console.log("                or:  project-ledger adopt --name " + name);
    console.log("Fill missing only:   project-ledger init --force");
    console.log("Inventory code:      project-ledger inventory");
    return;
  }

  const n = copyDir(scaffold, ROOT, { force: false });
  // Ensure expected dirs exist even if an older tarball omitted empty folders
  for (const d of [
    "docs/product/requirements",
    "docs/product/specs",
    "docs/product/sow",
    "docs/product/sources",
    "docs/product/sources/sow",
    "docs/product/sources/specs",
    "docs/product/sources/briefs",
    "docs/product/sources/misc",
    "docs/architecture/adr",
    "docs/plans/features",
    "docs/plans/tasks",
    "docs/plans/epics",
    "docs/plans/milestones",
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
    if (!fs.existsSync(keep) && !d.startsWith(".audit") && !d.includes("schemas") && !d.includes("templates") && !d.includes("hooks") && !d.includes("rules") && !d.includes("skills")) {
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

  // If .cursorignore was hiding Cursor/ledger files, that is wrong — patch + tell the user
  ensureCursorIgnoreSafe();
  reportCursorIgnoreWrong({ hard: false });

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
    ev.event_hash = hashEvent(ev);
    fs.mkdirSync(path.dirname(evPath), { recursive: true });
    fs.writeFileSync(evPath, JSON.stringify(ev) + "\n");
  }

  console.log(`Project Ledger initialized in ${ROOT}`);
  console.log(`  project name: ${name}`);
  console.log(`  files written/kept: ${n}+ (skipped existing)`);
  console.log(`  local CLI: ${vendored ? "scripts/ledger.mjs (+ .project-ledger/)" : "NOT VENDORED"}`);
  console.log("");
  console.log("Production gates (recommended):");
  console.log("  node scripts/ledger.mjs hooks install   # pre-commit validate+check");
  console.log("  # CI workflow: .github/workflows/project-ledger.yml (already scaffolded)");
  console.log("  # Optional: LEDGER_STRICT=1 for stop-hook hard fail");
  console.log("");
  console.log("Cursor: open Settings → Rules and confirm project-ledger is Always Apply.");
  console.log("        Enable Hooks if you want stop/validate reminders.");
  console.log("        If Cursor ignored the ledger, check .cursorignore — doctor will say WRONG.");
  console.log("");
  console.log("Next:");
  console.log("  node scripts/ledger.mjs doctor");
  console.log("  node scripts/ledger.mjs context");
  console.log("  node scripts/ledger.mjs validate");
  console.log("  Edit .project/people.yaml and docs/product/vision.md");

  // auto-install git hook when repo exists
  const gitOk = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, encoding: "utf8" });
  if (gitOk.status === 0) {
    try {
      cmdHooksInstall();
    } catch {
      console.log("(skipped auto hooks install)");
    }
  }
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
  console.log(`Milestones         ${c.milestones || 0}`);
  console.log(`Requirements       ${c.requirements}`);
  const srcCount = ["sow", "specs", "briefs", "misc"].reduce((n, sub) => {
    return (
      n +
      listFiles(`docs/product/sources/${sub}`, (name) => name !== "README.md").length
    );
  }, 0);
  console.log(`Product sources    ${srcCount} (user originals under docs/product/sources/)`);
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

function cmdOnboard() {
  const g = graph();
  const o = computeOnboard(g);
  const c = o.counts;
  console.log(`PROJECT ONBOARD — ${g.project.name} (${g.project.id}) v${g.project.version}`);
  console.log(`phase: ${o.phase}\n`);
  console.log(o.headline);
  console.log("");
  console.log("Done");
  console.log(`- Project ledger bootstrapped (\`${g.project.id}\`, v${g.project.version})`);
  if (o.adopted) console.log("- Mid-build adopt checklist present (see ADOPTION-CHECKLIST.md)");
  if (o.sources.length) {
    const n = o.sources.length;
    console.log(`- ${n} product original${n === 1 ? "" : "s"}:`);
    for (const s of o.sources) console.log(`  - \`${s.path}\``);
  } else {
    console.log("- No product originals in docs/product/sources/ yet");
  }
  if (o.hasFocus) {
    const ctx = g.context;
    console.log(
      `- Focus: epic=${ctx.current_epic || "—"} plan=${ctx.current_plan || "—"} task=${ctx.current_task || "—"}`,
    );
  } else {
    console.log(
      `- No focus set; board ${o.boardEmpty ? "is empty" : "has entities"} (${c.epics} epics / ${c.milestones} milestones / ${c.plans} plans / ${c.tasks} tasks)`,
    );
  }
  if (c.sow_revisions || c.specifications || c.requirements) {
    console.log(
      `- Formal product: ${c.sow_revisions ? c.sow_revisions + " SOW rev" : "no SOW"} · ${c.requirements} REQ · ${c.specifications} SPEC`,
    );
  }
  console.log("");
  console.log("Not started (next path)");
  o.nextSteps.forEach((step, i) => console.log(`${i + 1}. ${step}`));
  console.log("");
  if (loadRules().follow_existing_codebase_style !== false) {
    console.log("Code style: read docs/conventions/code-style.md — naming per .project/conventions.yaml (e.g. camelCase variables).");
  }
  if (o.phase === "sources_only") {
    console.log("Suggested now: node scripts/ledger.mjs new sow   (derive from source — do not rewrite originals)");
    console.log("Or:             node scripts/ledger.mjs sources");
  } else if (o.phase === "active" || o.phase === "implementation") {
    console.log("Suggested now: node scripts/ledger.mjs next --focus");
  } else if (o.phase === "bootstrapped") {
    console.log("Suggested now: drop originals into docs/product/sources/ then node scripts/ledger.mjs sources");
  }
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
    "docs/product/sources",
    "docs/product/sources/sow",
    "docs/product/sources/specs",
    "docs/product/sources/briefs",
    "docs/product/sources/misc",
    "docs/architecture/adr",
    "docs/plans/epics",
    "docs/plans/milestones",
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
    ".project/conventions.yaml",
    "docs/conventions/code-style.md",
    "docs/conventions/structure.md",
  ];
  for (const p of required) if (!exists(p)) errors.push(`missing: ${p}`);

  for (const s of [
    "PROJECT",
    "PERSON",
    "EPIC",
    "MILESTONE",
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
    if (ev.event_hash && hashEvent(ev) !== ev.event_hash) {
      errors.push(`AUDIT_HASH_MISMATCH: ${ev.id} event_hash does not match payload`);
    }
    if (i > 0 && ev.prev_hash) {
      const prev = g.events[i - 1];
      const expect = prev.event_hash || hashEvent(prev);
      if (ev.prev_hash !== expect) {
        errors.push(`AUDIT_CHAIN_BREAK: ${ev.id} prev_hash does not match previous event`);
      }
    }
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
    console.error(`VALIDATE FAIL (${errors.length}) — ledger structure / reference integrity`);
    for (const e of errors) {
      console.error(`  - ${e}`);
      if (/missing:/.test(e)) console.error(`    fix: project-ledger upgrade  (or restore the path)`);
      if (/HASH_MISMATCH|CHAIN_BREAK/.test(e)) console.error(`    fix: do not rewrite history; investigate tampering or restore from git`);
      if (/missing schema|spec missing|sow missing/.test(e)) console.error(`    fix: restore artifact or re-run ledger new/revise`);
    }
    console.error("validate does not prove software works — only that ledger records are consistent.");
    process.exit(1);
  }
  console.log("VALIDATE OK — structure and reference integrity");
  console.log("(Does not prove implementation correctness or that hooks/CI ran.)");
  const c = counts(g);
  console.log(
    `entities: EPIC=${c.epics} REQ=${c.requirements} SPEC=${c.specifications} REV=${c.spec_revisions} ADR=${c.decisions} PLAN=${c.plans} TASK=${c.tasks} RUN=${c.agent_runs} EVT=${c.events}`,
  );
  const warns = drift.issues.filter((i) => i.level === "warn");
  if (warns.length) {
    console.log(`warnings: ${warns.length} (see: node scripts/ledger.mjs drift)`);
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
    console.log("  Phase + next steps: node scripts/ledger.mjs onboard");
    console.log("  Product originals: docs/product/sources/ (sow|specs|briefs|misc) — run: ledger sources");
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
  if (ctx.current_task) {
    console.log("Before coding: node scripts/ledger.mjs preflight");
  }
}

function extractOutOfScope(body) {
  if (!body) return "";
  const m = body.match(/##\s*Out of scope\b[\s\S]*?(?=\n##\s|\n#\s|$)/i)
    || body.match(/###\s*Out of scope\b[\s\S]*?(?=\n##\s|\n###\s|\n#\s|$)/i);
  return (m ? m[0] : "").trim();
}

function extractInScope(body) {
  if (!body) return "";
  const m = body.match(/###\s*In scope\b[\s\S]*?(?=\n###\s|\n##\s|\n#\s|$)/i)
    || body.match(/##\s*Scope\b[\s\S]*?(?=\n##\s|\n#\s|$)/i);
  return (m ? m[0] : "").trim();
}

function resolveDepEntity(g, depId) {
  const base = String(depId).replace(/@\d+$/, "");
  if (base.startsWith("TASK-")) return { kind: "task", ent: g.tasks.find((t) => t.meta.id === base) };
  if (base.startsWith("PLAN-")) return { kind: "plan", ent: g.plans.find((p) => p.meta.id === base) };
  if (base.startsWith("SPEC-")) return { kind: "spec", ent: g.specs.find((s) => s.meta.id === base) };
  if (base.startsWith("REQ-")) return { kind: "req", ent: g.requirements.find((r) => r.meta.id === base) };
  if (base.startsWith("ADR-")) return { kind: "adr", ent: g.decisions.find((d) => d.meta.id === base) };
  if (base.startsWith("EPIC-")) return { kind: "epic", ent: g.epics.find((e) => e.meta.id === base) };
  if (base.startsWith("MS-")) return { kind: "milestone", ent: (g.milestones || []).find((m) => m.meta.id === base) };
  return { kind: "unknown", ent: null };
}

function cmdPreflight(taskIdArg) {
  const g = graph();
  const ctx = g.context;
  const taskId = taskIdArg || ctx.current_task;
  console.log("PREFLIGHT — before coding\n");
  if (!taskId) {
    console.error("FAIL  no task — run: ledger focus TASK-####   or: ledger preflight TASK-####");
    process.exit(1);
  }

  const errors = [];
  const warns = [];
  const checks = [];

  const task = g.tasks.find((t) => t.meta.id === taskId);
  if (!task) {
    console.error(`FAIL  unknown ${taskId}`);
    process.exit(1);
  }
  checks.push(`task ${task.meta.id} — ${task.meta.title || ""} [${task.meta.status}]`);

  if (task.meta.status === "blocked") {
    errors.push("TASK_BLOCKED: status is blocked — unblock or pick another task");
  }
  if (task.meta.status === "cancelled") {
    errors.push("TASK_CANCELLED: do not implement a cancelled task");
  }
  if (task.meta.status === "done") {
    warns.push("TASK_DONE: task already done — confirm this is a follow-up before editing");
  }

  const rules = g.rules || {};
  const planId = task.meta.plan;
  if (!planId) {
    errors.push("NO_PLAN: task has no plan — link a PLAN before coding");
  }
  const plan = g.plans.find((p) => p.meta.id === planId);
  if (planId && !plan) {
    errors.push(`PLAN_MISSING: ${planId} not found`);
  } else if (plan) {
    checks.push(`plan ${plan.meta.id} — ${plan.meta.title || ""} [${plan.meta.status}]`);
    const appr = planIsApprovedForImpl(plan, rules);
    if (!appr.ok) {
      errors.push({
        code: "PLAN_NOT_APPROVED",
        msg: `${plan.meta.id} status=${appr.status} — SPEC pin is not approval (rules.implementation_requires_approval)`,
        fix: appr.fix || `set status: approved on ${plan.path}`,
      });
    } else if (rules.implementation_requires_approval !== false) {
      checks.push(`plan approval: ${plan.meta.status} (SPEC existence alone is not approval)`);
    }
  }

  const specRef = plan?.meta?.spec || ctx.current_spec;
  if (rules.implementation_requires_spec !== false) {
    if (!specRef || !String(specRef).includes("@")) {
      errors.push("NO_SPEC_PIN: plan/task has no SPEC@rev — set plan.spec before coding");
    } else {
      const [sid, revS] = String(specRef).split("@");
      const rev = Number(revS);
      const spec = g.specs.find((s) => s.meta.id === sid);
      if (!spec) {
        errors.push(`SPEC_MISSING: ${sid} not found — check docs/product/specs/ and sources/specs/`);
      } else {
        checks.push(`spec ${sid}@${rev} (current ${spec.meta.current_revision}) — ${spec.meta.title || ""}`);
        const revPath = path.join(path.dirname(spec.path), `v${rev}.md`);
        const currentPath = path.join(path.dirname(spec.path), `v${spec.meta.current_revision}.md`);
        if (!exists(revPath)) {
          errors.push(`SPEC_REV_MISSING: ${revPath}`);
        } else {
          checks.push(`spec body: ${revPath}`);
          const { body } = parseFrontmatter(read(revPath));
          const out = extractOutOfScope(body);
          const inn = extractInScope(body);
          if (!out && !/out of scope/i.test(body)) {
            warns.push("SCOPE_SECTION_MISSING: SPEC has no Out of scope section — ask user before expanding scope");
          } else if (out) {
            console.log("OUT OF SCOPE (from SPEC — do not implement these)\n");
            console.log(out.split("\n").map((l) => `  ${l}`).join("\n"));
            console.log("");
          }
          if (inn) {
            console.log("IN SCOPE (from SPEC)\n");
            console.log(inn.split("\n").slice(0, 40).map((l) => `  ${l}`).join("\n"));
            if (inn.split("\n").length > 40) console.log("  …");
            console.log("");
          }
          console.log("EDGE CASE: If the user prompt asks for something in Out of scope → STOP and confirm with the user.");
          console.log("EDGE CASE: If it depends on another system/task not listed → add depends_on or create a blocker task.\n");
        }
        if (Number(spec.meta.current_revision) > rev) {
          warns.push(
            `STALE_SPEC_PIN: plan pins ${specRef} but current is ${sid}@${spec.meta.current_revision} — re-read current revision or revise the plan`,
          );
          if (exists(currentPath)) checks.push(`current spec body: ${currentPath}`);
        }
      }
    }
  }

  // Dependencies
  const deps = asArr(task.meta.depends_on);
  if (!deps.length) {
    warns.push("NO_DEPENDS_ON: depends_on is empty — confirm nothing else must finish first");
  } else {
    console.log("DEPENDENCIES\n");
    for (const dep of deps) {
      const { kind, ent } = resolveDepEntity(g, dep);
      if (!ent) {
        errors.push(`DEP_MISSING: ${dep} not found`);
        console.log(`  ✗ ${dep} (missing)`);
        continue;
      }
      const st = ent.meta.status || "n/a";
      const okStatuses =
        kind === "task"
          ? ["done"]
          : kind === "adr"
            ? ["accepted"]
            : kind === "req"
              ? ["active", "done"]
              : kind === "plan"
                ? ["approved", "in_progress", "done"]
                : kind === "epic"
                  ? ["active", "done"]
                  : ["draft", "approved", "active", "done"];
      const ready = kind === "spec" ? true : okStatuses.includes(st);
      console.log(`  ${ready ? "✓" : "✗"} ${ent.meta.id} [${st}] (${kind})`);
      if (!ready) {
        if (kind === "task" && st !== "done") {
          errors.push(`DEP_NOT_READY: ${dep} status=${st} — finish or unblock before this task`);
        } else if (kind === "adr" && st === "proposed") {
          errors.push(`DEP_ADR_UNRESOLVED: ${dep} is still proposed — get acceptance before coding`);
        } else {
          warns.push(`DEP_STATUS: ${dep} status=${st} — confirm it is safe to proceed`);
        }
      }
    }
    console.log("");
  }

  // ADRs on plan
  if (plan) {
    for (const did of asArr(plan.meta.decisions)) {
      const adr = g.decisions.find((d) => d.meta.id === did);
      if (!adr) errors.push(`PLAN_ADR_MISSING: ${did}`);
      else if (adr.meta.status === "proposed") {
        if (rules.implementation_requires_approval !== false) {
          errors.push({
            code: "ADR_PROPOSED",
            msg: `${did} still proposed — unresolved decision blocks implementation when approval is required`,
            fix: `accept the ADR (status: accepted) or remove it from plan.decisions before coding`,
          });
        } else {
          warns.push(`ADR_PROPOSED: ${did} still proposed — risky to implement against it`);
        }
      }
    }
  }

  if (yamlScalar(task.meta.out_of_scope_risk)) {
    warns.push(`OUT_OF_SCOPE_RISK noted on task: ${task.meta.out_of_scope_risk}`);
  }

  if (!asArr(task.meta.files).length) {
    warns.push(
      "TASK_FILES_EMPTY: files: [] — list paths you will edit so check/done can prove traceability and evidence freshness",
    );
  }

  // Sources hint
  const srcFiles = ["sow", "specs", "briefs", "misc"].flatMap((sub) =>
    listFiles(`docs/product/sources/${sub}`, (n) => n !== "README.md"),
  );
  if (!srcFiles.length) {
    warns.push("NO_PRODUCT_SOURCES: docs/product/sources/ is empty — confirm formal SPEC/SOW still match user intent");
  }

  if (rules.follow_existing_codebase_style !== false) {
    printStyleConventions({ hard: false, warns });
  }

  console.log("CHECKS");
  for (const c of checks) console.log(`  · ${c}`);
  console.log("");
  for (const w of warns) console.log(`WARN  ${w}`);
  if (errors.length) {
    console.error(`\nPREFLIGHT FAIL (${errors.length}) — do not start coding`);
    for (const e of errors) {
      if (typeof e === "string") {
        console.error(`  - ${e}`);
        continue;
      }
      console.error(`  - ${e.code || "ERROR"}: ${e.msg || e}`);
      if (e.fix) console.error(`    fix: ${e.fix}`);
    }
    console.error("\nRecovery: fix the field/artifact above, then: node scripts/ledger.mjs preflight");
    console.error("Preflight checks readiness only — it does not prove later code is correct or in scope.");
    process.exit(1);
  }
  console.log("\nPREFLIGHT OK — prerequisites look ready; implement within SPEC scope only.");
  console.log("Limits: preflight does not verify your later implementation, and local hooks can be bypassed.");
  console.log("If the prompt conflicts with Out of scope or missing deps → ask the user, do not invent scope.");
  console.log("Match code style: read docs/conventions/code-style.md and adjacent files (camelCase etc. per .project/conventions.yaml).");
}

function printStyleConventions({ hard = false, warns = null, errors = null } = {}) {
  const rules = loadRules();
  if (rules.follow_existing_codebase_style === false) return;
  const conv = loadConventions();
  const styleDoc = conv?.codeStyleDoc || "docs/conventions/code-style.md";
  const structDoc = conv?.structureDoc || "docs/conventions/structure.md";
  console.log("CODE STYLE (mandatory before editing application code)\n");
  if (!exists(styleDoc)) {
    const msg = `STYLE_DOC_MISSING: ${styleDoc} — add conventions or run project-ledger upgrade`;
    if (hard && errors) errors.push(msg);
    else if (warns) warns.push(msg);
    console.log(`  ⚠ ${msg}\n`);
    return;
  }
  console.log(`  Read: ${styleDoc}`);
  if (exists(structDoc)) console.log(`  Read: ${structDoc}`);
  if (conv?.naming && Object.keys(conv.naming).length) {
    console.log("  Naming:");
    for (const [k, v] of Object.entries(conv.naming)) console.log(`    ${k}: ${v}`);
  } else {
    console.log("  Naming: variables/functions camelCase · classes PascalCase · constants UPPER_SNAKE_CASE · files kebab-case");
  }
  console.log("  Rule: match adjacent files — do not introduce a second style or new folder layout without ADR.\n");
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
  appendAuditEvent({
    timestamp: ctx.updated_at,
    actor: { type: actor.split(":")[0] || "agent", id: actor.split(":")[1] || actor },
    action: "context.focus",
    target: base,
  });
  appendAgentTrace({ action: "focus", target: base, notes: ctx.notes });
  console.log(`focused ${base}`);
  cmdContext();
}

function parseNewFlags(rest) {
  const flags = {
    epic: null,
    plan: null,
    spec: null,
    req: null,
    milestone: null,
    release: null,
    status: null,
    focus: false,
    actor: "agent:ledger",
    run: null,
    result: null,
    task: null,
    command: null,
  };
  const titleParts = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--epic") flags.epic = rest[++i];
    else if (a === "--plan") flags.plan = rest[++i];
    else if (a === "--spec") flags.spec = rest[++i];
    else if (a === "--req") flags.req = rest[++i];
    else if (a === "--ms" || a === "--milestone") flags.milestone = rest[++i];
    else if (a === "--release") flags.release = rest[++i];
    else if (a === "--status") flags.status = rest[++i];
    else if (a === "--actor") flags.actor = rest[++i];
    else if (a === "--run") flags.run = rest[++i];
    else if (a === "--result") flags.result = rest[++i];
    else if (a === "--task") flags.task = rest[++i];
    else if (a === "--command") flags.command = rest[++i];
    else if (a === "--focus") flags.focus = true;
    else titleParts.push(a);
  }
  return { title: titleParts.join(" ").trim(), flags };
}



function cmdNew(kind, rest) {
  if (!kind) {
    console.error("usage: ledger new <epic|ms|req|spec|sow|plan|task|adr|run|chg|evd|test|rel> <title> [flags]");
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
  } else if (kind === "ms" || kind === "milestone") {
    id = nextId("MS", g.milestones || []);
    const epic = flags.epic || ctx.current_epic || "null";
    rel = `docs/plans/milestones/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "planned"}
epic: ${epic}
target_date: null
tasks: []
plans: []
release: ${flags.release || "null"}
---

# ${id} — ${title}

## Goal

…

## Exit criteria

- [ ] …
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
    appendAuditEvent({
      timestamp: now,
      actor: { type: flags.actor.split(":")[0] || "agent", id: flags.actor.split(":")[1] || flags.actor },
      action: "entity.created.spec",
      target: id,
    });
    appendAgentTrace({ action: "new.spec", target: id, path: indexRel });
    console.log(`created ${indexRel}`);
    console.log(`created ${revRel} (hash ${hash})`);
    console.log("Reminder: derive from docs/product/sources/specs/ (do not rewrite user originals).");
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
    appendAuditEvent({
      timestamp: now,
      actor: { type: flags.actor.split(":")[0] || "agent", id: flags.actor.split(":")[1] || flags.actor },
      action: "entity.created.sow",
      target: id,
    });
    appendAgentTrace({ action: "new.sow", target: id, path: indexRel });
    console.log(`created ${indexRel}`);
    console.log(`created ${revRel} (hash ${hash})`);
    console.log("Reminder: derive from docs/product/sources/sow/ (do not rewrite user originals).");
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
milestone: ${flags.milestone || "null"}
release: ${flags.release || "null"}
depends_on: []
blocks: []
out_of_scope_risk: null
agent_runs: []
files: []
---

# ${id}

## Intent

${title}

## Spec check (required before coding)

- [ ] Read pinned SPEC@rev on the plan
- [ ] Confirm request is **in scope**
- [ ] Confirm \`depends_on\` are done/unblocked
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
    const runId = flags.run || "null";
    const taskId = flags.task || ctx.current_task || "null";
    const result = normalizeResult(flags.result || "not_run");
    const taskEnt = taskId && taskId !== "null" ? g.tasks.find((t) => t.meta.id === taskId) : null;
    const state = taskEnt ? computeTaskCodeState(taskEnt) : { hash: "no-files", gitHead: null };
    const command = flags.command || title;
    body = `---
id: ${id}
title: ${title}
kind: test
agent_run: ${runId}
task: ${taskId}
command: ${JSON.stringify(String(command))}
result: ${result}
code_state: ${state.hash}
git_head: ${state.gitHead || "null"}
path: .engineering/evidence/${id}.md
recorded_at: ${now}
---

# ${id}

## Verification

- command: ${command}
- result: ${result}
- code_state: ${state.hash} (hash of task.files working tree; ledger metadata excluded)

## Output (redacted)

${redactSecrets("(attach or paste relevant output here)")}
`;
  } else if (kind === "test") {
    id = nextId("TEST", g.tests);
    rel = `.engineering/tests/${id}.md`;
    body = `---
id: ${id}
title: ${title}
status: ${flags.status || "planned"}
spec: ${flags.spec || ctx.current_spec || "null"}
task: ${flags.task || ctx.current_task || "null"}
result: not_run
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
status: ${flags.status || "planned"}
version: 0.0.0
milestone: ${flags.milestone || "null"}
tasks: []
evidence: []
changes: []
released_at: null
---

# ${id}

${title}
`;
  } else {
    console.error("unknown kind; use epic|ms|req|spec|sow|plan|task|adr|run|chg|evd|test|rel");
    process.exit(1);
  }

  if (exists(rel)) {
    console.error(`already exists: ${rel}`);
    process.exit(1);
  }
  write(rel, body);
  if (kind === "evd") {
    const runId = flags.run;
    const taskId = flags.task || ctx.current_task;
    if (runId && exists(`.engineering/agent-runs/${runId}.md`)) {
      let runText = read(`.engineering/agent-runs/${runId}.md`);
      const { meta } = parseFrontmatter(runText);
      const evs = asArr(meta.evidence);
      if (!evs.includes(id)) {
        evs.push(id);
        runText = setFrontmatterField(runText, "evidence", `[${evs.join(", ")}]`);
        write(`.engineering/agent-runs/${runId}.md`, runText);
        console.log(`linked ${id} → ${runId}.evidence`);
      }
    }
    if (taskId && exists(`docs/plans/tasks/${taskId}.md`)) {
      let taskText = read(`docs/plans/tasks/${taskId}.md`);
      const { meta } = parseFrontmatter(taskText);
      const runs = asArr(meta.agent_runs);
      if (runId && !runs.includes(runId)) {
        runs.push(runId);
        taskText = setFrontmatterField(taskText, "agent_runs", `[${runs.join(", ")}]`);
        write(`docs/plans/tasks/${taskId}.md`, taskText);
        console.log(`linked ${runId} → ${taskId}.agent_runs`);
      }
    }
    const result = normalizeResult(flags.result || "not_run");
    if (result === "not_run") console.log("note: result=not_run — will not satisfy done until re-recorded as pass");
    if (result === "fail") console.log("note: result=fail — will not satisfy done");
    if (result === "blocked") console.log("note: result=blocked — will not satisfy done");
  }
  appendAuditEvent({
    timestamp: now,
    actor: { type: flags.actor.split(":")[0] || "agent", id: flags.actor.split(":")[1] || flags.actor },
    action: `entity.created.${kind}`,
    target: id,
  });
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
    appendAuditEvent({
      timestamp: now,
      actor: { type: "agent", id: "ledger" },
      action: "spec.revised",
      target: base,
      revision: next,
    });
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
    appendAuditEvent({
      timestamp: now,
      actor: { type: "agent", id: "ledger" },
      action: "sow.revised",
      target: meta.id || base,
      revision: next,
    });
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
    "scripts/.project-ledger/",
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
    console.error(`CHECK FAIL (${errors.length}) — untraced implementation files`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error("\nfix: add path to TASK frontmatter files: [] or create a CHG covering these files.");
    console.error("Then: node scripts/ledger.mjs check");
    process.exit(1);
  }
  console.log(`CHECK OK — ${codeFiles.length} file(s) traced to tasks/changes`);
  console.log("(Traceability of paths only — not proof that tests passed.)");
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
  for (const d of [
    "docs/plans/epics",
    "docs/plans/milestones",
    "docs/product/sources",
    "docs/product/sources/sow",
    "docs/product/sources/specs",
    "docs/product/sources/briefs",
    "docs/product/sources/misc",
    ".cursor/skills",
    ".claude/skills",
    ".github/workflows",
  ]) {
    fs.mkdirSync(abs(d), { recursive: true });
  }
  // refresh always-overwrite critical agent policy + CLI
  for (const rel of [
    "AGENTS.md",
    "docs/agent-protocol.md",
    "docs/product/sources/README.md",
    "docs/product/sources/sow/README.md",
    "docs/product/sources/specs/README.md",
    "docs/product/sources/briefs/README.md",
    "docs/product/sources/misc/README.md",
    "docs/plans/milestones/README.md",
    ".project/templates/TASK.md",
    ".project/templates/MILESTONE.md",
    ".project/schemas/TASK.json",
    ".project/schemas/MILESTONE.json",
    ".project/schemas/RELEASE.json",
    ".project/schemas/EVIDENCE.json",
    ".project/templates/EVIDENCE.md",
    ".project/model.yaml",
    ".cursor/rules/project-ledger.mdc",
    ".cursor/rules/agent-toolkit.mdc",
    ".cursor/rules/codebase-style.mdc",
    ".cursor/rules/security-review.mdc",
    ".project/conventions.yaml",
    "docs/conventions/code-style.md",
    "docs/conventions/structure.md",
    ".claude/rules/project-ledger.md",
    ".github/copilot-instructions.md",
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
  console.log("");
  console.log("Migration notes (0.11 → 0.12):");
  console.log("  - Shared gates: scripts/.project-ledger/lib/gates.mjs must be committed");
  console.log("  - Plan draft blocks preflight/done when implementation_requires_approval (default)");
  console.log("  - Evidence needs result=pass + code_state; re-record legacy EVD without code_state");
  console.log("  - Prefer: ledger new evd \"…\" --run RUN-#### --result pass --task TASK-####");
  console.log("Next: node scripts/ledger.mjs doctor && node scripts/ledger.mjs validate");
}

/** Mid-build / existing project: scaffold without clobbering, seed sources, inventory. */
function cmdAdopt(args) {
  const nameIdx = args.indexOf("--name");
  const name =
    (nameIdx >= 0 && args[nameIdx + 1]) ||
    path.basename(ROOT) ||
    "my-project";

  console.log(`ADOPT — mid-build / existing project → Project Ledger\n`);
  console.log(`ROOT  ${ROOT}`);
  console.log(`name  ${name}\n`);

  // 1) Ensure ledger present (never overwrite existing files)
  if (!exists(".project/project.yaml")) {
    console.log("Step 1: init (fill scaffold, skip existing files)…");
    cmdInit(["--name", name, "--force"]);
  } else {
    console.log("Step 1: already initialized — running upgrade…");
    cmdUpgrade();
  }

  // 2) Seed sources from existing product docs (copy, never move/overwrite user originals in place)
  console.log("\nStep 2: seed docs/product/sources/ from existing docs (copy only)…");
  const seedPairs = [
    ["README.md", "docs/product/sources/briefs/imported-README.md"],
    ["CONTRIBUTING.md", "docs/product/sources/briefs/imported-CONTRIBUTING.md"],
    ["docs/README.md", "docs/product/sources/misc/imported-docs-README.md"],
  ];
  // Heuristic: common product doc names anywhere under docs/ (except ledger-owned trees)
  const skipPrefixes = [
    "docs/product/sources/",
    "docs/product/specs/",
    "docs/product/sow/",
    "docs/product/requirements/",
    "docs/plans/",
    "docs/architecture/adr/",
    "docs/agent-protocol.md",
  ];
  let seeded = 0;
  for (const [from, to] of seedPairs) {
    if (exists(from) && !exists(to)) {
      fs.mkdirSync(path.dirname(abs(to)), { recursive: true });
      fs.copyFileSync(abs(from), abs(to));
      console.log(`  + ${from} → ${to}`);
      seeded++;
    }
  }
  if (exists("docs")) {
    for (const f of listFiles("docs", (n) => /\.(md|txt|pdf)$/i.test(n))) {
      if (skipPrefixes.some((p) => f === p || f.startsWith(p))) continue;
      if (f === "docs/product/vision.md") continue;
      const base = path.basename(f);
      const lower = base.toLowerCase();
      let destDir = "docs/product/sources/misc";
      if (/sow|statement.of.work|contract|msa/.test(lower)) destDir = "docs/product/sources/sow";
      else if (/spec|prd|product.?spec|requirements?/.test(lower)) destDir = "docs/product/sources/specs";
      else if (/brief|discovery|one.?pager|rfc/.test(lower)) destDir = "docs/product/sources/briefs";
      const dest = `${destDir}/imported-${base}`;
      if (!exists(dest)) {
        fs.mkdirSync(path.dirname(abs(dest)), { recursive: true });
        fs.copyFileSync(abs(f), abs(dest));
        console.log(`  + ${f} → ${dest}`);
        seeded++;
      }
    }
  }
  if (!seeded) console.log("  (no extra docs found to seed — drop originals into docs/product/sources/ manually)");

  // 3) Adoption checklist
  const checklist = `docs/product/sources/briefs/ADOPTION-CHECKLIST.md`;
  if (!exists(checklist)) {
    write(
      checklist,
      `# Mid-project adoption checklist

Generated by \`ledger adopt\` for **${name}**.

## Do this once

- [ ] Review files under \`docs/product/sources/\` (imported copies — originals untouched)
- [ ] Write formal SOW/SPEC from sources: \`ledger new sow\` / \`ledger new spec --req …\`
- [ ] Create an epic for remaining work: \`ledger new epic "Stabilize ${name}"\`
- [ ] Break mid-build work into tasks with \`files:\` listing real paths (\`ledger inventory\` helps)
- [ ] \`ledger hooks install\` + keep CI workflow
- [ ] \`ledger doctor\` + \`ledger validate\`

## Rules while adopting

1. Do **not** rewrite user originals in \`sources/\`.
2. New code changes need a TASK with \`files:\` or \`ledger check\` will fail.
3. Before coding: \`ledger preflight\`. Before PR: \`ledger review\`.
`,
    );
    console.log(`  + ${checklist}`);
  }

  // 4) Bootstrap epic if none
  const g = graph();
  if (!g.epics.length) {
    console.log("\nStep 3: bootstrap epic for mid-build…");
    cmdNew("epic", [`Adopt ledger for ${name}`, "--status", "active"]);
  } else {
    console.log("\nStep 3: epics already exist — skip bootstrap epic");
  }

  // 5) Focus + notes
  const g2 = graph();
  const epic = g2.epics[0];
  if (epic) {
    saveContext({
      ...loadContext(),
      current_epic: epic.meta.id,
      notes: `Mid-build adopt of ${name} — see docs/product/sources/briefs/ADOPTION-CHECKLIST.md`,
      updated_at: new Date().toISOString(),
      updated_by: "agent:ledger",
    });
  }

  // 6) Inventory
  console.log("\nStep 4: code inventory (untraced paths)…");
  cmdInventory();

  console.log("\n=== ADOPT COMPLETE — next ===");
  console.log("  1. Read docs/product/sources/briefs/ADOPTION-CHECKLIST.md");
  console.log("  2. node scripts/ledger.mjs onboard");
  console.log("  3. node scripts/ledger.mjs new sow \"…\" / new spec \"…\" --req …");
  console.log("  4. Create TASK files with files: [src/…] for areas you still touch");
  console.log("  5. node scripts/ledger.mjs hooks install");
  console.log("  6. node scripts/ledger.mjs doctor");
  appendAuditEvent({
    actor: { type: "agent", id: "ledger" },
    action: "project.adopted",
    target: "PROJECT-001",
  });
}

function cmdInventory() {
  const g = graph();
  const skip = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
    "vendor",
    "scripts",
    "docs",
    ".project",
    ".engineering",
    ".audit",
    ".agent-trace",
    ".cursor",
    ".claude",
    ".github",
    "scaffold",
    "test",
    "tests",
    "__tests__",
  ]);
  const roots = [];
  if (fs.existsSync(ROOT)) {
    for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith(".") && ![".project"].includes(ent.name)) {
        if (skip.has(ent.name)) continue;
      }
      if (skip.has(ent.name)) continue;
      roots.push(ent.name);
    }
  }

  const traced = new Set();
  for (const t of g.tasks) {
    for (const f of asArr(t.meta.files)) {
      const top = String(f).replace(/^\.\//, "").split("/")[0];
      if (top) traced.add(top);
    }
  }
  for (const c of g.changes) {
    for (const f of asArr(c.meta.files)) {
      const top = String(f).replace(/^\.\//, "").split("/")[0];
      if (top) traced.add(top);
    }
  }

  console.log("INVENTORY — top-level dirs vs TASK/CHG files:\n");
  let untraced = 0;
  for (const d of roots.sort()) {
    const ok = traced.has(d) || [...traced].some((t) => t === d || d.startsWith(t));
    // also: any file under d mentioned
    const hit = g.tasks.some((t) => asArr(t.meta.files).some((f) => String(f).startsWith(d + "/"))) ||
      g.changes.some((c) => asArr(c.meta.files).some((f) => String(f).startsWith(d + "/")));
    if (ok || hit) console.log(`  ✓  ${d}/  (traced)`);
    else {
      console.log(`  ✗  ${d}/  (no TASK/CHG files: yet — mid-build: add a task covering this)`);
      untraced++;
    }
  }
  if (!roots.length) console.log("  (no top-level code dirs found)");
  console.log(`\n${untraced} untraced dir(s). Tip: ledger new task "Cover ${roots[0] || "src"}" --plan PLAN-#### then set files: [${roots[0] || "src"}/]`);
  return untraced;
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

function cmdSources() {
  console.log("PRODUCT SOURCES (user-provided originals)\n");
  console.log("Path: docs/product/sources/{sow,specs,briefs,misc}/");
  console.log("Rule: do not rewrite these — derive formal SOW/SPEC with ledger new/revise.\n");
  let total = 0;
  for (const sub of ["sow", "specs", "briefs", "misc"]) {
    const dir = `docs/product/sources/${sub}`;
    if (!exists(dir)) {
      console.log(`${sub}/  (missing — run: project-ledger upgrade)`);
      continue;
    }
    const files = listFiles(dir, (name) => name !== "README.md");
    console.log(`${sub}/  (${files.length})`);
    for (const f of files) console.log(`  - ${f}`);
    if (!files.length) console.log("  (empty — drop originals here)");
    total += files.length;
  }
  console.log(`\n${total} source file(s). Formal ledger SOW/SPEC stay the implementation source of truth.`);
}

function taskDepsReady(g, task) {
  const problems = [];
  for (const dep of asArr(task.meta.depends_on)) {
    const { kind, ent } = resolveDepEntity(g, dep);
    if (!ent) {
      problems.push(`missing ${dep}`);
      continue;
    }
    const st = ent.meta.status || "n/a";
    if (kind === "task" && st !== "done") problems.push(`${dep} status=${st}`);
    if (kind === "adr" && st === "proposed") problems.push(`${dep} still proposed`);
  }
  return problems;
}

function cmdNext(args) {
  const focus = args.includes("--focus");
  const g = graph();
  const candidates = g.tasks
    .filter((t) => ["todo", "in_progress"].includes(t.meta.status))
    .map((t) => ({ task: t, blockers: taskDepsReady(g, t) }))
    .filter((x) => !x.blockers.length);
  candidates.sort((a, b) => {
    const rank = (s) => (s === "in_progress" ? 0 : 1);
    return rank(a.task.meta.status) - rank(b.task.meta.status) || String(a.task.meta.id).localeCompare(String(b.task.meta.id));
  });
  console.log("NEXT READY TASKS (deps satisfied)\n");
  if (!candidates.length) {
    console.log("  (none) — unblock depends_on or create a task");
    process.exit(0);
  }
  for (const { task } of candidates.slice(0, 10)) {
    console.log(`  ${task.meta.id}  [${task.meta.status}]  ${task.meta.title || ""}`);
    console.log(`    plan=${task.meta.plan || "—"}  ms=${yamlScalar(task.meta.milestone) || "—"}  path=${task.path}`);
  }
  const top = candidates[0].task;
  console.log(`\nSuggested: ${top.meta.id}`);
  if (focus) {
    cmdFocus([top.meta.id, "--notes", "auto-focused by ledger next"]);
  } else {
    console.log(`Focus: node scripts/ledger.mjs focus ${top.meta.id}`);
    console.log(`Then:  node scripts/ledger.mjs preflight`);
  }
}

function cmdHandoff() {
  const g = graph();
  const ctx = g.context;
  console.log("=== PROJECT LEDGER HANDOFF (paste into new chat) ===\n");
  console.log("1) Run: node scripts/ledger.mjs context");
  console.log("2) Run: node scripts/ledger.mjs preflight");
  console.log("3) Work only within SPEC scope; ask if out-of-scope or deps missing.\n");
  console.log("FOCUS");
  console.log(`  epic=${ctx.current_epic || "—"} plan=${ctx.current_plan || "—"} task=${ctx.current_task || "—"}`);
  console.log(`  spec=${ctx.current_spec || "—"} req=${ctx.current_req || "—"}`);
  if (ctx.notes) console.log(`  notes=${ctx.notes}`);
  if (ctx.current_task) {
    const task = g.tasks.find((t) => t.meta.id === ctx.current_task);
    if (task) {
      console.log(`\nTASK ${task.meta.id} — ${task.meta.title || ""} [${task.meta.status}]`);
      console.log(`  path: ${task.path}`);
      console.log(`  depends_on: ${asArr(task.meta.depends_on).join(", ") || "(none)"}`);
      console.log(`  files: ${asArr(task.meta.files).join(", ") || "(none)"}`);
    }
  }
  console.log("\nSOURCES: node scripts/ledger.mjs sources");
  console.log("BOARD:   node scripts/ledger.mjs board");
  console.log("DONE:    node scripts/ledger.mjs done TASK-####");
  console.log("REVIEW:  node scripts/ledger.mjs review");
  console.log("\n=== END HANDOFF ===");
}

function cmdNote(args) {
  const text = args.join(" ").trim();
  if (!text) {
    console.error("usage: ledger note <text>");
    process.exit(1);
  }
  const ctx = loadContext();
  if (!ctx.current_task) {
    console.error("no focused task — run: ledger focus TASK-####");
    process.exit(1);
  }
  const g = graph();
  const task = g.tasks.find((t) => t.meta.id === ctx.current_task);
  if (!task) {
    console.error(`unknown ${ctx.current_task}`);
    process.exit(1);
  }
  let body = read(task.path);
  const stamp = new Date().toISOString();
  const line = `- ${stamp}: ${text}`;
  if (/##\s*Notes\b/i.test(body)) {
    body = body.replace(/(##\s*Notes\b[^\n]*\n)/i, `$1\n${line}\n`);
  } else {
    body = body.trimEnd() + `\n\n## Notes\n\n${line}\n`;
  }
  write(task.path, body);
  ctx.notes = text;
  ctx.updated_at = stamp;
  ctx.updated_by = "agent:ledger";
  saveContext(ctx);
  appendAgentTrace({ action: "note", target: task.meta.id, note: text });
  console.log(`noted on ${task.meta.id}`);
}

function cmdBoard() {
  const g = graph();
  console.log("BOARD\n");
  console.log("MILESTONES");
  for (const m of g.milestones || []) {
    console.log(`  ${m.meta.id}  [${m.meta.status}]  ${m.meta.title || ""}  epic=${yamlScalar(m.meta.epic) || "—"}`);
  }
  if (!(g.milestones || []).length) console.log("  (none)");
  console.log("\nEPICS");
  for (const e of g.epics) console.log(`  ${e.meta.id}  [${e.meta.status}]  ${e.meta.title || ""}`);
  if (!g.epics.length) console.log("  (none)");
  console.log("\nPLANS");
  for (const p of g.plans) {
    console.log(`  ${p.meta.id}  [${p.meta.status}]  ${p.meta.title || ""}  spec=${p.meta.spec || "—"}`);
  }
  if (!g.plans.length) console.log("  (none)");
  console.log("\nTASKS");
  const by = { in_progress: [], todo: [], blocked: [], done: [], cancelled: [] };
  for (const t of g.tasks) {
    const s = t.meta.status || "todo";
    (by[s] || (by[s] = [])).push(t);
  }
  for (const s of ["in_progress", "todo", "blocked", "done", "cancelled"]) {
    if (!by[s]?.length) continue;
    console.log(`  [${s}]`);
    for (const t of by[s]) {
      console.log(
        `    ${t.meta.id}  ${t.meta.title || ""}  plan=${t.meta.plan || "—"} ms=${yamlScalar(t.meta.milestone) || "—"} rel=${yamlScalar(t.meta.release) || "—"}`,
      );
    }
  }
  if (!g.tasks.length) console.log("  (none)");
  console.log("\nRELEASES");
  for (const r of g.releases) {
    console.log(`  ${r.meta.id}  [${r.meta.status}]  v${r.meta.version || "?"}  ${r.meta.title || ""}  ms=${yamlScalar(r.meta.milestone) || "—"}`);
  }
  if (!g.releases.length) console.log("  (none)");
}

function cmdDone(taskId) {
  if (!taskId || !taskId.startsWith("TASK-")) {
    console.error("usage: ledger done TASK-####");
    process.exit(1);
  }
  const g = graph();
  const rules = g.rules || {};
  const task = g.tasks.find((t) => t.meta.id === taskId);
  if (!task) {
    console.error(`unknown ${taskId}`);
    console.error(`  fix: node scripts/ledger.mjs board   # list tasks`);
    process.exit(1);
  }
  const errors = [];
  const warns = [];
  if (task.meta.status === "cancelled") {
    errors.push({
      code: "TASK_CANCELLED",
      msg: "task is cancelled",
      fix: "pick another task (ledger next) — do not mark cancelled work done",
    });
  }
  const blockers = taskDepsReady(g, task);
  if (blockers.length) {
    errors.push({
      code: "DEPS_NOT_READY",
      msg: `depends_on not ready: ${blockers.join("; ")}`,
      fix: "finish blocker tasks or adjust depends_on, then re-run done",
    });
  }

  const plan = g.plans.find((p) => p.meta.id === task.meta.plan);
  const appr = planIsApprovedForImpl(plan, rules);
  if (task.meta.plan && !appr.ok) {
    errors.push({
      code: "PLAN_NOT_APPROVED",
      msg: `${task.meta.plan} status=${appr.status} — cannot complete work against an unapproved plan`,
      fix: appr.fix,
    });
  }

  if (rules.agent_runs_required && !asArr(task.meta.agent_runs).length) {
    errors.push({
      code: "RUN_MISSING",
      msg: "rules.agent_runs_required: no agent_runs on task",
      fix: `ledger new run "…" --plan ${task.meta.plan || "PLAN-####"}  then add id to task.agent_runs`,
    });
  }

  const ev = evaluateDoneEvidence(g, task, rules);
  errors.push(...ev.errors);
  warns.push(...(ev.warns || []));

  const te = evaluateDoneTests(g, task, rules);
  errors.push(...te.errors);

  for (const w of warns) console.log(`WARN  ${w}`);
  if (errors.length) {
    printGateErrors("DONE FAIL", errors);
    console.error("\nCompletion records were not modified.");
    process.exit(1);
  }

  let text = read(task.path);
  text = setFrontmatterField(text, "status", "done");
  write(task.path, text);
  appendAuditEvent({
    actor: { type: "agent", id: "ledger" },
    action: "task.done",
    target: taskId,
  });
  appendAgentTrace({ action: "done", target: taskId });
  console.log(`${taskId} → done`);
  if (ev.codeState?.hash) console.log(`verified against code_state ${ev.codeState.hash} (task.files)`);
  console.log("Next: node scripts/ledger.mjs review   # before PR");
  console.log("Note: done checks ledger verification records — it does not re-run your test suite.");
}

function cmdReview() {
  console.log("REVIEW GATE (before PR)\n");
  let failed = 0;
  const runStep = (label, fn) => {
    console.log(`— ${label}`);
    try {
      fn();
      console.log(`OK  ${label}\n`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${label}: ${e.message || e}\n`);
    }
  };

  // Run as subprocesses for real exit codes
  const steps = [
    ["validate", ["validate"]],
    ["check", ["check"]],
  ];
  const ctx = loadContext();
  if (ctx.current_task) steps.push([`preflight ${ctx.current_task}`, ["preflight", ctx.current_task]]);

  for (const [label, args] of steps) {
    const entry = exists("scripts/ledger.mjs")
      ? abs("scripts/ledger.mjs")
      : fileURLToPath(import.meta.url);
    const out = spawnSync(process.execPath, [entry, ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (out.status !== 0) {
      failed++;
      console.error(`FAIL  ${label}`);
      console.error(out.stdout || "");
      console.error(out.stderr || "");
    } else {
      console.log(`OK  ${label}`);
    }
  }

  const g = graph();
  const proposed = g.decisions.filter((d) => d.meta.status === "proposed");
  if (proposed.length) {
    console.log(`WARN  ${proposed.length} proposed ADR(s): ${proposed.map((d) => d.meta.id).join(", ")}`);
  }
  if (failed) {
    console.error(`\nREVIEW FAIL (${failed}) — do not open/merge PR yet`);
    console.error("Recovery: fix the failing gate above, then: node scripts/ledger.mjs review");
    console.error("Local hooks can be bypassed; CI enforces merge only when configured.");
    process.exit(1);
  }
  console.log("\nREVIEW OK — validate + check (+ preflight if focused) passed.");
  console.log("Still follow host CI. Valid ledger records alone do not prove working software.");
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
  const ev = appendAuditEvent({
    actor,
    action,
    target,
    ...(spec ? { spec } : {}),
  });
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
  case "adopt":
    cmdAdopt(argv);
    break;
  case "upgrade":
    cmdUpgrade();
    break;
  case "inventory":
    cmdInventory();
    break;
  case "doctor":
    cmdDoctor();
    break;
  case "status":
    cmdStatus();
    break;
  case "onboard":
    cmdOnboard();
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
  case "preflight":
    cmdPreflight(argv[0]);
    break;
  case "next":
    cmdNext(argv);
    break;
  case "handoff":
    cmdHandoff();
    break;
  case "note":
    cmdNote(argv);
    break;
  case "board":
    cmdBoard();
    break;
  case "done":
    cmdDone(argv[0]);
    break;
  case "review":
    cmdReview();
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
  case "sources":
    cmdSources();
    break;
  case "ui":
    cmdUi(argv);
    break;
  default:
    usage();
    process.exit(cmd ? 1 : 0);
}
