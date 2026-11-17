const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const { normalizeAcademicLevel } = require('../utils/academicLevels');
const { canAccessCourse } = require("./courseMembershipService");

const idOf = (value) => String(value?._id || value || "");
const ACADEMIC_LEVELS = new Set(["ND1", "ND2", "HND1", "HND2"]);
const MARKETPLACE_PUBLICATION = Object.freeze({
  productStatus: "published",
  approved: true,
  statuses: Object.freeze(["published", "approved"]),
  visibilities: Object.freeze(["public", "unlisted"])
});

const getMarketplacePublicationFilter = ({ publicOnly = false } = {}) => ({
  productStatus: MARKETPLACE_PUBLICATION.productStatus,
  approved: MARKETPLACE_PUBLICATION.approved,
  status: { $in: [...MARKETPLACE_PUBLICATION.statuses] },
  visibility: publicOnly
    ? "public"
    : { $in: [...MARKETPLACE_PUBLICATION.visibilities] },
  hidden: false,
  isDeleted: false,
  deletedAt: null
});

const normalizeSemester = (semester) => {
  if (typeof semester !== "string") return "";
  const normalized = semester.trim().toLowerCase().replace(/\s+semester$/, "");
  if (normalized === "first") return "First";
  if (normalized === "second") return "Second";
  return "";
};

const isRecognizedSemester = (semester) => Boolean(normalizeSemester(semester));

const hasCourseAssociatedMetadata = (material) =>
  Boolean(material.course && material.department) &&
  ACADEMIC_LEVELS.has(normalizeAcademicLevel(material.level));

const isCourseMaterial = (material) =>
  Boolean(material.courseCode) ||
  hasCourseAssociatedMetadata(material);

const isLegacyCourseMaterial = (material) =>
  (
    material.materialType === "Lecture Note" &&
    material.category === "Lecture Notes"
  );

const isCourseAssociatedMaterial = (material) =>
  isCourseMaterial(material) || isLegacyCourseMaterial(material);

const isMarketplaceMaterial = (material) =>
  Boolean(material) &&
  material.productStatus === MARKETPLACE_PUBLICATION.productStatus &&
  material.approved === MARKETPLACE_PUBLICATION.approved &&
  MARKETPLACE_PUBLICATION.statuses.includes(material.status) &&
  MARKETPLACE_PUBLICATION.visibilities.includes(material.visibility) &&
  material.hidden === false &&
  material.isDeleted === false &&
  material.deletedAt == null;

const classifyMaterial = (material) => {
  if (isCourseMaterial(material)) return "course";
  if (isLegacyCourseMaterial(material)) return "course";
  if (isMarketplaceMaterial(material)) return "marketplace";
  return "unknown";
};

const resolveCourseDepartmentId = async (departmentValue, expectedId) => {
  if (mongoose.Types.ObjectId.isValid(idOf(departmentValue))) {
    const departmentId = idOf(departmentValue);
    return !expectedId || departmentId === expectedId ? departmentId : null;
  }
  if (typeof departmentValue !== "string" || !departmentValue.trim()) return null;

  const Department = require("../models/Department");
  const departments = await Department.find({ name: departmentValue.trim() });
  return departments.length === 1 && (!expectedId || idOf(departments[0]._id) === expectedId)
    ? idOf(departments[0]._id)
    : null;
};

const resolveCourseForMaterial = async (material) => {
  if (!isCourseMaterial(material) || !material.course) {
    return null;
  }

  const Course = require("../models/course");
  if (typeof material.courseCode === "string" && material.courseCode.trim()) {
    const courses = await Course.find({ code: material.courseCode.trim() });
    if (courses.length !== 1) return null;
    const [course] = courses;
    if (!course.title || course.title !== material.course || !course.department || !course.level) {
      return null;
    }
    const departmentId = await resolveCourseDepartmentId(
      material.department,
      idOf(course.department)
    );
    if (
      !departmentId ||
      normalizeAcademicLevel(course.level) !== normalizeAcademicLevel(material.level) ||
      (material.semester &&
        (!isRecognizedSemester(material.semester) ||
          normalizeSemester(course.semester) !== normalizeSemester(material.semester)))
    ) {
      return null;
    }
    return course;
  }

  if (!material.department || !material.level || !isRecognizedSemester(material.semester)) return null;
  const departmentId = await resolveCourseDepartmentId(material.department);
  if (!departmentId) return null;
  const query = {
    title: material.course,
    department: departmentId,
    level: material.level,
    semester: normalizeSemester(material.semester)
  };
  const candidates = await Course.find(query);
  if (candidates.length !== 1) return null;
  const [course] = candidates;

  if (
    !course ||
    course.title !== material.course ||
    idOf(course.department) !== departmentId ||
    normalizeAcademicLevel(course.level) !== normalizeAcademicLevel(material.level) ||
    normalizeSemester(course.semester) !== normalizeSemester(material.semester)
  ) {
    return null;
  }

  return course;
};

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
const verifyCourseMembership = async ({ user, material }) => {
  const classification = classifyMaterial(material);
  if (classification === "marketplace") {
    return { allowed: true };
  }
  if (classification === "unknown") {
    return { allowed: false, reason: "course_unresolved" };
  }

  const course = await resolveCourseForMaterial(material);
  if (!course) {
    return { allowed: false, reason: "course_unresolved" };
  }

  return canAccessCourse(user, course)
    ? { allowed: true }
    : { allowed: false, reason: "course_membership_required" };
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

  if (restrictByCourse) {
    if (!isMarketplaceMaterial(material)) {
      return { allowed: false, reason: "unpublished" };
    }

    const membership = await verifyCourseMembership({ user, material });
    if (!membership.allowed) {
      return { allowed: false, reason: membership.reason };
    }
  }

  return { allowed: true, reason: "available_without_purchase" };
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

/**
 * Record a successful material purchase with payment split information.
 */
const recordPurchaseWithSplit = async ({ user, material, reference, amount, discount = 0, lecturer, platformFee, lecturerAmount, paystackTransactionId }) => {
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
    discount,
    lecturer: lecturer?._id || null,
    platformFee: platformFee || 0,
    lecturerAmount: lecturerAmount || 0,
    currency: "NGN",
    paymentProvider: "paystack",
    studentNameAtPurchase: user.name || "",
    studentEmailAtPurchase: user.email || "",
    studentMatricAtPurchase: user.matricNumber || "",
    paystackTransactionId: paystackTransactionId || null
  });

  material.purchases = (material.purchases || 0) + 1;
  material.sales = (material.sales || 0) + 1;
  await material.save();

  return transaction;
};

module.exports = {
  getMarketplacePublicationFilter,
  isMarketplaceMaterial,
  isCourseAssociatedMaterial,
  canViewMaterial,
  canDownloadMaterial,
  canPurchaseMaterial,
  canEditMaterial,
  canDeleteMaterial,
  recordView,
  recordDownload,
  recordPurchase,
  recordPurchaseWithSplit
};
