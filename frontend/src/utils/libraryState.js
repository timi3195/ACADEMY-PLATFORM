const PROGRESS_STORAGE_KEY = 'academy-library-progress';
const WISHLIST_STORAGE_KEY = 'academy-wishlist';
const RECENT_STORAGE_KEY = 'academy-recently-viewed';

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
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Unable to load library progress', error);
    return [];
  }
}

export function saveProgressEntries(entries = []) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(entries));
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
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Unable to load wishlist', error);
    return [];
  }
}

export function saveWishlistEntries(entries = []) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(entries));
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
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Unable to load recent materials', error);
    return [];
  }
}

export function saveRecentlyViewedEntries(entries = []) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries));
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
