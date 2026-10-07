const { q, assertNumber, clampLimit, pick } = require("../servicenow");
const { str, limitProp, notFound, withLinks } = require("./util");

const PROBLEM_FIELDS =
  "sys_id,number,short_description,state,priority,impact,urgency,assigned_to,assignment_group,cmdb_ci,known_error,opened_at";

const tools = [
  {
    name: "search_problems",
    description:
      "Search ServiceNow problem records by state, priority, assignment group, configuration item, keyword, or known-error flag.",
    annotations: { readOnlyHint: true, title: "Search Problems" },
    inputSchema: {
      type: "object",
      properties: {
        state: str("State: 101=New, 102=Assess, 103=Root Cause Analysis, 104=Fix in Progress, 106=Resolved, 107=Closed"),
        priority: str("1 (Critical) through 5 (Planning)"),
        assignment_group: str("Assignment group name (contains match)"),
        cmdb_ci: str("Configuration item name (contains match)"),
        query: str("Free-text search in short_description"),
        known_error: { type: "boolean", description: "Only known errors" },
        active_only: { type: "boolean", description: "Only active problems" },
        limit: limitProp,
      },
    },
    async handler({ sn }, args) {
      const parts = [];
      if (args.state) parts.push(`state=${q(args.state)}`);
      if (args.priority) parts.push(`priority=${q(args.priority)}`);
      if (args.assignment_group) parts.push(`assignment_group.nameLIKE${q(args.assignment_group)}`);
      if (args.cmdb_ci) parts.push(`cmdb_ci.nameLIKE${q(args.cmdb_ci)}`);
      if (args.query) parts.push(`short_descriptionLIKE${q(args.query)}`);
      if (args.known_error === true) parts.push("known_error=true");
      if (args.active_only) parts.push("active=true");
      parts.push("ORDERBYDESCsys_created_on");
      const rows = await sn.list("problem", { query: parts.join("^"), fields: PROBLEM_FIELDS, limit: clampLimit(args.limit) });
      return withLinks(sn, "problem", rows);
    },
  },
  {
    name: "get_problem",
    description:
      "Get full details of a problem record by number, including root cause, workaround, fix notes, and the incidents linked to it.",
    annotations: { readOnlyHint: true, title: "Get Problem" },
    inputSchema: {
      type: "object",
      properties: { number: str("Problem number, e.g. PRB0000001") },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const row = await sn.findByNumber("problem", assertNumber(args.number));
      if (!row) return notFound("Problem", args.number);
      const linked = await sn.list("incident", {
        query: `problem_id=${row.sys_id}^ORDERBYDESCsys_created_on`,
        fields: "sys_id,number,short_description,state,priority",
        limit: 25,
      });
      return {
        ...row,
        url: sn.recordUrl("problem", row.sys_id),
        linked_incidents: withLinks(sn, "incident", linked),
      };
    },
  },
  {
    name: "create_problem",
    description:
      "Create a new problem record (e.g. for recurring incidents or a major incident needing root-cause analysis). Only call after the user has confirmed.",
    annotations: { destructiveHint: true, title: "Create Problem" },
    inputSchema: {
      type: "object",
      properties: {
        short_description: str("Brief summary of the problem"),
        description: str("Details, symptoms, and evidence"),
        category: str("Category"),
        impact: str("1 (High), 2 (Medium), 3 (Low)"),
        urgency: str("1 (High), 2 (Medium), 3 (Low)"),
        assignment_group: str("Assignment group name or sys_id"),
        cmdb_ci: str("Affected configuration item name or sys_id"),
      },
      required: ["short_description"],
    },
    async handler({ sn }, args) {
      const body = pick(args, ["short_description", "description", "category", "impact", "urgency", "assignment_group", "cmdb_ci"]);
      const r = await sn.insert("problem", body);
      return {
        number: r.number,
        sys_id: r.sys_id,
        url: sn.recordUrl("problem", r.sys_id),
        message: `Problem ${r.number} created successfully`,
      };
    },
  },
  {
    name: "update_problem",
    description:
      "Update a problem record: state, root cause, workaround, fix notes, known-error flag, assignment, or add work notes. Only call after the user has confirmed.",
    annotations: { destructiveHint: true, title: "Update Problem" },
    inputSchema: {
      type: "object",
      properties: {
        number: str("Problem number"),
        state: str("New state (see search_problems)"),
        cause_notes: str("Root cause"),
        workaround: str("Workaround"),
        fix_notes: str("Permanent fix description"),
        known_error: { type: "boolean", description: "Mark as a known error" },
        assigned_to: str("Assignee name or sys_id"),
        assignment_group: str("Assignment group name or sys_id"),
        priority: str("1-5"),
        work_notes: str("Add an internal work note"),
      },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const rec = await sn.findByNumber("problem", assertNumber(args.number), { fields: "sys_id,number" });
      if (!rec) return notFound("Problem", args.number);
      const body = pick(args, [
        "state",
        "cause_notes",
        "workaround",
        "fix_notes",
        "known_error",
        "assigned_to",
        "assignment_group",
        "priority",
        "work_notes",
      ]);
      if (Object.keys(body).length === 0) return { error: "No fields to update were provided." };
      await sn.patch("problem", rec.sys_id, body);
      return {
        number: rec.number,
        url: sn.recordUrl("problem", rec.sys_id),
        message: `Problem ${rec.number} updated`,
        updated_fields: Object.keys(body),
      };
    },
  },
  {
    name: "link_incident_to_problem",
    description: "Link an incident to a problem record (sets the incident's Problem field).",
    annotations: { destructiveHint: true, title: "Link Incident to Problem" },
    inputSchema: {
      type: "object",
      properties: {
        incident_number: str("Incident number, e.g. INC0010001"),
        problem_number: str("Problem number, e.g. PRB0000001"),
      },
      required: ["incident_number", "problem_number"],
    },
    async handler({ sn }, args) {
      const [inc, prb] = await Promise.all([
        sn.findByNumber("incident", assertNumber(args.incident_number, "incident_number"), { fields: "sys_id,number" }),
        sn.findByNumber("problem", assertNumber(args.problem_number, "problem_number"), { fields: "sys_id,number" }),
      ]);
      if (!inc) return notFound("Incident", args.incident_number);
      if (!prb) return notFound("Problem", args.problem_number);
      await sn.patch("incident", inc.sys_id, { problem_id: prb.sys_id });
      return {
        incident: inc.number,
        problem: prb.number,
        url: sn.recordUrl("problem", prb.sys_id),
        message: `Incident ${inc.number} linked to problem ${prb.number}`,
      };
    },
  },
];

module.exports = { tools };
