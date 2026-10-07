const { ServiceNowError, q, assertNumber, clampLimit, isSysId, stripHtml } = require("../servicenow");
const { str, limitProp, notFound, withLinks } = require("./util");

const RITM_FIELDS = "sys_id,number,short_description,cat_item,state,stage,request,requested_for,opened_by,opened_at,assignment_group,assigned_to";

function assertSysId(value, label) {
  if (!isSysId(value)) throw new ServiceNowError(400, `Invalid ${label} "${value}". Expected a 32-character sys_id.`);
  return value;
}

const tools = [
  {
    name: "search_catalog_items",
    description:
      "Search the ServiceNow Service Catalog for orderable items (e.g. 'laptop', 'software access', 'new mailbox'). Returns item sys_ids for get_catalog_item / submit_catalog_request.",
    annotations: { readOnlyHint: true, title: "Search Catalog Items" },
    inputSchema: {
      type: "object",
      properties: { query: str("What the user wants to request"), limit: limitProp },
      required: ["query"],
    },
    async handler({ sn }, args) {
      const params = new URLSearchParams({ sysparm_text: q(args.query), sysparm_limit: String(clampLimit(args.limit, 10)) });
      const data = await sn.request("GET", `sn_sc/servicecatalog/items?${params}`);
      return (data.result || []).map((i) => ({
        sys_id: i.sys_id,
        name: i.name,
        short_description: i.short_description,
        category: i.category && typeof i.category === "object" ? i.category.title : i.category,
        type: i.type,
      }));
    },
  },
  {
    name: "get_catalog_item",
    description:
      "Get a catalog item's description and the variables (form questions) it needs, including which are mandatory and allowed choices. Call before submit_catalog_request.",
    annotations: { readOnlyHint: true, title: "Get Catalog Item" },
    inputSchema: {
      type: "object",
      properties: { sys_id: str("Catalog item sys_id from search_catalog_items") },
      required: ["sys_id"],
    },
    async handler({ sn }, args) {
      const id = assertSysId(args.sys_id, "sys_id");
      const data = await sn.request("GET", `sn_sc/servicecatalog/items/${id}`);
      const i = data.result || {};
      return {
        sys_id: i.sys_id,
        name: i.name,
        short_description: i.short_description,
        description: stripHtml(i.description).slice(0, 2000),
        price: i.price,
        variables: (i.variables || [])
          .filter((v) => v.name)
          .map((v) => ({
            name: v.name,
            label: v.label,
            type: v.friendly_type || v.type,
            mandatory: !!v.mandatory,
            ...(Array.isArray(v.choices) && v.choices.length
              ? { choices: v.choices.map((c) => ({ value: c.value, label: c.label })) }
              : {}),
          })),
      };
    },
  },
  {
    name: "submit_catalog_request",
    description:
      "Order a Service Catalog item on behalf of the signed-in user (creates a REQ and RITM). Only call after showing the user the item and variable values and getting confirmation.",
    annotations: { destructiveHint: true, title: "Submit Catalog Request" },
    inputSchema: {
      type: "object",
      properties: {
        sys_id: str("Catalog item sys_id"),
        quantity: { type: "integer", minimum: 1, maximum: 10, description: "Quantity (default 1)" },
        variables: {
          type: "object",
          description: "Variable name → value map, using names from get_catalog_item",
          additionalProperties: { type: "string" },
        },
        requested_for: str("Optional sys_id of the user the request is for (defaults to the signed-in user)"),
      },
      required: ["sys_id"],
    },
    async handler({ sn }, args) {
      const id = assertSysId(args.sys_id, "sys_id");
      const body = {
        sysparm_quantity: String(clampLimit(args.quantity, 1, 10)),
        variables: args.variables && typeof args.variables === "object" ? args.variables : {},
      };
      if (args.requested_for) body.sysparm_requested_for = assertSysId(args.requested_for, "requested_for");
      const data = await sn.request("POST", `sn_sc/servicecatalog/items/${id}/order_now`, body);
      const r = data.result || {};
      return {
        request_number: r.request_number || r.number,
        request_sys_id: r.request_id || r.sys_id,
        url: sn.recordUrl("sc_request", r.request_id || r.sys_id),
        message: `Request ${r.request_number || r.number} submitted`,
      };
    },
  },
  {
    name: "search_requested_items",
    description:
      "Search requested items (RITMs). Use mine=true for the signed-in user's own requests. Filter by state or keyword.",
    annotations: { readOnlyHint: true, title: "Search Requested Items" },
    inputSchema: {
      type: "object",
      properties: {
        mine: { type: "boolean", description: "Only items requested for the signed-in user" },
        requested_for: str("Requested-for user name (contains match)"),
        state: str("State number, e.g. 1=Open, 2=Work in Progress, 3=Closed Complete, 4=Closed Incomplete"),
        query: str("Free-text search in short_description"),
        active_only: { type: "boolean", description: "Only active items" },
        limit: limitProp,
      },
    },
    async handler({ sn }, args) {
      const parts = [];
      if (args.mine) parts.push("requested_for=javascript:gs.getUserID()");
      if (args.requested_for) parts.push(`requested_for.nameLIKE${q(args.requested_for)}`);
      if (args.state) parts.push(`state=${q(args.state)}`);
      if (args.query) parts.push(`short_descriptionLIKE${q(args.query)}`);
      if (args.active_only) parts.push("active=true");
      parts.push("ORDERBYDESCsys_created_on");
      const rows = await sn.list("sc_req_item", { query: parts.join("^"), fields: RITM_FIELDS, limit: clampLimit(args.limit) });
      return withLinks(sn, "sc_req_item", rows);
    },
  },
  {
    name: "get_requested_item",
    description: "Get details of a requested item (RITM) or request (REQ) by number, including stage and fulfilment status.",
    annotations: { readOnlyHint: true, title: "Get Requested Item" },
    inputSchema: {
      type: "object",
      properties: { number: str("RITM or REQ number, e.g. RITM0010001") },
      required: ["number"],
    },
    async handler({ sn }, args) {
      const number = assertNumber(args.number);
      if (number.startsWith("REQ")) {
        const req = await sn.findByNumber("sc_request", number);
        if (!req) return notFound("Request", number);
        const items = await sn.list("sc_req_item", { query: `request=${req.sys_id}`, fields: RITM_FIELDS, limit: 25 });
        return { ...req, url: sn.recordUrl("sc_request", req.sys_id), items: withLinks(sn, "sc_req_item", items) };
      }
      const row = await sn.findByNumber("sc_req_item", number);
      if (!row) return notFound("Requested item", number);
      return { ...row, url: sn.recordUrl("sc_req_item", row.sys_id) };
    },
  },
];

module.exports = { tools };
