/* 車番コール: 電波がなくても開けるように、画面と部品をスマホに保存する */
var VERSION = 'shaban-call-v4';
var SHARE_CACHE = 'shaban-call-shared';
var APP_FILES = [
  './', './index.html', './engine.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'
];
var CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(APP_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== SHARE_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);

  // LINEなどの「共有」から届いたPDF・写真を受け取って、アプリに渡す
  if (req.method === 'POST' && /\/share-target\/?$/.test(url.pathname)) {
    e.respondWith((async function () {
      try {
        var fd = await req.formData();
        var files = fd.getAll('file').filter(function (f) { return f && f.size; });
        var c = await caches.open(SHARE_CACHE);
        var old = await c.keys(); await Promise.all(old.map(function (k) { return c.delete(k); }));
        for (var i = 0; i < files.length && i < 6; i++) {
          await c.put(new Request('./shared/' + i), new Response(files[i], { headers: {
            'content-type': files[i].type || 'application/octet-stream',
            'x-file-name': encodeURIComponent(files[i].name || ('file' + i))
          } }));
        }
      } catch (err) {}
      return Response.redirect(new URL('./index.html?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // アプリ本体: まずネット(最新版)、つながらなければ保存分
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match('./index.html'); });
    }));
    return;
  }

  // 読み取り用の部品・フォント: 保存分があればそれを使う
  if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    e.respondWith(caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    }));
  }
});
