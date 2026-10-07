const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateSkills } = require("../../copilot-studio/scripts/validate-skills");

test("Copilot Studio skills are valid and only reference existing MCP tools", () => {
  const { skills, errors } = validateSkills(path.join(__dirname, "..", "..", "copilot-studio", "skills"));
  assert.deepEqual(errors, []);
  assert.ok(skills.length >= 9);
});

test("validator catches bad names and unknown tools", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
  fs.mkdirSync(path.join(dir, "Bad_Skill"));
  fs.writeFileSync(
    path.join(dir, "Bad_Skill", "SKILL.md"),
    "---\nname: Bad_Skill\ndescription: >-\n  Use this when the user asks for something that requires calling a tool that does not exist anywhere.\n---\n\nCall `delete_everything` then `search_incidents`.\n"
  );
  const { errors } = validateSkills(dir);
  assert.ok(errors.some((e) => /must be lowercase/.test(e)));
  assert.ok(errors.some((e) => /unknown MCP tool `delete_everything`/.test(e)));
  assert.ok(!errors.some((e) => /search_incidents/.test(e)));
});
