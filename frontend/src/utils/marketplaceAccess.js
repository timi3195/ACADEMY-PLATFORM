export function normalizeMaterialAccess(response) {
  const payload = response && typeof response === 'object' && 'access' in response && response.access && typeof response.access === 'object'
    ? response.access
    : response || {};

  const accessValue = payload.access ?? payload.hasAccess ?? payload.canView ?? payload.canRead ?? payload.isPurchased ?? payload.purchased ?? payload.granted ?? false;
  const access = Boolean(accessValue);
  const canDownload = Boolean(payload.canDownload ?? payload.allowDownload ?? accessValue);

  return {
    access,
    hasAccess: access,
    canView: access,
    canRead: access,
    canDownload,
    isPurchased: access,
    reason: payload.reason || 'No access yet'
  };
}
