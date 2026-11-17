export function normalizeMaterialFormValue(value) {
  if (value && typeof value === 'object' && value._id) {
    return value._id;
  }

  return value ?? '';
}

export function buildMaterialPayload(form) {
  const previewPages = Number(form?.previewPages || 0);
  const pageCount = Number(form?.pageCount || previewPages || 0);
  const fileSize = Number(form?.fileSize || 0);

  return {
    ...form,
    course: normalizeMaterialFormValue(form?.course),
    department: normalizeMaterialFormValue(form?.department),
    price: 0,
    discount: 0,
    previewPages,
    pageCount,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    tags: form?.tags || '',
    isFree: true,
    isPaid: false,
    pricingMode: 'free',
    allowDownload: form?.allowDownload !== 'false' && form?.allowDownload !== false,
    allowPreview: form?.allowPreview !== 'false' && form?.allowPreview !== false
  };
}
