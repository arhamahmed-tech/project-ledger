/**
 * Host-project style tooling detection (ledger does not ship ESLint).
 */
import { exists, read } from "./paths.mjs";
import { loadRules } from "./parse.mjs";

const MARKERS = [
  { id: "eslint", files: [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs"] },
  { id: "prettier", files: [".prettierrc", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.json", "prettier.config.js", "prettier.config.mjs"] },
  { id: "ruff", files: ["ruff.toml", ".ruff.toml"] },
  { id: "biome", files: ["biome.json", "biome.jsonc"] },
];

export function detectStyleTooling() {
  const found = [];
  for (const m of MARKERS) {
    if (m.files.some((f) => exists(f))) found.push(m.id);
  }
  if (exists("package.json")) {
    try {
      const pkg = JSON.parse(read("package.json"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if ((pkg.eslintConfig || deps.eslint) && !found.includes("eslint")) found.push("eslint");
      if ((pkg.prettier || deps.prettier) && !found.includes("prettier")) found.push("prettier");
      if (deps["@biomejs/biome"] && !found.includes("biome")) found.push("biome");
    } catch {
      /* ignore */
    }
  }
  return found;
}

/**
 * @returns {{ ok: boolean, level: 'off'|'warn'|'error', found: string[], msg?: string, fix?: string }}
 */
export function evaluateStyleTooling(rules = loadRules()) {
  if (rules.follow_existing_codebase_style === false) {
    return { ok: true, level: "off", found: [] };
  }
  const found = detectStyleTooling();
  if (found.length) return { ok: true, level: "ok", found };
  const hard = rules.style_tooling_required === true;
  return {
    ok: !hard,
    level: hard ? "error" : "warn",
    found,
    msg: "No host linter/formatter config detected (eslint/prettier/ruff/biome)",
    fix: "Add eslint/prettier (or ruff/biome) for real style enforcement — ledger only prints naming rules",
  };
}
