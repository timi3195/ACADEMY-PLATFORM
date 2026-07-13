export function formatCurrency(value) {
  const numeric = Number(value || 0);
  return `₦${numeric.toLocaleString()}`;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
