const mongoose = require("mongoose");
const File = require("../models/File");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const materialAccessService = require("../services/materialAccessService");
const NIGERIAN_BANKS = require("../utils/bankList");

const buildLecturerMaterialFilters = (lecturerId, query) => {
  const filters = {
    lecturer: lecturerId,
    isDeleted: false
  };

  if (query.q) {
    filters.$text = { $search: query.q };
  }

  if (query.course) {
    filters.course = query.course;
  }

  if (query.department) {
    filters.department = query.department;
  }

  if (query.status) {
    if (query.status === "approved" || query.status === "pending" || query.status === "rejected" || query.status === "hidden") {
      filters.status = query.status;
    }
  }

  return filters;
};

const getLecturerDashboard = async (lecturerId) => {
  const materials = await File.find({ lecturer: lecturerId, isDeleted: false });
  const materialIds = materials.map((m) => m._id);

  const transactions = await Transaction.find({
    material: { $in: materialIds },
    plan: "material",
    status: "success"
  }).lean();

  const totalMaterials = materials.length;
  const totalSales = transactions.length;
  const totalEarnings = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  const pendingEarnings = transactions.filter((tx) => tx.status === "pending").reduce((sum, tx) => sum + (tx.amount || 0), 0);
  const withdrawnEarnings = await Withdrawal.aggregate([
    { $match: { lecturer: new mongoose.Types.ObjectId(lecturerId), status: { $in: ["approved", "paid"] } } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);

  const totalDownloads = materials.reduce((sum, material) => sum + (material.downloads || 0), 0);
  const totalViews = materials.reduce((sum, material) => sum + (material.views || 0), 0);

  const mostPurchased = await File.findOne({ lecturer: lecturerId, isDeleted: false })
    .sort({ purchases: -1 })
    .lean();

  const newestMaterials = await File.find({ lecturer: lecturerId, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return {
    totalMaterials,
    totalSales,
    totalEarnings,
    pendingEarnings,
    withdrawnEarnings: withdrawnEarnings[0] ? withdrawnEarnings[0].total : 0,
    totalDownloads,
    totalViews,
    mostPurchasedMaterial: mostPurchased || null,
    newestMaterials
  };
};

const getLecturerMaterials = async (lecturerId, query = {}) => {
  const filters = buildLecturerMaterialFilters(lecturerId, query);
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Number(query.limit) || 20, 50);
  const skip = (page - 1) * limit;

  const materials = await File.find(filters)
    .populate("course department", "title code name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await File.countDocuments(filters);

  return {
    materials,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

const createLecturerMaterial = async ({ user, body, file }) => {
  return await File.create({
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
    price: Number(body.price || 0),
    isFree: body.isFree === "true" || body.isFree === true,
    isPaid: body.isPaid === "true" || body.isPaid === true,
    premiumDiscount: Number(body.premiumDiscount || 0),
    tags: normalizeTags(body.tags),
    approved: false,
    status: "pending",
    hidden: false,
    featured: false,
    isDeleted: false,
    downloads: 0,
    views: 0,
    purchases: 0,
    sales: 0,
    ratingAverage: 0,
    ratingCount: 0
  }).then(async (created) => {
    created.fileUrl = `/api/marketplace/materials/${created._id}`;
    await created.save();
    return created;
  });
};

const updateLecturerMaterial = async ({ user, materialId, body, file }) => {
  const material = await File.findById(materialId);
  if (!material) return null;

  const editPermission = materialAccessService.canEditMaterial({ user, material });
  if (!editPermission.allowed) {
    const error = new Error(editPermission.reason || "Unauthorized to update this material");
    error.statusCode = 403;
    throw error;
  }

  if (material.isDeleted) {
    const error = new Error("Material is deleted");
    error.statusCode = 404;
    throw error;
  }

  const updates = {
    title: body.title ?? material.title,
    description: body.description ?? material.description,
    coverImageUrl: body.coverImageUrl ?? material.coverImageUrl,
    price: body.price !== undefined ? Number(body.price) : material.price,
    tags: body.tags !== undefined ? normalizeTags(body.tags) : material.tags,
    visibility: body.visibility ?? material.visibility,
    previewPages: body.previewPages !== undefined ? Number(body.previewPages) : material.previewPages,
    level: body.level ?? material.level,
    status: body.status ?? material.status,
    hidden: body.hidden !== undefined ? !!body.hidden : material.hidden
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

const softDeleteMaterial = async (materialId, user) => {
  const material = await File.findById(materialId);
  if (!material) return null;

  const deletePermission = materialAccessService.canDeleteMaterial({ user, material });
  if (!deletePermission.allowed) {
    const error = new Error(deletePermission.reason || "Unauthorized to delete this material");
    error.statusCode = 403;
    throw error;
  }

  if (material.isDeleted) return material;

  material.isDeleted = true;
  material.deletedAt = new Date();
  await material.save();
  return material;
};

const getMaterialAnalytics = async (lecturerId, materialId) => {
  if (!mongoose.Types.ObjectId.isValid(materialId)) {
    const error = new Error("Invalid material ID");
    error.statusCode = 400;
    throw error;
  }

  const material = await File.findOne({ _id: materialId, lecturer: lecturerId, isDeleted: false });
  if (!material) {
    const error = new Error("Material not found");
    error.statusCode = 404;
    throw error;
  }

  const purchases = await Transaction.find({
    material: materialId,
    plan: "material",
    status: "success"
  })
    .populate("user", "name email")
    .sort({ paidAt: -1 })
    .lean();

  const averageRating = material.ratingAverage || 0;
  const ratingCount = material.ratingCount || 0;

  const recentBuyers = purchases.slice(0, 10).map((tx) => ({
    user: tx.user,
    amount: tx.amount,
    purchasedAt: tx.paidAt,
    reference: tx.reference
  }));

  return {
    views: material.views,
    downloads: material.downloads,
    sales: material.sales,
    earnings: purchases.reduce((sum, tx) => sum + (tx.amount || 0), 0),
    purchaseHistory: purchases.map((tx) => ({
      transactionId: tx._id,
      reference: tx.reference,
      amount: tx.amount,
      paidAt: tx.paidAt,
      user: tx.user
    })),
    averageRating,
    ratingCount,
    recentBuyers
  };
};

const getLecturerEarnings = async (lecturerId) => {
  const materials = await File.find({ lecturer: lecturerId, isDeleted: false }).select("_id").lean();
  const materialIds = materials.map((material) => material._id);

  const sales = await Transaction.find({
    material: { $in: materialIds },
    plan: "material",
    status: "success"
  }).lean();

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const salesThisMonth = sales.filter((tx) => {
    const dt = new Date(tx.paidAt);
    return dt.getMonth() === currentMonth && dt.getFullYear() === currentYear;
  }).length;

  const currentSemester = now.getMonth() < 6 ? `${now.getFullYear()}-1` : `${now.getFullYear()}-2`;
  const salesThisSemester = sales.filter((tx) => String(tx.semester) === currentSemester).length;

  const availableBalance = sales.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  const pendingBalance = await Withdrawal.aggregate([
    { $match: { lecturer: new mongoose.Types.ObjectId(lecturerId), status: "pending" } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);
  const withdrawnBalance = await Withdrawal.aggregate([
    { $match: { lecturer: new mongoose.Types.ObjectId(lecturerId), status: { $in: ["approved", "paid"] } } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);

  return {
    availableBalance,
    pendingBalance: pendingBalance[0] ? pendingBalance[0].total : 0,
    withdrawnBalance: withdrawnBalance[0] ? withdrawnBalance[0].total : 0,
    salesThisMonth,
    salesThisSemester
  };
};

const getLecturerWithdrawals = async (lecturerId) => {
  return await Withdrawal.find({ lecturer: lecturerId }).sort({ requestedAt: -1 }).lean();
};

const requestLecturerWithdrawal = async (lecturerId, body) => {
  const MIN_WITHDRAWAL = 1000;
  const amount = Number(body.amount);

  if (amount < MIN_WITHDRAWAL) {
    const error = new Error(`Minimum withdrawal amount is ${MIN_WITHDRAWAL}`);
    error.statusCode = 400;
    throw error;
  }

  if (!NIGERIAN_BANKS.includes(body.bankName)) {
    const error = new Error("Unsupported bank name");
    error.statusCode = 400;
    throw error;
  }

  const withdrawal = await Withdrawal.create({
    lecturer: lecturerId,
    amount,
    bankName: body.bankName,
    accountNumber: body.accountNumber,
    accountName: body.accountName,
    status: "pending",
    notes: body.notes || ""
  });

  return withdrawal;
};

module.exports = {
  getLecturerDashboard,
  getLecturerMaterials,
  createLecturerMaterial,
  updateLecturerMaterial,
  softDeleteMaterial,
  getMaterialAnalytics,
  getLecturerEarnings,
  getLecturerWithdrawals,
  requestLecturerWithdrawal
};
