const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const File = require("../models/File");
const Transaction = require("../models/Transaction");
const paystackService = require("./paystackService");
const materialAccessService = require("./materialAccessService");

const normalizeTags = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
  return String(tags)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
};

const createMaterial = async ({ user, body, file }) => {
  const price = Number(body.price || 0);
  const isFree = body.isFree === "true" || body.isFree === true;
  const isPaid = body.isPaid === "true" || body.isPaid === true;

  const created = await File.create({
    title: body.title,
    description: body.description || "",
    coverImageUrl: body.coverImageUrl || "",
    fileUrl: "",
    storageFilename: file.filename,
    originalName: file.originalname,
    course: body.course,
    department: body.department || null,
    semester: body.semester || "First",
    lecturer: user.id,
    category: body.category || "Other",
    materialType: body.materialType || "Other",
    visibility: body.visibility || "public",
    level: body.level || "Other",
    previewPages: Number(body.previewPages || 0),
    pageCount: Number(body.pageCount || body.previewPages || 0),
    productStatus: body.productStatus || "draft",
    language: body.language || "en",
    edition: body.edition || "",
    publisher: body.publisher || "",
    price,
    isFree,
    isPaid,
    premiumDiscount: Number(body.premiumDiscount || 0),
    approved: false,
    status: body.status || "pending",
    hidden: false,
    featured: false,
    uploads: 0,
    downloads: 0,
    purchases: 0,
    sales: 0,
    ratingAverage: 0,
    ratingCount: 0,
    tags: normalizeTags(body.tags),
    isPremium: false
  });

  created.fileUrl = `/api/marketplace/materials/${created._id}`;
  await created.save();
  return created;
};

const buildMaterialFilters = (query) => {
  const filters = { approved: true, visibility: "public" };

  if (query.q) {
    filters.$text = { $search: query.q };
  }
  if (query.department) {
    filters.department = query.department;
  }
  if (query.course) {
    filters.course = query.course;
  }
  if (query.semester) {
    filters.semester = query.semester;
  }
  if (query.category) {
    filters.category = query.category;
  }
  if (query.materialType) {
    filters.materialType = query.materialType;
  }
  if (query.lecturer) {
    filters.lecturer = query.lecturer;
  }
  if (query.tags) {
    const tags = Array.isArray(query.tags) ? query.tags : String(query.tags).split(",");
    filters.tags = { $in: tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean) };
  }

  return filters;
};

