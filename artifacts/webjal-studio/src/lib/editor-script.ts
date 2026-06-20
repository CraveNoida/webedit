export const EDITOR_SCRIPT = `<style id="wj-editor-style">
  :root { --wj-editor-bar-height: 44px; }
  [data-wj-hover]:not([data-wj-selected]) { outline: 2px dashed rgba(99,102,241,0.65) !important; outline-offset: 3px !important; cursor: pointer !important; }
  [data-wj-selected] { outline: 2px solid #6366f1 !important; outline-offset: 3px !important; }
  [contenteditable="true"] { min-width: 20px; min-height: 1em; }
  #wj-bar { position: fixed; top: 0; left: 0; right: 0; min-height: var(--wj-editor-bar-height); background: linear-gradient(90deg,#312e81,#4c1d95); color: #fff; display: flex; align-items: center; padding: 8px 16px; gap: 10px; z-index: 2147483647; font-family: system-ui,-apple-system,sans-serif; font-size: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.35); user-select: none; box-sizing: border-box; flex-wrap: wrap; }
  #wj-bar .wb { background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 4px 12px; border-radius: 5px; cursor: pointer; font-size: 12px; font-family: inherit; flex-shrink: 0; }
  #wj-bar .wb:hover { background: rgba(255,255,255,0.26); }
  #wj-bar .ws { width:1px; height:20px; background: rgba(255,255,255,0.2); flex-shrink:0; }
  #wj-bar .wi { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 5px 10px; border-radius: 4px; font-size: 12px; width: 280px; outline: none; font-family: inherit; flex-shrink: 1; min-width: 80px; }
  #wj-bar .wi::placeholder { color: rgba(255,255,255,0.4); }
  #wj-bar .sp { flex: 1; min-width: 8px; }
  body { padding-top: var(--wj-editor-bar-height) !important; }
  @media (max-width: 520px) {
    :root { --wj-editor-bar-height: 52px; }
    #wj-bar { align-items: center; gap: 6px; padding: 8px; }
    #wj-bar .wb { padding: 4px 8px; font-size: 11px; }
    #wj-bar .wi { width: 100%; }
    #wj-bar .sp { display: none; }
    #wj-bar .ws { display: none; }
    #wj-bar .sl { display: none; }
    #wj-bar span[style*="opacity:0.5"] { display: none !important; }
  }
</style>
<script id="wj-editor-script">(function(){
  'use strict';
  var bar=document.createElement('div'); bar.id='wj-bar';
  document.body.prepend(bar);
  var sel=null, saved=null, stimer=null, slabel=null;

  function syncBarHeight(){
    requestAnimationFrame(function(){
      document.documentElement.style.setProperty('--wj-editor-bar-height', bar.offsetHeight+'px');
      offsetTopBars();
    });
  }

  function parsePx(v){
    var n=parseFloat(v);
    return isNaN(n)?0:n;
  }

  function offsetTopBars(){
    var h=bar.offsetHeight||44;
    document.querySelectorAll('header,nav,[class*="nav"],[class*="header"],[class*="sticky"],[class*="fixed"],[style*="position"]').forEach(function(el){
      if(!el||el===bar||(el.closest&&el.closest('#wj-bar'))) return;
      var cs=window.getComputedStyle(el);
      if(cs.position!=='fixed'&&cs.position!=='sticky') return;
      var rect=el.getBoundingClientRect();
      var alreadyAdjusted=el.hasAttribute('data-wj-editor-offset');
      var top=alreadyAdjusted?parsePx(el.getAttribute('data-wj-original-top')||'0'):parsePx(cs.top);
      if(!alreadyAdjusted&&top>8&&rect.top>8) return;
      if(!el.hasAttribute('data-wj-original-top')) el.setAttribute('data-wj-original-top', el.style.top||'');
      el.setAttribute('data-wj-editor-offset','');
      el.style.setProperty('top', (h+top)+'px', 'important');
    });
  }

  function exit(){ commit(); window.parent.postMessage({type:'wj-exit-edit'},'*'); }

  function commit(){
    if(sel){ sel.contentEditable='false'; sel.removeAttribute('data-wj-selected'); sel=null; saved=null; }
  }

  function setStatus(t){ if(slabel) slabel.textContent=t; }

  function idle(){
    bar.innerHTML='<span style="background:rgba(255,255,255,0.14);padding:2px 10px;border-radius:4px;font-size:11px;flex-shrink:0;">Edit Mode</span><span style="opacity:0.5;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Click any text or image to edit</span><div class="sp"></div><span class="sl" style="font-size:11px;opacity:0.6;flex-shrink:0;"></span><button class="wb" id="wb-exit" style="background:rgba(239,68,68,0.3);border-color:rgba(239,68,68,0.5);">Exit Editor</button>';
    slabel=bar.querySelector('.sl');
    bar.querySelector('#wb-exit').onclick=exit;
    syncBarHeight();
  }

  function deleteSelected(){
    if(!sel) return;
    var el=sel;
    sel=null; saved=null;
    el.removeAttribute('data-wj-selected'); el.contentEditable='false';
    el.remove();
    send(); idle();
  }

  var DEL_BTN='<button class="wb" id="wb-del" style="background:rgba(239,68,68,0.35);border-color:rgba(239,68,68,0.6);">&#x1F5D1; Delete</button>';

  function textBar(el){
    bar.innerHTML='<span style="background:rgba(255,255,255,0.14);padding:2px 10px;border-radius:4px;font-size:11px;flex-shrink:0;">Editing Text</span><div class="ws"></div><button class="wb" id="wb-done">Done</button><button class="wb" id="wb-cancel">Cancel</button>'+DEL_BTN+'<div class="sp"></div><span class="sl" style="font-size:11px;opacity:0.6;flex-shrink:0;"></span><button class="wb" id="wb-exit" style="background:rgba(239,68,68,0.3);border-color:rgba(239,68,68,0.5);">Exit Editor</button>';
    slabel=bar.querySelector('.sl');
    bar.querySelector('#wb-done').onclick=function(){ commit(); send(); idle(); };
    bar.querySelector('#wb-cancel').onclick=function(){ if(sel&&saved!==null) sel.innerHTML=saved; commit(); idle(); };
    bar.querySelector('#wb-del').onclick=function(){ if(confirm('Delete this element?')) deleteSelected(); };
    bar.querySelector('#wb-exit').onclick=function(){ if(sel&&saved!==null) sel.innerHTML=saved; commit(); exit(); };
    syncBarHeight();
  }

  function imgBar(el){
    var src=(el.getAttribute('src')||'').replace(/"/g,'&quot;');
    bar.innerHTML='<span style="background:rgba(255,255,255,0.14);padding:2px 10px;border-radius:4px;font-size:11px;flex-shrink:0;">Image</span><div class="ws"></div><input class="wi" id="wi-url" placeholder="Paste new image URL..." /><button class="wb" id="wb-replace">Replace</button><button class="wb" id="wb-cancel">Cancel</button>'+DEL_BTN+'<div class="sp"></div><span class="sl" style="font-size:11px;opacity:0.6;flex-shrink:0;"></span><button class="wb" id="wb-exit" style="background:rgba(239,68,68,0.3);border-color:rgba(239,68,68,0.5);">Exit Editor</button>';
    slabel=bar.querySelector('.sl');
    var inp=document.getElementById('wi-url'); inp.value=el.getAttribute('src')||''; setTimeout(function(){ inp.focus(); inp.select(); },10);
    bar.querySelector('#wb-replace').onclick=function(){ var u=inp.value.trim(); if(u&&el){ el.src=u; el.removeAttribute('srcset'); } commit(); send(); idle(); };
    bar.querySelector('#wb-cancel').onclick=function(){ commit(); idle(); };
    bar.querySelector('#wb-del').onclick=function(){ if(confirm('Delete this image?')) deleteSelected(); };
    bar.querySelector('#wb-exit').onclick=function(){ commit(); exit(); };
    syncBarHeight();
  }

  function serialize(){
    var c=document.documentElement.cloneNode(true);
    ['wj-bar','wj-editor-style','wj-editor-script'].forEach(function(id){ var e=c.querySelector('#'+id); if(e) e.remove(); });
    var b=c.querySelector('body'); if(b) b.style.marginTop='';
    c.querySelectorAll('[data-wj-editor-offset]').forEach(function(e){
      var original=e.getAttribute('data-wj-original-top')||'';
      if(original) e.style.top=original;
      else e.style.removeProperty('top');
      e.removeAttribute('data-wj-editor-offset');
      e.removeAttribute('data-wj-original-top');
    });
    c.querySelectorAll('[data-wj-hover],[data-wj-selected]').forEach(function(e){ e.removeAttribute('data-wj-hover'); e.removeAttribute('data-wj-selected'); });
    c.querySelectorAll('[contenteditable]').forEach(function(e){ e.removeAttribute('contenteditable'); });
    return '<!DOCTYPE html>\\n'+c.outerHTML;
  }

  function send(){
    setStatus('Saving...');
    var h=serialize();
    window.parent.postMessage({type:'wj-html-change',html:h},'*');
  }

  function schedule(){ clearTimeout(stimer); stimer=setTimeout(send,900); }

  idle();
  window.addEventListener('resize', syncBarHeight);

  var SKIP=new Set(['HTML','BODY','HEAD','SCRIPT','STYLE','META','LINK','NOSCRIPT']);
  function skip(e){
    if(!e||!e.tagName) return true;
    if(SKIP.has(e.tagName.toUpperCase())) return true;
    if(e.id==='wj-bar') return true;
    if(e.closest&&e.closest('#wj-bar')) return true;
    return false;
  }

  document.addEventListener('mouseover',function(e){ if(!skip(e.target)&&e.target!==sel) e.target.setAttribute('data-wj-hover',''); },true);
  document.addEventListener('mouseout',function(e){ if(e.target&&e.target.removeAttribute) e.target.removeAttribute('data-wj-hover'); },true);

  document.addEventListener('click',function(e){
    var el=e.target;
    if(skip(el)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if(sel&&sel!==el){ sel.contentEditable='false'; sel.removeAttribute('data-wj-selected'); }
    el.removeAttribute('data-wj-hover');
    el.setAttribute('data-wj-selected','');
    sel=el; saved=el.innerHTML;
    if(el.tagName==='IMG'){ imgBar(el); }
    else {
      el.contentEditable='true'; el.focus();
      try{ var r=document.createRange(),s=window.getSelection(); r.selectNodeContents(el); r.collapse(false); s.removeAllRanges(); s.addRange(r); }catch(ex){}
      textBar(el);
    }
  },true);

  document.addEventListener('input',schedule);

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&sel){ if(saved!==null) sel.innerHTML=saved; commit(); idle(); e.preventDefault(); }
  },true);

  window.parent.postMessage({type:'wj-editor-ready'},'*');
})();</script>`;
