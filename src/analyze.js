import { address, numeric, ApiError } from "./api.js";
const text = (value, fallback = "") =>
  typeof value === "string" ? value.slice(0, 400) : fallback;
export function leaderboardRow(row) {
  if (!row || typeof row !== "object")
    throw new ApiError("Некорректная строка рейтинга.", "schema");
  let wallet;
  try {
    wallet = address(row.user_id);
  } catch {
    throw new ApiError("API вернул некорректный адрес в рейтинге.", "schema");
  }
  return {
    wallet,
    name: text(row.user_name, wallet),
    rank: numeric(row.rank ?? row.pnl_rank),
    pnl: numeric(row.pnl),
    volumeShares: numeric(row.volume),
  };
}
export function positionRows(result, wallet) {
  const seen = new Set(),
    rows = [];
  let invalid = 0;
  for (const row of result.rows) {
    if (
      !row ||
      typeof row.token_id !== "string" ||
      !row.token_id ||
      typeof row.condition_id !== "string" ||
      !row.condition_id ||
      (row.proxy_wallet &&
        (typeof row.proxy_wallet !== "string" ||
          row.proxy_wallet.toLowerCase() !== wallet))
    ) {
      invalid++;
      continue;
    }
    const key = row.condition_id + ":" + row.token_id;
    if (seen.has(key)) {
      invalid++;
      continue;
    }
    seen.add(key);
    rows.push({
      key,
      token: row.token_id,
      condition: row.condition_id,
      title: text(row.title, "Без названия"),
      outcome: text(row.outcome),
      eventSlug: text(row.event_slug),
      size: numeric(row.current_size),
      currentValue: numeric(row.current_value),
      unrealizedPnl: numeric(row.unrealized_pnl),
      realizedPnl: numeric(row.realized_pnl),
      timestamp: numeric(row.last_event_at),
    });
  }
  return {
    ...result,
    rows,
    complete: result.complete && invalid === 0,
    invalid,
    reason: invalid
      ? "Пропущены некорректные или повторные строки: " +
        invalid +
        ". " +
        (result.reason || "")
      : result.reason,
  };
}
function sumKnown(rows, field) {
  return rows.every((row) => row[field] !== null)
    ? rows.reduce((n, row) => n + row[field], 0)
    : null;
}
export function analyzeClosed(result) {
  const known = result.rows.filter((row) => row.realizedPnl !== null);
  const wins = known.filter((row) => row.realizedPnl > 0),
    losses = known.filter((row) => row.realizedPnl < 0);
  const grossProfit = wins.reduce((n, row) => n + row.realizedPnl, 0);
  const grossLoss = -losses.reduce((n, row) => n + row.realizedPnl, 0);
  const metricsAvailable = result.rows.length > 0 || result.complete;
  const allKnown = known.length === result.rows.length;
  return {
    count: result.rows.length,
    known: known.length,
    missing: result.rows.length - known.length,
    realizedPnl:
      metricsAvailable && allKnown
        ? sumKnown(result.rows, "realizedPnl")
        : null,
    wins: wins.length,
    losses: losses.length,
    flat: known.length - wins.length - losses.length,
    profitableShare:
      wins.length + losses.length
        ? wins.length / (wins.length + losses.length)
        : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    noLossesObserved: wins.length > 0 && losses.length === 0,
    largestWinShare:
      grossProfit > 0
        ? Math.max(...wins.map((row) => row.realizedPnl)) / grossProfit
        : null,
    complete: result.complete && allKnown,
  };
}
export function analyzeOpen(result) {
  const available = result.rows.length > 0 || result.complete;
  return {
    count: result.rows.length,
    currentValue: available ? sumKnown(result.rows, "currentValue") : null,
    unrealizedPnl: available ? sumKnown(result.rows, "unrealizedPnl") : null,
    complete:
      result.complete &&
      result.rows.every(
        (row) => row.currentValue !== null && row.unrealizedPnl !== null,
      ),
  };
}
export function normalizeSeries(body) {
  if (!body?.data || !Array.isArray(body.data.points))
    throw new ApiError("Некорректная кривая PnL.", "schema");
  const points = body.data.points.map((point) => ({
    timestamp: numeric(point.timestamp),
    value: numeric(point.economic_pnl),
  }));
  if (
    points.some(
      (p) => p.timestamp === null || p.timestamp <= 0 || p.value === null,
    )
  ) {
    throw new ApiError(
      "В кривой PnL отсутствуют необходимые значения.",
      "schema",
    );
  }
  return points.sort((a, b) => a.timestamp - b.timestamp);
}
export function activityRows(rows) {
  return rows.map((row) => ({
    title: text(row.title, "Без названия"),
    outcome: text(row.outcome),
    type: text(row.type),
    side: text(row.side),
    size: numeric(row.size),
    value: numeric(row.usdc_size),
    timestamp: numeric(row.timestamp),
    eventSlug: text(row.event_slug),
  }));
}
