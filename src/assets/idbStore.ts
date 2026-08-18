/**
 * Local-first asset blob store (IndexedDB) for source images, GLB binaries,
 * and thumbnails. Project JSON only keeps metadata + blob id references.
 *
 * Falls back to an in-memory Map when IndexedDB is unavailable (tests / SSR).
 */

export type AssetBlobKind = "sourceImage" | "glb" | "thumbnail" | "other";

export interface AssetBlobRecord {
  id: string;
  kind: AssetBlobKind;
  mimeType: string;
  byteLength: number;
  createdAt: number;
  data: ArrayBuffer;
}

const DB_NAME = "planform-assets";
const DB_VERSION = 1;
const STORE = "blobs";

type MemoryStore = Map<string, AssetBlobRecord>;

function memoryBackend(): {
  put: (rec: AssetBlobRecord) => Promise<void>;
  get: (id: string) => Promise<AssetBlobRecord | undefined>;
  del: (id: string) => Promise<boolean>;
  keys: () => Promise<string[]>;
  clear: () => Promise<void>;
} {
  const mem: MemoryStore = new Map();
  return {
    async put(rec) {
      mem.set(rec.id, rec);
    },
    async get(id) {
      return mem.get(id);
    },
    async del(id) {
      return mem.delete(id);
    },
    async keys() {
      return [...mem.keys()];
    },
    async clear() {
      mem.clear();
    },
  };
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function idbBackend() {
  const api = {
    async put(rec: AssetBlobRecord): Promise<void> {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
      });
      db.close();
    },
    async get(id: string): Promise<AssetBlobRecord | undefined> {
      const db = await openDb();
      const result = await new Promise<AssetBlobRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result as AssetBlobRecord | undefined);
        req.onerror = () => reject(req.error ?? new Error("idb get failed"));
      });
      db.close();
      return result;
    },
    async del(id: string): Promise<boolean> {
      const existing = await api.get(id);
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("idb delete failed"));
      });
      db.close();
      return !!existing;
    },
    async keys(): Promise<string[]> {
      const db = await openDb();
      const result = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
        req.onerror = () => reject(req.error ?? new Error("idb keys failed"));
      });
      db.close();
      return result;
    },
    async clear(): Promise<void> {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("idb clear failed"));
      });
      db.close();
    },
  };
  return api;
}

export class AssetBlobStore {
  private backend = memoryBackend();
  private ready: Promise<void>;

  constructor(forceMemory = false) {
    this.ready = (async () => {
      if (!forceMemory && idbAvailable()) {
        try {
          this.backend = idbBackend();
          // Touch DB once to ensure upgrade runs.
          await this.backend.keys();
        } catch {
          this.backend = memoryBackend();
        }
      }
    })();
  }

  async putBlob(
    id: string,
    data: ArrayBuffer,
    opts: { kind: AssetBlobKind; mimeType: string },
  ): Promise<AssetBlobRecord> {
    await this.ready;
    const rec: AssetBlobRecord = {
      id,
      kind: opts.kind,
      mimeType: opts.mimeType,
      byteLength: data.byteLength,
      createdAt: Date.now(),
      data,
    };
    await this.backend.put(rec);
    return rec;
  }

  async getBlob(id: string): Promise<AssetBlobRecord | undefined> {
    await this.ready;
    return this.backend.get(id);
  }

  async deleteBlob(id: string): Promise<boolean> {
    await this.ready;
    return this.backend.del(id);
  }

  async listKeys(): Promise<string[]> {
    await this.ready;
    return this.backend.keys();
  }

  async clear(): Promise<void> {
    await this.ready;
    return this.backend.clear();
  }
}

/** Shared singleton for the running app (tests should construct their own). */
let shared: AssetBlobStore | null = null;
export function getAssetBlobStore(): AssetBlobStore {
  if (!shared) shared = new AssetBlobStore();
  return shared;
}

export function resetAssetBlobStoreForTests(): void {
  shared = new AssetBlobStore(true);
}
