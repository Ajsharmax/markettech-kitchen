importScripts("/applications/vendor/pdf-lib-1.10.0.min.js");
self.onmessage=async event=>{
 const data=event.data||{};if(data.type!=="merge")return;
 try{
  const {PDFDocument}=PDFLib;const output=await PDFDocument.create();let completed=0;
  for(const file of data.files){
   const source=await PDFDocument.load(new Uint8Array(file.bytes));
   const pages=await output.copyPages(source,source.getPageIndices());
   for(const page of pages)output.addPage(page);
   completed++;self.postMessage({type:"progress",value:Math.round(completed/data.files.length*90),message:"Added "+completed+" of "+data.files.length+" PDF files…"});
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  const bytes=await output.save();const outName="merged-"+new Date().toISOString().replace(/[:.]/g,"-").slice(0,19)+".pdf";
  self.postMessage({type:"result",filename:outName,bytes},[bytes.buffer]);
 }catch(error){self.postMessage({type:"error",message:error&&error.message?error.message:"Unable to merge one of these PDFs. It may be damaged or password-protected."});}
};