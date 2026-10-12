import fs from 'node:fs';
const [tabId, phase] = process.argv.slice(2);
const tabs = await (await fetch('http://127.0.0.1:18800/json/list')).json();
const tab = tabs.find(t => t.id === tabId);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map();
ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(r.error):p.resolve(r.result);}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
ws.onclose=()=>{for(const p of pending.values())p.reject(new Error('Browser tab closed during regression'));pending.clear();};
const rows=[];
for(const width of [320,375,390,640,767,768,834,1024,1280,1440]) {
 await call('Emulation.setDeviceMetricsOverride',{width,height:1024,deviceScaleFactor:1,mobile:false});
 const r=await call('Runtime.evaluate',{expression:`(async () => { await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return ['New information type','New location'].map(name => {const i=document.querySelector('input[placeholder="'+name+'"]');if(!i)return {name,missing:true}; const s=getComputedStyle(i),rect=i.getBoundingClientRect(),p=i.parentElement.getBoundingClientRect();return {name,width:rect.width,usable:i.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),panel:p.width,value:i.value,overflow:[...i.parentElement.children].some(x=>{const r=x.getBoundingClientRect();return r.right>p.right+1||r.left<p.left-1;}),controls:[...i.parentElement.children].map(x=>({width:x.getBoundingClientRect().width,top:x.getBoundingClientRect().top,left:x.getBoundingClientRect().left}))};});})()`,awaitPromise:true,returnByValue:true});
 if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);
 for(const input of r.result.value)rows.push({viewport:width,...input,pass:!input.missing&&input.usable>=96&&!input.overflow});
}
await call('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:false});
ws.close();fs.writeFileSync(`state/T-10953/${phase}-layout.json`,JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows.map(({viewport,name,width,usable,pass})=>({viewport,name,width,usable,pass})),null,2));
if(rows.some(r=>!r.pass))process.exitCode=1;
