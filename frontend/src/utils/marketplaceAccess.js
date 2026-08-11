export function normalizeMaterialAccess(response) {
  const payload = response && typeof response === 'object' && 'access' in response && response.access && typeof response.access === 'object'
    ? response.access
    : response || {};

  const access = typeof payload.access === 'boolean' ? payload.access : Boolean(payload.access);
  return {
    access,
    reason: payload.reason || 'No access yet'
  };
}
