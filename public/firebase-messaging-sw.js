importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCejY8ji65DIObmccYNb2lpenwIplfIJGg",
  projectId: "spoof-10233",
  storageBucket: "spoof-10233.firebasestorage.app",
  messagingSenderId: "520588327152",
  appId: "1:520588327152:web:placeholder"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  if (payload.data && payload.data.command === 'FETCH_LOCATION') {
    // Note: Geolocation API (navigator.geolocation) is NOT available in a Service Worker.
    // To actually fetch location in the background, one must either:
    // 1. Show a notification that the user clicks to open the app and send location.
    // 2. Use the Background Sync / Background Geolocation APIs (experimental in some browsers).
    // 3. Post a message to all open window clients to fetch the location if the app is open.
    
    // For this prototype, we'll try to notify the client window if it's open:
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'FETCH_LOCATION'
            });
        });
    });

    // We will also show a notification
    const notificationTitle = 'Location Request';
    const notificationOptions = {
      body: 'The server requested your location. Please open the app.',
      icon: '/favicon.ico'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  }
});

