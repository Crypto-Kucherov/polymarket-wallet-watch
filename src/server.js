import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createService, selection } from "./service.js";
import { createDemoService } from "./demo.js";
import { ApiError, address } from "./api.js";
const assets = new Map([
  ["/", ["../public/index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["../public/app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["../public/style.css", "text/css; charset=utf-8"]],
]);
export function createApp({
  live = createService(),
  demo = createDemoService(),
} = {}) {
  return createServer(async (req, res) => {
    const host = req.headers.host || "";
    const allowedHosts = new Set([
      "127.0.0.1:" + req.socket.localPort,
      "localhost:" + req.socket.localPort,
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    if (
      !allowedHosts.has(host) ||
      (req.headers.origin && req.headers.origin !== "http://" + host)
    )
      return json(403, { error: "Local access only." });
    if (req.method !== "GET") return json(405, { error: "Read-only server." });
    try {
      const url = new URL(req.url, "http://" + host);
      if (assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const data = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
        return;
      }
      if (url.pathname === "/api/health") return json(200, { ok: true });
      if (!["/api/leaderboard", "/api/wallet"].includes(url.pathname))
        return json(404, { error: "Not found." });
      const mode = url.searchParams.get("mode") || "live";
      if (!["live", "demo"].includes(mode))
        throw new ApiError("Неизвестный режим.", "input");
      const { period, category } = selection(
        url.searchParams.get("period") || "month",
        url.searchParams.get("category") || "overall",
      );
      const service = mode === "demo" ? demo : live;
      const result =
        url.pathname === "/api/leaderboard"
          ? await service.leaderboard(period, category)
          : await service.wallet(
              address(url.searchParams.get("wallet")),
              period,
              category,
            );
      json(200, { ...result, mode });
    } catch (error) {
      json(error.code === "input" ? 400 : 502, {
        error:
          error instanceof ApiError
            ? error.message
            : "Не удалось получить данные. Повторите запрос позже.",
      });
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("PORT must be between 1024 and 65535.");
  const server = createApp();
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? "Порт занят. Задайте другой PORT."
        : "Не удалось запустить сервер.",
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log("Wallet Watch: http://127.0.0.1:" + port),
  );
}
