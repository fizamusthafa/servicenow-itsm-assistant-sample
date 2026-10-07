const { q, assertNumber, clampLimit, stripHtml } = require("../servicenow");
const { str, limitProp, notFound, withLinks } = require("./util");

const tools = [
  {
    name: "search_knowledge",
    description:
      "Search published ServiceNow knowledge base articles. Use to find troubleshooting steps or known fixes before creating or while working an incident.",
    annotations: { readOnlyHint: true, title: "Search Knowledge" },
    inputSchema: {
      type: "object",
      properties: {
        query: str("Keywords to search for in article title and body"),
        knowledge_base: str("Optional knowledge base title (contains match)"),
        limit: limitProp,
      },
      required: ["query"],
    },
    async handler({ sn }, args) {
      const term = q(args.query);
      const parts = ["workflow_state=published", `short_descriptionLIKE${term}^ORtextLIKE${term}`];
      if (args.knowledge_base) parts.push(`kb_knowledge_base.titleLIKE${q(args.knowledge_base)}`);
      parts.push("ORDERBYDESCsys_view_count");
      const rows = await sn.list("kb_knowledge", {
        query: parts.join("^"),
        fields: "sys_id,number,short_description,kb_knowledge_base,kb_category,sys_updated_on,sys_view_count",
        limit: clampLimit(args.limit, 10),
      });
      return withLinks(sn, "kb_knowledge", rows);
    },
  },
  {
    name: "get_knowledge_article",
    description: "Get a knowledge article by number (e.g. KB0000011). Returns plain text and a source link for troubleshooting steps.",
    annotations: { readOnlyHint: true, title: "Get Knowledge Article" },
    inputSchema: {
      type: "object",
      properties: { number: str("Knowledge article number, e.g. KB0000011") },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const row = await sn.findByNumber("kb_knowledge", assertNumber(args.number), {
        fields: "sys_id,number,short_description,text,kb_knowledge_base,kb_category,author,sys_updated_on,workflow_state",
      });
      if (!row) return notFound("Knowledge article", args.number);
      const text = stripHtml(row.text);
      return {
        ...row,
        text: text.length > 8000 ? `${text.slice(0, 8000)}\n…(truncated, open the link for the full article)` : text,
        url: sn.recordUrl("kb_knowledge", row.sys_id),
      };
    },
  },
];

module.exports = { tools };
