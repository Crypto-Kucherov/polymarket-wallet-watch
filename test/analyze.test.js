import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClosed, analyzeOpen, positionRows, normalizeSeries, leaderboardRow } from '../src/analyze.js';
const rows = values => values.map(realizedPnl => ({ realizedPnl }));
test('separates wins, losses and break-even; no volume-as-ROI formula', () => {
  const result = analyzeClosed({ rows: rows([100, 50, -30, 0]), complete: true });
  assert.equal(result.realizedPnl, 120);
  assert.equal(result.profitableShare, 2 / 3);
  assert.equal(result.flat, 1);
  assert.equal(result.profitFactor, 5);
  assert.equal(result.largestWinShare, 2 / 3);
  assert.equal('roi' in result, false);
});
test('missing and failed data are not interpreted as zero profit', () => {
  const result = analyzeClosed({ rows: rows([10, null]), complete: true });
  assert.equal(result.realizedPnl, null);
  assert.equal(result.complete, false);
  assert.equal(analyzeClosed({ rows: [], complete: false }).realizedPnl, null);
  assert.equal(analyzeOpen({ rows: [], complete: false }).currentValue, null);
  assert.equal(analyzeClosed({ rows: [], complete: true }).realizedPnl, 0);
});
test('a winning-only sample does not claim infinite profit factor', () => {
  const result = analyzeClosed({ rows: rows([10]), complete: false });
  assert.equal(result.profitFactor, null);
  assert.equal(result.noLossesObserved, true);
  assert.equal(result.complete, false);
});
test('duplicate positions and foreign wallet rows make coverage incomplete', () => {
  const wallet = '0x' + '1'.repeat(40);
  const raw = { condition_id: 'market', token_id: '123', proxy_wallet: wallet, realized_pnl: 1 };
  const result = positionRows({ rows: [raw, raw, { ...raw, proxy_wallet: '0x' + '2'.repeat(40) }], complete: true }, wallet);
  assert.equal(result.rows.length, 1);
  assert.equal(result.invalid, 2);
  assert.equal(result.complete, false);
});
test('preserves API PnL and labels share volume without inventing returns', () => {
  const row = leaderboardRow({ user_id: '0x' + '1'.repeat(40), pnl: '12.5', volume: '200' });
  assert.equal(row.pnl, 12.5);
  assert.equal(row.volumeShares, 200);
  assert.throws(() => leaderboardRow({ user_id: 'bad' }));
});
test('series requires economic PnL without silently substituting other fields', () => {
  assert.throws(() => normalizeSeries({ data: { points: [{ timestamp: 1, realized_pnl: 10 }] } }));
  assert.deepEqual(normalizeSeries({ data: { points: [{ timestamp: 2, economic_pnl: 4 }, { timestamp: 1, economic_pnl: 3 }] } }).map(x=>x.value), [3,4]);
});
