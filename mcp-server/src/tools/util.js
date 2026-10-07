// Small helpers shared by tool modules.

const str = (description) => ({ type: "string", description });

const limitProp = { type: "integer", description: "Maximum results to return (1-50, default 20)", minimum: 1, maximum: 50 };

function notFound(kind, number) {
  return { error: `${kind} ${number} not found (or not visible to the signed-in user)` };
}

/** Attach a ServiceNow record link to each row. */
function withLinks(sn, table, rows) {
  return rows.map((r) => ({ ...r, url: sn.recordUrl(table, r.sys_id) }));
}

module.exports = { str, limitProp, notFound, withLinks };
