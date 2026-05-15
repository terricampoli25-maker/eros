self.addEventListener('install', function(e) {
  console.log('Service Worker installed');
});

self.addEventListener('fetch', function(e) {
  // do nothing, just let requests pass through
});
