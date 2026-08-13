const mongoose = require("mongoose");
const File = require("../models/File");
const User = require("../models/User");

const normalizeTags = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
  return String(tags)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
};
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const materialAccessService = require("../services/materialAccessService");
const { normalizeAcademicLevel } = require('../utils/academicLevels');
const NIGERIAN_BANKS = require("../utils/bankList");
const paystackService = require("../services/paystackService");
const { getPaystackBankCode, getAllBanksWithCodes } = require("../utils/paystackBankCodes");

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
  const publishedMaterials = materials.filter((material) => material.productStatus === "published" || material.status === "approved" || material.approved).length;
  const draftMaterials = materials.filter((material) => material.productStatus === "draft").length;
  const pendingApproval = materials.filter((material) => material.status === "pending" || material.status === "rejected").length;
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

  const averageRating = materials.length ? materials.reduce((sum, material) => sum + Number(material.ratingAverage || 0), 0) / materials.length : 0;

  return {
    totalMaterials,
    publishedMaterials,
    draftMaterials,
    pendingApproval,
    totalSales,
    totalEarnings,
    pendingEarnings,
    withdrawnEarnings: withdrawnEarnings[0] ? withdrawnEarnings[0].total : 0,
    totalDownloads,
    totalViews,
    averageRating,
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

const createLecturerMaterial = async ({ user, body, file, coverImage }) => {
  const coverImageUrl = coverImage ? `/uploads/${coverImage.filename}` : body.coverImageUrl || "";
  const pageCount = Number(body.pageCount || body.previewPages || 0);
  const normalizedCourse = body.course ? String(body.course) : null;
  const normalizedDepartment = body.department ? String(body.department) : null;
  const lecturer = await User.findById(user.id).select("name email").lean();
  const isDraft = body.status === "draft" || body.productStatus === "draft";

  return await File.create({
    title: body.title,
    description: body.description || "",
    coverImageUrl,
    coverImageFilename: coverImage?.filename || "",
    coverImageOriginalName: coverImage?.originalname || "",
    fileUrl: `/api/files/view/${body.title ? 'placeholder' : 'placeholder'}`,
    storageFilename: file.filename,
    originalName: file.originalname,
    course: normalizedCourse,
    department: normalizedDepartment,
    semester: body.semester || "First Semester",
    lecturer: user.id,
    lecturerName: lecturer?.name || lecturer?.email || user.email || "",
    category: body.category || body.materialType || "Other",
    materialType: body.materialType || "Lecture Note",
    visibility: body.visibility || "public",
    level: normalizeAcademicLevel(body.level) || "ND1",
    previewPages: Number(body.previewPages || 0),
    pageCount,
    productStatus: isDraft ? "draft" : "published",
    language: body.language || "English",
    edition: body.edition || "",
    publisher: body.publisher || "",
    price: Number(body.price || 0),
    isFree: body.isFree === "true" || body.isFree === true || body.pricingMode === "free" || Number(body.price || 0) === 0,
    isPaid: body.isPaid === "true" || body.isPaid === true || (body.pricingMode !== "free" && Number(body.price || 0) > 0),
    premiumDiscount: Number(body.premiumDiscount || body.discount || 0),
    tags: normalizeTags(body.tags),
    faculty: body.faculty || "",
    courseCode: body.courseCode || "",
    allowDownload: body.allowDownload !== "false" && body.allowDownload !== false,
    allowPreview: body.allowPreview !== "false" && body.allowPreview !== false,
    approved: true,
    status: isDraft ? "draft" : "published",
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
    created.fileUrl = `/api/files/view/${created._id}`;
    created.downloadUrl = `/api/files/download/${created._id}`;
    await created.save();
    return created;
  });
};

const updateLecturerMaterial = async ({ user, materialId, body, file, coverImage }) => {
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
    coverImageFilename: body.coverImageUrl ? material.coverImageFilename : material.coverImageFilename,
    coverImageOriginalName: body.coverImageUrl ? material.coverImageOriginalName : material.coverImageOriginalName,
    category: body.category ?? material.category,
    materialType: body.materialType ?? material.materialType,
    semester: body.semester ?? material.semester,
    price: body.price !== undefined ? Number(body.price) : material.price,
    tags: body.tags !== undefined ? normalizeTags(body.tags) : material.tags,
    visibility: body.visibility ?? material.visibility,
    previewPages: body.previewPages !== undefined ? Number(body.previewPages) : material.previewPages,
    pageCount: body.pageCount !== undefined ? Number(body.pageCount) : material.pageCount,
    level: body.level ?? material.level,
    productStatus: body.productStatus ?? material.productStatus,
    language: body.language ?? material.language,
    edition: body.edition ?? material.edition,
    publisher: body.publisher ?? material.publisher,
    status: body.status ?? material.status,
    hidden: body.hidden !== undefined ? !!body.hidden : material.hidden,
    faculty: body.faculty !== undefined ? body.faculty : material.faculty,
    courseCode: body.courseCode !== undefined ? body.courseCode : material.courseCode,
    allowDownload: body.allowDownload !== undefined ? (body.allowDownload !== "false" && body.allowDownload !== false) : material.allowDownload,
    allowPreview: body.allowPreview !== undefined ? (body.allowPreview !== "false" && body.allowPreview !== false) : material.allowPreview,
    isFree: body.isFree !== undefined ? (body.isFree === "true" || body.isFree === true || body.pricingMode === "free" || Number(body.price || 0) === 0) : material.isFree,
    isPaid: body.isPaid !== undefined ? (body.isPaid === "true" || body.isPaid === true || (body.pricingMode !== "free" && Number(body.price || 0) > 0)) : material.isPaid,
    premiumDiscount: body.premiumDiscount !== undefined ? Number(body.premiumDiscount || body.discount || 0) : material.premiumDiscount
  };

  if (coverImage) {
    updates.coverImageUrl = `/uploads/${coverImage.filename}`;
    updates.coverImageFilename = coverImage.filename;
    updates.coverImageOriginalName = coverImage.originalname;
  }

  if (file) {
    updates.storageFilename = file.filename;
    updates.originalName = file.originalname;
    updates.fileUrl = `/api/files/view/${material._id}`;
    updates.downloadUrl = `/api/files/download/${material._id}`;
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

const getLecturerSales = async (lecturerId, query = {}) => {
  // Verify lecturer owns the materials
  const materials = await File.find({ lecturer: lecturerId, isDeleted: false }).select("_id");
  const materialIds = materials.map((m) => m._id);

  if (materialIds.length === 0) {
    return { sales: [], total: 0, count: 0 };
  }

  // Build filters
  const filters = {
    lecturer: lecturerId,
    material: { $in: materialIds },
    plan: "material",
    status: "success"
  };

  // Apply optional filters
  if (query.materialId && mongoose.Types.ObjectId.isValid(query.materialId)) {
    filters.material = query.materialId;
  }

  if (query.status) {
    filters.status = query.status;
  }

  if (query.studentMatric) {
    filters.studentMatricAtPurchase = { $regex: query.studentMatric, $options: "i" };
  }

  if (query.studentName) {
    filters.studentNameAtPurchase = { $regex: query.studentName, $options: "i" };
  }

  if (query.startDate || query.endDate) {
    filters.paidAt = {};
    if (query.startDate) {
      filters.paidAt.$gte = new Date(query.startDate);
    }
    if (query.endDate) {
      filters.paidAt.$lte = new Date(query.endDate);
    }
  }

  // Pagination
  const limit = Math.min(Number(query.limit) || 20, 100);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = (page - 1) * limit;

  // Get sales
  const sales = await Transaction.find(filters)
    .populate("material", "title price course")
    .sort({ paidAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Transaction.countDocuments(filters);

  return {
    sales: sales.map((sale) => ({
      _id: sale._id,
      studentName: sale.studentNameAtPurchase,
      studentMatric: sale.studentMatricAtPurchase,
      email: sale.email,
      material: sale.material?.title || "Unknown",
      materialPrice: sale.materialPrice,
      discount: sale.discount,
      amount: sale.amount,
      platformFee: sale.platformFee,
      lecturerAmount: sale.lecturerAmount,
      reference: sale.reference,
      paidAt: sale.paidAt,
      status: sale.status
    })),
    total,
    count: sales.length,
    page,
    limit
  };
};

const exportLecturerSalesAsCSV = async (lecturerId, query = {}) => {
  // Verify lecturer owns the materials
  const materials = await File.find({ lecturer: lecturerId, isDeleted: false }).select("_id");
  const materialIds = materials.map((m) => m._id);

  if (materialIds.length === 0) {
    return "No sales to export";
  }

  // Build filters (same as getSales)
  const filters = {
    lecturer: lecturerId,
    material: { $in: materialIds },
    plan: "material",
    status: "success"
  };

  if (query.materialId && mongoose.Types.ObjectId.isValid(query.materialId)) {
    filters.material = query.materialId;
  }

  if (query.status) {
    filters.status = query.status;
  }

  if (query.studentMatric) {
    filters.studentMatricAtPurchase = { $regex: query.studentMatric, $options: "i" };
  }

  if (query.studentName) {
    filters.studentNameAtPurchase = { $regex: query.studentName, $options: "i" };
  }

  if (query.startDate || query.endDate) {
    filters.paidAt = {};
    if (query.startDate) {
      filters.paidAt.$gte = new Date(query.startDate);
    }
    if (query.endDate) {
      filters.paidAt.$lte = new Date(query.endDate);
    }
  }

  // Get all sales (no pagination for export)
  const sales = await Transaction.find(filters)
    .populate("material", "title price course")
    .sort({ paidAt: -1 })
    .lean();

  // CSV Header
  const headers = ["Date", "Student Name", "Matric Number", "Email", "Material", "Material Price", "Discount", "Sale Amount", "Platform Fee", "Your Earnings", "Reference"];

  // CSV Rows
  const rows = sales.map((sale) => [
    new Date(sale.paidAt).toLocaleString(),
    `"${(sale.studentNameAtPurchase || "").replace(/"/g, '""')}"`,
    `"${(sale.studentMatricAtPurchase || "").replace(/"/g, '""')}"`,
    `"${(sale.email || "").replace(/"/g, '""')}"`,
    `"${(sale.material?.title || "Unknown").replace(/"/g, '""')}"`,
    sale.materialPrice,
    sale.discount,
    sale.amount,
    sale.platformFee,
    sale.lecturerAmount,
    sale.reference
  ]);

  // Combine headers and rows
  const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

  return csv;
};

/**
 * Update lecturer's payment account settings and create/update Paystack subaccount
 */
const updatePaymentSettings = async (lecturerId, body) => {
  const { bankCode, accountNumber, accountName, bankName } = body;

  // Validation
  if (!bankCode || !String(bankCode).trim()) {
    const error = new Error("Bank code is required");
    error.statusCode = 400;
    throw error;
  }

  if (!accountNumber || !String(accountNumber).trim()) {
    const error = new Error("Account number is required");
    error.statusCode = 400;
    throw error;
  }

  if (String(accountNumber).trim().length < 10) {
    const error = new Error("Account number must be at least 10 digits");
    error.statusCode = 400;
    throw error;
  }

  if (!accountName || !String(accountName).trim()) {
    const error = new Error("Account name is required");
    error.statusCode = 400;
    throw error;
  }

  if (!bankName || !NIGERIAN_BANKS.includes(bankName)) {
    const error = new Error("Valid bank name is required");
    error.statusCode = 400;
    throw error;
  }

  // Verify bank name has a Paystack code
  const paystackBankCode = getPaystackBankCode(bankName);
  if (!paystackBankCode) {
    const error = new Error(`Bank "${bankName}" is not supported by Paystack`);
    error.statusCode = 400;
    throw error;
  }

  const lecturer = await User.findById(lecturerId);
  if (!lecturer) {
    const error = new Error("Lecturer not found");
    error.statusCode = 404;
    throw error;
  }

  // Prepare sanitized account number (only store last 4 digits for security)
  const accountNumberStr = String(accountNumber).trim();
  const accountNumberLast4 = accountNumberStr.slice(-4);

  try {
    // Create or update Paystack subaccount
    // First, prepare the payload for Paystack
    const subaccountPayload = {
      business_name: lecturer.name || "Lecturer Account",
      settlement_bank: paystackBankCode,  // Use Paystack's bank code
      account_number: accountNumberStr,   // Full account number sent to Paystack only
      account_name: String(accountName).trim(),
      percentage_charge: 10  // Platform commission percentage
    };

    // Create subaccount with Paystack
    const paystackResponse = await paystackService.createSubaccount(lecturer, subaccountPayload);

    if (!paystackResponse || !paystackResponse.subaccount_code) {
      const error = new Error("Failed to create Paystack subaccount. Please check your account details.");
      error.statusCode = 400;
      throw error;
    }

    // Update lecturer record with verified account details
    lecturer.paystackPayment = {
      subaccountCode: paystackResponse.subaccount_code,
      businessName: lecturer.name || "",
      bankCode: paystackBankCode,  // Store Paystack bank code
      bankName: String(bankName).trim(),
      accountNumber: accountNumberLast4,  // Store only last 4 digits for security
      accountName: String(accountName).trim(),
      percentageCharge: 10,
      verified: true,  // Mark as verified after successful Paystack creation
      createdAt: new Date(),
      paystackSubaccountId: paystackResponse.id || null
    };

    await lecturer.save();

    // Log successful subaccount creation (safe info only)
    console.log(`[Paystack] Subaccount created for lecturer ${lecturer._id}. Subaccount code: ${paystackResponse.subaccount_code.substring(0, 10)}...`);

    return {
      success: true,
      businessName: lecturer.paystackPayment.businessName,
      bankCode: paystackBankCode,
      bankName: lecturer.paystackPayment.bankName,
      accountNumberLast4: accountNumberLast4,
      accountName: lecturer.paystackPayment.accountName,
      verified: lecturer.paystackPayment.verified,
      message: "Payment account verified successfully! You can now publish paid materials."
    };
  } catch (err) {
    // Log detailed error for debugging (without exposing credentials)
    console.error(`[Paystack] Subaccount creation failed for lecturer ${lecturerId}:`, {
      error: err.message,
      status: err.response?.status,
      paystackError: err.response?.data?.message
    });

    // Return specific Paystack error if available
    if (err.response?.data?.message) {
      const error = new Error(`Paystack error: ${err.response.data.message}`);
      error.statusCode = err.response.status || 400;
      throw error;
    }

    throw err;
  }
};

/**
 * Get lecturer's current payment account settings
 */
const getPaymentSettings = async (lecturerId) => {
  const lecturer = await User.findById(lecturerId).select('paystackPayment name email').lean();
  if (!lecturer) {
    const error = new Error("Lecturer not found");
    error.statusCode = 404;
    throw error;
  }

  const settings = lecturer.paystackPayment || {};
  return {
    businessName: settings.businessName || lecturer.name || "",
    bankCode: settings.bankCode || "",
    bankName: settings.bankName || "",
    accountNumberLast4: settings.accountNumber || "",  // Already storing last 4 digits
    accountName: settings.accountName || "",
    verified: settings.verified || false,
    subaccountCode: settings.verified ? (settings.subaccountCode || null) : null,
    createdAt: settings.createdAt || null
  };
};

/**
 * Get list of available Nigerian banks with Paystack codes
 */
const getAvailableBanks = async () => {
  return getAllBanksWithCodes();
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
  requestLecturerWithdrawal,
  getLecturerSales,
  exportLecturerSalesAsCSV,
  getPaymentSettings,
  updatePaymentSettings,
  getAvailableBanks
};
