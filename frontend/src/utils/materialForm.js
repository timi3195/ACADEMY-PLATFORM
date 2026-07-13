export function normalizeMaterialFormValue(value) {
  if (value && typeof value === 'object' && value._id) {
    return value._id;
  }

  return value ?? '';
}

export function buildMaterialPayload(form) {
  const price = Number(form?.price || 0);
  const previewPages = Number(form?.previewPages || 0);
  const isFree = price === 0;
  const isPaid = price > 0;

  return {
    ...form,
    course: normalizeMaterialFormValue(form?.course),
    department: normalizeMaterialFormValue(form?.department),
    price,
    previewPages,
    isFree,
    isPaid
  };
}
