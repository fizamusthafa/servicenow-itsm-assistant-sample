const incidents = require("./incidents");
const changes = require("./changes");
const problems = require("./problems");
const requests = require("./requests");
const knowledge = require("./knowledge");
const cmdb = require("./cmdb");
const people = require("./people");
const records = require("./records");

const tools = [
  ...incidents.tools,
  ...changes.tools,
  ...problems.tools,
  ...requests.tools,
  ...knowledge.tools,
  ...cmdb.tools,
  ...people.tools,
  ...records.tools,
];

const names = new Set();
for (const t of tools) {
  if (names.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
  names.add(t.name);
}

const toolsByName = new Map(tools.map((t) => [t.name, t]));

/** Tool definitions as advertised over MCP (handler stripped). */
function toolDefinitions() {
  return tools.map(({ handler, ...def }) => def);
}

module.exports = { tools, toolsByName, toolDefinitions, uiResources: incidents.uiResources };
