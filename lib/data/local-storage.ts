const DB_NAME = "CharacterAppDB";
const DB_VERSION = 4;

export const CHARACTERS_RECORD_FILE = "characters_record";
export const CHARACTER_DIALOGUES_FILE = "character_dialogues";
export const CHARACTER_IMAGES_FILE = "character_images";
export const WORLD_BOOK_FILE = "world_book";
export const REGEX_SCRIPTS_FILE = "regex_scripts";
export const PRESET_FILE = "preset_data";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHARACTERS_RECORD_FILE)) {
        db.createObjectStore(CHARACTERS_RECORD_FILE);
      }
      if (!db.objectStoreNames.contains(CHARACTER_DIALOGUES_FILE)) {
        db.createObjectStore(CHARACTER_DIALOGUES_FILE);
      }
      if (!db.objectStoreNames.contains(CHARACTER_IMAGES_FILE)) {
        db.createObjectStore(CHARACTER_IMAGES_FILE);
      }
      if (!db.objectStoreNames.contains(WORLD_BOOK_FILE)) {
        db.createObjectStore(WORLD_BOOK_FILE);
      }
      if (!db.objectStoreNames.contains(REGEX_SCRIPTS_FILE)) {
        db.createObjectStore(REGEX_SCRIPTS_FILE);
      }
      if (!db.objectStoreNames.contains(PRESET_FILE)) {
        db.createObjectStore(PRESET_FILE);
      }
    };
  });
}

export async function readData(storeName: string): Promise<any[]> {
  await initializeDataFiles();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get("data");

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function writeData(storeName: string, data: any[]): Promise<void> {
  await initializeDataFiles();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(data, "data");

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function initializeDataFiles(): Promise<void> {
  const db = await openDB();

  const storeNames = [
    CHARACTERS_RECORD_FILE, 
    CHARACTER_DIALOGUES_FILE, 
    CHARACTER_IMAGES_FILE,
    WORLD_BOOK_FILE,
    PRESET_FILE,
    REGEX_SCRIPTS_FILE,
  ];

  await Promise.all(storeNames.map(storeName => {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const getRequest = store.get("data");

      getRequest.onsuccess = () => {
        if (getRequest.result === undefined) {
          const putRequest = store.put([], "data");
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }));
}

export async function setBlob(key: string, blob: Blob): Promise<void> {
  await initializeDataFiles();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_IMAGES_FILE, "readwrite");
    const store = tx.objectStore(CHARACTER_IMAGES_FILE);
    const request = store.put(blob, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getBlob(key: string): Promise<Blob | null> {
  await initializeDataFiles();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_IMAGES_FILE, "readonly");
    const store = tx.objectStore(CHARACTER_IMAGES_FILE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteBlob(key: string): Promise<void> {
  await initializeDataFiles();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_IMAGES_FILE, "readwrite");
    const store = tx.objectStore(CHARACTER_IMAGES_FILE);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function exportAllData(): Promise<Record<string, any>> {
  const db = await openDB();
  const exportData: Record<string, any> = {};
  
  // Handle regular data stores
  const regularStores = [
    CHARACTERS_RECORD_FILE,
    CHARACTER_DIALOGUES_FILE,
    WORLD_BOOK_FILE,
    REGEX_SCRIPTS_FILE,
  ];

  for (const storeName of regularStores) {
    const data = await readData(storeName);
    exportData[storeName] = data;
  }

  // Handle image data separately
  const imageData = await readData(CHARACTER_IMAGES_FILE);
  const imageBlobs: Array<{key: string, data: string}> = [];
  
  // Get all keys from the image store
  const tx = db.transaction(CHARACTER_IMAGES_FILE, "readonly");
  const store = tx.objectStore(CHARACTER_IMAGES_FILE);
  const keys = await new Promise<string[]>((resolve) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result as string[]);
  });

  // Read each image blob and convert to base64
  for (const key of keys) {
    const blob = await getBlob(key);
    if (blob && blob instanceof Blob) {
      try {
        const base64 = await blobToBase64(blob);
        imageBlobs.push({ key, data: base64 });
      } catch (error) {
        console.error(`Failed to convert image ${key} to base64:`, error);
      }
    }
  }
  
  exportData[CHARACTER_IMAGES_FILE] = imageBlobs;

  return exportData;
}

export async function importAllData(data: Record<string, any>): Promise<void> {
  const db = await openDB();
  
  // Handle regular data stores
  const regularStores = [
    CHARACTERS_RECORD_FILE,
    CHARACTER_DIALOGUES_FILE,
    WORLD_BOOK_FILE,
    REGEX_SCRIPTS_FILE,
  ];

  for (const storeName of regularStores) {
    if (data[storeName]) {
      await writeData(storeName, data[storeName]);
    }
  }

  // Handle image data separately
  if (data[CHARACTER_IMAGES_FILE]) {
    for (const item of data[CHARACTER_IMAGES_FILE]) {
      if (typeof item.data === "string") {
        const blob = await base64ToBlob(item.data);
        await setBlob(item.key, blob);
      }
    }
  }
}

// Helper function to convert Blob to base64
async function blobToBase64(blob: Blob): Promise<string> {
  if (!(blob instanceof Blob)) {
    throw new Error("Input is not a valid Blob object");
  }
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper function to convert base64 to Blob
async function base64ToBlob(base64: string): Promise<Blob> {
  const response = await fetch(base64);
  return response.blob();
}

