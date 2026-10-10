const CACHE_NAME = 'shiftgrid-timer-v1';
const PIP_STATE_KEY = 'shiftgrid.pip.state.v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('message', async (event) => {
  if (event.data?.type === 'SYNC_PIP_STATE') {
    const state = event.data.payload;
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => {
      client.postMessage({
        type: 'PIP_STATE_SYNC',
        payload: state,
      });
    });
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'timer-sync') {
    event.waitUntil(syncTimerState());
  }
});

async function syncTimerState() {
  const clients = await self.clients.matchAll({ type: 'window' });
  const state = await getStoredPipState();
  if (state) {
    clients.forEach((client) => {
      client.postMessage({
        type: 'PIP_STATE_SYNC',
        payload: state,
      });
    });
  }
}

async function getStoredPipState() {
  return new Promise((resolve) => {
    const request = indexedDB.open('shiftgrid-timer', 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pip-state'], 'readonly');
      const store = transaction.objectStore('pip-state');
      const getRequest = store.get('current');
      getRequest.onsuccess = () => resolve(getRequest.result);
    };
    request.onerror = () => resolve(null);
  });
}

console.log('ShiftGrid Timer Service Worker loaded');