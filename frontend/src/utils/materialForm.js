export function normalizeMaterialFormValue(value) {
  if (value && typeof value === 'object' && value._id) {
    return value._id;
  }

  return value ?? '';
}

export function buildMaterialPayload(form) {
  const pricingMode = form?.pricingMode || (Number(form?.price || 0) === 0 ? 'free' : 'paid');
  const rawPrice = Number(form?.price || 0);
  const price = pricingMode === 'free' ? 0 : rawPrice;
  const discount = Number(form?.discount || 0);
  const previewPages = Number(form?.previewPages || 0);
  const pageCount = Number(form?.pageCount || previewPages || 0);
  const fileSize = Number(form?.fileSize || 0);
  const isFree = pricingMode === 'free' || price === 0;
  const isPaid = !isFree && price > 0;

  return {
    ...form,
    course: normalizeMaterialFormValue(form?.course),
    department: normalizeMaterialFormValue(form?.department),
    price,
    discount,
    previewPages,
    pageCount,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    tags: form?.tags || '',
    isFree,
    isPaid,
    pricingMode,
    allowDownload: form?.allowDownload !== 'false' && form?.allowDownload !== false,
    allowPreview: form?.allowPreview !== 'false' && form?.allowPreview !== false
  };
}
