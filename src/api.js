const BASE = "https://data-api.polymarket.com/v2/";
const ALLOWED = new Set(["leaderboard", "positions", "activity", "user-pnl"]);
export const PERIODS = ["day", "week", "month", "all"];
export const CATEGORIES = [
  "overall",
  "politics",
  "sports",
  "crypto",
  "economics",
  "tech",
  "finance",
];

export class ApiError extends Error {
  constructor(message, code = "upstream") {
    super(message);
    this.code = code;
  }
}
export function address(value) {
  if (
    typeof value !== "string" ||
    value.length !== 42 ||
    !/^0x[0-9a-fA-F]+$/.test(value)
  ) {
    throw new ApiError(
      "Введите адрес кошелька: 0x и 40 шестнадцатеричных символов.",
      "input",
    );
  }
  return value.toLowerCase();
}
export function numeric(value) {
  if (
    typeof value === "string" &&
    !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)
  )
    return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function pageShape(body) {
  if (
    !body ||
    !Array.isArray(body.data) ||
    !body.pagination ||
    !Object.hasOwn(body.pagination, "next_cursor") ||
    !(
      body.pagination.next_cursor === null ||
      typeof body.pagination.next_cursor === "string"
    ) ||
    body.pagination.next_cursor === "" ||
    (body.pagination.has_more === true &&
      body.pagination.next_cursor === null) ||
    (body.pagination.has_more === false && body.pagination.next_cursor !== null)
  ) {
    throw new ApiError(
      "Polymarket вернул неожиданную структуру страницы.",
      "schema",
    );
  }
  return body;
}
export function createApi({
  fetchImpl = fetch,
  timeoutMs = 12000,
  maxBytes = 4 * 1024 * 1024,
} = {}) {
  async function get(route, params = {}) {
    if (!ALLOWED.has(route))
      throw new ApiError("Unsupported API route.", "input");
    const url = new URL(route, BASE);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(key, String(value));
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(
          response.status === 429
            ? "Polymarket ограничил частоту запросов. Повторите позже."
            : "Polymarket ответил HTTP " + response.status + ".",
          "http",
        );
      }
      let size = 0;
      const chunks = [];
      if (!response.body)
        throw new ApiError("Пустой ответ Polymarket.", "schema");
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes)
          throw new ApiError("Ответ API превысил допустимый размер.", "limit");
        chunks.push(Buffer.from(chunk));
      }
      let body;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        throw new ApiError("Polymarket вернул некорректный JSON.", "schema");
      }
      if (!body || !Object.hasOwn(body, "data"))
        throw new ApiError("В ответе API отсутствует data.", "schema");
      return body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "Нет соединения с Polymarket Data API. Проверьте доступ к data-api.polymarket.com.",
        "network",
      );
    }
  }
  async function pages(route, params, { maxPages = 5, resume = {} } = {}) {
    const rows = [],
      seen = new Set();
    let cursor;
    for (let i = 0; i < maxPages; i++) {
      let body;
      try {
        body = pageShape(
          await get(route, cursor ? { ...resume, cursor } : params),
        );
      } catch (error) {
        return { rows, complete: false, pages: i, reason: error.message };
      }
      rows.push(...body.data);
      const next = body.pagination.next_cursor;
      if (next === null)
        return { rows, complete: true, pages: i + 1, reason: null };
      if (seen.has(next))
        return {
          rows,
          complete: false,
          pages: i + 1,
          reason: "API повторил курсор; обход остановлен.",
        };
      seen.add(next);
      cursor = next;
    }
    return {
      rows,
      complete: false,
      pages: maxPages,
      reason: "Достигнут лимит страниц; показана часть данных.",
    };
  }
  return { get, pages };
}
