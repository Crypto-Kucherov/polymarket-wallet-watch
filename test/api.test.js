import test from "node:test";
import assert from "node:assert/strict";
import { createApi, pageShape, numeric, address } from "../src/api.js";
const json = (data) => new Response(JSON.stringify(data));
const page = (data, next = null) => ({
  data,
  pagination: { next_cursor: next, has_more: next !== null },
});

test("strict address and numeric handling preserves zero and missing values", () => {
  assert.equal(address("0x" + "Ab".repeat(20)), "0x" + "ab".repeat(20));
  for (const bad of ["0x12", "0x" + "a".repeat(39) + "\n", null])
    assert.throws(() => address(bad));
  for (const bad of [
    null,
    undefined,
    "",
    " ",
    true,
    "Infinity",
    NaN,
    {},
    "0x10",
  ])
    assert.equal(numeric(bad), null);
  assert.equal(numeric("0"), 0);
  assert.equal(numeric("-1.5e2"), -150);
});
test("uses only fixed HTTPS GET endpoints with no credentials", async () => {
  const api = createApi({
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, "https://data-api.polymarket.com");
      assert.equal(url.pathname, "/v2/leaderboard");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.authorization, undefined);
      return json(page([]));
    },
  });
  await api.get("leaderboard", { time_period: "month" });
  await assert.rejects(api.get("https://example.com"), /Unsupported/);
});
test("positions cursor requests retain the wallet anchor", async () => {
  let calls = 0;
  const api = createApi({
    fetchImpl: async (url) => {
      if (calls++ === 0) return json(page([{ id: 1 }], "opaque"));
      assert.equal(url.searchParams.get("user"), "wallet");
      assert.equal(url.searchParams.get("cursor"), "opaque");
      assert.equal(url.searchParams.has("status"), false);
      return json(page([{ id: 2 }]));
    },
  });
  const result = await api.pages(
    "positions",
    { user: "wallet", status: "CLOSED" },
    { resume: { user: "wallet" } },
  );
  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 2);
});
test("marks capped and repeated cursors as incomplete", async () => {
  const api = createApi({
    fetchImpl: async () => json(page([{ id: 1 }], "same")),
  });
  assert.equal(
    (await api.pages("positions", {}, { maxPages: 1 })).complete,
    false,
  );
  assert.match((await api.pages("positions", {})).reason, /повторил/);
});
test("keeps already fetched rows if a later page fails", async () => {
  let count = 0;
  const api = createApi({
    fetchImpl: async () =>
      ++count === 1
        ? json(page([1], "next"))
        : new Response("", { status: 503 }),
  });
  const result = await api.pages("positions", {});
  assert.deepEqual(result.rows, [1]);
  assert.equal(result.complete, false);
});
test("schema changes and malformed responses fail explicitly", async () => {
  for (const body of [
    { data: [] },
    page([], ""),
    { data: [], pagination: { next_cursor: null, has_more: true } },
  ]) {
    assert.throws(() => pageShape(body));
  }
  await assert.rejects(
    createApi({ fetchImpl: async () => new Response("bad") }).get("activity"),
    /JSON/,
  );
  await assert.rejects(
    createApi({ fetchImpl: async () => json([]) }).get("activity"),
    /data/,
  );
});
test("response size, HTTP limits and network failures are surfaced", async () => {
  await assert.rejects(
    createApi({
      maxBytes: 10,
      fetchImpl: async () => json({ data: "long enough to overflow" }),
    }).get("activity"),
    /размер/,
  );
  await assert.rejects(
    createApi({ fetchImpl: async () => new Response("", { status: 429 }) }).get(
      "activity",
    ),
    /частоту/,
  );
  await assert.rejects(
    createApi({
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
    }).get("activity"),
    /Нет соединения/,
  );
});
