const CACHE='nexobalance-v2.20.0';
const ASSETS=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(url.origin===self.location.origin||url.hostname==='cdn.jsdelivr.net'||url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com'){
    e.respondWith(
      caches.match(e.request).then(hit=>{
        const net=fetch(e.request).then(res=>{
          if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}
          return res;
        }).catch(()=>hit);
        return hit||net;
      })
    );
  }
});
