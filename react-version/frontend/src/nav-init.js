export function initNav() {
var nav=document.getElementById('navLinks');
if(nav){
  var groups=[].slice.call(nav.querySelectorAll('.nav-group'));
  var lockUntil=0;
  var hoverOk=function(){return Date.now()>lockUntil&&window.matchMedia&&matchMedia('(hover:hover) and (min-width:921px)').matches};
  var closeAll=function(except){groups.forEach(function(g){if(g!==except){g.classList.remove('open');g.querySelector('.nav-group-btn').setAttribute('aria-expanded','false')}})};
  groups.forEach(function(g){
    var b=g.querySelector('.nav-group-btn');
    b.addEventListener('click',function(e){e.stopPropagation();var open=!g.classList.contains('open');closeAll(g);g.classList.toggle('open',open);b.setAttribute('aria-expanded',String(open))});
    g.addEventListener('mouseenter',function(){if(hoverOk()){closeAll(g);g.classList.add('open');b.setAttribute('aria-expanded','true')}});
    g.addEventListener('mouseleave',function(){if(hoverOk()){g.classList.remove('open');b.setAttribute('aria-expanded','false')}});
  });
  document.addEventListener('click',function(e){if(!e.target.closest('.nav-group'))closeAll()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeAll()});
  window.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('.nav-menu a')){lockUntil=Date.now()+900;closeAll()}},true);
  var mark=function(){groups.forEach(function(g){g.classList.toggle('has-active',!!g.querySelector('a.is-active'))})};
  new MutationObserver(function(ms){if(ms.some(function(m){return m.target.tagName==='A'}))mark()}).observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
  mark();
}
/* ---- sauvegarde rapide ---- */
var KEY='nexus.lastBackup',qb=document.getElementById('quickBackup'),qr=document.getElementById('quickRestore');
function stamp(){try{localStorage.setItem(KEY,String(Date.now()))}catch(e){}refresh()}
function refresh(){
  if(!qb)return;
  var t=0;try{t=+localStorage.getItem(KEY)||0}catch(e){}
  var days=t?Math.floor((Date.now()-t)/864e5):null,has=0;try{has=localStorage.length}catch(e){}
  var stale=has>4&&(t===0||days>=7);
  qb.classList.toggle('nudge',stale);
  qb.title=t?('Dernière sauvegarde : '+(days<1?'aujourd’hui':'il y a '+days+' j')+(stale?' — pensez à en refaire une.':'')):'Exporter une sauvegarde JSON de vos données'+(stale?' — aucune sauvegarde enregistrée.':'');
}
function press(id){var el=document.getElementById(id);if(el)el.click();else alert('Ouvrez la section Système pour utiliser la sauvegarde.')}
if(qb)qb.addEventListener('click',function(){press('systemExportJson');stamp()});
if(qr)qr.addEventListener('click',function(){press('systemImport')});
document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('#systemExportJson'))stamp()},true);
refresh();
}
