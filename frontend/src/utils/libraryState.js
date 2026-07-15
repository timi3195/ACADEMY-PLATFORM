const PROGRESS_STORAGE_KEY = 'academy-library-progress';
const WISHLIST_STORAGE_KEY = 'academy-wishlist';
const RECENT_STORAGE_KEY = 'academy-recently-viewed';
const PENDING_PURCHASE_STORAGE_KEY = 'academy-pending-purchase';
const LATEST_PURCHASE_STORAGE_KEY = 'academy-latest-purchase';

function getStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getProgressPercent(lastPage = 0, totalPages = 0) {
  if (!totalPages || !lastPage) return 0;
  return Number(Math.min(100, Math.max(0, (lastPage / totalPages) * 100)).toFixed(1));
}

export function normalizeProgressEntry(entry = {}) {
  const totalPages = Number(entry.totalPages || 0);
  const lastPage = Number(entry.lastPage || 0);
  const percentCompleted = getProgressPercent(lastPage, totalPages);

  return {
    materialId: entry.materialId || entry._id || '',
    lastPage,
    totalPages,
    percentCompleted,
    lastOpened: entry.lastOpened || new Date().toISOString()
  };
}

export function createProgressEntry(materialId, overrides = {}) {
  return normalizeProgressEntry({ materialId, ...overrides });
}

export function loadProgressEntries() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Unable to load library progress', error);
    return [];
  }
}

export function saveProgressEntries(entries = []) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(entries));
}

export function upsertProgressEntry(entry) {
  const normalized = normalizeProgressEntry(entry);
  const entries = loadProgressEntries();
  const nextEntries = entries.filter((item) => item.materialId !== normalized.materialId);
  nextEntries.unshift(normalized);
  saveProgressEntries(nextEntries.slice(0, 50));
  return normalized;
}

export function getProgressEntry(materialId) {
  return loadProgressEntries().find((entry) => entry.materialId === materialId) || null;
}

export function loadWishlistEntries() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Unable to load wishlist', error);
    return [];
  }
}

export function saveWishlistEntries(entries = []) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(entries));
}

export function toggleWishlistEntry(material) {
  const id = material?._id || material?.id || material?.materialId;
  if (!id) return [];
  const entries = loadWishlistEntries();
  const exists = entries.includes(id);
  const nextEntries = exists ? entries.filter((entry) => entry !== id) : [id, ...entries];
  saveWishlistEntries(nextEntries.slice(0, 40));
  return nextEntries;
}

export function isWishlisted(material) {
  const id = material?._id || material?.id || material?.materialId;
  return Boolean(id && loadWishlistEntries().includes(id));
}

export function loadRecentlyViewedEntries() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Unable to load recent materials', error);
    return [];
  }
}

export function saveRecentlyViewedEntries(entries = []) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries));
}

export function addRecentlyViewed(material) {
  const id = material?._id || material?.id || material?.materialId;
  if (!id) return [];
  const entries = loadRecentlyViewedEntries().filter((entry) => entry !== id);
  entries.unshift(id);
  const nextEntries = entries.slice(0, 12);
  saveRecentlyViewedEntries(nextEntries);
  return nextEntries;
}

export function savePendingPurchase(purchase) {
  const storage = getStorage();
  if (!storage) return null;
  const payload = purchase ? { ...purchase, savedAt: new Date().toISOString() } : null;
  storage.setItem(PENDING_PURCHASE_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function loadPendingPurchase() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_PURCHASE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error('Unable to load pending purchase', error);
    return null;
  }
}

export function clearPendingPurchase() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(PENDING_PURCHASE_STORAGE_KEY);
}

export function saveLatestPurchase(purchase) {
  const storage = getStorage();
  if (!storage) return null;
  const payload = purchase ? { ...purchase, savedAt: new Date().toISOString() } : null;
  storage.setItem(LATEST_PURCHASE_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function loadLatestPurchase() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LATEST_PURCHASE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error('Unable to load latest purchase', error);
    return null;
  }
}
