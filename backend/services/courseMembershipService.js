const mongoose = require("mongoose");

const idOf = (value) => String(value?._id || value || "");

const departmentIdOf = (value) => {
  const department = value && typeof value === "object" &&
    !(value instanceof mongoose.Types.ObjectId)
    ? value._id
    : value;

  if (typeof department !== "string" &&
      !(department instanceof mongoose.Types.ObjectId)) {
    return null;
  }

  const departmentId = String(department);
  return /^[a-f\d]{24}$/i.test(departmentId) ? departmentId.toLowerCase() : null;
};

const isStudentInCourseDepartment = (user, course) => {
  if (user?.role !== "student" || !course) return false;

  const studentDepartmentId = departmentIdOf(user.department);
  const courseDepartmentId = departmentIdOf(course.department);
  return Boolean(
    studentDepartmentId &&
    courseDepartmentId &&
    studentDepartmentId === courseDepartmentId
  );
};

const isApprovedLecturerAssignedToCourse = (user, course) =>
  user?.role === "lecturer" &&
  user.lecturerStatus === "approved" &&
  Array.isArray(course?.lecturers) &&
  course.lecturers.some((lecturerId) => idOf(lecturerId) === idOf(user._id || user.id));

const canAccessCourse = (user, course) => {
  if (!user || !course) return false;
  if (user.role === "admin") return true;
  if (user.role === "student") return isStudentInCourseDepartment(user, course);
  return isApprovedLecturerAssignedToCourse(user, course);
};

const getAccessibleCourseFilter = (user) => {
  if (user?.role === "admin") return {};
  const userId = user?._id || user?.id;
  if (user?.role === "lecturer" && user.lecturerStatus === "approved" && userId) {
    return { lecturers: userId };
  }
  if (user?.role === "student") {
    const departmentId = departmentIdOf(user.department);
    return departmentId
      ? { department: new mongoose.Types.ObjectId(departmentId) }
      : { _id: { $in: [] } };
  }
  return { _id: { $in: [] } };
};

const getValidAccessibleCourseIds = async (user) => {
  if (!user || user.role === "admin") return null;

  const Course = require("../models/course");
  const Department = require("../models/Department");
  const courses = await Course.find(getAccessibleCourseFilter(user))
    .select("_id department")
    .lean();
  if (!courses.length) return [];

  const departmentIds = [...new Set(courses
    .map((course) => departmentIdOf(course.department))
    .filter(Boolean))];
  if (!departmentIds.length) return [];

  const departments = await Department.find({
    _id: { $in: departmentIds.map((id) => new mongoose.Types.ObjectId(id)) }
  }).select("_id").lean();
  const existingDepartmentIds = new Set(departments
    .map((department) => departmentIdOf(department._id))
    .filter(Boolean));

  return courses
    .filter((course) => {
      const departmentId = departmentIdOf(course.department);
      if (!departmentId || !existingDepartmentIds.has(departmentId)) return false;
      return user.role === "student"
        ? isStudentInCourseDepartment(user, course)
        : isApprovedLecturerAssignedToCourse(user, course);
    })
    .map((course) => course._id);
};

module.exports = {
  isStudentInCourseDepartment,
  isApprovedLecturerAssignedToCourse,
  canAccessCourse,
  getAccessibleCourseFilter,
  getValidAccessibleCourseIds
};
