import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { DEMO_WALLETS } from "../src/demo.js";
import { once } from "node:events";
import { request } from "node:http";
async function setup(t) {
  let liveCalls = 0;
  const server = createApp({
    live: {
      leaderboard: async () => {
        liveCalls++;
        throw new Error("secret upstream details");
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    url: "http://127.0.0.1:" + server.address().port,
    calls: () => liveCalls,
  };
}
test("demo is explicit, synthetic and does not call live endpoints", async (t) => {
  const { url, calls } = await setup(t);
  const response = await fetch(url + "/api/leaderboard?mode=demo");
  const board = await response.json();
  assert.equal(board.mode, "demo");
  assert.match(board.rows[0].name, /Demo/);
  const wallet = await (
    await fetch(url + "/api/wallet?mode=demo&wallet=" + DEMO_WALLETS[0])
  ).json();
  assert.equal(wallet.mode, "demo");
  assert.equal(wallet.closedMetrics.count, 36);
  assert.equal(calls(), 0);
});
test("server rejects external origins, unsafe host headers and write methods", async (t) => {
  const { url } = await setup(t);
  assert.equal(
    (
      await fetch(url + "/api/health", {
        headers: { Origin: "https://example.com" },
      })
    ).status,
    403,
  );
  const status = await new Promise((resolve, reject) => {
    const req = request(
      url + "/api/health",
      { headers: { Host: "attacker.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
  assert.equal(
    (await fetch(url + "/api/health", { method: "POST" })).status,
    405,
  );
});
test("private paths are not served and errors do not expose upstream internals", async (t) => {
  const { url } = await setup(t);
  assert.equal((await fetch(url + "/.git/config")).status, 404);
  const response = await fetch(url + "/api/leaderboard");
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes("secret upstream"), false);
  assert.equal((await fetch(url + "/api/wallet?wallet=invalid")).status, 400);
});
test("serves the comparison module as JavaScript without exposing source directories", async (t) => {
  const { url } = await setup(t);
  const response = await fetch(url + "/position-changes.js");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/javascript/);
  assert.match(await response.text(), /export function createPositionTracker/);
  assert.equal((await fetch(url + "/src/service.js")).status, 404);
});
