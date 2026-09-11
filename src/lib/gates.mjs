/**
 * Shared readiness / completion gates — keep preflight, done, and review aligned.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { abs, exists } from "./paths.mjs";
import { asArr, yamlScalar } from "./parse.mjs";
import { fileMatches } from "./model.mjs";

export const PASS_RESULTS = new Set(["pass", "passed", "ok"]);
export const FAIL_RESULTS = new Set(["fail", "failed", "error"]);
export const NOT_RUN_RESULTS = new Set(["not_run", "not-run", "n/a", "na", "pending", ""]);
export const BLOCKED_RESULTS = new Set(["blocked", "blocked_by_env", "env_blocked"]);
export const WAIVED_RESULTS = new Set(["waived", "waiver"]);

export const PLAN_APPROVED_STATUSES = new Set(["approved", "in_progress", "done"]);

/** Hash of task-listed application files (working tree). Ignores ledger metadata paths. */
export function computeTaskCodeState(task) {
  const files = asArr(task?.meta?.files)
    .map((f) => String(f).replace(/\/$/, ""))
    .filter(Boolean)
    .sort();
  if (!files.length) {
    return { hash: "no-files", files: [], note: "task.files is empty — code_state cannot prove freshness" };
  }
  const h = crypto.createHash("sha256");
  h.update("v1\n");
  for (const f of files) {
    h.update(f);
    h.update("\0");
    if (!exists(f)) {
      h.update("MISSING\n");
      continue;
    }
    const st = fs.statSync(abs(f));
    if (st.isDirectory()) {
      h.update("DIR\n");
      continue;
    }
    h.update(fs.readFileSync(abs(f)));
    h.update("\n");
  }
  let gitHead = null;
  const g = spawnSync("git", ["rev-parse", "HEAD"], { cwd: abs("."), encoding: "utf8" });
  if (g.status === 0) gitHead = String(g.stdout || "").trim() || null;
  return { hash: h.digest("hex").slice(0, 16), files, gitHead };
}

export function normalizeResult(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (PASS_RESULTS.has(s)) return "pass";
  if (FAIL_RESULTS.has(s)) return "fail";
  if (BLOCKED_RESULTS.has(s)) return "blocked";
  if (WAIVED_RESULTS.has(s)) return "waived";
  if (NOT_RUN_RESULTS.has(s) || s === "n/a") return "not_run";
  return s || "not_run";
}

export function classifyResult(raw) {
  const n = normalizeResult(raw);
  if (n === "pass") return "pass";
  if (n === "fail") return "fail";
  if (n === "blocked") return "blocked";
  if (n === "waived") return "waived";
  return "not_run";
}

export function planIsApprovedForImpl(plan, rules = {}) {
  if (rules.implementation_requires_approval === false) return { ok: true };
  if (!plan) return { ok: false, reason: "NO_PLAN" };
  const st = plan.meta.status || "draft";
  if (PLAN_APPROVED_STATUSES.has(st)) return { ok: true, status: st };
  return {
    ok: false,
    reason: "PLAN_NOT_APPROVED",
    status: st,
    fix: `set plan status to approved (not draft): edit ${plan.path} — a SPEC pin alone is not approval`,
  };
}

/** Collect evidence records linked to a task via agent_runs. */
export function evidenceForTask(g, task) {
  const runIds = asArr(task.meta.agent_runs);
  const fromRuns = g.evidence.filter((e) => runIds.includes(e.meta.agent_run));
  const linkedIds = new Set();
  for (const rid of runIds) {
    const run = g.runs.find((r) => r.meta.id === rid);
    for (const eid of asArr(run?.meta?.evidence)) linkedIds.add(eid);
  }
  const fromMeta = g.evidence.filter((e) => linkedIds.has(e.meta.id));
  const byId = new Map();
  for (const e of [...fromRuns, ...fromMeta]) byId.set(e.meta.id, e);
  return [...byId.values()];
}

/**
 * Evaluate whether evidence is sufficient for done under current rules.
 * Returns { ok, errors: [{code, msg, fix}], warns }
 */
