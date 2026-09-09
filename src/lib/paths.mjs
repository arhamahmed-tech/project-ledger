import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** Target project root — cwd, or LEDGER_ROOT override */
export const ROOT = path.resolve(process.env.LEDGER_ROOT || process.cwd());
export const PORT = Number(process.env.LEDGER_PORT || 3847);

function resolvePkgRoot() {
  const candidates = [
    process.env.LEDGER_PKG_ROOT,
    path.resolve(__dirname, "../.."), // package when in src/lib
    path.resolve(__dirname, "../../.."), // package when deeper / consumer when vendored
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
  return path.resolve(__dirname, "../..");
}

export const PKG_ROOT = resolvePkgRoot();

export function abs(p) {
  return path.join(ROOT, p);
}
export function read(p) {
  return fs.readFileSync(abs(p), "utf8");
}
export function write(p, s) {
  fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
  fs.writeFileSync(abs(p), s);
}
export function exists(p) {
  return fs.existsSync(abs(p));
}
export function append(p, line) {
  fs.appendFileSync(abs(p), line.endsWith("\n") ? line : line + "\n");
}

export function listFiles(rel, filter = () => true) {
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
