(function(){
  'use strict';
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine=window.matchMedia&&matchMedia('(hover:hover) and (pointer:fine)').matches;
  function el(t,c,v){var n=document.createElement(t);if(c)n.className=c;if(v)for(var k in v)n.style.setProperty(k,v[k]);return n}
  /* Titre d'accueil : lettres en 3D */
  var h1=document.querySelector('.home-page h1');
  if(h1&&!reduce){
    h1.setAttribute('aria-label',h1.textContent.replace(/\s+/g,' ').trim());h1.classList.add('nx-letters');var k=0;
    (function walk(n){Array.prototype.slice.call(n.childNodes).forEach(function(c){
      if(c.nodeType===3){var f=document.createDocumentFragment();c.nodeValue.split('').forEach(function(ch){
        if(/\s/.test(ch))f.appendChild(document.createTextNode(ch));
        else{var s=el('span','nx-ch',{'--k':k++});s.setAttribute('aria-hidden','true');s.textContent=ch;f.appendChild(s)}});n.replaceChild(f,c)}
      else if(c.nodeType===1)walk(c)})})(h1)
  }
  /* Orbites autour du logo */
  var ring=document.querySelector('.home-logo-ring');
  if(ring){ring.appendChild(el('i','nx-orbit'));ring.appendChild(el('i','nx-orbit b'))}
  /* Délais d'entrée en cascade */
  document.querySelectorAll('main > section').forEach(function(s){s.querySelectorAll('.card,.metric,.chart-card,.account-card').forEach(function(n,i){n.style.setProperty('--i',Math.min(i,14))})});
  document.querySelectorAll('.home-pillar').forEach(function(n,i){n.style.setProperty('--i',i)});
  /* Tilt 3D au survol (délégué : fonctionne aussi sur les cartes recréées) */
  if(fine&&!reduce){
    var SEL='.metric,.setup-card,.account-card,.home-pillar,.console,.snapshot-card,.home-logo-ring',cur=null;
    function max(n){return n.matches('.home-logo-ring')?12:n.matches('.console')?5:6}
    function prep(n){
      if(!n.classList.contains('nx-tilt')){
        if(getComputedStyle(n).position==='static')n.style.position='relative';
        if(!n.matches('.home-logo-ring')&&!n.querySelector(':scope > .nx-glare'))n.appendChild(el('span','nx-glare'));
        n.classList.add('nx-tilt');void n.offsetWidth
      }
    }
    function rel(n){n.classList.remove('nx-on');n.style.removeProperty('--rx');n.style.removeProperty('--ry')}
    document.addEventListener('pointermove',function(e){
      if(e.pointerType&&e.pointerType!=='mouse')return;
      var t=e.target.closest?e.target.closest(SEL):null;
      if(t!==cur){if(cur)rel(cur);cur=t;if(cur)prep(cur)}
      if(!cur)return;
      var r=cur.getBoundingClientRect(),px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height,m=max(cur);
      cur.style.setProperty('--ry',((px-.5)*2*m).toFixed(2)+'deg');cur.style.setProperty('--rx',((.5-py)*2*m).toFixed(2)+'deg');
      cur.style.setProperty('--gx',(px*100).toFixed(0)+'%');cur.style.setProperty('--gy',(py*100).toFixed(0)+'%');cur.classList.add('nx-on')
    },{passive:true});
    document.addEventListener('pointerout',function(e){if(!e.relatedTarget&&cur){rel(cur);cur=null}})
  }
})();
