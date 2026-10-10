const input=document.getElementById("merge-input");
const drop=document.getElementById("merge-drop");
const list=document.getElementById("merge-file-list");
const start=document.getElementById("merge-start");
const clear=document.getElementById("merge-clear");
const status=document.getElementById("merge-status");
const progress=document.getElementById("merge-progress");
const totalLabel=document.getElementById("merge-total");
const empty=document.getElementById("merge-empty");
let files=[];
let worker=null;
let busy=false;
function say(message,type=""){status.textContent=message;status.className="merge-status"+(type?" "+type:"");}
function bytes(n){return n<1024*1024?(n/1024).toFixed(0)+" KB":(n/1024/1024).toFixed(2)+" MB";}
function sync(){
 list.replaceChildren();
 files.forEach((file,index)=>{
  const row=document.createElement("li");row.className="merge-file";
  const num=document.createElement("span");num.className="merge-number";num.textContent=String(index+1);
  const info=document.createElement("div");const name=document.createElement("div");name.className="merge-filename";name.textContent=file.name;const size=document.createElement("div");size.className="merge-size";size.textContent=bytes(file.size);info.append(name,size);
  const actions=document.createElement("div");actions.className="merge-actions";
  for(const [label,delta] of [["↑",-1],["↓",1]]){const b=document.createElement("button");b.type="button";b.textContent=label;b.setAttribute("aria-label",(delta<0?"Move up ":"Move down ")+file.name);b.disabled=busy||index+delta<0||index+delta>=files.length;b.addEventListener("click",()=>{const to=index+delta;[files[index],files[to]]=[files[to],files[index]];sync();});actions.append(b);}
  const remove=document.createElement("button");remove.type="button";remove.textContent="Remove";remove.disabled=busy;remove.addEventListener("click",()=>{files.splice(index,1);sync();say("Removed "+file.name+".");});actions.append(remove);
  row.append(num,info,actions);list.append(row);
 });
 const total=files.reduce((n,f)=>n+f.size,0);totalLabel.textContent=files.length?files.length+" file(s) · "+bytes(total):"";
 start.disabled=busy||files.length<2;clear.disabled=busy||!files.length;input.disabled=busy;empty.hidden=files.length>0;
}
function addFiles(fileList){
 const accepted=[],rejected=[];
 for(const file of Array.from(fileList||[])){if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){if(!files.some(existing=>existing.name===file.name&&existing.size===file.size&&existing.lastModified===file.lastModified))accepted.push(file);}else rejected.push(file.name);}
 files.push(...accepted);
 if(rejected.length)say("Skipped non-PDF file(s): "+rejected.join(", "),"error");
 else if(accepted.length)say("Added "+accepted.length+" PDF file(s).");
 else say("No new PDF files were added.");
 sync();
}
input.addEventListener("change",()=>{addFiles(input.files);input.value="";});
drop.addEventListener("dragover",event=>{event.preventDefault();drop.classList.add("dragover");});
drop.addEventListener("dragleave",()=>drop.classList.remove("dragover"));
drop.addEventListener("drop",event=>{event.preventDefault();drop.classList.remove("dragover");if(!busy)addFiles(event.dataTransfer.files);});
clear.addEventListener("click",()=>{if(busy)return;files=[];progress.hidden=true;progress.value=0;sync();say("Add at least two PDF files to begin.");});
start.addEventListener("click",async()=>{
 if(busy||files.length<2)return;
 busy=true;sync();progress.hidden=false;progress.value=0;say("Reading PDF files…");
 try{
  const payload=[];
  for(const file of files){payload.push({name:file.name,bytes:await file.arrayBuffer()});}
  worker=new Worker("/applications/merge-pdf-worker.js");
  worker.onmessage=event=>{
   const data=event.data||{};
   if(data.type==="progress"){progress.value=data.value;say(data.message);return;}
   if(data.type==="result"){
    const blob=new Blob([data.bytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=data.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    progress.value=100;say("Merged PDF downloaded successfully.","success");finish();
   }else if(data.type==="error"){say(data.message||"Could not merge these PDFs.","error");finish();}
  };
  worker.onerror=event=>{say("The merge worker failed. Try smaller PDFs or another browser tab.","error");finish();};
  worker.postMessage({type:"merge",files:payload},payload.map(item=>item.bytes));
 }catch(error){say(error&&error.message?error.message:"Could not read the selected PDFs.","error");finish();}
});
function finish(){if(worker){worker.terminate();worker=null;}busy=false;sync();}
sync();