import { createApi, address, PERIODS, CATEGORIES, ApiError, pageShape } from './api.js';
import { leaderboardRow, positionRows, analyzeClosed, analyzeOpen, normalizeSeries, activityRows } from './analyze.js';

export function selection(period = 'month', category = 'overall') {
  if (!PERIODS.includes(period) || !CATEGORIES.includes(category)) throw new ApiError('Неизвестный период или категория.', 'input');
  return { period, category };
}
export function createService(api = createApi()) {
  const cache = new Map(), pending = new Map();
  async function cached(key, loader) {
    if (cache.get(key)?.expires > Date.now()) return cache.get(key).value;
    if (pending.has(key)) return pending.get(key);
    const promise = loader().then(value => {
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: Date.now() + 60000 });
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  async function leaderboard(period, category) {
    selection(period, category);
    return cached('board:' + period + ':' + category, async () => {
      const page = pageShape(await api.get('leaderboard', { time_period: period, category, sort_by: 'PNL', limit: 50 }));
      return { mode: 'live', fetchedAt: new Date().toISOString(), period, category,
        rows: page.data.map(leaderboardRow), hasMore: page.pagination.next_cursor !== null };
    });
  }
  async function wallet(rawWallet, period = 'month', category = 'overall') {
    const user = address(rawWallet);
    selection(period, category);
    return cached('wallet:' + user + ':' + period + ':' + category, async () => {
      const settled = await Promise.allSettled([
        api.get('leaderboard', { user, time_period: period, category }),
        api.pages('positions', { user, status: 'CLOSED', sort_by: 'TIMESTAMP', sort_direction: 'DESC', limit: 100 }, { resume: { user } }),
        api.pages('positions', { user, status: 'OPEN', include_archived: true, filter_amount: 0, limit: 100 }, { resume: { user, include_archived: true, filter_amount: 0 } }),
        api.get('user-pnl', { user, interval: { day: '1d', week: '1w', month: '1m', all: 'all' }[period], fidelity: '1d' }),
        api.get('activity', { user, limit: 30, sort_direction: 'DESC' }),
      ]);
      const warnings = [];
      function result(index, fallback, title) {
        const item = settled[index];
        if (item.status === 'fulfilled') return item.value;
        warnings.push(title + ': ' + item.reason.message);
        return fallback;
      }
      const board = result(0, null, 'Рейтинг');
      let standing = null;
      if (board?.data) {
        try { standing = leaderboardRow(board.data); }
        catch (error) { warnings.push(error.message); }
      }
      const empty = { rows: [], complete: false, pages: 0, reason: 'Данные не загружены.' };
      const closed = positionRows(result(1, empty, 'Закрытые позиции'), user);
      const open = positionRows(result(2, empty, 'Открытые позиции'), user);
      let series = [];
      try { const body = result(3, null, 'Кривая PnL'); if (body) series = normalizeSeries(body); }
      catch (error) { warnings.push(error.message); }
      let activity = [], activityHasMore = false;
      try {
        const body = result(4, null, 'Активность');
        if (body) { pageShape(body); activity = activityRows(body.data); activityHasMore = body.pagination.next_cursor !== null; }
      } catch (error) { warnings.push(error.message); }
      if (closed.reason) warnings.push('Закрытые позиции: ' + closed.reason);
      if (open.reason) warnings.push('Открытые позиции: ' + open.reason);
      if (!standing && closed.pages === 0 && open.pages === 0 && !series.length && !activity.length) {
        throw new ApiError(warnings[0] || 'Данные кошелька недоступны.');
      }
      const closedMetrics = analyzeClosed(closed), openMetrics = analyzeOpen(open);
      if (closedMetrics.missing) warnings.push('У части закрытых позиций отсутствует прибыль; итоговая сумма не рассчитана.');
      return { mode: 'live', fetchedAt: new Date().toISOString(), wallet: user, period, category,
        standing, closedMetrics, openMetrics, open: open.rows, series, activity, activityHasMore,
        coverage: { closed: { complete: closed.complete, pages: closed.pages }, open: { complete: open.complete, pages: open.pages } }, warnings };
    });
  }
  return { leaderboard, wallet };
}
