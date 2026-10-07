// Compares observed holdings, not executions. Prices and PnL do not affect it.
export const SIZE_TOLERANCE = 0.000001;
function snapshot(report) {
  if (
    !report ||
    !["live", "demo"].includes(report.mode) ||
    typeof report.wallet !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(report.wallet) ||
    typeof report.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(report.fetchedAt))
  ) {
    throw new TypeError("Invalid snapshot identity.");
  }
  const identity = report.mode + ":" + report.wallet.toLowerCase();
  if (report.coverage?.open?.complete !== true)
    return { identity, complete: false };
  if (!Array.isArray(report.open) || report.open.length > 500)
    throw new TypeError("Invalid position list.");
  const positions = new Map();
  for (const row of report.open) {
    if (
      !row ||
      typeof row.key !== "string" ||
      !row.key ||
      positions.has(row.key) ||
      typeof row.size !== "number" ||
      !Number.isFinite(row.size) ||
      row.size < 0
    ) {
      throw new TypeError("Missing or ambiguous position size.");
    }
    positions.set(row.key, {
      key: row.key,
      size: row.size,
      title:
        typeof row.title === "string"
          ? row.title.slice(0, 400)
          : "Без названия",
      outcome: typeof row.outcome === "string" ? row.outcome.slice(0, 100) : "",
    });
  }
  return {
    identity,
    complete: true,
    positions,
    at: report.fetchedAt,
    time: Date.parse(report.fetchedAt),
  };
}
function difference(before, after) {
  const changes = [];
  for (const [key, current] of after.positions) {
    const previous = before.positions.get(key);
    if (!previous) {
      changes.push({
        ...current,
        kind: "appeared",
        before: null,
        after: current.size,
        delta: null,
      });
      continue;
    }
    const delta = current.size - previous.size;
    if (Math.abs(delta) > SIZE_TOLERANCE) {
      changes.push({
        ...current,
        kind: delta > 0 ? "increased" : "decreased",
        before: previous.size,
        after: current.size,
        delta,
      });
    }
  }
  for (const [key, previous] of before.positions) {
    if (!after.positions.has(key)) {
      changes.push({
        ...previous,
        kind: "disappeared",
        before: previous.size,
        after: null,
        delta: null,
      });
    }
  }
  return changes;
}
export function createPositionTracker({ maxWallets = 50 } = {}) {
  if (!Number.isInteger(maxWallets) || maxWallets < 1 || maxWallets > 50)
    throw new TypeError("maxWallets must be 1..50.");
  const history = new Map();
  return {
    observe(report) {
      let current;
      try {
        current = snapshot(report);
      } catch {
        return { status: "invalid", changes: [], fromAt: null, toAt: null };
      }
      const previous = history.get(current.identity);
      if (!current.complete) {
        return {
          status: "incomplete",
          changes: [],
          fromAt: previous?.snapshot.at ?? null,
          toAt: null,
        };
      }
      if (previous && current.time < previous.snapshot.time) {
        return {
          status: "stale",
          changes: [],
          fromAt: previous.snapshot.at,
          toAt: current.at,
        };
      }
      if (previous && current.time === previous.snapshot.time) {
        return { ...previous.result, cached: true };
      }
      const result = previous
        ? {
            status: "compared",
            changes: difference(previous.snapshot, current),
            fromAt: previous.snapshot.at,
            toAt: current.at,
            cached: false,
          }
        : {
            status: "baseline",
            changes: [],
            fromAt: null,
            toAt: current.at,
            cached: false,
          };
      history.delete(current.identity);
      if (history.size >= maxWallets)
        history.delete(history.keys().next().value);
      history.set(current.identity, { snapshot: current, result });
      return result;
    },
  };
}
