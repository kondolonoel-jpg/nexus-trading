(function(){
  var links=document.querySelectorAll('.nav-links a[href^="#"]');
  if(links.length){
    var rail=document.createElement('nav');rail.className='nx-rail';rail.setAttribute('aria-label','Sections');
    links.forEach(function(l){var a=document.createElement('a');a.href=l.getAttribute('href');a.dataset.l=l.textContent.trim();a.dataset.p=l.getAttribute('href').slice(1);rail.appendChild(a)});
    document.body.appendChild(rail);
    var sync=function(){var p=document.documentElement.getAttribute('data-page')||location.hash.slice(1)||'home';rail.querySelectorAll('a').forEach(function(a){a.classList.toggle('on',a.dataset.p===p)})};
    new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-page']});window.addEventListener('hashchange',sync);sync();
  }
})();
