const objectIdOf = (value) => {
  const department = value && typeof value === 'object'
    ? value._id
    : value;

  if (typeof department !== 'string' || !/^[a-f\d]{24}$/i.test(department)) {
    return null;
  }

  return department.toLowerCase();
};

const idOf = (value) => String(value?._id || value?.id || value || '');

export function isCourseAccessibleToUser(user, course) {
  if (!user || !course) return false;
  if (user.role === 'admin') return true;

  if (user.role === 'student') {
    const studentDepartmentId = objectIdOf(user.department);
    const courseDepartmentId = objectIdOf(course.department);
    return Boolean(
      studentDepartmentId &&
      courseDepartmentId &&
      studentDepartmentId === courseDepartmentId
    );
  }

  if (user.role === 'lecturer' && user.lecturerStatus === 'approved') {
    const userId = idOf(user._id || user.id);
    return Boolean(userId) &&
      Array.isArray(course.lecturers) &&
      course.lecturers.some((lecturerId) => idOf(lecturerId) === userId);
  }

  return false;
}
