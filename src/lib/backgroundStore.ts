const databaseName = "gnm-studio-assets";
const storeName = "assets";
const backgroundKey = "background-image";

export type StoredBackground = {
  blob: Blob;
  name: string;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local asset database."));
  });
}

async function runRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("The local asset operation failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("The local asset transaction was cancelled."));
    });
  } finally {
    database.close();
  }
}

export async function loadBackgroundImage() {
  return (await runRequest("readonly", (store) => store.get(backgroundKey))) as StoredBackground | undefined;
}

export async function saveBackgroundImage(background: StoredBackground) {
  await runRequest("readwrite", (store) => store.put(background, backgroundKey));
}

export async function removeBackgroundImage() {
  await runRequest("readwrite", (store) => store.delete(backgroundKey));
}
