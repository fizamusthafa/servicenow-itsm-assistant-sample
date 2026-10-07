const { q, assertNumber, clampLimit, pick, toSnDateTime } = require("../servicenow");
const { str, limitProp, notFound, withLinks } = require("./util");

const CHANGE_FIELDS =
  "sys_id,number,short_description,type,risk,impact,state,start_date,end_date,assigned_to,assignment_group,cmdb_ci,approval";

const DATE_FIELDS = ["start_date", "end_date"];

function normalizeDates(body) {
  for (const f of DATE_FIELDS) if (body[f]) body[f] = toSnDateTime(body[f], f);
  return body;
}

const tools = [
  {
    name: "search_changes",
    description:
      "Search ServiceNow change requests by state, type, assignment group, configuration item, keyword, or planned window. Use window_start/window_end to find changes that overlap a maintenance window (conflict check).",
    annotations: { readOnlyHint: true, title: "Search Changes" },
    inputSchema: {
      type: "object",
      properties: {
        state: str("State number: -5=New, -4=Assess, -3=Authorize, -2=Scheduled, -1=Implement, 0=Review, 3=Closed, 4=Canceled"),
        type: str("normal, standard, or emergency"),
        assignment_group: str("Filter by assignment group name (contains match)"),
        cmdb_ci: str("Filter by configuration item name (contains match)"),
        query: str("Free-text search in short_description"),
        window_start: str("Return changes whose planned window overlaps this start (ISO 8601)"),
        window_end: str("Return changes whose planned window overlaps this end (ISO 8601)"),
        active_only: { type: "boolean", description: "Only return active changes" },
        limit: limitProp,
      },
    },
    async handler({ sn }, args) {
      const parts = [];
      if (args.state) parts.push(`state=${q(args.state)}`);
      if (args.type) parts.push(`type=${q(args.type)}`);
      if (args.assignment_group) parts.push(`assignment_group.nameLIKE${q(args.assignment_group)}`);
      if (args.cmdb_ci) parts.push(`cmdb_ci.nameLIKE${q(args.cmdb_ci)}`);
      if (args.query) parts.push(`short_descriptionLIKE${q(args.query)}`);
      // Overlap: change.start <= window.end AND change.end >= window.start
      if (args.window_end) parts.push(`start_date<=${toSnDateTime(args.window_end, "window_end")}`);
      if (args.window_start) parts.push(`end_date>=${toSnDateTime(args.window_start, "window_start")}`);
      if (args.active_only) parts.push("active=true");
      parts.push("ORDERBYDESCsys_created_on");
      const rows = await sn.list("change_request", {
        query: parts.join("^"),
        fields: CHANGE_FIELDS,
        limit: clampLimit(args.limit),
      });
      return withLinks(sn, "change_request", rows);
    },
  },
  {
    name: "get_change",
    description: "Get full details of a change request by its number, including implementation, backout, and test plans.",
    annotations: { readOnlyHint: true, title: "Get Change Request" },
    inputSchema: {
      type: "object",
      properties: { number: str("Change number, e.g. CHG0000001") },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const row = await sn.findByNumber("change_request", assertNumber(args.number));
      if (!row) return notFound("Change", args.number);
      return { ...row, url: sn.recordUrl("change_request", row.sys_id) };
    },
  },
  {
    name: "create_change",
    description:
      "Create a new change request in ServiceNow. Only call after the user has confirmed a preview of the change.",
    annotations: { destructiveHint: true, title: "Create Change Request" },
    inputSchema: {
      type: "object",
      properties: {
        short_description: str("Brief summary"),
        description: str("Full details and justification"),
        type: str("normal, standard, or emergency"),
        risk: str("high, moderate, low"),
        impact: str("1 (High), 2 (Medium), 3 (Low)"),
        assignment_group: str("Assignment group"),
        cmdb_ci: str("Affected configuration item name or sys_id"),
        start_date: str("Planned start (ISO 8601)"),
        end_date: str("Planned end (ISO 8601)"),
        implementation_plan: str("Implementation steps"),
        backout_plan: str("Backout / rollback plan"),
        test_plan: str("Test / validation plan"),
        justification: str("Business justification"),
      },
      required: ["short_description", "type"],
    },
    async handler({ sn }, args) {
      const body = normalizeDates(
        pick(args, [
          "short_description",
          "description",
          "type",
          "risk",
          "impact",
          "assignment_group",
          "cmdb_ci",
          "start_date",
          "end_date",
          "implementation_plan",
          "backout_plan",
          "test_plan",
          "justification",
        ])
      );
      const r = await sn.insert("change_request", body);
      return {
        number: r.number,
        sys_id: r.sys_id,
        state: r.state,
        url: sn.recordUrl("change_request", r.sys_id),
        message: `Change ${r.number} created successfully`,
      };
    },
  },
  {
    name: "update_change",
    description:
      "Update an existing change request: state, schedule, risk, plans, assignment, or add work notes. Only call after the user has confirmed.",
    annotations: { destructiveHint: true, title: "Update Change Request" },
    inputSchema: {
      type: "object",
      properties: {
        number: str("Change number"),
        state: str("New state number (see search_changes)"),
        risk: str("high, moderate, low"),
        impact: str("1 (High), 2 (Medium), 3 (Low)"),
        assigned_to: str("Assignee name or sys_id"),
        assignment_group: str("Assignment group name or sys_id"),
        start_date: str("Planned start (ISO 8601)"),
        end_date: str("Planned end (ISO 8601)"),
        implementation_plan: str("Implementation steps"),
        backout_plan: str("Backout / rollback plan"),
        test_plan: str("Test / validation plan"),
        close_code: str("successful, successful_issues, unsuccessful (when closing)"),
        close_notes: str("Close notes (when closing)"),
        work_notes: str("Add an internal work note"),
      },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const rec = await sn.findByNumber("change_request", assertNumber(args.number), { fields: "sys_id,number" });
      if (!rec) return notFound("Change", args.number);
      const body = normalizeDates(
        pick(args, [
          "state",
          "risk",
          "impact",
          "assigned_to",
          "assignment_group",
          "start_date",
          "end_date",
          "implementation_plan",
          "backout_plan",
          "test_plan",
          "close_code",
          "close_notes",
          "work_notes",
        ])
      );
      if (Object.keys(body).length === 0) return { error: "No fields to update were provided." };
      const r = await sn.patch("change_request", rec.sys_id, body);
      return {
        number: r.number,
        url: sn.recordUrl("change_request", rec.sys_id),
        message: `Change ${rec.number} updated`,
        updated_fields: Object.keys(body),
      };
    },
  },
];

module.exports = { tools };
