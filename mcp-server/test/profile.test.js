const test = require("node:test");
const assert = require("node:assert/strict");
const { tools } = require("../src/tools/people");

const profileTool = tools.find((tool) => tool.name === "get_my_profile");

test("profile bootstrap resolves the authenticated user before their groups", async () => {
  const calls = [];
  const profile = { sys_id: "user-one", name: "Demo User", department: "IT", location: "London" };
  const sn = {
    async list(table, options) {
      calls.push({ table, options });
      return table === "sys_user" ? [profile] : [{ group: "Service Desk" }];
    },
  };
  const result = await profileTool.handler({ sn });
  assert.equal(calls[0].table, "sys_user");
  assert.equal(calls[0].options.query, "sys_id=javascript:gs.getUserID()");
  assert.equal(calls[1].table, "sys_user_grmember");
  assert.equal(calls[1].options.query, "user=user-one");
  assert.deepEqual(result, { ...profile, groups: ["Service Desk"] });
});

test("profile bootstrap does not reuse another authenticated user's context", async () => {
  function connectionFor(sysId, name, group) {
    return {
      async list(table, options) {
        if (table === "sys_user") return [{ sys_id: sysId, name }];
        assert.equal(options.query, `user=${sysId}`);
        return [{ group }];
      },
    };
  }
  const [first, second] = await Promise.all([
    profileTool.handler({ sn: connectionFor("user-one", "First User", "Service Desk") }),
    profileTool.handler({ sn: connectionFor("user-two", "Second User", "Finance") }),
  ]);
  assert.deepEqual(first, { sys_id: "user-one", name: "First User", groups: ["Service Desk"] });
  assert.deepEqual(second, { sys_id: "user-two", name: "Second User", groups: ["Finance"] });
});

test("unresolved identity does not trigger a group lookup", async () => {
  const calls = [];
  const result = await profileTool.handler({ sn: {
    async list(table) {
      calls.push(table);
      return [];
    },
  } });
  assert.deepEqual(calls, ["sys_user"]);
  assert.deepEqual(result, { error: "Could not resolve the signed-in user" });
});

test("profile bootstrap propagates permissions errors without identity fallback", async () => {
  const forbidden = new Error("ServiceNow 403 Forbidden");
  await assert.rejects(profileTool.handler({ sn: {
    async list() {
      throw forbidden;
    },
  } }), (error) => error === forbidden);
});