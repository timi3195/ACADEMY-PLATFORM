const path = require("path");
const File = require("../models/File");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const paystackService = require("./paystackService");

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
    price,
    isFree,
    isPaid,
    premiumDiscount: Number(body.premiumDiscount || 0),
    approved: false,
    uploads: 0,
    downloads: 0,
    purchases: 0,
    ratingAverage: 0,
    ratingCount: 0,
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
  return await File.findById(id)
    .populate({ path: "course", select: "title code" })
    .populate({ path: "department", select: "name code" })
    .populate({ path: "lecturer", select: "name email" })
    .lean();
};

const getLecturerMaterials = async (lecturerId) => {
  return await File.find({ lecturer: lecturerId })
    .populate("course department", "title code name")
    .sort({ createdAt: -1 });
};

const getLibrary = async (userId) => {
  const transactions = await Transaction.find({
    user: userId,
    plan: "material",
    status: "success",
    material: { $ne: null }
  }).populate({
    path: "material",
    populate: [
      { path: "course", select: "title code" },
      { path: "department", select: "name code" },
      { path: "lecturer", select: "name email" }
    ]
  });

  return transactions.map((transaction) => ({
    transactionId: transaction._id,
    purchasedAt: transaction.paidAt,
    amount: transaction.amount,
    discount: transaction.discount || 0,
    material: transaction.material
  }));
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

const userHasPurchasedMaterial = async (userId, materialId) => {
  if (!userId || !materialId) return false;

  const existing = await Transaction.findOne({
    user: userId,
    material: materialId,
    plan: "material",
    status: "success"
  });

  return Boolean(existing);
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

  const alreadyPurchased = await userHasPurchasedMaterial(user.id, materialId);
  if (alreadyPurchased) {
    const error = new Error("You already own this material");
    error.statusCode = 409;
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

  const alreadyVerifiedTransaction = await Transaction.findOne({ reference });
  if (alreadyVerifiedTransaction) {
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
  await material.save();

  return transaction;
};

module.exports = {
  createMaterial,
  listMaterials,
  getMaterialById,
  getLecturerMaterials,
  getLibrary,
  initializePurchase,
  verifyPurchase,
  listPendingMaterials,
  setMaterialApproval
};
