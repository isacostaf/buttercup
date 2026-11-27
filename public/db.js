// Armazenamento local com IndexedDB (aguenta fotos, ao contrário do localStorage).
// Quando houver banco de dados de verdade, só este arquivo precisa mudar.

const DB_NAME = 'buttercup';
const STORE = 'recipes';
const VERSION = 1;

let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  all: () => run('readonly', (s) => s.getAll()),
  put: (recipe) => run('readwrite', (s) => s.put(recipe)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
};

// Pede ao navegador para não apagar os dados quando faltar espaço.
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* ok */ }
}
