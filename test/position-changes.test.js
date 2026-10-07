import test from "node:test";
import assert from "node:assert/strict";
import {
  createPositionTracker,
  SIZE_TOLERANCE,
} from "../public/position-changes.js";
const wallet = "0x" + "1".repeat(40);
const position = (key, size, extra = {}) => ({
  key,
  size,
  title: "Example " + key,
  outcome: "Yes",
  ...extra,
});
const report = (open, seconds = 0, extra = {}) => ({
  mode: "live",
  wallet,
  fetchedAt: new Date(Date.UTC(2026, 9, 7, 12, 0, seconds)).toISOString(),
  coverage: { open: { complete: true } },
  open,
  ...extra,
});

test("first complete response establishes a baseline without invented activity", () => {
  const result = createPositionTracker().observe(report([position("a", 100)]));
  assert.equal(result.status, "baseline");
  assert.deepEqual(result.changes, []);
});
test("detects appearances, size changes and disappearance by stable position key", () => {
  const tracker = createPositionTracker();
  tracker.observe(
    report([position("a", 100), position("b", 80), position("c", 50)]),
  );
  const result = tracker.observe(
    report([position("a", 120), position("b", 30), position("d", 12)], 60),
  );
  assert.deepEqual(
    result.changes.map((row) => row.kind),
    ["increased", "decreased", "appeared", "disappeared"],
  );
  assert.equal(result.changes[0].delta, 20);
  assert.equal(result.changes[1].delta, -50);
  assert.equal(result.changes[2].before, null);
  assert.equal(result.changes[3].after, null);
  assert.equal(result.changes[3].delta, null);
});
test("price and PnL movement alone does not become a size change", () => {
  const tracker = createPositionTracker();
  tracker.observe(
    report([position("a", 100, { currentValue: 50, unrealizedPnl: 5 })]),
  );
  const result = tracker.observe(
    report([position("a", 100, { currentValue: 60, unrealizedPnl: 15 })], 60),
  );
  assert.deepEqual(result.changes, []);
});
test("incomplete responses do not claim removals or replace the last complete baseline", () => {
  const tracker = createPositionTracker();
  tracker.observe(report([position("a", 100), position("b", 50)]));
  const partial = tracker.observe(
    report([position("a", 110)], 60, {
      coverage: { open: { complete: false } },
    }),
  );
  assert.equal(partial.status, "incomplete");
  assert.deepEqual(partial.changes, []);
  const complete = tracker.observe(
    report([position("a", 120), position("b", 50)], 120),
  );
  assert.equal(complete.changes[0].before, 100);
  assert.equal(complete.changes.length, 1);
});
test("complete empty inventory differs from a failed or incomplete empty result", () => {
  const tracker = createPositionTracker();
  tracker.observe(report([position("a", 10)]));
  assert.equal(
    tracker.observe(report([], 30, { coverage: { open: { complete: false } } }))
      .changes.length,
    0,
  );
  assert.equal(tracker.observe(report([], 60)).changes[0].kind, "disappeared");
});
test("a partial first response cannot establish a baseline", () => {
  const tracker = createPositionTracker();
  assert.equal(
    tracker.observe(report([], 0, { coverage: { open: { complete: false } } }))
      .status,
    "incomplete",
  );
  assert.equal(
    tracker.observe(report([position("a", 10)], 60)).status,
    "baseline",
  );
});
test("isolates wallets and separates live data from demonstration data", () => {
  const tracker = createPositionTracker();
  tracker.observe(report([position("a", 10)]));
  assert.equal(
    tracker.observe(report([position("a", 100)], 60, { mode: "demo" })).status,
    "baseline",
  );
  assert.equal(
    tracker.observe(report([], 60, { wallet: "0x" + "2".repeat(40) })).status,
    "baseline",
  );
  assert.equal(
    tracker.observe(report([position("a", 20)], 120)).changes[0].delta,
    10,
  );
});
test("reuses the prior comparison for cached responses without duplicating activity", () => {
  const tracker = createPositionTracker();
  tracker.observe(report([position("a", 10)]));
  const result = tracker.observe(report([position("a", 20)], 60));
  const repeat = tracker.observe(report([position("a", 20)], 60));
  assert.equal(repeat.cached, true);
  assert.deepEqual(repeat.changes, result.changes);
  assert.deepEqual(
    tracker.observe(report([position("a", 20)], 120)).changes,
    [],
  );
});
test("out-of-order responses never roll back the baseline", () => {
  const tracker = createPositionTracker();
  tracker.observe(report([position("a", 10)], 60));
  assert.equal(tracker.observe(report([], 0)).status, "stale");
  assert.equal(
    tracker.observe(report([position("a", 20)], 120)).changes[0].before,
    10,
  );
});
test("unknown sizes, duplicate keys and invalid reports are not treated as zero", () => {
  const tracker = createPositionTracker();
  tracker.observe(report([position("a", 10)]));
  for (const bad of [
    report([position("a", null)], 30),
    report([position("a", -1)], 30),
    report([position("a", Infinity)], 30),
    report([position("a", 1), position("a", 2)], 30),
    report([], 30, { fetchedAt: "bad" }),
    report([], 30, { wallet: "bad" }),
  ]) {
    assert.equal(tracker.observe(bad).status, "invalid");
  }
  assert.equal(
    tracker.observe(report([position("a", 20)], 60)).changes[0].before,
    10,
  );
});
test("copies input rows so later mutations cannot change the baseline", () => {
  const tracker = createPositionTracker(),
    first = report([position("a", 10)]);
  tracker.observe(first);
  first.open[0].size = 999;
  assert.equal(
    tracker.observe(report([position("a", 20)], 60)).changes[0].before,
    10,
  );
});
test("ignores rounding noise below the documented size tolerance", () => {
  const tracker = createPositionTracker();
  tracker.observe(report([position("a", 10)]));
  assert.deepEqual(
    tracker.observe(report([position("a", 10 + SIZE_TOLERANCE / 2)], 60))
      .changes,
    [],
  );
});
test("bounded tab memory evicts old wallets rather than claiming first-load changes", () => {
  const tracker = createPositionTracker({ maxWallets: 1 });
  tracker.observe(report([position("a", 10)]));
  tracker.observe(report([], 60, { wallet: "0x" + "2".repeat(40) }));
  assert.equal(tracker.observe(report([], 120)).status, "baseline");
  assert.throws(() => createPositionTracker({ maxWallets: 0 }));
});
