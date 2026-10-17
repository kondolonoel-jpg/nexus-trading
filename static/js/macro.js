/* Macro Intelligence : COT, rapports de banques, régimes Risk-On, alertes, + verdict par marché (Analyse IA).
   Données 100 % réelles servies par /api/macro/* (voir macro.py). */
(function(){
'use strict';
var $=function(s,r){return (r||document).querySelector(s)};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function tokenHeader(){try{var t=localStorage.getItem('nexus_token_v1');return t?{'Authorization':'Bearer '+t}:{}}catch(e){return {}}}
function get(path,opts){opts=opts||{};return fetch(path,{method:opts.method||'GET',headers:Object.assign({},opts.auth?tokenHeader():{}),cache:'no-store'}).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok)throw new Error(d.error||('Erreur '+r.status));return d})})}
function nf(n,d){return n==null?'n/d':Number(n).toLocaleString('fr-FR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0})}
function sg(n,d){return n==null?'n/d':(n>0?'+':n<0?'−':'')+nf(Math.abs(n),d)}
function kfmt(n){return n==null?'n/d':(Math.abs(n)>=1000?nf(n/1000,1)+'k':nf(n))}
function ago(ts){if(!ts)return '—';var s=Math.max(0,Date.now()/1000-ts);if(s<90)return 'à l’instant';if(s<5400)return 'il y a '+Math.round(s/60)+' min';if(s<129600)return 'il y a '+Math.round(s/3600)+' h';return 'il y a '+Math.round(s/86400)+' j'}
function dfr(iso){return iso?iso.slice(8,10)+'/'+iso.slice(5,7):'—'}
function cls(n){return n>0?'pos':n<0?'neg':''}
function tone(l){return /ACHAT|HAUSS|RISK-ON|ACHETEUR/.test(l||'')?'up':/VENTE|BAISS|RISK-OFF|VENDEUR/.test(l||'')?'down':'mid'}

/* Liste de repli : le sélecteur reste complet même si /api/markets est injoignable */
var FALLBACK=[['XAUUSD','Or (Gold)','Métaux'],['XAGUSD','Argent (Silver)','Métaux'],['GBPUSD','GBP/USD','Forex'],['EURUSD','EUR/USD','Forex'],['USDJPY','USD/JPY','Forex'],['AUDUSD','AUD/USD','Forex'],['USDCAD','USD/CAD','Forex'],['DXY','Dollar Index (DXY)','Forex'],['US30','US30 (Dow Jones)','Indices'],['US100','US100 (Nasdaq)','Indices'],['US500','US500 (S&P 500)','Indices'],['USOIL','Pétrole WTI','Énergie'],['BTCUSD','Bitcoin (BTC/USD)','Crypto'],
 ['VOL10','Volatility 10','Volatility'],['VOL25','Volatility 25','Volatility'],['VOL50','Volatility 50','Volatility'],['VOL75','Volatility 75','Volatility'],['VOL100','Volatility 100','Volatility'],['VOL10S','Volatility 10 (1s)','Volatility'],['VOL25S','Volatility 25 (1s)','Volatility'],['VOL50S','Volatility 50 (1s)','Volatility'],['VOL75S','Volatility 75 (1s)','Volatility'],['VOL100S','Volatility 100 (1s)','Volatility'],
 ['BOOM300','Boom 300','Boom & Crash'],['BOOM500','Boom 500','Boom & Crash'],['BOOM1000','Boom 1000','Boom & Crash'],['CRASH300','Crash 300','Boom & Crash'],['CRASH500','Crash 500','Boom & Crash'],['CRASH1000','Crash 1000','Boom & Crash'],
 ['STEP','Step Index','Step'],['JUMP10','Jump 10','Jump'],['JUMP25','Jump 25','Jump'],['JUMP50','Jump 50','Jump'],['JUMP75','Jump 75','Jump'],['JUMP100','Jump 100','Jump']]
 .map(function(m){var syn=['Volatility','Boom & Crash','Step','Jump'].indexOf(m[2])>=0;return {symbol:m[0],name:m[1],family:m[2],group:syn?'Synthétiques':m[2]}});

var KEY='nexus.market';
function savedSym(){try{return localStorage.getItem(KEY)||'XAUUSD'}catch(e){return 'XAUUSD'}}
var st={sym:savedSym(),markets:FALLBACK.slice(),offline:false,cot:null,banksReq:0,verdicts:null,calib:null,alerts:[],lastAlert:null,telegram:false,calibTries:0};
window.nxMarket=st.sym;
function mk(sym){for(var i=0;i<st.markets.length;i++)if(st.markets[i].symbol===sym)return st.markets[i];return null}
function isSynth(sym){var m=mk(sym);return !!m&&m.group==='Synthétiques'}

/* ---------- Sélection de marché partagée (chips groupées + menu Macro) ---------- */
function paintChips(){
  var groups=[],map={};
  st.markets.forEach(function(x){var g=x.family||x.group;if(!map[g]){map[g]=[];groups.push(g)}map[g].push(x)});
  var html=groups.map(function(g){return '<optgroup label="'+esc(g)+'">'+map[g].map(function(x){return '<option value="'+esc(x.symbol)+'"'+(x.symbol===st.sym?' selected':'')+'>'+esc(x.name)+' — '+esc(x.symbol)+'</option>'}).join('')+'</optgroup>'}).join('');
  ['#mkSelect','#mxMarket'].forEach(function(id){var s=$(id);if(s){s.innerHTML=html;s.value=st.sym}});
  var note=$('#mkNote');if(note)note.hidden=!st.offline;
}
function setMarket(sym){
  if(!sym||sym===st.sym)return;
  st.sym=sym;window.nxMarket=sym;
  try{localStorage.setItem(KEY,sym)}catch(e){}
  paintChips();renderCot();loadBanks(false);renderVerdicts(st.verdicts);
  document.dispatchEvent(new CustomEvent('nx:market',{detail:sym}));
}

/* ---------------- COT ---------------- */
function cotRow(c,name,sub,r){
  var t=(r.long||0)+(r.short||0)||1,lp=Math.max(4,Math.round((r.long||0)/t*100));
  return '<div class="cot-name">'+name+(sub?'<br><span style="font-weight:400;color:var(--text-faint)">'+sub+'</span>':'')+'</div>'
    +'<div class="cot-bar '+c+'"><i class="l" style="width:'+lp+'%">L '+kfmt(r.long)+'</i><i class="s" style="width:'+(100-lp)+'%">S '+kfmt(r.short)+'</i></div>'
    +'<div class="cot-net '+(r.net>0?'pos':r.net<0?'neg':'')+'">'+(r.net==null?'n/d':sg(r.net/1000,1)+'k net')+'</div><div class="cot-rowline"></div>';
}
function gauge(label,p){
  return '<div class="cot-gauge"><div class="g-top"><span>'+label+'</span><b>'+(p==null?'n/d':p)+'</b></div><div class="g-bar">'+(p==null?'':'<i style="left:'+p+'%"></i>')+'</div>'
    +'<div class="g-ends"><span>0 · short extrême</span><span>50</span><span>100 · long extrême</span></div></div>';
}
var COT_HEAD='<div class="mx-head"><span class="mx-chip">M1</span><h3>COT · Commerciaux vs Non-Commerciaux</h3></div>';
function renderCot(){
  var box=$('#mxCot');if(!box)return;
  if(isSynth(st.sym)){box.innerHTML=COT_HEAD+'<div class="ai-loading">Non applicable : les indices synthétiques Deriv n’ont pas de rapport COT (ils ne sont pas cotés sur un marché à terme réglementé).</div>';return}
  var d=st.cot;
  if(!d||d.loading){box.innerHTML=COT_HEAD+'<div class="ai-loading">Le serveur lit le rapport COT de la CFTC (mise à jour hebdomadaire)…</div>';return}
  var c=d.markets&&d.markets[st.sym];
  if(!c){box.innerHTML=COT_HEAD+'<div class="ai-loading">Aucune donnée COT pour '+esc(st.sym)+' (source CFTC indisponible ou marché non couvert).</div>';return}
  var cm=c.commercial,nc=c.noncommercial,nr=c.nonreportable;
  var bt=cm.pct52==null?'mid':cm.pct52>=65?'up':cm.pct52<=35?'down':'mid';
  var note='Variation hebdomadaire du net commercial : <b class="'+cls(cm.chg_week)+'">'+sg(cm.chg_week)+'</b> contrats (non-commerciaux : <b class="'+cls(nc.chg_week)+'">'+sg(nc.chg_week)+'</b>). Ratio net commercial / net spéculatif = <b>'+(c.ratio_comm_spec==null?'n/d':nf(c.ratio_comm_spec,2).replace('-','−'))+'</b>. ';
  note+=cm.net>0?'Les Commerciaux sont nets acheteurs : le biais institutionnel soutient la hausse.':'Les Commerciaux sont nets vendeurs — position de couverture habituelle sur ce marché ; lisez-la avec le percentile 52 semaines ('+(cm.pct52==null?'n/d':cm.pct52)+').';
  if(c.invert)note+=' <b>Contrat sur la devise opposée :</b> lecture inversée pour la paire '+esc(c.symbol)+'.';
  box.innerHTML='<div class="mx-head"><span class="mx-chip">M1</span><h3>COT · Commerciaux vs Non-Commerciaux</h3><span class="mx-badge mid">'+esc(c.symbol)+' · CFTC rapport du '+dfr(c.date)+'</span></div>'
    +'<div class="mx-meta"><b>'+esc(c.label)+'</b><span class="mx-badge '+bt+'">Percentile net 52 sem. · Com '+(cm.pct52==null?'n/d':cm.pct52)+' · Non-com '+(nc.pct52==null?'n/d':nc.pct52)+'</span></div>'
    +'<div class="cot-cols"><div class="cot-th">Long / Short (contrats)</div><div class="cot-th"></div><div class="cot-th">Net</div>'+cotRow('c','Commerciaux','smart money',cm)+cotRow('n','Non-Commerciaux','spéculateurs',nc)+cotRow('r','Non-reportables','petits traders',nr)+'</div>'
    +'<div class="cot-gauges">'+gauge('Commerciaux · percentile net 52 sem.',cm.pct52)+gauge('Non-commerciaux · percentile net 52 sem.',nc.pct52)+'</div>'
    +'<p class="mx-note">'+note+'</p>'+(c.flag?'<p class="mx-note warn">⚠ '+esc(c.flag)+'</p>':'')
    +'<p class="mx-note" style="font-size:10.5px;color:var(--text-faint)">Rapport Legacy futures-only de la CFTC, publié le vendredi pour le mardi précédent · '+c.weeks+' semaines d’historique · score COT du verdict : <b>'+sg(c.score,0)+'</b>.</p>';
}

/* ---------------- Banques ---------------- */
var BK_HEAD='<div class="mx-head"><span class="mx-chip">M1</span><h3>Rapports de recherche banques</h3>';
function renderBanks(d,loading,err){
  var box=$('#mxBanks');if(!box)return;
  if(loading){box.innerHTML=BK_HEAD+'</div><div class="ai-loading">Lecture des titres de presse sur '+esc(st.sym)+'… (5 à 15 s)</div>';return}
  if(d&&d.na){box.innerHTML=BK_HEAD+'</div><div class="ai-loading">'+esc(d.message)+'</div>';return}
  if(err||!d||!d.ok){box.innerHTML=BK_HEAD+'</div><div class="ai-loading">Titres indisponibles : '+esc(err||'source injoignable')+'.</div>';return}
  var head=BK_HEAD+'<span class="mx-badge '+tone(d.label)+'">'+esc(d.label)+'</span></div>';
  var rows=d.items.map(function(i){
    var tg=i.target!=null?'<b>objectif cité : '+nf(i.target,i.target<20?4:0)+'</b> · ':'';
    return '<div class="bk-row"><div class="bk-name">'+esc(i.bank)+'</div><div class="bk-text"><a href="'+esc(i.link)+'" target="_blank" rel="noopener noreferrer">'+esc(i.title)+'</a><small>'+tg+esc(i.source||'presse')+' · '+ago(i.ts)+'</small></div><span class="bk-stance '+tone(i.stance)+'">'+i.stance+'</span></div>';
  }).join('')||'<div class="ai-loading">Aucun titre récent des banques suivies sur '+esc(st.sym)+' (45 derniers jours).</div>';
  var miss=d.missing&&d.missing.length&&d.items.length?'<p class="mx-note" style="font-size:10.5px;color:var(--text-faint)">Pas de titre récent : '+esc(d.missing.join(', '))+'.</p>':'';
  box.innerHTML=head+'<div class="bk-list">'+rows+'</div>'+miss+'<p class="mx-note" style="font-size:10.5px;color:var(--text-faint)">Titres réels de la presse financière (Google News), lien vers la source. Le sens et l’objectif sont lus automatiquement dans le titre : ce n’est pas le rapport complet — ouvrez le lien pour le détail.</p>';
}
function loadBanks(force){
  if(isSynth(st.sym)){st.banksReq++;renderBanks({na:true,message:'Non applicable : pas de rapports de banques pour les indices synthétiques Deriv.'});return}
  var req=++st.banksReq;renderBanks(null,true);
  get('/api/macro/banks?symbol='+encodeURIComponent(st.sym)+(force?'&force=1':'')).then(function(d){if(req===st.banksReq)renderBanks(d)}).catch(function(e){if(req===st.banksReq)renderBanks(null,false,e.message)});
}

/* ---------------- Régimes ---------------- */
var RG_HEAD='<div class="mx-head"><span class="mx-chip">M2</span><h3>Carte des régimes de marché</h3>';
function renderRegimes(r){
  var box=$('#mxRegimes');if(!box)return;
  if(!r||r.loading||!r.data){box.innerHTML=RG_HEAD+'</div><div class="ai-loading">Le serveur calcule les régimes à partir des indices, du VIX, du dollar et des taux…</div>';return}
  var g=r.data.global||{};
  var head=RG_HEAD+'<span class="mx-badge '+tone(g.label)+'">'+(g.label?esc(g.label)+(g.pct!=null?' '+g.pct+'%':''):'n/d')+'</span></div>';
  var regs=(r.data.regions||[]).map(function(x){
    if(!x.regime)return '<div class="rg-card"><div class="rg-top"><b><em>'+esc(x.code)+'</em>'+esc(x.name)+'</b></div><p class="rg-sum">Données de marché indisponibles pour cette région.</p></div>';
    var rows=(x.rows||[]).map(function(w){return '<div class="rg-row"><span>'+esc(w.k)+'</span><b'+(w.v?'':' class="na" title="source indisponible"')+'>'+(w.v?esc(w.v):'n/d')+'</b></div>'}).join('');
    return '<div class="rg-card"><div class="rg-top"><b><em>'+esc(x.code)+'</em>'+esc(x.name)+'</b><span class="mx-badge '+(x.regime==='TRANSITOIRE'?'mid':tone(x.regime))+'">'+esc(x.regime)+'</span></div><div class="rg-bar"><i style="left:'+x.pos+'%"></i></div>'+rows+'<p class="rg-sum">'+esc(x.summary||'')+'</p></div>';
  }).join('');
  var sigs=(g.signals||[]).map(function(s){return '<span class="rg-sig'+(s.on?' on':'')+'" title="'+esc(s.detail)+'">'+(s.on?'● ':'○ ')+esc(s.label)+'</span>'}).join('');
  box.innerHTML=head+'<div class="rg-grid">'+regs+'</div><div class="rg-signals"><span class="t">Signaux risk-on : '+(g.on!=null?g.on+' / '+g.total:'n/d')+' · ≥ 60 % = Risk-On · ≤ 40 % = Risk-Off</span>'+sigs+'</div>'
    +'<p class="mx-note" style="font-size:10.5px;color:var(--text-faint)">Régime par région : tendance de l’indice (20 j, MM50), VIX pour les États-Unis. Taux : FRED (mensuel pour le Japon, la Chine et le 10 ans allemand) ; « n/d » si la série est indisponible.</p>';
}

/* ---------------- Alertes : Telegram + notifications du navigateur ---------------- */
var AL_HEAD='<div class="mx-head"><span class="mx-chip">M3</span><h3>Alertes</h3>';
function notifState(){return ('Notification' in window)?Notification.permission:'unsupported'}
function renderAlerts(){
  var box=$('#mxAlerts');if(!box)return;
  var ns=notifState();
  var tg='<span class="mx-badge '+(st.telegram?'up':'mid')+'">Telegram : '+(st.telegram?'configuré':'non configuré')+'</span>';
  var nb=ns==='unsupported'?'':'<button class="btn btn-small" id="mxNotif" type="button"'+(ns==='granted'?' disabled':'')+'>'+(ns==='granted'?'🔔 Notifications activées':ns==='denied'?'🔕 Bloquées par le navigateur':'🔔 Activer les notifications')+'</button>';
  var items=st.alerts.slice(-8).reverse().map(function(a){
    return '<div class="al-row"><span class="al-k '+a.kind+'">'+({verdict:'VERDICT',regime:'RÉGIME',test:'TEST'}[a.kind]||'ALERTE')+'</span><div><b>'+esc(a.title.replace('NEXUS TRADING · ',''))+'</b><small>'+esc(a.text)+' · '+ago(a.ts)+'</small></div></div>'}).join('')
    ||'<div class="ai-loading">Aucune alerte pour l’instant. Une alerte part quand un verdict bascule (ACHAT / NEUTRE / VENTE) ou quand le régime global change, confirmé sur 2 cycles de 15 min.</div>';
  box.innerHTML=AL_HEAD+tg+'</div><div class="al-actions">'+nb+'<button class="btn btn-small" id="mxAlertTest" type="button">Envoyer une alerte de test</button><span id="mxAlertMsg" class="al-msg"></span></div><div class="al-list">'+items+'</div>'
    +'<p class="mx-note" style="font-size:10.5px;color:var(--text-faint)">Telegram : définissez <code>TELEGRAM_BOT_TOKEN</code> et <code>TELEGRAM_CHAT_ID</code> sur le serveur. Les notifications du navigateur ne s’affichent que tant que cet onglet reste ouvert ; Telegram, lui, prévient même onglet fermé.</p>';
}
function toast(title,text){
  var box=$('#mxToasts');if(!box){box=document.createElement('div');box.id='mxToasts';box.className='mx-toasts';document.body.appendChild(box)}
  var t=document.createElement('div');t.className='mx-toast';t.innerHTML='<b>'+esc(title)+'</b><span>'+esc(text)+'</span>';box.appendChild(t);
  setTimeout(function(){t.classList.add('out');setTimeout(function(){t.remove()},400)},9000);
}
function loadAlerts(){
  get('/api/macro/alerts?since='+(st.lastAlert==null?0:st.lastAlert)).then(function(d){
    st.telegram=!!d.telegram;
    var first=st.lastAlert==null;
    (d.alerts||[]).forEach(function(a){
      st.alerts.push(a);
      if(!first){toast(a.title.replace('NEXUS TRADING · ',''),a.text);if(notifState()==='granted'){try{new Notification(a.title,{body:a.text,tag:'nexus-'+a.id})}catch(e){}}}
    });
    if(st.alerts.length>50)st.alerts=st.alerts.slice(-50);
    st.lastAlert=d.latest||0;renderAlerts();
  }).catch(function(){});
}

/* ---------------- Statut & test des sources ---------------- */
function renderStatus(s,cot,reg){
  var el=$('#mxStatus');if(!el)return;
  var bad=[];if(s&&s.sources){Object.keys(s.sources).forEach(function(k){if(!s.sources[k].ok)bad.push(k+' ('+(s.sources[k].error||'erreur')+')')})}
  var t=[];if(cot&&cot.updated_at)t.push('COT '+ago(cot.updated_at));if(reg&&reg.updated_at)t.push('régimes '+ago(reg.updated_at));
  if(!s&&!cot&&!reg){el.innerHTML='<strong class="bad">Serveur injoignable</strong> <em>· ouvrez le site via le serveur NEXUS (pas le fichier HTML seul).</em>';return}
  el.innerHTML=(bad.length?'<strong class="bad">Source en erreur</strong> <em>· '+esc(bad.join(' · '))+'</em>':'<strong>Synchronisé</strong> <em>· '+(t.join(' · ')||'en attente des premières données')+'</em>');
}
function runSelftest(){
  var box=$('#mxSelftest');if(!box)return;box.hidden=false;box.innerHTML='<div class="ai-loading">Test des sources en cours… (jusqu’à 20 s)</div>';
  get('/api/macro/selftest').then(function(d){
    box.innerHTML=d.checks.map(function(c){return '<div class="st-row"><span class="st-dot '+(c.ok?'ok':'ko')+'"></span><b>'+esc(c.name)+'</b><span>'+esc(c.detail)+'</span><em>'+c.ms+' ms</em></div>'}).join('');
  }).catch(function(e){box.innerHTML='<div class="ai-loading">Test impossible : '+esc(e.message)+'</div>'});
}

/* ---------------- Verdict par marché ---------------- */
var VD=[['macro','Macro'],['fundamental','Fondamental'],['technical','Technique D1/W1']];
function calibLine(sym){
  var c=st.calib&&st.calib.per&&st.calib.per[sym];
  if(!st.calib)return '<p class="vd-cal">Fiabilité historique : calcul en cours sur ~2 ans de données…</p>';
  if(!c)return '<p class="vd-cal">Fiabilité historique : historique insuffisant pour ce marché.</p>';
  function part(l,x){if(!x)return l+' <small>n/d</small>';var weak=x.n<100;return l+' <b class="'+(weak?'':x.hit>=55?'pos':x.hit<=48?'neg':'')+'">'+nf(x.hit,0)+' %</b> <small>(n='+x.n+(weak?' · échantillon faible':'')+')</small>'}
  return '<p class="vd-cal" title="Part des signaux (score ≥ 25 en valeur absolue) dont le sens a vu juste 5 jours plus tard, sur ~2 ans. Le COT n’est pas inclus (pas d’historique). Le passé ne garantit pas l’avenir.">Fiabilité à 5 jours · '+part('Technique',c.technical)+' · '+part('Macro',c.macro)+' · '+part('Combiné',c.combined)+'</p>';
}
function renderVerdicts(d){
  var grid=$('#vdGrid');if(!grid)return;
  st.verdicts=d;
  var v=d&&d.verdicts&&d.verdicts[st.sym]?[d.verdicts[st.sym]]:[];
  grid.classList.add('single');
  if(!v.length){grid.innerHTML='<div class="ai-loading">'+(d&&d.loading?'Le serveur récupère les données de marché…':'Aucun verdict disponible pour '+esc(st.sym)+' pour le moment (données de marché insuffisantes).')+'</div>';renderCalibNote();return}
  var up=$('#vdUpdated');if(up)up.textContent='MAJ '+ago(d.updated_at);
  grid.innerHTML=v.map(function(x){
    var t=tone(x.label),lines=VD.map(function(p){
      var c=x.components[p[0]]||{},s=c.score,w=c.weight;
      var bar=s==null?'':'<i class="'+(s>=0?'p':'n')+'" style="width:'+Math.min(50,Math.abs(s)/2)+'%"></i>';
      return '<div class="vd-line"><div class="vd-lab">'+p[1]+'<small>poids '+w+' %</small></div><div class="vd-bar">'+bar+'</div><div class="vd-val '+cls(s)+'">'+(s==null?'n/a':sg(s,0))+'</div></div>';
    }).join('');
    var why=VD.map(function(p){var c=x.components[p[0]]||{};return '<li><b>'+p[1]+' :</b> '+(c.reasons||[]).map(esc).join(' · ')+'</li>'}).join('');
    return '<div class="vd-card"><div class="vd-top"><div><h4>'+esc(x.name)+'</h4><small>'+esc(x.symbol)+' · '+esc(x.group)+' · '+x.agree+'/'+x.of+' composantes alignées</small></div><div style="text-align:right"><div class="vd-score '+cls(x.total)+'">'+sg(x.total,0)+'</div><span class="mx-badge '+t+'" style="margin-top:6px">'+esc(x.label)+'</span></div></div>'
      +lines+calibLine(x.symbol)+'<details open><summary>Raisons</summary><ul>'+why+'</ul></details></div>';
  }).join('');
  renderCalibNote();
}
function renderCalibNote(){
  var el=$('#vdCalib');if(!el)return;
  var c=st.calib;if(!c||!c.global){el.textContent=c?'Calibration : historique insuffisant pour estimer une pondération.':'';return}
  var g=c.global,sug=c.suggest;
  function p(l,x){return x?l+' '+nf(x.hit,0)+' % (n='+x.n+')':''}
  el.innerHTML='<b>Calibration</b> ('+c.markets+' marchés, ~2 ans, horizon '+c.horizon+' j) : '+[p('Technique',g.technical),p('Macro',g.macro),p('Combiné',g.combined)].filter(Boolean).join(' · ')
    +(sug?' — pondération suggérée par l’historique : Macro '+sug.macro+' · Technique '+sug.technical+' (Fondamental '+sug.fundamental+' non testable). Poids appliqués : 32 / 24 / 44.':'')
    +' Un taux proche de 50 % signifie peu d’avantage statistique ; ce n’est pas une garantie.';
}
function loadCalib(){
  get('/api/macro/calibration').then(function(d){
    if(d.status==='ready'){st.calib=d;renderVerdicts(st.verdicts)}
    else if(st.calibTries++<30)setTimeout(loadCalib,15000);
  }).catch(function(){});
}

/* ---------------- Orchestration ---------------- */
function loadMain(){
  return Promise.all([get('/api/macro/cot').catch(function(){return null}),get('/api/macro/regimes').catch(function(){return null}),get('/api/macro/status').catch(function(){return null})]).then(function(a){
    st.cot=a[0];renderCot();renderRegimes(a[1]);renderStatus(a[2],a[0],a[1]);if(a[2])st.telegram=!!a[2].telegram;
  });
}
function loadVerdicts(){get('/api/macro/verdicts').then(renderVerdicts).catch(function(){var g=$('#vdGrid');if(g)g.innerHTML='<div class="ai-loading">Serveur injoignable (/api/macro/verdicts). Ouvrez le site via le serveur NEXUS.</div>'})}
function init(){
  if(!$('#mxMarket')&&!$('#mkSelect'))return;
  if(!mk(st.sym)){st.sym='XAUUSD';window.nxMarket=st.sym}
  paintChips();renderAlerts();renderCot();
  get('/api/markets').then(function(d){
    if(d.markets&&d.markets.length){st.markets=d.markets.map(function(m){return {symbol:m.symbol,name:m.name,group:m.group,family:m.family||m.group}});st.offline=false}
    else st.offline=true;
  }).catch(function(){st.offline=true}).then(function(){
    if(!mk(st.sym)){st.sym=st.markets[0].symbol;window.nxMarket=st.sym}
    paintChips();renderCot();renderVerdicts(st.verdicts);document.dispatchEvent(new CustomEvent('nx:market',{detail:st.sym}));
  });
  ['#mkSelect','#mxMarket'].forEach(function(id){var s=$(id);if(s)s.addEventListener('change',function(){setMarket(s.value)})});
  var r=$('#mxRefresh');if(r)r.addEventListener('click',function(){loadMain();loadBanks(true);loadVerdicts();loadAlerts()});
  var tb=$('#mxTest');if(tb)tb.addEventListener('click',runSelftest);
  document.addEventListener('click',function(e){
    var t=e.target;if(!t||!t.id)return;
    if(t.id==='mxNotif'){Notification.requestPermission().then(function(){renderAlerts()})}
    if(t.id==='mxAlertTest'){var m=$('#mxAlertMsg');if(m)m.textContent='Envoi…';
      get('/api/macro/alerts/test',{method:'POST',auth:true}).then(function(d){loadAlerts();var m2=$('#mxAlertMsg');if(m2)m2.textContent=d.telegram_configured?(d.telegram_sent?'Envoyée sur Telegram.':'Telegram : échec d’envoi.'):'Alerte créée (Telegram non configuré).'}).catch(function(e){var m2=$('#mxAlertMsg');if(m2)m2.textContent=e.message})}
  });
  loadMain();loadBanks(false);loadVerdicts();loadAlerts();loadCalib();
  setInterval(function(){loadMain();loadVerdicts()},300000);
  setInterval(loadAlerts,60000);
  var tries=0,fast=setInterval(function(){tries++;if((st.cot&&!st.cot.loading)||tries>12){clearInterval(fast);return}loadMain();loadVerdicts()},10000);
}
init();
})();