export function evaluateDoneEvidence(g, task, rules = {}) {
  const errors = [];
  const warns = [];
  if (!rules.evidence_required) return { ok: true, errors, warns };

  const list = evidenceForTask(g, task);
  if (!list.length) {
    errors.push({
      code: "EVIDENCE_MISSING",
      msg: "rules.evidence_required: no EVD-* linked to task agent_runs",
      fix: 'ledger new evd "verify …" --run RUN-#### --result pass --task TASK-####',
    });
    return { ok: false, errors, warns };
  }

  const state = computeTaskCodeState(task);
  let freshPass = false;

  for (const ev of list) {
    const kind = classifyResult(ev.meta.result);
    const eid = ev.meta.id;
    if (kind === "fail") {
      errors.push({
        code: "EVIDENCE_FAILED",
        msg: `${eid} result=fail — failed checks do not count as passing`,
        fix: "re-run verification and record new evidence with --result pass",
      });
      continue;
    }
    if (kind === "blocked") {
      errors.push({
        code: "EVIDENCE_BLOCKED",
        msg: `${eid} result=blocked — environment-blocked is not a pass`,
        fix: "resolve the environment issue, re-run, or --result waived only if explicitly authorized",
      });
      continue;
    }
    if (kind === "not_run") {
      errors.push({
        code: "EVIDENCE_NOT_RUN",
        msg: `${eid} result=${ev.meta.result || "missing"} — not run / n/a is not a pass`,
        fix: `run the check and: ledger new evd "…" --run … --result pass --task ${task.meta.id}`,
      });
      continue;
    }
    if (kind === "waived") {
      warns.push(`${eid} is waived — ensure a human authorized the waiver`);
      freshPass = true;
      continue;
    }
    if (kind !== "pass") {
      errors.push({
        code: "EVIDENCE_BAD_RESULT",
        msg: `${eid} has unrecognized result=${ev.meta.result}`,
        fix: "use result: pass|fail|not_run|blocked|waived",
      });
      continue;
    }

    const stored = yamlScalar(ev.meta.code_state);
    if (!stored || stored === "pending" || stored === "legacy" || stored === "none") {
      errors.push({
        code: "EVIDENCE_NO_CODE_STATE",
        msg: `${eid} has no code_state — legacy/missing provenance is not treated as fresh verification`,
        fix: `re-record: ledger new evd "…" --run ${ev.meta.agent_run || "RUN-####"} --result pass --task ${task.meta.id}`,
      });
      continue;
    }
    if (state.hash === "no-files") {
      errors.push({
        code: "TASK_FILES_EMPTY",
        msg: `${task.meta.id} has empty files: — cannot prove evidence freshness against application code`,
        fix: `add implementation paths to task frontmatter files: [src/…] then re-record evd with --result pass`,
      });
      continue;
    }
    if (stored !== state.hash) {
      errors.push({
        code: "EVIDENCE_STALE",
        msg: `${eid} code_state=${stored} but task files now hash to ${state.hash} — code changed after verification`,
        fix: `re-run checks, then ledger new evd "…" --result pass --task ${task.meta.id} --run …`,
      });
      continue;
    }
    freshPass = true;
  }

  if (!freshPass && !errors.length) {
    errors.push({
      code: "EVIDENCE_INSUFFICIENT",
      msg: "no passing, fresh evidence for this task",
      fix: `ledger new evd "…" --result pass --task ${task.meta.id} --run RUN-####`,
    });
  }

  return { ok: !errors.length, errors, warns, codeState: state };
}

export function evaluateDoneTests(g, task, rules = {}) {
  const errors = [];
  if (!rules.tests_required) return { ok: true, errors };
  const linked = g.tests.filter(
    (t) => String(t.meta.task || "") === task.meta.id || asArr(t.meta.tasks).includes(task.meta.id),
  );
  const mentioned = /TEST-\d+/.test(task.body);
  if (!linked.length && !mentioned) {
    errors.push({
      code: "TEST_MISSING",
      msg: "rules.tests_required: add/link a TEST-* record",
      fix: `ledger new test "…" then set task: ${task.meta.id} in frontmatter, or mention TEST-id in task body`,
    });
    return { ok: false, errors };
  }
  for (const t of linked) {
    const st = String(t.meta.status || "").toLowerCase();
    const res = classifyResult(t.meta.result || t.meta.status);
    if (["fail", "failed"].includes(st) || res === "fail") {
      errors.push({
        code: "TEST_FAILED",
        msg: `${t.meta.id} status/result indicates failure`,
        fix: `fix failing tests; do not mark done while ${t.meta.id} is fail`,
      });
    }
    if (["not_run", "planned", "pending"].includes(st) && rules.tests_must_pass) {
      errors.push({
        code: "TEST_NOT_RUN",
        msg: `${t.meta.id} is ${st} — not run is not pass`,
        fix: "execute the test and set status/result to pass (or record EVD with result=pass)",
      });
    }
  }
  return { ok: !errors.length, errors };
}

export function printGateErrors(label, items) {
  console.error(`${label} (${items.length})`);
  for (const e of items) {
    if (typeof e === "string") {
      console.error(`  - ${e}`);
      continue;
    }
    console.error(`  - ${e.code}: ${e.msg}`);
    if (e.fix) console.error(`    fix: ${e.fix}`);
  }
}

export function redactSecrets(text, max = 4000) {
  let s = String(text || "");
  s = s.replace(/(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
  if (s.length > max) s = s.slice(0, max) + "\n…[truncated]";
  return s;
}


export const CODE_SKIP_PREFIXES = [
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
  "CHANGELOG.md",
];

export function isCodePath(f) {
  return !CODE_SKIP_PREFIXES.some((p) => f === p || f.startsWith(p));
}

/** Changed implementation paths (working tree + index + untracked, or LEDGER_DIFF_RANGE). */
export function listChangedCodeFiles() {
  const opts = { cwd: abs("."), encoding: "utf8" };
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], opts);
  if (inside.status !== 0) return { ok: false, files: [], reason: "not-git" };
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
  return { ok: true, files: files.filter(isCodePath) };
}

