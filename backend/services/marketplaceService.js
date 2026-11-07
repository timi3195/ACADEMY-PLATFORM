const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const File = require("../models/File");
const Course = require("../models/course");
const Department = require("../models/Department");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const paystackService = require("./paystackService");
const materialAccessService = require("./materialAccessService");
const storageService = require("./storageService");
const paymentIntegrity = require("./paymentIntegrityService");
const crypto = require("crypto");

const normalizeTags = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
  return String(tags)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getBaseApiUrl = (req = null) => {
  if (req && req.protocol && req.get) {
    const forwardedProto = req.get("x-forwarded-proto") || req.protocol;
    const forwardedHost = req.get("x-forwarded-host") || req.get("host");
    if (forwardedHost) {
      return `${forwardedProto}://${forwardedHost}`;
    }
  }

  return (process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
};

const toAbsoluteUrl = (value, req = null) => {
  if (!value) {
    return value;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${getBaseApiUrl(req)}${value}`;
  }

  return value;
};

const normalizeMaterialFileUrl = (material, req = null) => {
  if (!material || !material._id) return material;

  const fileId = String(material._id);
  const viewUrl = `/api/files/view/${fileId}`;
  const downloadUrl = `/api/files/download/${fileId}`;

  const resolvedFileUrl = viewUrl;
  const resolvedDownloadUrl = downloadUrl;

  return {
    ...material,
    coverImageUrl: toAbsoluteUrl(material.coverImageUrl, req),
    fileUrl: toAbsoluteUrl(resolvedFileUrl, req),
    downloadUrl: toAbsoluteUrl(resolvedDownloadUrl, req),
    accessUrl: toAbsoluteUrl(material.accessUrl || `/api/marketplace/materials/${fileId}`, req)
  };
};

const buildMaterialFilters = (query) => {
  const clauses = [
    {
      hidden: false,
      productStatus: "published",
      isDeleted: false,
      visibility: "public"
    }
  ];

  const searchTerm = String(query.q || "").trim();
  if (searchTerm) {
    const regex = new RegExp(escapeRegExp(searchTerm), "i");
    const tags = searchTerm.split(/\s+/).map((item) => item.toLowerCase()).filter(Boolean);

    clauses.push({
      $or: [
        { title: regex },
        { description: regex },
        { course: regex },
        { department: regex },
        { faculty: regex },
        { materialType: regex },
        { publisher: regex },
        { edition: regex },
        { language: regex },
        { lecturerName: regex },
        { tags: { $in: tags } }
      ]
    });
  }

  if (query.department) {
    clauses.push({ department: query.department });
  }

  if (query.course) {
    clauses.push({ course: query.course });
  }

  if (query.semester) {
    clauses.push({ semester: query.semester });
  }

  if (query.level) {
    clauses.push({ level: query.level });
  }

  if (query.materialType) {
    clauses.push({ materialType: query.materialType });
  }

  if (query.faculty) {
    clauses.push({ faculty: query.faculty });
  }

  if (query.price === "free") {
    clauses.push({ $or: [{ price: 0 }, { isFree: true }] });
  }

  if (query.price === "paid") {
    clauses.push({ price: { $gt: 0 } });
  }

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

const createMaterial = async ({ user, body, file }) => {
  const price = Number(body.price || 0);
  const isFree = body.isFree === "true" || body.isFree === true;
  const isPaid = body.isPaid === "true" || body.isPaid === true;
  const lecturerName = String(user?.name || user?.email || "").trim();

  const materialId = new mongoose.Types.ObjectId();
  const storageData = await storageService.uploadUploadedFile({ file, materialId });
  const created = await File.create({
    _id: materialId,
    title: body.title,
    description: body.description || "",
    coverImageUrl: body.coverImageUrl || "",
    fileUrl: "",
    ...storageData,
    originalFilename: file.originalname,
    originalName: file.originalname,
    course: body.course,
    department: body.department || null,
    semester: body.semester || "First",
    lecturer: user.id,
    lecturerName,
    category: body.category || "Other",
    materialType: body.materialType || "Other",
    visibility: body.visibility || "public",
    level: body.level || "Other",
    previewPages: Number(body.previewPages || 0),
    pageCount: Number(body.pageCount || body.previewPages || 0),
    productStatus: body.productStatus || "published",
    language: body.language || "en",
    edition: body.edition || "",
    publisher: body.publisher || "",
    faculty: body.faculty || "",
    price,
    isFree,
    isPaid,
    premiumDiscount: Number(body.premiumDiscount || 0),
    approved: true,
    status: "published",
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

  created.fileUrl = `/api/files/view/${created._id}`;
  created.downloadUrl = `/api/files/download/${created._id}`;
  await created.save();
  return created;
};

const listMaterials = async (query) => {
  const filters = buildMaterialFilters(query);
  const limit = Math.min(Number(query.limit) || 20, 50);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = (page - 1) * limit;
  const sortBy = String(query.sortBy || "newest").toLowerCase();

  const sortOptions = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    rating: { ratingAverage: -1 },
    "low-price": { price: 1 },
    "high-price": { price: -1 },
    views: { views: -1 },
    sales: { sales: -1 },
    alpha: { title: 1 }
  };

  const sort = sortOptions[sortBy] || sortOptions.newest;

  const total = await File.countDocuments(filters);
  const materials = await File.find(filters)
    .populate({ path: "lecturer", select: "name email" })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    materials: materials.map((material) => {
      const normalized = normalizeMaterialFileUrl(material);
      return {
        ...normalized,
        accessUrl: `/api/marketplace/materials/${material._id}`
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
};

const getMaterialById = async (id, user = null) => {
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    return null;
  }

  const material = await File.findById(id)
    .populate({ path: "lecturer", select: "name email" })
    .select("-storageFilename -deletedAt")
    .lean();

  if (!material || material.isDeleted) {
    return null;
  }

  const normalizedMaterial = normalizeMaterialFileUrl(material);

  if (!normalizedMaterial || normalizedMaterial.isDeleted) {
    return null;
  }

  const userId = user?.id || user?._id;
  const isOwner = Boolean(material.lecturer && userId && material.lecturer._id?.toString() === userId.toString());
  const isAdmin = Boolean(user && user.role === "admin");

  // Base allowed for owner/admin
  if (isOwner || isAdmin) {
    // Attach full access metadata for owners/admins if a user context is present
    if (userId) {
      const downloadAccess = await materialAccessService.canDownloadMaterial({ user: { id: userId }, material, restrictByCourse: false });
      return {
        ...normalizedMaterial,
        access: { hasAccess: true, canView: true, canRead: true, canDownload: downloadAccess.allowed, reason: 'admin_or_owner', isPurchased: false },
        allowDownload: Boolean(downloadAccess.allowed),
        canDownload: Boolean(downloadAccess.allowed)
      };
    }

    return normalizedMaterial;
  }

  if (normalizedMaterial.hidden) {
    return null;
  }

  // Publicly visible materials are returned; for authenticated users, include access metadata
  if ((normalizedMaterial.productStatus === "published" || normalizedMaterial.status === "approved") && ["public", "unlisted"].includes(normalizedMaterial.visibility)) {
    if (!userId) {
      return normalizedMaterial;
    }

    // Determine access using the existing access-control service (do not duplicate transaction queries)
    const viewAccess = await materialAccessService.canViewMaterial({ user: { id: userId }, material, restrictByCourse: false });
    const downloadAccess = await materialAccessService.canDownloadMaterial({ user: { id: userId }, material, restrictByCourse: false });

    return {
      ...normalizedMaterial,
      access: {
        hasAccess: Boolean(viewAccess.allowed),
        canView: Boolean(viewAccess.allowed),
        canRead: Boolean(viewAccess.allowed),
        canDownload: Boolean(downloadAccess.allowed),
        isPurchased: viewAccess.reason === 'purchased' || downloadAccess.allowed,
        reason: viewAccess.reason || null
      },
      allowDownload: Boolean(downloadAccess.allowed),
      canDownload: Boolean(downloadAccess.allowed)
    };
  }

  return null;
};

const getLecturerMaterials = async (lecturerId) => {
  return await File.find({ lecturer: lecturerId })
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
    faculty: body.faculty ?? material.faculty,
    price: body.price !== undefined ? Number(body.price) : material.price,
    lecturerName: material.lecturerName || '',
    isFree: body.isFree !== undefined ? (body.isFree === "true" || body.isFree === true) : material.isFree,
    isPaid: body.isPaid !== undefined ? (body.isPaid === "true" || body.isPaid === true) : material.isPaid,
    premiumDiscount: body.premiumDiscount !== undefined ? Number(body.premiumDiscount) : material.premiumDiscount,
    approved: body.approved !== undefined ? !!body.approved : material.approved,
    tags: body.tags !== undefined ? normalizeTags(body.tags) : material.tags
  };

  const oldStorage = file ? { storageProvider: material.storageProvider, storageKey: material.storageKey, storageFilename: material.storageFilename } : null;
  if (file) {
    const storageData = await storageService.uploadUploadedFile({ file, materialId: material._id });
    Object.assign(updates, storageData);
    updates.originalFilename = file.originalname;
    updates.originalName = file.originalname;
    updates.fileUrl = `/api/files/view/${material._id}`;
    updates.downloadUrl = `/api/files/download/${material._id}`;
  }

  Object.assign(material, updates);
  await material.save();
  if (oldStorage) await storageService.deleteObject(oldStorage).catch(() => {});
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

  await storageService.deleteObject(material);

  await material.remove();
  return true;
};

const getFeaturedMaterials = async (query) => {
  const limit = Math.min(Number(query.limit) || 12, 50);
  const materials = await File.find({ productStatus: "published", visibility: "public", hidden: false, isDeleted: false })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ purchases: -1, ratingAverage: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return materials.map((material) => normalizeMaterialFileUrl(material));
};

const getNewMaterials = async (query) => {
  const limit = Math.min(Number(query.limit) || 12, 50);
  const materials = await File.find({ productStatus: "published", visibility: "public", hidden: false, isDeleted: false })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return materials.map((material) => normalizeMaterialFileUrl(material));
};

const getCourseMaterials = async (courseId, query) => {
  const limit = Math.min(Number(query.limit) || 20, 50);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const course = mongoose.Types.ObjectId.isValid(String(courseId))
    ? await Course.findById(courseId).select("title code").lean()
    : null;
  const courseValues = [courseId, course?.title, course?.code].filter(Boolean);
  const materials = await File.find({ course: { $in: courseValues }, productStatus: "published", visibility: "public", hidden: false, isDeleted: false })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return materials.map((material) => normalizeMaterialFileUrl(material));
};

const getDepartmentMaterials = async (departmentId, query) => {
  const limit = Math.min(Number(query.limit) || 20, 50);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const department = mongoose.Types.ObjectId.isValid(String(departmentId))
    ? await Department.findById(departmentId).select("name code").lean()
    : null;
  const departmentValues = [departmentId, department?.name, department?.code].filter(Boolean);
  const materials = await File.find({ department: { $in: departmentValues }, productStatus: "published", visibility: "public", hidden: false, isDeleted: false })
    .populate({ path: "lecturer", select: "name email" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return materials.map((material) => normalizeMaterialFileUrl(material));
};

const getLibrary = async (userId, query = {}, req = null) => {
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

  return transactions.map((transaction) => {
    const material = normalizeMaterialFileUrl(transaction.material, req);
    return {
      transactionId: transaction._id,
      reference: transaction.reference,
      status: transaction.status,
      purchasedAt: transaction.paidAt,
      amount: transaction.amount,
      discount: transaction.discount || 0,
      material: {
        ...material,
        allowDownload: true,
        canDownload: true
      }
    };
  });
};

const getLibraryItem = async (userId, materialId, req = null) => {
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
      { path: "lecturer", select: "name email" }
    ]
  });

  if (!transaction) {
    return null;
  }

  const material = normalizeMaterialFileUrl(transaction.material, req);

  return {
    transactionId: transaction._id,
    reference: transaction.reference,
    status: transaction.status,
    purchasedAt: transaction.paidAt,
    amount: transaction.amount,
    discount: transaction.discount || 0,
    material: {
      ...material,
      allowDownload: true,
      canDownload: true
    }
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

// Approval workflow removed: materials are published immediately on creation.

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
  const purchaseUser = user?.id ? await User.findById(user.id).lean() : null;
  if (!purchaseUser) {
    const error = new Error("Authenticated user not found");
    error.statusCode = 401;
    throw error;
  }

  const material = await File.findById(materialId).populate('lecturer', 'name email paystackPayment');
  if (!material) {
    const error = new Error("Material not found");
    error.statusCode = 404;
    throw error;
  }

  // Approval gating removed; newly created materials can be purchased if for sale.
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

  const purchasePermission = await materialAccessService.canPurchaseMaterial({ user: purchaseUser, material });
  if (!purchasePermission.allowed) {
    const error = new Error(purchasePermission.reason || "Purchase not allowed");
    error.statusCode = 403;
    throw error;
  }

  // Validate student profile is complete before allowing purchase
  if (!purchaseUser.matricNumber || !String(purchaseUser.matricNumber).trim()) {
    const error = new Error("Please complete your student profile before purchasing this material. Matric number is required.");
    error.statusCode = 400;
    error.requiresProfileCompletion = true;
    throw error;
  }

  if (!purchaseUser.yearOfStudy) {
    const error = new Error("Please complete your student profile before purchasing this material. Academic level is required.");
    error.statusCode = 400;
    error.requiresProfileCompletion = true;
    throw error;
  }

  if (!purchaseUser.department) {
    const error = new Error("Please complete your student profile before purchasing this material. Department is required.");
    error.statusCode = 400;
    error.requiresProfileCompletion = true;
    throw error;
  }

  // For paid materials, verify lecturer has payment account configured
  if (material.isPaid && material.price > 0) {
    const lecturer = material.lecturer;
    if (!lecturer || !lecturer.paystackPayment?.verified || !lecturer.paystackPayment?.subaccountCode) {
      const error = new Error("Lecturer payment account is not configured or verified");
      error.statusCode = 400;
      throw error;
    }
  }

  const finalPrice = getDiscountedPrice(material, purchaseUser);
  const expectedAmount = Math.round(finalPrice * 100) / 100;
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    const error = new Error("This material has an invalid purchase price");
    error.statusCode = 400;
    throw error;
  }
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const currency = (process.env.PAYSTACK_CURRENCY || "NGN").toUpperCase();
  const reference = `academy_mat_${crypto.randomUUID()}`;

  // Get lecturer's subaccount for payment split
  const lecturerSubaccount = material.lecturer?.paystackPayment?.subaccountCode || null;

  const platformFee = Math.round(expectedAmount * 10) / 100;
  const pendingTransaction = await Transaction.create({
    user: purchaseUser._id,
    email: purchaseUser.email,
    amount: expectedAmount,
    currency,
    reference,
    status: "pending",
    plan: "material",
    paymentType: "material",
    material: material._id,
    materialPrice: material.price,
    discount: Number(material.premiumDiscount || 0),
    lecturer: material.lecturer?._id || null,
    platformFee,
    lecturerAmount: finalPrice - platformFee,
    paymentProvider: "paystack",
    studentNameAtPurchase: purchaseUser.name || "",
    studentEmailAtPurchase: purchaseUser.email || "",
    studentMatricAtPurchase: purchaseUser.matricNumber || ""
  });

  try {
    const transport = await paystackService.initializePayment({
      email: purchaseUser.email,
      amount: expectedAmount,
      currency,
      reference,
      callbackUrl: `${frontendUrl}/marketplace/${material._id}`,
      metadata: {
        materialId: material._id.toString(),
        paymentType: "material",
        userId: String(purchaseUser._id)
      },
      subaccountCode: lecturerSubaccount
    });

    if (!transport?.authorization_url || transport.reference !== reference) {
      const error = new Error("Paystack returned an invalid initialization response");
      error.statusCode = 502;
      throw error;
    }

    return {
      authorizationUrl: transport.authorization_url,
      reference,
      amount: expectedAmount,
      currency
    };
  } catch (error) {
    await Transaction.findOneAndUpdate(
      { _id: pendingTransaction._id, status: "pending" },
      { $set: { status: "failed", failureReason: "Payment initialization failed" } }
    );
    throw error;
  }
};

const verifyPurchase = async (materialId, reference, user) => {
  let transaction;
  let paymentVerified = false;
  try {
    const claim = await paymentIntegrity.claimPendingTransaction(reference, user.id);
    transaction = claim.transaction;
    if (transaction.paymentType !== "material" ||
        String(transaction.material) !== String(materialId)) {
      const error = new Error("Payment reference does not match this material");
      error.statusCode = 403;
      throw error;
    }
    if (claim.alreadyProcessed) {
      await reconcilePurchaseMetrics(transaction);
      return transaction;
    }

    let verification;
    try {
      verification = await paystackService.verifyPayment(reference);
    } catch (error) {
      error.retryablePaymentError = true;
      throw error;
    }
    paymentIntegrity.validatePaystackPayment(transaction, verification, reference);
    paymentVerified = true;
    return await completeWebhookPurchase(transaction, verification);
  } catch (error) {
    if (transaction?.status === "processing") {
      if (error.retryablePaymentError || paymentVerified) {
        await paymentIntegrity.releaseTransactionForRetry(transaction, error.message);
      } else {
        await paymentIntegrity.markTransactionFailed(transaction, error.message);
      }
    }
    throw error;
  }
};

const reconcilePurchaseMetrics = async (transaction) => {
  if (!transaction || transaction.status !== "success" ||
      transaction.paymentType !== "material" || !transaction.material) {
    const error = new Error("Successful material transaction is invalid");
    error.statusCode = 400;
    throw error;
  }

  const [material, purchaseCount] = await Promise.all([
    File.findById(transaction.material),
    Transaction.countDocuments({
      material: transaction.material,
      paymentType: "material",
      status: "success"
    })
  ]);
  if (!material) {
    const error = new Error("Purchased material was not found");
    error.statusCode = 404;
    throw error;
  }

  await File.findByIdAndUpdate(material._id, {
    $set: { purchases: purchaseCount, sales: purchaseCount }
  });
};

const completeWebhookPurchase = async (transaction, paymentData) => {
  paymentIntegrity.validatePaystackPayment(transaction, paymentData, transaction.reference);
  if (transaction.status !== "processing" ||
      transaction.paymentType !== "material" ||
      !transaction.material) {
    const error = new Error("Pending material transaction is invalid");
    error.statusCode = 400;
    throw error;
  }

  const material = await File.findById(transaction.material);
  const purchaseUser = await User.findById(transaction.user).lean();
  if (!material || !purchaseUser ||
      String(purchaseUser.email).trim().toLowerCase() !== String(transaction.email).trim().toLowerCase()) {
    const error = new Error("Pending material transaction data is inconsistent");
    error.statusCode = 400;
    throw error;
  }

  const completed = await paymentIntegrity.markTransactionSuccessful(transaction, paymentData);
  await reconcilePurchaseMetrics(completed);
  return completed;
};

module.exports = {
  normalizeMaterialFileUrl,
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
  completeWebhookPurchase,
  reconcilePurchaseMetrics
};
