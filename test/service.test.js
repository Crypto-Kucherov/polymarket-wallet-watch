import test from "node:test";
import assert from "node:assert/strict";
import { createService, selection } from "../src/service.js";
const wallet = "0x" + "1".repeat(40);
const page = (data) => ({ data, pagination: { next_cursor: null } });
test("service uses correct v2 selectors and keeps metrics scopes distinct", async () => {
  const service = createService({
    get: async (route, params) => {
      if (route === "leaderboard") {
        assert.equal(params.time_period, "month");
        return { data: { user_id: wallet, pnl: 99 } };
      }
      if (route === "user-pnl") return { data: { points: [] } };
      return page([]);
    },
    pages: async (route, params) => {
      if (params.status === "CLOSED") {
        assert.equal(params.include_archived, undefined);
        assert.equal(params.sort_by, "TIMESTAMP");
      } else assert.equal(params.include_archived, true);
      return { rows: [], complete: true, pages: 1, reason: null };
    },
  });
  const result = await service.wallet(wallet);
  assert.equal(result.standing.pnl, 99);
  assert.equal(result.closedMetrics.realizedPnl, 0);
});
test("failed lookups are not cached as empty successful wallets", async () => {
  let calls = 0;
  const service = createService({
    get: async () => {
      calls++;
      throw new Error("offline");
    },
    pages: async () => ({
      rows: [],
      pages: 0,
      complete: false,
      reason: "offline",
    }),
  });
  await assert.rejects(service.wallet(wallet), /offline/);
  await assert.rejects(service.wallet(wallet), /offline/);
  assert.equal(calls, 6);
});
test("coalesces identical discovery requests and rejects invalid selectors", async () => {
  let calls = 0;
  const service = createService({
    get: async () => {
      calls++;
      return page([]);
    },
  });
  await Promise.all([
    service.leaderboard("month", "overall"),
    service.leaderboard("month", "overall"),
  ]);
  assert.equal(calls, 1);
  assert.throws(() => selection("forever", "overall"));
});