export function fileCoveredByTaskOrChange(g, task, file) {
  if (fileMatches(task.meta.files, file) || (task.body && task.body.includes(file))) return true;
  const runIds = asArr(task.meta.agent_runs);
  for (const c of g.changes || []) {
    const run = c.meta.agent_run;
    if (run && runIds.includes(run) && (fileMatches(c.meta.files, file) || (c.body || "").includes(file))) {
      return true;
    }
    if (fileMatches(c.meta.files, file) || (c.body || "").includes(file)) {
      // allow CHG that mentions the task id
      if (String(c.meta.task || "") === task.meta.id || asArr(c.meta.tasks).includes(task.meta.id)) return true;
      if ((c.body || "").includes(task.meta.id)) return true;
    }
  }
  return false;
}

/**
 * Post-implementation gate: readiness still true + no file drift + fresh evidence.
 * Preflight does not prove later code; this does for the current tree.
 */
export function evaluatePostflight(g, task, rules = {}, { depsBlockers = [] } = {}) {
  const errors = [];
  const warns = [];
  const checks = [];

  if (!task) {
    return {
      ok: false,
      errors: [{ code: "NO_TASK", msg: "no task", fix: "ledger focus TASK-#### or postflight TASK-####" }],
      warns,
      checks,
    };
  }
  checks.push(`task ${task.meta.id} [${task.meta.status || "?"}]`);

  if (task.meta.status === "cancelled") {
    errors.push({
      code: "TASK_CANCELLED",
      msg: "task is cancelled",
      fix: "pick another task — do not complete cancelled work",
    });
  }
  if (depsBlockers.length) {
    errors.push({
      code: "DEPS_NOT_READY",
      msg: `depends_on not ready: ${depsBlockers.join("; ")}`,
      fix: "finish blockers or adjust depends_on",
    });
  }

  const plan = g.plans.find((p) => p.meta.id === task.meta.plan);
  if (!task.meta.plan) {
    errors.push({
      code: "NO_PLAN",
      msg: "task has no plan",
      fix: "link a PLAN on the task before done",
    });
  } else if (!plan) {
    errors.push({
      code: "PLAN_MISSING",
      msg: `${task.meta.plan} not found`,
      fix: "restore plan file or fix task.plan",
    });
  } else {
    const appr = planIsApprovedForImpl(plan, rules);
    if (!appr.ok) {
      errors.push({
        code: "PLAN_NOT_APPROVED",
        msg: `${plan.meta.id} status=${appr.status}`,
        fix: appr.fix,
      });
    } else {
      checks.push(`plan ${plan.meta.id} [${plan.meta.status}]`);
    }
    const specRef = plan.meta.spec;
    if (rules.implementation_requires_spec !== false) {
      if (!specRef || !String(specRef).includes("@")) {
        errors.push({
          code: "NO_SPEC_PIN",
          msg: "plan has no SPEC@rev pin",
          fix: "set plan.spec to SPEC-####@N",
        });
      } else {
        checks.push(`spec ${specRef}`);
      }
    }
  }

  if (rules.agent_runs_required && !asArr(task.meta.agent_runs).length) {
    errors.push({
      code: "RUN_MISSING",
      msg: "rules.agent_runs_required: no agent_runs on task",
      fix: `ledger new run "…" --plan ${task.meta.plan || "PLAN-####"} then link on task`,
    });
  }

  const changed = listChangedCodeFiles();
  if (!changed.ok) {
    warns.push("not a git repo — skipping implementation-drift check");
  } else if (!changed.files.length) {
    checks.push("no dirty implementation files (drift check clean)");
  } else {
    checks.push(`changed code files: ${changed.files.length}`);
    for (const f of changed.files) {
      if (!fileCoveredByTaskOrChange(g, task, f)) {
        errors.push({
          code: "POSTFLIGHT_DRIFT",
          msg: `${f} changed but not listed on ${task.meta.id} files: (or linked CHG)`,
          fix: `add path to task files: [] or revert the file, then re-record evidence`,
        });
      }
    }
  }

  const ev = evaluateDoneEvidence(g, task, rules);
  errors.push(...ev.errors);
  warns.push(...(ev.warns || []));
  if (ev.codeState?.hash) checks.push(`code_state ${ev.codeState.hash}`);

  const te = evaluateDoneTests(g, task, rules);
  errors.push(...te.errors);

  return {
    ok: !errors.length,
    errors,
    warns,
    checks,
    codeState: ev.codeState,
    changedFiles: changed.files || [],
  };
}
