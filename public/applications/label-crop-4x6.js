(function(){
'use strict';
var root=document.getElementById('mtlc'),$=function(id){return root.querySelector('#lc-'+id)},MIN=24,state={files:[],pages:[],sel:-1},drag=null,currentRenderTask=null,currentLoadingTask=null,currentWorker=null,cancelled=false;
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc='/applications/vendor/pdfjs-3.11.174.worker.min.js';
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}function cur(){return state.pages[state.sel]||null}function num(id,d){var v=parseFloat($(id).value);return isFinite(v)?v:d}
function size(){return $('size').value.split('x').map(Number)}function nameSize(){return $('size').selectedOptions[0].text.split(' (')[0]}
function status(s,k){$('status').textContent=s||'';$('status').className=k||''}
function clampCrop(c,p){var w=clamp(c.w,Math.min(MIN,p.w),p.w),h=clamp(c.h,Math.min(MIN,p.h),p.h);return{x:clamp(c.x,0,p.w-w),y:clamp(c.y,0,p.h-h),w:w,h:h}}
function detect(p,pad){var W=p.canvas.width,H=p.canvas.height,d=p.canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data,min=new Int32Array(H).fill(W),max=new Int32Array(H).fill(-1);for(var y=0;y<H;y++)for(var x=0;x<W;x++){var i=(y*W+x)*4;if(d[i+3]>128&&.299*d[i]+.587*d[i+1]+.114*d[i+2]<200){min[y]=Math.min(min[y],x);max[y]=Math.max(max[y],x)}}function bbox(limit){var t=-1,b=-1,l=W,r=-1;for(var y=0;y<limit;y++)if(max[y]>=0){if(t<0)t=y;b=y;l=Math.min(l,min[y]);r=Math.max(r,max[y])}return t<0?null:{top:t,bottom:b,left:l,right:r}}var cut=H;for(var y=0;y<H;y++)if(max[y]>=0&&max[y]-min[y]>.6*W){cut=y;break}var b=bbox(cut);if(!b||b.bottom-b.top<.15*H)b=bbox(H);if(!b)return{x:0,y:0,w:p.w,h:p.h};var s=W/p.w;return clampCrop({x:b.left/s-pad,y:b.top/s-pad,w:(b.right-b.left+1)/s+2*pad,h:(b.bottom-b.top+1)/s+2*pad},p)}
async function addFiles(files){
 if(!window.pdfjsLib||!window.PDFLib){status('Local PDF libraries failed to load. Reload the page.','bad');return}
 var arr=Array.from(files).filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name));
 if(!arr.length){status('Choose PDF files.','bad');return}
 var large=arr.filter(f=>f.size>100*1024*1024);
 if(large.length&&!window.confirm(large.map(f=>f.name).join(', ')+' exceed 100 MB. Processing may use substantial memory. Continue?'))return;
 cancelled=false;$('cancel').disabled=false;$('progress').value=0;
 var before=state.pages.length,processed=0,totalPages=0;
 for(var f of arr){ if(f.size>0) totalPages++; }
 for(var f of arr){
  if(cancelled)break;
  try{
   status('Reading '+f.name+'…');
   var bytes=new Uint8Array(await f.arrayBuffer()),fi=state.files.push({name:f.name,bytes:bytes})-1;
   currentLoadingTask=pdfjsLib.getDocument({data:bytes.slice(),isEvalSupported:false,disableFontFace:true});
   currentLoadingTask.onPassword=function(updatePassword,reason){
    var pass=window.prompt(reason===2?'Wrong password. Enter the PDF password again:':'This PDF is password protected. Enter its password:');
    if(pass===null){cancelled=true;throw new Error('Password entry cancelled.')}
    updatePassword(pass);
   };
   var doc=await currentLoadingTask.promise;currentLoadingTask=null;
   totalPages=Math.max(totalPages,doc.numPages*arr.length);
   for(var i=1;i<=doc.numPages;i++){
    if(cancelled)break;
    var pg=await doc.getPage(i),v=pg.view,vp=pg.getViewport({scale:doc.numPages>40?1:1.5,rotation:0}),cv=document.createElement('canvas');
    cv.width=Math.round(vp.width);cv.height=Math.round(vp.height);
    currentRenderTask=pg.render({canvasContext:cv.getContext('2d',{willReadFrequently:true}),viewport:vp});
    await currentRenderTask.promise;currentRenderTask=null;
    var th=document.createElement('canvas');th.width=120;th.height=Math.round(120*cv.height/cv.width);th.getContext('2d').drawImage(cv,0,0,th.width,th.height);
    var p={fileIdx:fi,pageIdx:i-1,name:f.name,view:v,w:v[2]-v[0],h:v[3]-v[1],canvas:cv,thumb:th.toDataURL('image/jpeg',.7),include:true,crop:null};
    p.crop=detect(p,num('pad',6));state.pages.push(p);
    processed++;$('progress').value=Math.min(99,Math.round(processed/Math.max(totalPages,processed)*100));
    status('Rendering '+f.name+' · page '+i+' of '+doc.numPages+'…');
   }
   if(cancelled)break;
  }catch(e){
   currentRenderTask=null;currentLoadingTask=null;
   if(cancelled||e.name==='RenderingCancelledException')break;
   status((/password|encrypted/i.test(e.message)?'Wrong password or password-protected PDF could not be opened. ':'This PDF could not be read. ')+e.message,'bad');renderAll();$('cancel').disabled=true;return;
  }
 }
 currentRenderTask=null;currentLoadingTask=null;$('cancel').disabled=true;renderAll();
 if(cancelled)status('Processing cancelled. Any pages already loaded remain available.','bad');
 else status('Added '+(state.pages.length-before)+' page(s). Review crops, then download.','ok');
 $('progress').value=0;
}
function place(c,W,H){var cover=$('fit').value==='cover',m=cover?0:clamp(num('margin',4),0,Math.min(W,H)/2-10),aw=W-2*m,ah=H-2*m,s=cover?Math.max(aw/c.w,ah/c.h):Math.min(aw/c.w,ah/c.h);return{s:s,x:(W-c.w*s)/2,y:(H-c.h*s)/2}}
function renderAll(){var has=state.pages.length>0;$('empty').hidden=has;$('work').hidden=!has;$('pages-panel').hidden=!has;renderThumbs();renderStage()}
function renderThumbs(){var ul=$('thumbs');ul.textContent='';var used=0;state.pages.forEach(function(p,i){if(p.include)used++;var li=document.createElement('li');li.className='lc-thumb'+(i===state.sel?' active':'');var b=document.createElement('button');b.type='button';var im=document.createElement('img');im.src=p.thumb;im.alt='Page '+(i+1);b.appendChild(im);b.addEventListener('click',function(){state.sel=i;renderThumbs();renderStage()});var lab=document.createElement('label');lab.className='lc-inc';var cb=document.createElement('input');cb.type='checkbox';cb.checked=p.include;cb.addEventListener('change',function(){p.include=cb.checked;renderThumbs();preview()});lab.append(cb,document.createTextNode('Page '+(i+1)));li.append(b,lab);ul.appendChild(li)});$('count').textContent=' · '+used+'/'+state.pages.length;$('download').disabled=!used;$('download').textContent=used>1?'Download PDF ('+used+' labels)':'Download PDF'}
function sync(){var p=cur();if(!p)return;var c=p.crop;$('crop').style.left=c.x/p.w*100+'%';$('crop').style.top=c.y/p.h*100+'%';$('crop').style.width=c.w/p.w*100+'%';$('crop').style.height=c.h/p.h*100+'%';['x','y','w','h'].forEach(function(k){$(k).value=Math.round(c[k])})}
function renderStage(){var p=cur();if(!p){preview();return}$('stage').style.aspectRatio=p.w+'/'+p.h;$('canvas').width=p.canvas.width;$('canvas').height=p.canvas.height;$('canvas').getContext('2d').drawImage(p.canvas,0,0);$('meta').textContent='Page '+(state.sel+1)+' of '+state.pages.length+' · '+Math.round(p.w)+' × '+Math.round(p.h)+' pt';sync();preview()}
function preview(){var cv=$('preview'),ctx=cv.getContext('2d'),sz=size(),W=sz[0],H=sz[1],px=2;cv.width=W*px;cv.height=H*px;ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);var p=cur();if(!p){$('preview-cap').textContent=nameSize()+' · no page loaded';return}var c=p.crop,pl=place(c,W,H),k=p.canvas.width/p.w;ctx.drawImage(p.canvas,c.x*k,c.y*k,c.w*k,c.h*k,pl.x*px,pl.y*px,c.w*pl.s*px,c.h*pl.s*px);$('preview-cap').textContent=nameSize()+' · crop '+Math.round(c.w)+' × '+Math.round(c.h)+' pt'}
function setCrop(c,commit){var p=cur();if(!p)return;p.crop=clampCrop(c,p);sync();preview();if(commit)renderThumbs()}
var box=$('crop');box.addEventListener('pointerdown',function(e){var p=cur();if(!p)return;e.preventDefault();drag={dir:e.target.dataset.h||'move',sx:e.clientX,sy:e.clientY,c:{...p.crop},k:p.w/$('stage').clientWidth};box.setPointerCapture(e.pointerId);box.focus({preventScroll:true})});box.addEventListener('pointermove',function(e){var p=cur();if(!drag||!p)return;var dx=(e.clientX-drag.sx)*drag.k,dy=(e.clientY-drag.sy)*drag.k,c=drag.c,x=c.x,y=c.y,w=c.w,h=c.h,d=drag.dir;if(d==='move'){x=clamp(x+dx,0,p.w-w);y=clamp(y+dy,0,p.h-h)}else{if(d.includes('w')){var nx=clamp(x+dx,0,x+w-MIN);w+=x-nx;x=nx}if(d.includes('e'))w=clamp(w+dx,MIN,p.w-x);if(d.includes('n')){var ny=clamp(y+dy,0,y+h-MIN);h+=y-ny;y=ny}if(d.includes('s'))h=clamp(h+dy,MIN,p.h-y)}p.crop={x:x,y:y,w:w,h:h};sync();preview()});function endDrag(){if(drag){drag=null;renderThumbs()}}box.addEventListener('pointerup',endDrag);box.addEventListener('pointercancel',endDrag);box.addEventListener('keydown',function(e){var p=cur();if(!p)return;var step=e.shiftKey?10:1,dx=0,dy=0;if(e.key==='ArrowLeft')dx=-step;else if(e.key==='ArrowRight')dx=step;else if(e.key==='ArrowUp')dy=-step;else if(e.key==='ArrowDown')dy=step;else return;e.preventDefault();setCrop({...p.crop,x:p.crop.x+dx,y:p.crop.y+dy},true)});
['x','y','w','h'].forEach(function(k){$(k).addEventListener('change',function(){var p=cur();if(p)setCrop({x:num('x',p.crop.x),y:num('y',p.crop.y),w:num('w',p.crop.w),h:num('h',p.crop.h)},true)})});
$('detect').addEventListener('click',function(){var p=cur();if(p){setCrop(detect(p,num('pad',6)),true);status('Auto-detected page '+(state.sel+1)+'.','ok')}});$('detect-all').addEventListener('click',function(){state.pages.forEach(p=>p.crop=detect(p,num('pad',6)));renderAll();status('Auto-detected all pages.','ok')});$('apply').addEventListener('click',function(){var p=cur();if(p){state.pages.forEach(q=>q.crop=clampCrop({...p.crop},q));renderAll();status('Current crop copied to all pages.','ok')}});$('ratio').addEventListener('click',function(){var p=cur();if(!p)return;var sz=size(),r=sz[0]/sz[1],c=p.crop,cx=c.x+c.w/2,cy=c.y+c.h/2,w=c.w,h=c.h;if(w/h<r)w=h*r;else h=w/r;if(w>p.w){w=p.w;h=w/r}if(h>p.h){h=p.h;w=h*r}setCrop({x:cx-w/2,y:cy-h/2,w:w,h:h},true)});
['size','fit','margin'].forEach(k=>$(k).addEventListener('input',preview));$('pad').addEventListener('change',function(){if(cur())setCrop(detect(cur(),num('pad',6)),true)});$('clear').addEventListener('click',function(){if(currentWorker){currentWorker.terminate();currentWorker=null}cancelled=true;state={files:[],pages:[],sel:-1};$('cancel').disabled=true;$('progress').value=0;status('');renderAll();preview()});var drop=$('drop');$('file').addEventListener('change',function(e){addFiles(e.target.files);e.target.value=''});['dragenter','dragover'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.add('over')}));['dragleave','drop'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.classList.remove('over')}));drop.addEventListener('drop',e=>{if(e.dataTransfer)addFiles(e.dataTransfer.files)});
$('cancel').addEventListener('click',function(){
 cancelled=true;
 if(currentRenderTask){try{currentRenderTask.cancel()}catch(e){}}
 if(currentLoadingTask){try{currentLoadingTask.destroy()}catch(e){}}
 if(currentWorker){currentWorker.postMessage({type:'cancel'});currentWorker.terminate();currentWorker=null;$('download').disabled=!state.pages.some(p=>p.include);$('cancel').disabled=true;status('Processing cancelled.','bad');$('progress').value=0}
});
$('download').addEventListener('click',function(){
 var btn=$('download'),list=state.pages.filter(p=>p.include),sz=size();
 if(!list.length)return;
 if(list.some(p=>state.files[p.fileIdx].bytes.byteLength>100*1024*1024)&&!window.confirm('One or more source PDFs exceed 100 MB. Export may use substantial memory. Continue?'))return;
 btn.disabled=true;$('cancel').disabled=false;$('progress').value=0;status('Starting private PDF worker…');
 try{
  currentWorker=new Worker('/applications/label-crop-worker.js');
  var payload={files:state.files.map(f=>({name:f.name,bytes:f.bytes.buffer.slice(0)})),pages:list.map(p=>({fileIdx:p.fileIdx,pageIdx:p.pageIdx,view:p.view,crop:p.crop})),settings:{width:sz[0],height:sz[1],margin:num('margin',4),fit:$('fit').value,name:nameSize()}};
  currentWorker.onmessage=function(e){
   var m=e.data||{};
   if(m.type==='progress'){$('progress').value=m.value||0;status(m.message||'Building PDF…')}
   else if(m.type==='result'){
    var blob=new Blob([m.bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=m.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Downloaded '+list.length+' label(s). Print at 100% scale.','ok');finish();
   }else if(m.type==='error'){
    status(m.name==='AbortError'?'Processing cancelled.':(/encrypt|password/i.test(m.message)?'This encrypted PDF cannot be exported by the current browser PDF library. ':'Could not build PDF: ')+m.message,'bad');finish();
   }
  };
  currentWorker.onerror=function(e){status('PDF worker failed: '+(e.message||'unknown error'),'bad');finish()};
  currentWorker.postMessage({type:'start',payload});
 }catch(e){status('Could not start PDF worker: '+e.message,'bad');finish()}
 function finish(){if(currentWorker){currentWorker.terminate();currentWorker=null}btn.disabled=!state.pages.some(p=>p.include);$('cancel').disabled=true;$('progress').value=0}
});

renderAll();preview();
})();
