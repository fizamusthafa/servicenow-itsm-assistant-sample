#!/usr/bin/env node
// Offline validation for Copilot Studio skills (GitHub Copilot harness).
//
// Checks every copilot-studio/skills/<name>/SKILL.md for:
//   - front matter with `name` and `description`
//   - name: lowercase letters, digits, single hyphens, matches its folder
//   - description present and within length limits (it is the routing text)
//   - every MCP tool referenced in backticks exists on the MCP server
//   - every references/… file mentioned exists
//
// Usage: node copilot-studio/scripts/validate-skills.js [skillsDir]

const fs = require("fs");
const path = require("path");

const SKILLS_DIR = path.resolve(process.argv[2] || path.join(__dirname, "..", "skills"));
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TOOL_VERBS =
  /^(show|search|get|create|update|resolve|assign|link|submit|add|list|respond|lookup|delete|remove|approve|reject|find|fetch|send|post|set|run|query|cancel|reopen|escalate)_[a-z_]+$/;

function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (/^[>|][-+]?$/.test(rest.trim())) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].trim());
      fm[key] = block.join(rest.trim().startsWith(">") ? " " : "\n").trim();
    } else {
      fm[key] = rest.replace(/^["']|["']$/g, "").trim();
    }
  }
  return { fm, body: text.slice(m[0].length) };
}

function loadToolNames() {
  const { toolDefinitions } = require(path.join(__dirname, "..", "..", "mcp-server", "src", "tools"));
  return new Set(toolDefinitions().map((t) => t.name));
}

function validateSkills(dir = SKILLS_DIR) {
  const errors = [];
  const toolNames = loadToolNames();
  const skills = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (skills.length === 0) errors.push(`No skills found in ${dir}`);

  for (const folder of skills) {
    const file = path.join(dir, folder, "SKILL.md");
    const where = path.relative(process.cwd(), file);
    if (!fs.existsSync(file)) {
      errors.push(`${where}: missing SKILL.md`);
      continue;
    }
    const parsed = parseFrontMatter(fs.readFileSync(file, "utf8"));
    if (!parsed) {
      errors.push(`${where}: missing YAML front matter`);
      continue;
    }
    const { fm, body } = parsed;
    if (!fm.name) errors.push(`${where}: front matter has no name`);
    else {
      if (!NAME_RE.test(fm.name)) errors.push(`${where}: name "${fm.name}" must be lowercase letters, digits and single hyphens`);
      if (fm.name.length > 64) errors.push(`${where}: name "${fm.name}" is longer than 64 characters`);
      if (fm.name !== folder) errors.push(`${where}: name "${fm.name}" does not match folder "${folder}"`);
    }
    if (!fm.description) errors.push(`${where}: front matter has no description`);
    else if (fm.description.length > 1024) errors.push(`${where}: description is ${fm.description.length} chars (max 1024)`);
    else if (fm.description.length < 80) errors.push(`${where}: description is too short to route on; say when to use the skill`);

    for (const [, ident] of body.matchAll(/`([a-z_]+)`/g)) {
      if (TOOL_VERBS.test(ident) && !toolNames.has(ident)) {
        errors.push(`${where}: references unknown MCP tool \`${ident}\``);
      }
    }
    for (const [, ref] of body.matchAll(/`(references\/[^`]+)`/g)) {
      if (!fs.existsSync(path.join(dir, folder, ref))) errors.push(`${where}: missing reference file ${ref}`);
    }
  }
  return { skills, errors };
}

if (require.main === module) {
  const { skills, errors } = validateSkills();
  if (errors.length) {
    for (const e of errors) console.error(`✖ ${e}`);
    process.exit(1);
  }
  console.log(`✔ ${skills.length} skills valid: ${skills.join(", ")}`);
}

module.exports = { validateSkills, parseFrontMatter };
