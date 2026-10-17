/* ================= NEXUS AUTH + LIVE NEWS + ANALYSE IA ================= */
(function(){
'use strict';
var TOKEN_KEY='nexus_token_v1';
function $(s){return document.querySelector(s)}
function $$(s){return Array.prototype.slice.call(document.querySelectorAll(s))}
/* Stockage du token : localStorage + sessionStorage (fallback iframes sandbox) */
function saveToken(t){try{localStorage.setItem(TOKEN_KEY,t)}catch(e){}try{sessionStorage.setItem(TOKEN_KEY,t)}catch(e){}}
function loadToken(){try{var t=localStorage.getItem(TOKEN_KEY);if(t)return t}catch(e){}try{return sessionStorage.getItem(TOKEN_KEY)}catch(e){return null}}
function clearToken(){try{localStorage.removeItem(TOKEN_KEY)}catch(e){}try{sessionStorage.removeItem(TOKEN_KEY)}catch(e){}}

/* ---------- Navigation une seule page : le menu fait défiler vers chaque section ---------- */
document.addEventListener('click',function(e){
  var t=e.target;
  var a=(t&&t.closest)?t.closest('a[href^="#"]'):null;
  if(!a)return;
  var id=(a.getAttribute('href')||'').slice(1);
  var el=id&&document.getElementById(id);
  if(!el)return;
  e.preventDefault();e.stopPropagation();
  var nl=document.getElementById('navLinks'),nt=document.getElementById('navToggle');
  if(nl)nl.classList.remove('open');
  if(nt){nt.setAttribute('aria-expanded','false');nt.textContent='Menu';}
  try{history.replaceState(null,'','#'+id)}catch(_){}
  try{el.scrollIntoView({behavior:'smooth',block:'start'})}catch(_){}
},true);

var gate=$('#authGate'), chip=$('#userChip'), chipName=$('#userChipName');
var user=null, newsTimer=null, aiTimer=null, statusTimer=null;
var nfState={cat:'all',impact:false,items:[],updated:null,refresh:180};
var aiState={updated:null,refresh:900};

/* ---------- API ---------- */
function api(path,opts){
  opts=opts||{};
  var headers=opts.headers||{};
  var tok=loadToken();
  if(tok){
    headers['Authorization']='Bearer '+tok;
    // Repli : certains proxys retirent le header Authorization -> token aussi en query string
    path+=(path.indexOf('?')===-1?'?':'&')+'token='+encodeURIComponent(tok);
  }
  if(opts.body) headers['Content-Type']='application/json';
  return fetch(path,{method:opts.method||'GET',headers:headers,body:opts.body?JSON.stringify(opts.body):undefined}).catch(function(){
    var e=new Error('Serveur NEXUS injoignable. Ouvrez l’application via la preview du serveur, pas le fichier HTML seul.');
    e.network=true; throw e;
  }).then(function(res){
    return res.json().catch(function(){return {}}).then(function(data){
      if(!res.ok) { var e=new Error(data.error||('Erreur '+res.status)); e.status=res.status; throw e; }
      return data;
    });
  });
}

/* ---------- Verbes UI ---------- */
function setMsg(sel,txt,ok){var el=$(sel);el.textContent=txt||'';el.classList.toggle('ok',!!ok)}
function btnLoading(btn,on,label){if(!btn)return;btn.disabled=on;if(on){btn.dataset.label=btn.textContent;btn.textContent=label||'…'}else if(btn.dataset.label){btn.textContent=btn.dataset.label}}

/* ---------- Auth ---------- */
function showTab(which){
  var login=which==='login';
  $('#tabLogin').classList.toggle('active',login);
  $('#tabRegister').classList.toggle('active',!login);
  $('#loginForm').hidden=!login;
  $('#registerForm').hidden=login;
}
$('#tabLogin').addEventListener('click',function(){showTab('login')});
$('#tabRegister').addEventListener('click',function(){showTab('register')});

$('#loginForm').addEventListener('submit',function(ev){
  ev.preventDefault();
  var u=$('#loginUser').value.trim(), p=$('#loginPass').value;
  if(!u||!p){setMsg('#loginMsg','Renseignez votre nom d’utilisateur et votre mot de passe.');return}
  var btn=$('#loginBtn');
  setMsg('#loginMsg','');
  btnLoading(btn,true,'Connexion…');
  api('/api/login',{method:'POST',body:{username:u,password:p}})
    .then(function(d){saveToken(d.token);user=d.user;enterApp()})
    .catch(function(e){setMsg('#loginMsg',e.message)})
    .then(function(){btnLoading(btn,false)});
});

$('#registerForm').addEventListener('submit',function(ev){
  ev.preventDefault();
  var u=$('#regUser').value.trim(), p1=$('#regPass').value,p2=$('#regPass2').value;
  if(u.length<3||u.length>32){setMsg('#regMsg','Nom d’utilisateur : 3 à 32 caractères (lettres, chiffres, espace, _ . -).');return}
  if(p1.length<6){setMsg('#regMsg','Mot de passe trop court : 6 caractères minimum.');return}
  if(p1!==p2){setMsg('#regMsg','Les mots de passe ne correspondent pas.');return}
  var btn=$('#regBtn');
  setMsg('#regMsg','');
  btnLoading(btn,true,'Création…');
  api('/api/register',{method:'POST',body:{username:u,email:$('#regEmail').value.trim(),password:p1}})
    .then(function(d){saveToken(d.token);user=d.user;enterApp()})
    .catch(function(e){setMsg('#regMsg',e.message)})
    .then(function(){btnLoading(btn,false)});
});

$('#logoutBtn').addEventListener('click',function(){
  clearToken();
  location.reload();
});

function enterApp(){
  document.body.classList.remove('locked');
  gate.hidden=true;
  chip.hidden=false;
  chipName.textContent='● '+(user||'');
  startLive();
}

/* ---------- Horodatage relatif ---------- */
function ago(ts){
  var s=Math.max(1,Math.floor(Date.now()/1000-ts));
  if(s<60)return 'il y a '+s+' s';
  var m=Math.floor(s/60); if(m<60)return 'il y a '+m+' min';
  var h=Math.floor(m/60); if(h<24)return 'il y a '+h+' h';
  return 'il y a '+Math.floor(h/24)+' j';
}
function fmtPrice(p){
  if(p==null||isNaN(p))return '—';
  var d=p>=1000?1:(p>=50?2:(p>=2?3:5));
  return p.toLocaleString('fr-FR',{minimumFractionDigits:Math.min(d,4),maximumFractionDigits:d});
}

/* ---------- News temps réel ---------- */
function renderNews(){
  var list=$('#nfList');
  var items=nfState.items.filter(function(it){
    var okCat=nfState.cat==='all'||it.category===nfState.cat;
    var okImp=!nfState.impact||it.impact==='high';
    return okCat&&okImp;
  });
  if(!items.length){list.innerHTML='<div class="live-feed-empty">Aucune actualité pour ce filtre.</div>';return}
  list.innerHTML=items.slice(0,60).map(function(it){
    var catCls='cat-'+String(it.category).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z]/g,'');
    var when=new Date(it.timestamp*1000);
    var clock=when.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    return '<div class="nf-item">'
      +'<div class="nf-time">'+ago(it.timestamp)+'<small>'+clock+' UTC</small></div>'
      +'<div><p class="nf-title"><a href="'+(it.link||'#')+'" target="_blank" rel="noopener noreferrer">'+esc(it.title)+'</a></p>'
      +(it.summary?'<p class="nf-sum">'+esc(it.summary)+'</p>':'')
      +'<div class="nf-meta"><span class="nf-src">'+esc(it.source)+'</span><span class="nf-tag '+catCls+'">'+esc(it.category)+'</span>'
      +(it.impact==='high'?'<span class="nf-tag hi">⚡ impact fort</span>':'')
      +'</div></div></div>';
  }).join('');
}
function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

