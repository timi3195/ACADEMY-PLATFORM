export function normalizeMaterialFormValue(value) {
  if (value && typeof value === 'object' && value._id) return value._id;
  return value ?? '';
}

export function buildMaterialPayload(form) {
  return {
    title: String(form?.title || '').trim(),
    description: String(form?.description || '').trim(),
    course: normalizeMaterialFormValue(form?.course),
    materialType: form?.materialType || 'Lecture Note',
    category: form?.category || 'Lecture Notes',
    tags: form?.tags || '',
    language: form?.language || 'English',
    previewPages: Math.max(0, Number(form?.previewPages || 0)),
    pageCount: Math.max(0, Number(form?.pageCount || 0)),
    status: form?.status === 'draft' ? 'draft' : 'published'
  };
}
