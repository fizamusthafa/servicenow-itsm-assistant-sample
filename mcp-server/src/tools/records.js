const { ServiceNowError, q, assertNumber, clampLimit, tableForNumber, PREFIX_TABLES } = require("../servicenow");
const { str, limitProp, notFound } = require("./util");

const SUPPORTED = Object.keys(PREFIX_TABLES).join(", ");

const tools = [
  {
    name: "add_work_note",
    description: `Add an internal work note and/or a customer-visible comment to any ITSM record (${SUPPORTED}).`,
    annotations: { destructiveHint: true, title: "Add Work Note / Comment" },
    inputSchema: {
      type: "object",
      properties: {
        number: str(`Record number (${SUPPORTED})`),
        work_notes: str("Internal work note (not visible to the caller)"),
        comments: str("Customer-visible comment"),
      },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const number = assertNumber(args.number);
      const table = tableForNumber(number);
      if (!args.work_notes && !args.comments) return { error: "Provide work_notes and/or comments." };
      const rec = await sn.findByNumber(table, number, { fields: "sys_id,number" });
      if (!rec) return notFound("Record", number);
      const body = {};
      if (args.work_notes) body.work_notes = args.work_notes;
      if (args.comments) body.comments = args.comments;
      await sn.patch(table, rec.sys_id, body);
      return { number, url: sn.recordUrl(table, rec.sys_id), message: `Added ${Object.keys(body).join(" and ")} to ${number}` };
    },
  },
  {
    name: "get_record_activity",
    description: `Get the recent activity stream (work notes and comments, newest first) for an ITSM record (${SUPPORTED}).`,
    annotations: { readOnlyHint: true, title: "Get Record Activity" },
    inputSchema: {
      type: "object",
      properties: { number: str(`Record number (${SUPPORTED})`), limit: limitProp },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const number = assertNumber(args.number);
      const table = tableForNumber(number);
      const rec = await sn.findByNumber(table, number, { fields: "sys_id,number" });
      if (!rec) return notFound("Record", number);
      const entries = await sn.list("sys_journal_field", {
        query: `element_id=${rec.sys_id}^ORDERBYDESCsys_created_on`,
        fields: "element,value,sys_created_by,sys_created_on",
        limit: clampLimit(args.limit),
      });
      return {
        number,
        url: sn.recordUrl(table, rec.sys_id),
        activity: entries.map((e) => ({
          type: e.element === "work_notes" ? "work_note" : e.element === "comments" ? "comment" : e.element,
          by: e.sys_created_by,
          at: e.sys_created_on,
          text: String(e.value || "").slice(0, 2000),
        })),
      };
    },
  },
  {
    name: "list_my_approvals",
    description: "List approvals waiting on the signed-in user (change requests, requested items, etc.).",
    annotations: { readOnlyHint: true, title: "List My Approvals" },
    inputSchema: { type: "object", properties: { limit: limitProp } },
    async handler({ sn }, args) {
      const rows = await sn.list("sysapproval_approver", {
        query: "approver=javascript:gs.getUserID()^state=requested^ORDERBYDESCsys_created_on",
        fields: "sys_id,sysapproval,sysapproval.number,sysapproval.short_description,sysapproval.sys_class_name,due_date,sys_created_on",
        limit: clampLimit(args.limit),
      });
      return rows.map((r) => ({
        approval_sys_id: r.sys_id,
        number: r["sysapproval.number"],
        short_description: r["sysapproval.short_description"],
        record_type: r["sysapproval.sys_class_name"],
        requested_on: r.sys_created_on,
        due_date: r.due_date,
      }));
    },
  },
  {
    name: "respond_to_approval",
    description:
      "Approve or reject a pending approval assigned to the signed-in user for a record (e.g. CHG or RITM number). Only call after explicit user confirmation. Rejections require comments.",
    annotations: { destructiveHint: true, title: "Respond to Approval" },
    inputSchema: {
      type: "object",
      properties: {
        number: str("Number of the record being approved, e.g. CHG0000001 or RITM0010001"),
        decision: { type: "string", enum: ["approved", "rejected"], description: "approved or rejected" },
        comments: str("Reason / comments (required when rejecting)"),
      },
      required: ["number", "decision"],
    },
    async handler({ sn }, args) {
      const number = assertNumber(args.number);
      if (!["approved", "rejected"].includes(args.decision)) {
        throw new ServiceNowError(400, 'decision must be "approved" or "rejected"');
      }
      if (args.decision === "rejected" && !args.comments) {
        return { error: "A rejection needs comments explaining why." };
      }
      const [approval] = await sn.list("sysapproval_approver", {
        query: `sysapproval.number=${q(number)}^approver=javascript:gs.getUserID()^state=requested`,
        fields: "sys_id",
        limit: 1,
      });
      if (!approval) return { error: `No pending approval for ${number} is assigned to the signed-in user.` };
      const body = { state: args.decision };
      if (args.comments) body.comments = args.comments;
      await sn.patch("sysapproval_approver", approval.sys_id, body);
      return { number, decision: args.decision, message: `${number} ${args.decision}` };
    },
  },
];

module.exports = { tools };