function updateNfStatus(){
  var el=$('#nfStatus');
  if(!nfState.updated){el.innerHTML='<span class="source-live" style="color:var(--text-faint)"><i></i> Synchronisation…</span>';return}
  el.innerHTML='<span class="source-live"><i></i> LIVE</span> · dernière synchro serveur <b>'+ago(nfState.updated)+'</b> · '+nfState.items.length+' dépêches';
}

function fetchNews(){
  api('/api/news?limit=120').then(function(d){
    nfState.items=d.items||[];
    nfState.updated=d.updated_at;
    nfState.refresh=d.refresh_interval||180;
    renderNews();updateNfStatus();
  }).catch(function(){
    $('#nfStatus').innerHTML='<span style="color:var(--red)">Flux indisponible — vérifiez le serveur.</span>';
    $('#nfList').innerHTML='<div class="live-feed-empty">Impossible de joindre le backend /api/news.</div>';
  });
}

$$('#nfFilters .nf-chip').forEach(function(btn){
  btn.addEventListener('click',function(){
    if(btn.dataset.impact){
      nfState.impact=!nfState.impact;
      btn.classList.toggle('active',nfState.impact);
    }else{
      nfState.cat=btn.dataset.cat;
      $$('#nfFilters .nf-chip').forEach(function(b){if(!b.dataset.impact)b.classList.toggle('active',b===btn)});
    }
    renderNews();
  });
});

