const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");

/**
 * Determine whether a user is an admin.
 */
const isAdmin = (user) => user && user.role === "admin";

/**
 * Determine whether the user is the uploader/owner of a material.
 */
const isOwner = (user, material) => {
  return (
    user &&
    material &&
    material.lecturer &&
    user.id &&
    material.lecturer.toString() === user.id.toString()
  );
};

/**
 * Determine whether a user has an active premium subscription.
 */
const hasPremiumAccess = (user) => {
  if (!user) return false;
  const isPremium =
    (user.plan === "premium" || user.subscriptionType === "premium");
  const expiresAt = user.subscriptionExpiresAt;
  return isPremium && expiresAt && new Date(expiresAt) > new Date();
};

/**
 * Check whether the user has already purchased the material.
 */
const userHasPurchasedMaterial = async (user, material) => {
  if (!user || !user.id || !material || !material._id) return false;

  const existing = await Transaction.findOne({
    user: user.id,
    material: material._id,
    plan: "material",
    status: "success"
  });

  return Boolean(existing);
};

/**
 * Optional course membership restriction for course materials.
 * Marketplace materials are not restricted by course membership.
 */
const verifyCourseMembership = ({ user, material }) => {
  if (!material.course || !material.course.department || !material.course.level) {
    return { allowed: true };
  }

  if (!user || !user.department || !user.yearOfStudy) {
    return { allowed: false, reason: "complete_profile" };
  }

  if (user.department._id.toString() !== material.course.department._id.toString()) {
    return { allowed: false, reason: "department_mismatch" };
  }

  if (user.yearOfStudy !== material.course.level) {
    return { allowed: false, reason: "year_mismatch" };
  }

  return { allowed: true };
};

/**
 * Determine whether a user may view a material.
 */
const canViewMaterial = async ({ user, material, restrictByCourse = false }) => {
  if (!material) {
    return { allowed: false, reason: "material_not_found" };
  }

  if (material.isDeleted) {
    return { allowed: false, reason: "deleted" };
  }

  if (isAdmin(user) || isOwner(user, material)) {
    return { allowed: true, reason: "admin_or_owner" };
  }

  if (material.hidden) {
    return { allowed: false, reason: "hidden" };
  }

  if (material.visibility === "private") {
    return { allowed: false, reason: "private" };
  }

  if (material.approved === false) {
    return { allowed: false, reason: "not_approved" };
  }

  if (restrictByCourse) {
    const membership = verifyCourseMembership({ user, material });
    if (!membership.allowed) {
      return { allowed: false, reason: membership.reason };
    }
  }

  if (material.isFree || (!material.isPaid && !material.isPremium)) {
    return { allowed: true, reason: "free" };
  }

  if (material.isPremium) {
    return hasPremiumAccess(user)
      ? { allowed: true, reason: "premium" }
      : { allowed: false, reason: "premium_required" };
  }

  if (material.isPaid) {
    const purchased = await userHasPurchasedMaterial(user, material);
    return purchased
      ? { allowed: true, reason: "purchased" }
      : { allowed: false, reason: "purchase_required" };
  }

  return { allowed: true, reason: "default_allowed" };
};

/**
 * Determine whether a user may download a material.
 */
const canDownloadMaterial = async ({ user, material, restrictByCourse = false }) => {
  // Download rules mirror view rules.
  return await canViewMaterial({ user, material, restrictByCourse });
};

/**
 * Determine whether a user can purchase a material.
 */
const canPurchaseMaterial = async ({ user, material }) => {
  if (!material) {
    return { allowed: false, reason: "material_not_found" };
  }

  if (isAdmin(user) || isOwner(user, material)) {
    return { allowed: false, reason: "owner_or_admin" };
  }

  if (!material.isPaid) {
    return { allowed: false, reason: "not_for_sale" };
  }

  if (!material.approved) {
    return { allowed: false, reason: "not_approved" };
  }

  const purchased = await userHasPurchasedMaterial(user, material);
  if (purchased) {
    return { allowed: false, reason: "already_purchased" };
  }

  return { allowed: true, reason: "purchase_allowed" };
};

/**
 * Determine whether a user can edit a material.
 */
const canEditMaterial = ({ user, material }) => {
  if (!material) {
    return { allowed: false, reason: "material_not_found" };
  }

  if (isAdmin(user) || isOwner(user, material)) {
    return { allowed: true, reason: "edit_allowed" };
  }

  return { allowed: false, reason: "unauthorized" };
};

/**
 * Determine whether a user can delete a material.
 */
const canDeleteMaterial = ({ user, material }) => {
  return canEditMaterial({ user, material });
};

/**
 * Record a view count for the material.
 */
const recordView = async ({ material }) => {
  if (!material) {
    throw new Error("Material is required to record view");
  }

  material.views = (material.views || 0) + 1;
  await material.save();
  return material;
};

/**
 * Record a download count for the material.
 */
const recordDownload = async ({ material }) => {
  if (!material) {
    throw new Error("Material is required to record download");
  }

  material.downloads = (material.downloads || 0) + 1;
  await material.save();
  return material;
};

/**
 * Record a successful material purchase and grant ownership through transaction history.
 */
const recordPurchase = async ({ user, material, reference, amount, discount = 0 }) => {
  if (!material) {
    throw new Error("Material is required to record purchase");
  }
  if (!user || !user.id) {
    throw new Error("User is required to record purchase");
  }
  if (!reference) {
    throw new Error("Payment reference is required to record purchase");
  }

  const existing = await Transaction.findOne({ reference });
  if (existing) {
    if (
      existing.user.toString() !== user.id.toString() ||
      existing.material?.toString() !== material._id.toString()
    ) {
      const error = new Error("Payment reference already in use");
      error.statusCode = 409;
      throw error;
    }
    return existing;
  }

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
    discount
  });

  material.purchases = (material.purchases || 0) + 1;
  material.sales = (material.sales || 0) + 1;
  await material.save();

  return transaction;
};

module.exports = {
  canViewMaterial,
  canDownloadMaterial,
  canPurchaseMaterial,
  canEditMaterial,
  canDeleteMaterial,
  recordView,
  recordDownload,
  recordPurchase
};
