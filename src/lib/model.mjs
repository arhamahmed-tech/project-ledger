import { read, listFiles } from "./paths.mjs";
import {
  parseFrontmatter,
  loadMd,
  loadYamlishProject,
  yamlScalar,
  loadRules,
  loadContext,
  loadPeople,
  events,
  asArr,
} from "./parse.mjs";

export function graph() {
  return {
    project: loadYamlishProject(),
    people: loadPeople(),
    epics: loadMd("docs/plans/epics", "EPIC-"),
    milestones: loadMd("docs/plans/milestones", "MS-"),
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

export function counts(g = graph()) {
  return {
    epics: g.epics.length,
    milestones: g.milestones.length,
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

export function fileMatches(files, norm) {
  return asArr(files).some((f) => {
    const clean = f.replace(/\/$/, "");
    return norm === f || norm === clean || norm.startsWith(clean + "/") || norm.startsWith(f);
  });
}

export function findFileHits(g, norm) {
  const hitTasks = g.tasks.filter((t) => fileMatches(t.meta.files, norm) || t.body.includes(norm));
  const hitChanges = g.changes.filter((c) => fileMatches(c.meta.files, norm) || c.body.includes(norm));
  return { hitTasks, hitChanges };
}

export function resolveChain(g, task, change) {
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

export function computeDrift(g = graph()) {
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
