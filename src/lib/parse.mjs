import fs from "node:fs";
import crypto from "node:crypto";
import { abs, read, write, exists, append, listFiles } from "./paths.mjs";

export function parseFrontmatter(text) {
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

export function loadMd(globDir, prefix) {
  return listFiles(globDir, (n) => n.startsWith(prefix) && n.endsWith(".md")).map((f) => {
    const { meta, body } = parseFrontmatter(read(f));
    return { path: f, meta, body };
  });
}

export function loadYamlishProject() {
  const text = read(".project/project.yaml");
  return {
    id: text.match(/^\s*id:\s*(.+)$/m)?.[1]?.trim(),
    name: text.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim(),
    version: text.match(/^\s*version:\s*(.+)$/m)?.[1]?.trim(),
    ledger_version: text.match(/^\s*ledger_version:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim(),
  };
}

export function yamlScalar(v) {
  if (v == null || v === "null") return null;
  const s = String(v).trim();
  if (s === "null" || s === "") return null;
  return s.replace(/^["']|["']$/g, "");
}

export function loadRules() {
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

export function loadContext() {
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

export function saveContext(ctx) {
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

export function nextId(prefix, items) {
  const nums = items
    .map((it) => Number(String(it.meta?.id || it.id || "").replace(new RegExp(`^${prefix}-`), "")))
    .filter((n) => !Number.isNaN(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export function loadPeople() {
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

export function events() {
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

export function asArr(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export function setFrontmatterField(text, key, value) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return text;
  let fm = text.slice(4, end);
  const re = new RegExp(`^${key}:\\s*.*$`, "m");
  if (re.test(fm)) fm = fm.replace(re, `${key}: ${value}`);
  else fm += `\n${key}: ${value}`;
  return `---\n${fm}\n---\n` + text.slice(end + 5);
}

export function bodyHash(rel) {
  const { body } = parseFrontmatter(read(rel));
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function nextEventId() {
  const ids = events()
    .map((e) => Number(String(e.id).replace("EVT-", "")))
    .filter((n) => !Number.isNaN(n));
  const n = (ids.length ? Math.max(...ids) : 0) + 1;
  return `EVT-${String(n).padStart(6, "0")}`;
}

/** Stable hash for audit chain (excludes event_hash). */
export function hashEvent(ev) {
  const copy = { ...ev };
  delete copy.event_hash;
  return crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex").slice(0, 16);
}

/** Append audit event with prev_hash → event_hash chain. */
export function appendAuditEvent(partial) {
  const prev = events();
  const last = prev[prev.length - 1];
  const ev = {
    id: nextEventId(),
    timestamp: new Date().toISOString(),
    ...partial,
  };
  if (last) {
    ev.prev_hash = last.event_hash || hashEvent(last);
  }
  ev.event_hash = hashEvent(ev);
  append(".audit/events.jsonl", JSON.stringify(ev));
  return ev;
}

export function appendAgentTrace(entry) {
  const rel = ".agent-trace/traces.jsonl";
  fs.mkdirSync(abs(".agent-trace"), { recursive: true });
  append(rel, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}
