// NexoBalance Service Worker
// La versión se deriva de APP_VERSION del index.html. Al bumpear una, bumpea la otra.
const APP_VERSION='1.50.0';
const CACHE='nexobalance-v'+APP_VERSION;
const ASSETS=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'];

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>Promise.allSettled(ASSETS.map(a=>c.add(a))))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',e=>{
  if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();
});

// index.html y navegaciones: RED PRIMERO (con caché de respaldo).
// Así una corrección publicada llega al usuario en la siguiente apertura,
// aunque el service worker viejo siga activo un momento.
function esDocumento(req,url){
  if(req.mode==='navigate')return true;
  if(url.origin!==self.location.origin)return false;
  return url.pathname==='/'||url.pathname.endsWith('/')||url.pathname.endsWith('index.html');
}

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);

  if(esDocumento(e.request,url)){
    e.respondWith(
      fetch(e.request)
        .then(res=>{
          if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{})}
          return res;
        })
        .catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./index.html')))
    );
    return;
  }

  // Resto de estáticos: caché primero, refresco en segundo plano.
  const propio=url.origin===self.location.origin
    ||url.hostname==='cdn.jsdelivr.net'
    ||url.hostname==='fonts.googleapis.com'
    ||url.hostname==='fonts.gstatic.com';
  if(!propio)return;

  e.respondWith(
    caches.match(e.request).then(hit=>{
      const net=fetch(e.request).then(res=>{
        if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{})}
        return res;
      }).catch(()=>hit);
      return hit||net;
    })
  );
});