/* ---------- Analyse IA ---------- */
function regimeClass(r){
  if(/HAUSSIER/.test(r))return 'up';
  if(/BAISSIER/.test(r))return 'down';
  if(/RANGE|NEUTRE/.test(r))return 'flat';
  return 'mix';
}
function reasonsHtml(arr,cls){
  return (arr||[]).map(function(r){return '<li class="'+cls+'">'+esc(r)+'</li>'}).join('');
}
function chgmt(v){
  if(v==null||isNaN(v))return '—';
  return (v>0?'+':'')+v.toLocaleString('fr-FR',{maximumFractionDigits:2})+'%';
}
function levelsHtml(a){
  var lv=a.levels||{}, c=a.change||{};
  var parts='';
  if(lv.support!=null)parts+='<span class="lv sup">S <b>'+fmtPrice(lv.support)+'</b></span>';
  if(lv.resistance!=null)parts+='<span class="lv res">R <b>'+fmtPrice(lv.resistance)+'</b></span>';
  return parts?'<div class="ai-levels">'+parts+'</div>':'';
}
/* ---------- Calendrier économique ---------- */
function fetchCalendar(){
  api('/api/calendar?limit=80').then(function(d){
    renderCalendar(d.events||[]);
  }).catch(function(){
    var el=$('#calList');if(el)el.innerHTML='<div class="live-feed-empty">Calendrier indisponible.</div>';
  });
}
function renderCalendar(events){
  var el=$('#calList');if(!el)return;
  var hi=events.filter(function(e){return e.impact==='High'||e.impact==='Medium'});
  hi.sort(function(a,b){
    var now=Date.now()/1000;
    var da=Math.abs(a.timestamp-now), db=Math.abs(b.timestamp-now);
    return da-db;
  });
  if(!hi.length){el.innerHTML='<div class="live-feed-empty">Aucun événement High/Medium cette semaine.</div>';return}
  el.innerHTML=hi.slice(0,18).map(function(e){
    var d=new Date(e.timestamp*1000);
    var when=(e.past?'✔ publié':'⏳ prévu')+' · '+d.toLocaleString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    var nums=[];
    if(e.forecast)nums.push('prév. '+esc(e.forecast));
    if(e.previous)nums.push('préc. '+esc(e.previous));
    return '<div class="cal-ev'+(e.past?' past':'')+'">'
      +'<span class="when">'+when+'</span>'
      +'<span class="ttl">'+esc(e.title)+'</span>'
      +'<span class="meta"><span class="imp '+esc(e.impact)+'">'+esc(e.impact)+'</span><span>'+esc(e.country)+'</span>'+(nums.length?'<span>'+nums.join(' · ')+'</span>':'')+'</span>'
      +'</div>';
  }).join('');
}
function renderAnalysis(d){
  var grid=$('#aiGrid');
  aiState.last=d;
  var entries=Object.keys(d.analysis||{}).map(function(k){return d.analysis[k]}).filter(function(a){return !a.error});
  if(window.nxMarket){
    var picked=entries.filter(function(a){return a.symbol===window.nxMarket});
    if(!picked.length){grid.innerHTML='<div class="ai-loading">Aucune analyse disponible pour '+esc(window.nxMarket)+' pour le moment (données de marché indisponibles).</div>';return}
    entries=picked;
  }
  if(!entries.length){grid.innerHTML='<div class="ai-loading">Aucune analyse disponible — le serveur récupère les données de marché…</div>';return}
  grid.innerHTML=entries.map(function(a){
    var dr=a.daily||{}, wr=a.weekly||{};
    var dCls=regimeClass(dr.regime||''), wCls=regimeClass(wr.regime||'');
    var conf=Math.round(((dr.strength||0)+(wr.strength||0))/2);
    var news=(a.news||[]).map(function(n){return '<p>«&nbsp;'+esc(n.title)+'&nbsp;» <i>— '+esc(n.source)+(n.impact==='high'?' · ⚡ impact fort':'')+'</i></p>'}).join('')
      ||'<p style="color:var(--text-faint)">Pas d&rsquo;actualité spécifique détectée sur les dernières heures.</p>';
    return '<article class="ai-card">'
      +'<header class="ai-head"><div><h3>'+esc(a.name)+'</h3><div class="ai-sym">'+esc(a.symbol)+' · '+esc(a.group)+'</div></div>'
      +'<div class="ai-price">'+fmtPrice(a.price)+'<small>'+(a.currency||'')+' · MAJ '+ago(d.updated_at)+'</small></div></header>'
      +'<div class="ai-regimes">'
      +'<div class="ai-regime"><span class="ai-tf">Régime journalier (D1)</span><span class="regime-badge '+dCls+'">'+esc(dr.regime||'—')+'</span>'
      +'<div class="ai-conf"><span>force</span><span class="ai-conf-bar"><i style="width:'+(dr.strength||0)+'%"></i></span><span>'+(dr.strength||0)+'%</span></div></div>'
      +'<div class="ai-regime"><span class="ai-tf">Régime hebdomadaire (W1)</span><span class="regime-badge '+wCls+'">'+esc(wr.regime||'—')+'</span>'
      +'<div class="ai-conf"><span>force</span><span class="ai-conf-bar"><i style="width:'+(wr.strength||0)+'%"></i></span><span>'+(wr.strength||0)+'%</span></div></div>'
      +'</div>'
      +'<p class="ai-bias"><b>Biais :</b> '+esc(a.bias||'—')+'</p>'
      +'<ul class="ai-reasons">'
      +reasonsHtml(dr.reasons,'tech')+reasonsHtml((wr.reasons||[]).map(function(r){return '[W1] '+r}),'tech')
      +reasonsHtml(a.fundamental,'fund')
      +'</ul>'
      +levelsHtml(a)
      +'<div class="ai-newsbox"><h4>Contexte actualités ('+esc(a.symbol)+')</h4>'+news+'</div>'
      +'<footer class="ai-foot"><span>RSI D1 '+(dr.rsi!=null?dr.rsi:'—')+' · ADX D1 '+(dr.adx!=null?dr.adx:'—')+' · '+chgmt(a.change&&a.change.d5)+' / 5j · '+chgmt(a.change&&a.change.d20)+' / 20j</span><span>'+esc(a.symbol)+'</span></footer>'
      +'</article>';
  }).join('');
}
document.addEventListener('nx:market',function(){if(aiState.last)renderAnalysis(aiState.last)});
function updateAiStatus(d){
  var st=$('#aiStatus');
  if(d&&d.updated_at){
    st.innerHTML='<strong>Synchronisé</strong> <em>· dernière analyse '+ago(d.updated_at)+' · prochain calcul automatique dans '+Math.round((d.refresh_interval||900)/60)+' min</em>';
    $('#aiUpdatedAt').textContent=new Date(d.updated_at*1000).toLocaleString('fr-FR');
  }else{
    st.innerHTML='<strong>Initialisation…</strong> <em>le moteur calcule les régimes en cours.</em>';
  }
}
function fetchAnalysis(force){
  var btn=$('#aiRefresh');
  var doFetch=function(){
    api('/api/analysis').then(function(d){
      aiState.updated=d.updated_at||aiState.updated;
      renderAnalysis(d);updateAiStatus(d);
      return d;
    }).catch(function(){
      $('#aiGrid').innerHTML='<div class="ai-loading">Backend injoignable (/api/analysis). Vérifiez que le serveur tourne.</div>';
      return null;
    });
  };
  if(!force){doFetch();return}
  // Recalcul forcé : déclenche côté serveur puis attend la nouvelle version.
  btn.disabled=true;btn.textContent='Recalcul en cours…';
  var oldTs=aiState.updated||0;
  var st=$('#aiStatus');
  st.innerHTML='<strong>Recalcul demandé…</strong> <em>le moteur actualise les régimes (± 15 s).</em>';
  api('/api/analysis/refresh',{method:'POST'}).catch(function(){});
  var tries=0;
  var poll=setInterval(function(){
    tries++;
    api('/api/analysis').then(function(d){
      if(d.updated_at&&d.updated_at>oldTs){
        clearInterval(poll);
        aiState.updated=d.updated_at;
        renderAnalysis(d);updateAiStatus(d);
        btn.disabled=false;btn.textContent='↻ Actualiser l\u2019analyse';
      }else if(tries>=20){
        clearInterval(poll);
        renderAnalysis(d);updateAiStatus(d);
        btn.disabled=false;btn.textContent='↻ Actualiser l\u2019analyse';
      }
    }).catch(function(){
      if(tries>=20){clearInterval(poll);btn.disabled=false;btn.textContent='↻ Actualiser l\u2019analyse'}
    });
  },2000);
}
$('#aiRefresh').addEventListener('click',function(){fetchAnalysis(true)});

/* ---------- Boucles temps réel ---------- */
var calTimer=null;
function startLive(){
  fetchNews();
  fetchAnalysis();
  fetchCalendar();
  if(newsTimer)clearInterval(newsTimer);
  newsTimer=setInterval(fetchNews,60000);          // resynchro client chaque minute
  if(aiTimer)clearInterval(aiTimer);
  aiTimer=setInterval(function(){fetchAnalysis()},5*60000);
  if(calTimer)clearInterval(calTimer);
  calTimer=setInterval(fetchCalendar,5*60000);     // calendrier resynchro toutes les 5 min
  if(statusTimer)clearInterval(statusTimer);
  statusTimer=setInterval(updateNfStatus,15000);   // compte à rebours affiché
}

/* ---------- Init : session existante ? ---------- */
(function init(){
  document.body.classList.add('locked');
  var tok=loadToken();
  if(!tok){gate.hidden=false;return}
  api('/api/whoami').then(function(d){user=d.user;enterApp()})
    .catch(function(){clearToken();gate.hidden=false;document.body.classList.remove('locked')});
})();
})();
