(function(){
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var ring=document.querySelector('.home-logo-ring');
  if(ring){var s=document.createElement('i');s.className='nx-shine';ring.appendChild(s)}
  function split(el){
    if(!el||el.__w||el.textContent.trim().split(/\s+/).length>60)return;el.__w=1;
    el.setAttribute('aria-label',el.textContent.replace(/\s+/g,' ').trim());el.classList.add('nx-split');var k=0;
    (function walk(n){Array.prototype.slice.call(n.childNodes).forEach(function(c){
      if(c.nodeType===3){var f=document.createDocumentFragment();
        c.nodeValue.split(/(\s+)/).forEach(function(t){
          if(!t)return;if(/^\s+$/.test(t)){f.appendChild(document.createTextNode(t));return}
          var w=document.createElement('span');w.className='nx-w';w.setAttribute('aria-hidden','true');w.style.setProperty('--w',k++);w.textContent=t;f.appendChild(w)});
        n.replaceChild(f,c)}
      else if(c.nodeType===1)walk(c)})})(el)
  }
  document.querySelectorAll('main > section .section-head h2, main > section .section-desc, .hero-lead').forEach(split)
})();


(function(){
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var ring=document.querySelector('.home-logo-ring'),img=ring&&ring.querySelector('.home-logo');if(!img)return;
  window.__nxT0=performance.now();
  var box=document.createElement('div');box.className='nx-puzzle';box.setAttribute('aria-hidden','true');
  box.style.setProperty('--logo','url("'+(img.currentSrc||img.src)+'")');
  var W=Math.max(ring.offsetWidth,320);function R(m){return (Math.random()*2-1)*m}
  var corner={0:'10px 0 0 0',3:'0 10px 0 0',12:'0 0 0 10px',15:'0 0 10px 0'};
  for(var n=0;n<16;n++){
    var p=document.createElement('i'),s=p.style;p.className='nx-pz';
    s.setProperty('--c',n%4);s.setProperty('--r',(n/4)|0);s.setProperty('--n',n);
    s.setProperty('--ax',R(W*.8)+'px');s.setProperty('--ay',R(W*.7)+'px');s.setProperty('--az',R(160)+'px');s.setProperty('--ar',R(420)+'deg');
    s.setProperty('--bx',R(W*.55)+'px');s.setProperty('--by',R(W*.5)+'px');s.setProperty('--bz',R(120)+'px');s.setProperty('--br',R(300)+'deg');
    if(corner[n])s.borderRadius=corner[n];
    box.appendChild(p)
  }
  function place(){box.style.left=img.offsetLeft+'px';box.style.top=img.offsetTop+'px';box.style.width=img.offsetWidth+'px';box.style.height=img.offsetHeight+'px'}
  ring.classList.add('nx-has-puzzle');ring.insertBefore(box,img.nextSibling);place();
  if(window.ResizeObserver)new ResizeObserver(place).observe(img);window.addEventListener('resize',place)
})();
