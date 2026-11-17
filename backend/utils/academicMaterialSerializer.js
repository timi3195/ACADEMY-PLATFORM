const ACADEMIC_MATERIAL_FIELDS = [
  "_id", "title", "description", "coverImageUrl", "course", "courseRef", "courseCode",
  "department", "semester", "lecturer", "lecturerName", "category", "materialType",
  "visibility", "level", "previewPages", "pageCount", "status",
  "approved", "hidden", "isDeleted", "downloads", "views", "tags", "allowDownload",
  "allowPreview", "fileUrl", "downloadUrl", "originalName", "mimeType", "size",
  "createdAt", "updatedAt"
];

const serializeAcademicMaterial = (material) => {
  if (!material) return null;
  const source = typeof material.toObject === "function" ? material.toObject() : material;
  return ACADEMIC_MATERIAL_FIELDS.reduce((result, field) => {
    if (source[field] !== undefined) result[field] = source[field];
    return result;
  }, {});
};

module.exports = serializeAcademicMaterial;
