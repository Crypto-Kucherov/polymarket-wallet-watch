import { createPositionTracker } from "./position-changes.js";

const tracker = createPositionTracker();
const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const usd = (value) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
const pct = (value) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("ru", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
const short = (value) => value.slice(0, 6) + "…" + value.slice(-4);
const tone = (value) =>
  value === null ? "" : value < 0 ? "negative" : "positive";
const periods = {
  day: "за день",
  week: "за неделю",
  month: "за месяц",
  all: "за всё время",
};
const state = {
  mode:
    new URLSearchParams(location.search).get("demo") === "1" ? "demo" : "live",
  view: "discover",
  rows: [],
  wallet: null,
  report: null,
  comparison: null,
  tab: "positions",
  boardSequence: 0,
  walletSequence: 0,
  auto: false,
  saved: [],
};
function showError(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function readSaved() {
  try {
    const rows = JSON.parse(
      localStorage.getItem("wallet-watch:" + state.mode) || "[]",
    );
    state.saved = Array.isArray(rows)
      ? rows
          .filter(
            (row) =>
              row &&
              typeof row.wallet === "string" &&
              /^0x[0-9a-f]{40}$/.test(row.wallet) &&
              typeof row.name === "string",
          )
          .slice(0, 50)
          .map(({ wallet, name }) => ({ wallet, name: name.slice(0, 100) }))
      : [];
  } catch {
    state.saved = [];
  }
  $("saved-count").textContent = state.saved.length;
}
function saveCurrent() {
  const i = state.saved.findIndex((row) => row.wallet === state.wallet);
  if (i >= 0) state.saved.splice(i, 1);
  else if (state.saved.length < 50)
    state.saved.push({
      wallet: state.wallet,
      name: state.report?.standing?.name || short(state.wallet),
    });
  else
    return showError(
      "В списке уже 50 кошельков. Удалите один, чтобы добавить новый.",
    );
  try {
    localStorage.setItem(
      "wallet-watch:" + state.mode,
      JSON.stringify(state.saved),
    );
  } catch {
    return showError("Браузер не разрешил сохранить список наблюдения.");
  }
  $("saved-count").textContent = state.saved.length;
  renderWallets();
  renderDetail();
}
function modeUI() {
  $("mode-label").textContent =
    state.mode === "demo" ? "ДЕМОНСТРАЦИЯ" : "Публичные данные";
  $("demo-banner").hidden = state.mode !== "demo";
  $("mode").textContent =
    state.mode === "demo" ? "К живым данным" : "Открыть демо";
  $("address").disabled = state.mode === "demo";
}
async function api(route, extra = {}) {
  const query = new URLSearchParams({
    mode: state.mode,
    period: $("period").value,
    category: $("category").value,
    ...extra,
  });
  const response = await fetch("/api/" + route + "?" + query, {
    signal: AbortSignal.timeout(75000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Не удалось получить данные.");
  return body;
}
function renderWallets() {
  const search = $("search").value.toLowerCase(),
    positive = $("positive").checked && state.view === "discover";
  const base =
    state.view === "saved"
      ? state.saved.map((item) => ({
          ...item,
          ...state.rows.find((row) => row.wallet === item.wallet),
        }))
      : state.rows;
  const rows = base.filter(
    (row) =>
      (!positive || row.pnl > 0) &&
      (row.name + " " + row.wallet).toLowerCase().includes(search),
  );
  $("row-count").textContent = rows.length + " кошельков";
  $("board-scope").textContent =
    state.view === "saved"
      ? "Список сохранён в этом браузере. Адрес запроса передаётся Polymarket."
      : ($("period").value === "all"
          ? "Реализованная прибыль за всё время."
          : "PnL " +
            periods[$("period").value] +
            " учитывает оценку открытых позиций.") +
        " Показаны до 50 лидеров рейтинга.";
  $("positive").disabled = state.view === "saved";
  $("wallets").innerHTML = rows.length
    ? rows
        .map(
          (row) =>
            '<button class="wallet-row ' +
            (state.wallet === row.wallet ? "selected" : "") +
            '" data-wallet="' +
            row.wallet +
            '"><span class="wallet-id"><span class="rank">' +
            escape(row.rank || "·") +
            '</span><span><span class="wallet-name">' +
            escape(row.name) +
            '</span><span class="wallet-address">' +
            short(row.wallet) +
            '</span></span></span><span class="pnl ' +
            tone(row.pnl ?? null) +
            '">' +
            usd(row.pnl) +
            '<span class="amount-caption">PnL ' +
            periods[$("period").value] +
            "</span></span></button>",
        )
        .join("")
    : '<div class="empty"><h2>' +
      (state.view === "saved"
        ? "Список пока пуст"
        : "Нет подходящих кошельков") +
      "</h2><p>" +
      (state.view === "saved"
        ? "Добавьте кошелёк кнопкой «Наблюдать»."
        : "Измените фильтр или период.") +
      "</p></div>";
  for (const button of $("wallets").querySelectorAll("[data-wallet]"))
    button.onclick = () => loadWallet(button.dataset.wallet);
}
function metric(title, value, caption, cls = "") {
  return (
    '<div class="metric"><div class="metric-label">' +
    escape(title) +
    '</div><div class="metric-value ' +
    cls +
    '">' +
    escape(value) +
    "</div><small>" +
    escape(caption) +
    "</small></div>"
  );
}
function chart(points) {
  if (points.length < 2)
    return '<p class="scope">Недостаточно точек для графика.</p>';
  const values = points.map((p) => p.value),
    min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  const path = points
    .map(
      (point, i) =>
        (i ? "L" : "M") +
        ((i / (points.length - 1)) * 600).toFixed(2) +
        "," +
        (110 - ((point.value - min) / span) * 95).toFixed(2),
    )
    .join(" ");
  const date = (point) =>
    new Date(point.timestamp * 1000).toLocaleDateString("ru", {
      day: "numeric",
      month: "short",
    });
  return (
    '<svg class="chart" viewBox="0 0 600 125" preserveAspectRatio="none" role="img" aria-label="Экономический PnL по данным API"><path d="M0 110H600 M0 60H600 M0 10H600" stroke="#263040" stroke-width="1"/><path d="' +
    path +
    '" fill="none" stroke="#74e2b0" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg><div class="chart-axis"><span>' +
    escape(date(points[0])) +
    " · " +
    usd(values[0]) +
    "</span><span>" +
    escape(date(points.at(-1))) +
    " · " +
    usd(values.at(-1)) +
    "</span></div>"
  );
}
function renderPositionChanges() {
  const comparison = state.comparison;
  if (!comparison)
    return '<p class="scope">Сначала загрузите полный срез позиций.</p>';
  const date = (value) => escape(new Date(value).toLocaleString("ru"));
  const cachedNote = comparison.cached
    ? '<p class="scope">API вернул тот же срез. Нового сравнения пока нет.</p>'
    : "";
  if (comparison.status === "baseline") {
    return (
      '<div class="change-note">Первый полный срез сохранён в этой вкладке: ' +
      date(comparison.toAt) +
      ". Изменения появятся после следующей загрузки свежих данных.</div>" +
      cachedNote
    );
  }
  const blocked = {
    incomplete:
      "Данные загружены не полностью. Сравнение пропущено; предыдущий полный срез сохранён.",
    invalid:
      "Не удалось однозначно определить позиции или их объём. Сравнение пропущено; предыдущий срез сохранён.",
    stale:
      "Этот срез старше уже полученного. Сравнение пропущено; предыдущий срез сохранён.",
  };
  if (blocked[comparison.status]) {
    return (
      '<div class="change-note incomplete">' +
      blocked[comparison.status] +
      (comparison.fromAt
        ? " Последний полный срез: " + date(comparison.fromAt) + "."
        : "") +
      "</div>"
    );
  }
  const names = {
    appeared: "Появилась в списке",
    disappeared: "Исчезла из списка",
    increased: "Объём вырос",
    decreased: "Объём снизился",
  };
  const shares = (value) =>
    new Intl.NumberFormat("ru", { maximumFractionDigits: 6 }).format(value);
  const rows = comparison.changes
    .map((row) => {
      const before =
        row.before === null
          ? "не было в выборке"
          : shares(row.before) + " долей";
      const after =
        row.after === null ? "нет в выборке" : shares(row.after) + " долей";
      return (
        '<div class="position position-change"><div><div class="position-title">' +
        escape(row.title) +
        '</div><div class="position-meta">' +
        escape(row.outcome) +
        '</div><div class="change-amount">' +
        escape(before) +
        " → " +
        escape(after) +
        '</div></div><span class="change-kind">' +
        names[row.kind] +
        "</span></div>"
      );
    })
    .join("");
  return (
    '<p class="scope change-period">Сравнение: ' +
    date(comparison.fromAt) +
    " → " +
    date(comparison.toAt) +
    "</p>" +
    cachedNote +
    (rows ||
      '<div class="change-note">Изменений в составе и объёмах позиций не обнаружено.</div>') +
    '<p class="storage-note">Это изменения между двумя срезами, а не подтверждённые покупки или продажи. Для конкретных операций смотрите активность.</p>'
  );
}
function renderEntries() {
  const r = state.report;
  if (!r) return "";
  if (state.tab === "changes") return renderPositionChanges();
  const rows = state.tab === "positions" ? r.open : r.activity;
  if (!rows.length)
    return '<p class="scope">Нет загруженных записей. Полнота данных указана выше.</p>';
  return rows
    .map((row) => {
      const href = /^[a-z0-9][a-z0-9-]*$/.test(row.eventSlug)
        ? "https://polymarket.com/event/" + encodeURIComponent(row.eventSlug)
        : null;
      const title = href
        ? '<a href="' +
          href +
          '" target="_blank" rel="noreferrer">' +
          escape(row.title) +
          "</a>"
        : escape(row.title);
      const caption =
        state.tab === "positions"
          ? escape(row.outcome) + " · " + escape(row.size ?? "—") + " долей"
          : escape(row.type) +
            " / " +
            escape(row.side) +
            " · " +
            escape(row.outcome) +
            " · " +
            (row.timestamp
              ? escape(new Date(row.timestamp * 1000).toLocaleString("ru"))
              : "дата неизвестна");
      return (
        '<div class="position"><div><div class="position-title">' +
        title +
        '</div><div class="position-meta">' +
        caption +
        '</div></div><div class="position-amount">' +
        usd(state.tab === "positions" ? row.currentValue : row.value) +
        (state.tab === "positions"
          ? '<div class="position-meta ' +
            tone(row.unrealizedPnl) +
            '">PnL ' +
            usd(row.unrealizedPnl) +
            "</div>"
          : "") +
        "</div></div>"
      );
    })
    .join("");
}
function renderDetail() {
  const r = state.report;
  if (!r) return;
  const c = r.closedMetrics,
    o = r.openMetrics,
    watching = state.saved.some((row) => row.wallet === state.wallet);
  const name = r.standing?.name || short(state.wallet);
  const caveat =
    c.count < 20
      ? "Мало наблюдений: меньше 20 закрытых позиций."
      : c.largestWinShare > 0.5
        ? "Большая часть прибыли от выигрышей пришлась на одну позицию."
        : "Сравнивайте размер выборки и концентрацию результата.";
  $("detail").innerHTML =
    '<div class="detail-top"><div><h2>' +
    escape(name) +
    '</h2><div class="address-line">' +
    escape(state.wallet) +
    '</div></div><button id="watch" class="' +
    (watching ? "secondary" : "primary") +
    '">' +
    (watching ? "✓ Наблюдаю" : "＋ Наблюдать") +
    "</button></div>" +
    '<p class="detail-scope">PnL рейтинга ' +
    periods[r.period] +
    " · Позиции и график — по всему кошельку, независимо от категории рейтинга.</p>" +
    (r.warnings.length
      ? '<ul class="warnings">' +
        r.warnings.map((w) => "<li>" + escape(w) + "</li>").join("") +
        "</ul>"
      : "") +
    '<div class="metrics">' +
    metric(
      "PnL рейтинга",
      usd(r.standing?.pnl),
      r.period === "all"
        ? "Реализованный, по данным API"
        : "С учётом оценки открытых позиций",
      tone(r.standing?.pnl ?? null),
    ) +
    metric(
      "Прибыль закрытых позиций",
      usd(c.realizedPnl),
      c.count +
        " позиций · " +
        (c.complete ? "все доступные API" : "неполная выборка"),
      tone(c.realizedPnl),
    ) +
    metric(
      "Доля прибыльных позиций",
      pct(c.profitableShare),
      c.wins +
        " прибыльных / " +
        c.losses +
        " убыточных · " +
        c.flat +
        " в ноль",
    ) +
    metric(
      "Открытые позиции",
      usd(o.currentValue),
      o.count +
        " позиций · PnL " +
        usd(o.unrealizedPnl) +
        (o.complete ? "" : " · неполные данные"),
    ) +
    "</div>" +
    '<div class="chart-block"><div class="section-top"><h3>Экономический PnL · ' +
    periods[r.period] +
    '</h3><span class="muted">кумулятивная кривая API</span></div>' +
    chart(r.series) +
    "</div>" +
    '<div class="risk ' +
    (c.count >= 20 && c.largestWinShare <= 0.5 ? "good" : "") +
    '">' +
    escape(caveat) +
    " Крупнейший выигрыш: " +
    pct(c.largestWinShare) +
    " от суммы положительных результатов. Profit factor: " +
    (c.profitFactor === null ? "—" : c.profitFactor.toFixed(2)) +
    ".</div>" +
    '<div class="subtabs"><button class="subtab ' +
    (state.tab === "positions" ? "active" : "") +
    '" id="positions-tab">Позиции (' +
    o.count +
    ')</button><button class="subtab ' +
    (state.tab === "activity" ? "active" : "") +
    '" id="activity-tab">Последняя активность</button><button class="subtab ' +
    (state.tab === "changes" ? "active" : "") +
    '" id="changes-tab">Изменения (' +
    (state.comparison?.changes.length ?? 0) +
    ")</button></div>" +
    '<div id="entries">' +
    renderEntries() +
    "</div>" +
    '<div class="detail-bottom"><label class="check"><input id="auto" type="checkbox" ' +
    (state.auto ? "checked" : "") +
    ">Обновлять выбранный кошелёк раз в минуту</label><small>Срез: " +
    escape(new Date(r.fetchedAt).toLocaleTimeString("ru")) +
    "</small></div>" +
    '<p class="storage-note">Срезы сравнения хранятся только в памяти этой вкладки. Перезагрузка страницы сбрасывает сравнение, но сохраняет список наблюдения.</p>' +
    '<p class="storage-note">Закрытые позиции: до 500 последних, без ограничения по периоду. Доля прибыльных считается среди записей с известным ненулевым результатом; это не доля выигранных сделок.</p>';
  $("watch").onclick = saveCurrent;
  $("auto").onchange = () => {
    state.auto = $("auto").checked;
  };
  $("positions-tab").onclick = () => {
    state.tab = "positions";
    renderDetail();
  };
  $("activity-tab").onclick = () => {
    state.tab = "activity";
    renderDetail();
  };
  $("changes-tab").onclick = () => {
    state.tab = "changes";
    renderDetail();
  };
}
async function loadWallet(wallet, quiet = false) {
  const sequence = ++state.walletSequence;
  state.wallet = wallet;
  renderWallets();
  if (!quiet) {
    state.report = null;
    $("detail").innerHTML =
      '<div class="loading">Загружаю позиции и историю…</div>';
  }
  try {
    const report = await api("wallet", { wallet });
    if (sequence !== state.walletSequence) return;
    state.comparison = tracker.observe(report);
    state.report = report;
    renderDetail();
  } catch (error) {
    if (sequence !== state.walletSequence) return;
    showError(error.message);
    if (!quiet)
      $("detail").innerHTML =
        '<div class="empty"><h2>Данные недоступны</h2><p>Повторите запрос или откройте деморежим.</p></div>';
  }
}
async function loadBoard(walletToRestore = null) {
  const sequence = ++state.boardSequence;
  showError("");
  $("refresh").disabled = true;
  state.walletSequence++;
  state.report = null;
  state.wallet = null;
  state.rows = [];
  $("wallets").innerHTML = '<div class="loading">Загружаю рейтинг…</div>';
  $("detail").innerHTML =
    '<div class="empty"><h2>Выберите кошелёк</h2><p>Результаты появятся после загрузки рейтинга.</p></div>';
  try {
    const report = await api("leaderboard");
    if (sequence !== state.boardSequence) return;
    state.rows = report.rows;
    renderWallets();
    if (typeof walletToRestore === "string") await loadWallet(walletToRestore);
    else if (state.view === "discover" && state.rows.length)
      await loadWallet(state.rows[0].wallet);
  } catch (error) {
    if (sequence !== state.boardSequence) return;
    showError(error.message);
    renderWallets();
  } finally {
    if (sequence === state.boardSequence) $("refresh").disabled = false;
  }
}
$("mode").onclick = () => {
  state.mode = state.mode === "demo" ? "live" : "demo";
  readSaved();
  modeUI();
  loadBoard();
};
$("period").onchange = loadBoard;
$("category").onchange = loadBoard;
$("refresh").onclick = () => loadBoard(state.wallet);
$("search").oninput = renderWallets;
$("positive").onchange = renderWallets;
for (const view of ["discover", "saved"])
  $(view).onclick = () => {
    state.view = view;
    $("discover").classList.toggle("active", view === "discover");
    $("saved").classList.toggle("active", view === "saved");
    renderWallets();
  };
$("address-form").onsubmit = (event) => {
  event.preventDefault();
  const wallet = $("address").value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet))
    return showError("Нужен публичный адрес: 0x и 40 hex-символов.");
  showError("");
  loadWallet(wallet);
};
setInterval(() => {
  if (state.auto && state.wallet && !document.hidden)
    loadWallet(state.wallet, true);
}, 60000);
readSaved();
modeUI();
loadBoard();
