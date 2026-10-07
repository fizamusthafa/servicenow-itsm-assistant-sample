const { q, clampLimit, isSysId } = require("../servicenow");
const { str, limitProp, withLinks } = require("./util");

const CI_FIELDS =
  "sys_id,name,sys_class_name,operational_status,install_status,support_group,managed_by,owned_by,location,ip_address,short_description";

const tools = [
  {
    name: "search_configuration_items",
    description:
      "Search the CMDB for configuration items (servers, applications, services, network gear) by name, class, or support group.",
    annotations: { readOnlyHint: true, title: "Search Configuration Items" },
    inputSchema: {
      type: "object",
      properties: {
        name: str("CI name (contains match)"),
        ci_class: str("CI class table name, e.g. cmdb_ci_server, cmdb_ci_appl, cmdb_ci_service"),
        support_group: str("Support group name (contains match)"),
        limit: limitProp,
      },
    },
    async handler({ sn }, args) {
      const parts = [];
      if (args.name) parts.push(`nameLIKE${q(args.name)}`);
      if (args.ci_class) parts.push(`sys_class_name=${q(args.ci_class)}`);
      if (args.support_group) parts.push(`support_group.nameLIKE${q(args.support_group)}`);
      parts.push("ORDERBYname");
      const rows = await sn.list("cmdb_ci", { query: parts.join("^"), fields: CI_FIELDS, limit: clampLimit(args.limit) });
      return withLinks(sn, "cmdb_ci", rows);
    },
  },
  {
    name: "get_configuration_item",
    description:
      "Get a configuration item by exact name or sys_id, plus its currently open incidents, active changes, and open problems. Use for impact analysis and change risk review.",
    annotations: { readOnlyHint: true, title: "Get Configuration Item" },
    inputSchema: {
      type: "object",
      properties: { ci: str("CI exact name or sys_id") },
      required: ["ci"],
    },
    async handler({ sn }, args) {
      const query = isSysId(args.ci) ? `sys_id=${args.ci}` : `name=${q(args.ci)}`;
      const [ci] = await sn.list("cmdb_ci", { query, fields: CI_FIELDS, limit: 1 });
      if (!ci) return { error: `Configuration item "${args.ci}" not found (or not visible to the signed-in user)` };
      const related = (table, fields) =>
        sn
          .list(table, { query: `cmdb_ci=${ci.sys_id}^active=true^ORDERBYDESCsys_created_on`, fields, limit: 10 })
          .then((rows) => withLinks(sn, table, rows));
      const [incidents, changes, problems] = await Promise.all([
        related("incident", "sys_id,number,short_description,priority,state"),
        related("change_request", "sys_id,number,short_description,type,state,start_date,end_date"),
        related("problem", "sys_id,number,short_description,state,known_error"),
      ]);
      return {
        ...ci,
        url: sn.recordUrl("cmdb_ci", ci.sys_id),
        open_incidents: incidents,
        active_changes: changes,
        open_problems: problems,
      };
    },
  },
];

module.exports = { tools };