const listMaterials = async (query) => {
  const filters = buildMaterialFilters(query);
  const limit = Math.min(Number(query.limit) || 20, 50);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const materials = await File.find(filters)
    .populate({ path: "course", select: "title code" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return materials.map((material) => ({
    ...material,
    accessUrl: `/api/marketplace/materials/${material._id}`
  }));
};

const getMaterialById = async (id) => {
  return await File.findOne({
    _id: id,
    approved: true,
    isDeleted: false,
    hidden: false,
    visibility: { $in: ["public", "unlisted"] }
  })
    .populate({ path: "course", select: "title code" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" })
    .select("-storageFilename -deletedAt")
    .lean();
};

const getLecturerMaterials = async (lecturerId) => {
  return await File.find({ lecturer: lecturerId })
    .populate("course department", "title code name")
    .sort({ createdAt: -1 });
};

const updateMaterial = async ({ user, materialId, body, file }) => {
  const material = await File.findById(materialId);
  if (!material) return null;

  const editPermission = materialAccessService.canEditMaterial({ user, material });
  if (!editPermission.allowed) {
    const error = new Error(editPermission.reason || "Unauthorized to update this material");
    error.statusCode = 403;
    throw error;
  }

  const updates = {
    title: body.title ?? material.title,
    description: body.description ?? material.description,
    coverImageUrl: body.coverImageUrl ?? material.coverImageUrl,
    course: body.course ?? material.course,
    department: body.department ?? material.department,
    semester: body.semester ?? material.semester,
    category: body.category ?? material.category,
    materialType: body.materialType ?? material.materialType,
    visibility: body.visibility ?? material.visibility,
    level: body.level ?? material.level,
    previewPages: body.previewPages !== undefined ? Number(body.previewPages) : material.previewPages,
    pageCount: body.pageCount !== undefined ? Number(body.pageCount) : material.pageCount,
    productStatus: body.productStatus ?? material.productStatus,
    language: body.language ?? material.language,
    edition: body.edition ?? material.edition,
    publisher: body.publisher ?? material.publisher,
    price: body.price !== undefined ? Number(body.price) : material.price,
    isFree: body.isFree !== undefined ? (body.isFree === "true" || body.isFree === true) : material.isFree,
    isPaid: body.isPaid !== undefined ? (body.isPaid === "true" || body.isPaid === true) : material.isPaid,
    premiumDiscount: body.premiumDiscount !== undefined ? Number(body.premiumDiscount) : material.premiumDiscount,
    approved: body.approved !== undefined ? !!body.approved : material.approved,
    tags: body.tags !== undefined ? normalizeTags(body.tags) : material.tags
  };

  if (file) {
    updates.storageFilename = file.filename;
    updates.originalName = file.originalname;
    updates.fileUrl = `/api/marketplace/materials/${material._id}`;
  }

  Object.assign(material, updates);
  await material.save();
  return material;
};

const deleteMaterial = async (materialId, user) => {
  const material = await File.findById(materialId);
  if (!material) return null;

  const deletePermission = materialAccessService.canDeleteMaterial({ user, material });
  if (!deletePermission.allowed) {
    const error = new Error(deletePermission.reason || "Unauthorized to delete this material");
    error.statusCode = 403;
    throw error;
  }

  const storagePath = path.join(__dirname, "../uploads", material.storageFilename);
  if (material.storageFilename && fs.existsSync(storagePath)) {
    fs.unlinkSync(storagePath);
  }

  await material.remove();
  return true;
};

const getFeaturedMaterials = async (query) => {
  const limit = Math.min(Number(query.limit) || 12, 50);
  const materials = await File.find({ approved: true, visibility: "public" })
    .populate({ path: "course", select: "title code" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ purchases: -1, ratingAverage: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return materials;
};

const getNewMaterials = async (query) => {
  const limit = Math.min(Number(query.limit) || 12, 50);
  const materials = await File.find({ approved: true, visibility: "public" })
    .populate({ path: "course", select: "title code" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return materials;
};

const getCourseMaterials = async (courseId, query) => {
  const limit = Math.min(Number(query.limit) || 20, 50);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const materials = await File.find({ course: courseId, approved: true, visibility: "public" })
    .populate({ path: "course", select: "title code" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return materials;
};

const getDepartmentMaterials = async (departmentId, query) => {
  const limit = Math.min(Number(query.limit) || 20, 50);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const materials = await File.find({ department: departmentId, approved: true, visibility: "public" })
    .populate({ path: "course", select: "title code" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return materials;
};

const getLibrary = async (userId, query = {}) => {
  const filters = {
    user: userId,
    plan: "material",
    status: "success",
    material: { $ne: null }
  };

  const transactions = await Transaction.find(filters)
    .populate({
      path: "material",
      populate: [
        { path: "course", select: "title code" },
        { path: "department", select: "name code" },
        { path: "lecturer", select: "name email" }
      ]
    })
    .lean();

  const sortBy = String(query.sortBy || "newest").toLowerCase();
  const sortFns = {
    newest: (a, b) => new Date(b.paidAt) - new Date(a.paidAt),
    course: (a, b) => {
      const aKey = a.material?.course?.title || "";
      const bKey = b.material?.course?.title || "";
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    },
    lecturer: (a, b) => {
      const aKey = a.material?.lecturer?.name || "";
      const bKey = b.material?.lecturer?.name || "";
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    },
    department: (a, b) => {
      const aKey = a.material?.department?.name || "";
      const bKey = b.material?.department?.name || "";
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    }
  };

  const sorter = sortFns[sortBy] || sortFns.newest;
  transactions.sort(sorter);

  return transactions.map((transaction) => ({
    transactionId: transaction._id,
    reference: transaction.reference,
    status: transaction.status,
    purchasedAt: transaction.paidAt,
    amount: transaction.amount,
    discount: transaction.discount || 0,
    material: transaction.material
  }));
};

const getLibraryItem = async (userId, materialId) => {
  if (!mongoose.Types.ObjectId.isValid(materialId)) {
    return null;
  }

  const transaction = await Transaction.findOne({
    user: userId,
    material: materialId,
    plan: "material",
    status: "success"
  }).populate({
    path: "material",
    populate: [
      { path: "course", select: "title code" },
      { path: "department", select: "name code" },
      { path: "lecturer", select: "name email" }
    ]
  });

  if (!transaction) {
    return null;
  }

  return {
    transactionId: transaction._id,
    reference: transaction.reference,
    status: transaction.status,
    purchasedAt: transaction.paidAt,
    amount: transaction.amount,
    discount: transaction.discount || 0,
    material: transaction.material
  };
};

const getPurchaseHistory = async (userId, query = {}) => {
  const filters = {
    user: userId,
    plan: "material"
  };

  if (query.status) {
    filters.status = query.status;
  }

  if (query.materialId && mongoose.Types.ObjectId.isValid(query.materialId)) {
    filters.material = query.materialId;
  }

  const purchases = await Transaction.find(filters)
    .populate({
      path: "material",
      populate: [
        { path: "course", select: "title code" },
        { path: "department", select: "name code" },
        { path: "lecturer", select: "name email" }
      ]
    })
    .sort({ paidAt: -1 })
    .lean();

  return purchases.map((transaction) => ({
    transactionId: transaction._id,
    reference: transaction.reference,
    status: transaction.status,
    purchasedAt: transaction.paidAt,
    amount: transaction.amount,
    discount: transaction.discount || 0,
    material: transaction.material
  }));
};

const getMaterialAccess = async (userId, materialId) => {
  const material = await File.findById(materialId)
    .populate({ path: "course", select: "title code level department" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" });

  if (!material) {
    const error = new Error("Material not found");
    error.statusCode = 404;
    throw error;
  }

  const access = await materialAccessService.canViewMaterial({
    user: { id: userId },
    material,
    restrictByCourse: false
  });

  return {
    access: access.allowed,
    reason: access.reason,
    material
  };
};

const listPendingMaterials = async () => {
  return await File.find({ approved: false })
    .populate("course department lecturer", "title code name email")
    .sort({ createdAt: -1 });
};

const setMaterialApproval = async (materialId, approved) => {
  return await File.findByIdAndUpdate(
    materialId,
    { approved: !!approved },
    { new: true }
  );
};

const getDiscountedPrice = (material, user) => {
  const price = Number(material.price || 0);
  const discount = Number(material.premiumDiscount || 0);
  const isPremium = user && ((user.plan === "premium") || (user.subscriptionType === "premium"));

  if (isPremium && discount > 0 && material.isPaid) {
    return Math.max(0, Math.round(price * (100 - discount)) / 100);
  }
  return price;
};

const initializePurchase = async (materialId, user) => {
  const material = await File.findById(materialId);
  if (!material) {
    const error = new Error("Material not found");
    error.statusCode = 404;
    throw error;
  }
  if (!material.approved) {
    const error = new Error("Material is not approved for purchase yet");
    error.statusCode = 403;
    throw error;
  }
  if (material.isFree) {
    const error = new Error("This material is free and does not require purchase");
    error.statusCode = 400;
    throw error;
  }
  if (!material.isPaid && material.price <= 0) {
    const error = new Error("This material is not available for purchase");
    error.statusCode = 400;
    throw error;
  }

  const purchasePermission = await materialAccessService.canPurchaseMaterial({ user, material });
  if (!purchasePermission.allowed) {
    const error = new Error(purchasePermission.reason || "Purchase not allowed");
    error.statusCode = 403;
    throw error;
  }

  const finalPrice = getDiscountedPrice(material, user);
  const transport = await paystackService.initializePayment({
    email: user.email,
    amount: finalPrice,
    metadata: {
      materialId: material._id.toString(),
      paymentType: "material",
      discount: material.premiumDiscount || 0,
      userId: user.id
    }
  });

  return {
    authorizationUrl: transport.authorization_url,
    reference: transport.reference,
    amount: finalPrice,
    currency: transport.currency || "NGN"
  };
};

const verifyPurchase = async (materialId, reference, user) => {
  const material = await File.findById(materialId);
  if (!material) {
    const error = new Error("Material not found");
    error.statusCode = 404;
    throw error;
  }

  const verification = await paystackService.verifyPayment(reference);
  if (!verification || verification.status !== "success") {
    const error = new Error("Payment verification failed");
    error.statusCode = 400;
    throw error;
  }

  if (verification.metadata?.materialId && verification.metadata.materialId.toString() !== material._id.toString()) {
    const error = new Error("Payment reference does not match the requested material");
    error.statusCode = 400;
    throw error;
  }

  const alreadyVerifiedTransaction = await Transaction.findOne({ reference });
  if (alreadyVerifiedTransaction) {
    if (alreadyVerifiedTransaction.material.toString() !== material._id.toString() || alreadyVerifiedTransaction.user.toString() !== user.id.toString()) {
      const error = new Error("Payment reference already used");
      error.statusCode = 409;
      throw error;
    }
    return alreadyVerifiedTransaction;
  }

  const amount = verification.amount / 100;
  const transaction = await Transaction.create({
    user: user.id,
    email: user.email,
    amount,
    reference,
    status: "success",
    plan: "material",
    paymentType: "material",
    semester: null,
    expiresAt: null,
    paidAt: new Date(),
    material: material._id,
    materialPrice: material.price,
    discount: material.premiumDiscount || 0
  });

  material.purchases += 1;
  material.sales += 1;
  await material.save();

  return transaction;
};

module.exports = {
  createMaterial,
  listMaterials,
  getMaterialById,
  getLecturerMaterials,
  getLibrary,
  getLibraryItem,
  getPurchaseHistory,
  getMaterialAccess,
  initializePurchase,
  initializeMarketplacePurchase: initializePurchase,
  verifyPurchase,
  verifyMarketplacePurchase: verifyPurchase,
  listPendingMaterials,
  setMaterialApproval
};
