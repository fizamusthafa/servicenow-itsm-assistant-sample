const { q, clampLimit } = require("../servicenow");
const { str, limitProp } = require("./util");

const USER_FIELDS = "sys_id,name,user_name,email,title,department,location,manager,active";

const tools = [
  {
    name: "get_my_profile",
    description:
      "Get the signed-in ServiceNow user's profile and the assignment groups they belong to. Use to resolve 'me', 'my tickets', or 'my team'.",
    annotations: { readOnlyHint: true, title: "Get My Profile" },
    inputSchema: { type: "object", properties: {} },
    async handler({ sn }) {
      const [me] = await sn.list("sys_user", { query: "sys_id=javascript:gs.getUserID()", fields: USER_FIELDS, limit: 1 });
      if (!me) return { error: "Could not resolve the signed-in user" };
      const groups = await sn.list("sys_user_grmember", {
        query: `user=${me.sys_id}`,
        fields: "group",
        limit: 50,
      });
      return { ...me, groups: groups.map((g) => g.group).filter(Boolean) };
    },
  },
  {
    name: "lookup_user",
    description: "Find active ServiceNow users by name, user ID, or email. Returns sys_ids usable as caller or assignee.",
    annotations: { readOnlyHint: true, title: "Lookup User" },
    inputSchema: {
      type: "object",
      properties: { query: str("Name, user ID, or email (contains match)"), limit: limitProp },
      required: ["query"],
    },
    async handler({ sn }, args) {
      const term = q(args.query);
      return sn.list("sys_user", {
        query: `nameLIKE${term}^ORuser_nameLIKE${term}^ORemailLIKE${term}^active=true^ORDERBYname`,
        fields: USER_FIELDS,
        limit: clampLimit(args.limit, 10),
      });
    },
  },
  {
    name: "search_groups",
    description: "Find ServiceNow assignment groups by name. Use to pick a valid assignment group.",
    annotations: { readOnlyHint: true, title: "Search Groups" },
    inputSchema: {
      type: "object",
      properties: { query: str("Group name (contains match)"), limit: limitProp },
    },
    async handler({ sn }, args) {
      const parts = ["active=true"];
      if (args.query) parts.push(`nameLIKE${q(args.query)}`);
      parts.push("ORDERBYname");
      return sn.list("sys_user_group", {
        query: parts.join("^"),
        fields: "sys_id,name,description,manager,email",
        limit: clampLimit(args.limit),
      });
    },
  },
  {
    name: "list_group_members",
    description: "List the members of an assignment group (by exact group name).",
    annotations: { readOnlyHint: true, title: "List Group Members" },
    inputSchema: {
      type: "object",
      properties: { group: str("Exact assignment group name"), limit: limitProp },
      required: ["group"],
    },
    async handler({ sn }, args) {
      const rows = await sn.list("sys_user_grmember", {
        query: `group.name=${q(args.group)}^user.active=true`,
        fields: "user,user.user_name,user.email",
        limit: clampLimit(args.limit, 50),
      });
      return rows.map((r) => ({ name: r.user, user_name: r["user.user_name"], email: r["user.email"] }));
    },
  },
];

module.exports = { tools };
