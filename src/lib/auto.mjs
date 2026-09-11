/**
 * Phase-driven auto formalization planner.
 * Never rewrites docs/product/sources/* — only proposes ledger new … steps.
 */
import path from "node:path";
import { read, exists } from "./paths.mjs";
import { graph, computeOnboard, listProductSources } from "./model.mjs";

export function titleFromSource(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ").trim();
  if (!exists(filePath)) return base || "Product";
  try {
    const text = read(filePath);
    const m = text.match(/^#\s+(.+)$/m);
    if (m) return m[1].trim().slice(0, 80);
  } catch {
    /* ignore */
  }
  return base || "Product";
}

export function excerpt(filePath, max = 1200) {
  if (!exists(filePath)) return "";
  let t = read(filePath).replace(/\r\n/g, "\n");
  if (t.length > max) t = t.slice(0, max) + "\n…";
  return t;
}

/**
 * Build ordered actions for the current onboard phase.
 */
export function planAuto(g = graph()) {
  const o = computeOnboard(g);
  const actions = [];
  const blockers = [];

  if (o.phase === "bootstrapped") {
    blockers.push("No product sources — drop originals into docs/product/sources/ first");
    return { phase: o.phase, headline: o.headline, actions, blockers };
  }

  if (o.phase === "active" || o.phase === "implementation") {
    actions.push({
      op: "next",
      args: ["--focus"],
      note: "Focus next ready task — then preflight → implement → postflight → done",
    });
    return { phase: o.phase, headline: o.headline, actions, blockers };
  }

  if (o.phase === "sources_only") {
    const sources = o.sources.length ? o.sources : listProductSources();
    const sowSrc = sources.find((s) => s.category === "sow") || sources[0];
    const title = titleFromSource(sowSrc.path);
    actions.push({
      op: "new",
      args: ["sow", title],
      note: `Derive formal SOW from ${sowSrc.path} (original untouched)`,
      seedFrom: sowSrc.path,
    });
    actions.push({
      op: "new",
      args: ["req", `${title} — core requirement`],
      note: "Create REQ derived from sources",
    });
    actions.push({
      op: "new",
      args: ["spec", `${title} — product spec`, "--req", "REQ-0001"],
      note: "Create SPEC@1 (review body; pin is not human approval of product)",
    });
    actions.push({
      op: "new",
      args: ["epic", title],
      note: "Bootstrap epic for delivery",
    });
    actions.push({
      op: "new",
      args: [
        "plan",
        `${title} — initial plan`,
        "--spec",
        "SPEC-0001@1",
        "--epic",
        "EPIC-0001",
        "--status",
        "approved",
      ],
      note: "Approved plan so preflight can pass (SPEC pin alone is not approval)",
    });
    actions.push({
      op: "new",
      args: ["task", `Scaffold from sources: ${title}`, "--plan", "PLAN-0001", "--focus"],
      note: "First task — set files: before coding; run preflight",
    });
    return { phase: o.phase, headline: o.headline, actions, blockers, seedFrom: sowSrc.path };
  }

  if (o.phase === "specification") {
    if (!g.requirements.length) {
      actions.push({ op: "new", args: ["req", "Core requirement"], note: "Missing REQ" });
    }
    if (!g.specs.length) {
      const reqId = g.requirements[0]?.meta?.id || "REQ-0001";
      actions.push({
        op: "new",
        args: ["spec", "Product specification", "--req", reqId],
        note: "Missing SPEC",
      });
    }
    if (!g.epics.length) {
      actions.push({ op: "new", args: ["epic", "Delivery epic"], note: "Missing epic" });
    }
    if (!g.plans.length) {
      actions.push({
        op: "new",
        args: ["plan", "Initial plan", "--spec", "SPEC-0001@1", "--status", "approved"],
        note: "Missing approved plan",
      });
    }
    if (!actions.length) {
      actions.push({
        op: "new",
        args: ["task", "Next implementation slice", "--plan", "PLAN-0001", "--focus"],
        note: "Spec/plan exist — create a task",
      });
    }
    return { phase: o.phase, headline: o.headline, actions, blockers };
  }

  if (o.phase === "planning") {
    const planId = g.plans[0]?.meta?.id || "PLAN-0001";
    actions.push({
      op: "new",
      args: ["task", "Next implementation slice", "--plan", planId, "--focus"],
      note: "Break plan into a concrete task",
    });
    return { phase: o.phase, headline: o.headline, actions, blockers };
  }

  blockers.push(`No auto steps for phase=${o.phase}`);
  return { phase: o.phase, headline: o.headline, actions, blockers };
}

export function formatAutoPlan(plan) {
  const lines = [];
  lines.push(`AUTO PLAN — phase: ${plan.phase}`);
  if (plan.headline) lines.push(plan.headline);
  if (plan.seedFrom) lines.push(`seed_from: ${plan.seedFrom} (read-only)`);
  if (plan.blockers?.length) {
    lines.push("BLOCKERS");
    for (const b of plan.blockers) lines.push(`  - ${b}`);
  }
  if (plan.actions?.length) {
    lines.push("ACTIONS");
    plan.actions.forEach((a, i) => {
      const cmd =
        a.op === "next"
          ? `ledger next ${a.args.join(" ")}`
          : `ledger ${a.op} ${a.args.map(shellQuote).join(" ")}`;
      lines.push(`  ${i + 1}. ${cmd}`);
      if (a.note) lines.push(`     ${a.note}`);
    });
  } else if (!plan.blockers?.length) {
    lines.push("ACTIONS  (none)");
  }
  lines.push("");
  lines.push("Default is dry-run. Apply with: ledger auto --yes");
  lines.push("Review generated SOW/SPEC before coding. Auto does not invent product beyond source titles/excerpts.");
  return lines.join("\n");
}

function shellQuote(s) {
  const t = String(s);
  if (/[\s"]/.test(t)) return `"${t.replace(/"/g, '\\"')}"`;
  return t;
}
