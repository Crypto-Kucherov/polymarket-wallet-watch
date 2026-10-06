import { createService } from './service.js';
import { ApiError } from './api.js';
export const DEMO_WALLETS = ['1', '2', '3'].map(char => '0x' + char.repeat(40));
const names = ['Demo · Northstar', 'Demo · Steady Research', 'Demo · One Big Win'];
const profits = [Array.from({length: 36}, (_,i) => i % 4 === 0 ? -120 : 170),
  Array.from({length: 52}, (_,i) => i % 3 === 0 ? -50 : 80), [18000,-90,-200,-130,10]];
const page = data => ({ data, pagination: { next_cursor: null, has_more: false } });
export function createDemoService() {
  const now = Math.floor(Date.now() / 1000);
  const row = i => ({ user_id: DEMO_WALLETS[i], user_name: names[i], rank: i + 1,
    pnl: [13840,6240,21200][i], volume: [480000,216000,930000][i] });
  const api = {
    async get(route, params) {
      const i = params.user ? DEMO_WALLETS.indexOf(params.user) : 0;
      if (i < 0) throw new ApiError('В деморежиме доступны только три демонстрационных кошелька.', 'input');
      if (route === 'leaderboard') return params.user ? { data: row(i) } : page([2,0,1].map((n,rank)=>({...row(n),rank:rank+1})));
      if (route === 'user-pnl') return { data: { points: Array.from({length: 30}, (_,n)=>({
        timestamp: now - (29-n)*86400, economic_pnl: Math.round(11000 + n*(i===2?520:260) + Math.sin(n*0.7)*(i===2?1800:420))
      })) } };
      if (route === 'activity') return page(Array.from({length:6},(_,n)=>({
        type:'TRADE',side:n%3===0?'SELL':'BUY',title:'Демо: прогноз по событию '+(n+1),outcome:n%2?'Нет':'Да',
        usdc_size:240+n*110,size:500+n*20,timestamp:now-n*3600,event_slug:''
      })));
      throw new Error('Unknown demo route.');
    },
    async pages(route, params) {
      const i = DEMO_WALLETS.indexOf(params.user);
      if (i < 0) throw new ApiError('Выберите демонстрационный кошелёк.', 'input');
      const rows = params.status==='CLOSED' ? profits[i].map((p,n)=>({
        token_id:String(n+1),condition_id:'demo-closed-'+n,proxy_wallet:params.user,
        realized_pnl:p,title:'Демо: закрытая позиция '+(n+1),outcome:'Да',last_event_at:now-n*86400
      })) : Array.from({length:4},(_,n)=>({
        token_id:String(100+n),condition_id:'demo-open-'+n,proxy_wallet:params.user,current_size:1000+n*600,
        current_value:650+n*440,unrealized_pnl:n===2?-320:120+n*110,realized_pnl:0,
        title:['Демо: выпуск нового продукта до конца года','Демо: решение по ставке на следующем заседании','Демо: победитель спортивного турнира','Демо: достижение технического показателя'][n],
        outcome:n%2?'Нет':'Да',event_slug:'',last_event_at:now-n*10000
      }));
      return { rows, complete:true,pages:1,reason:null };
    }
  };
  return createService(api);
}
