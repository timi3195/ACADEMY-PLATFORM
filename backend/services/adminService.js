const User = require('../models/User');

const SENSITIVE_USER_FIELDS = new Set([
  'password',
  'googleId',
  'emailVerificationToken',
  'emailVerificationExpires',
  'resetPasswordToken',
  'resetPasswordExpires',
  'refreshTokens',
  'paystackPayment',
  'bankDetails',
  'subscriptionFeatures',
  'preferences'
]);

const sanitizeDepartment = (department) => {
  if (!department) return null;

  if (typeof department === 'string' || typeof department === 'number' || typeof department === 'boolean') {
    return department;
  }

  if (department && typeof department.toObject === 'function') {
    return {
      _id: department._id ? String(department._id) : null,
      name: department.name || '',
      code: department.code || ''
    };
  }

  return {
    _id: department._id ? String(department._id) : null,
    name: department.name || '',
    code: department.code || ''
  };
};

const sanitizeLecturerProfile = (lecturerProfile) => {
  if (!lecturerProfile || typeof lecturerProfile !== 'object') {
    return null;
  }

  return {
    specialty: lecturerProfile.specialty || '',
    bio: lecturerProfile.bio || '',
    institution: lecturerProfile.institution || '',
    experience: lecturerProfile.experience || ''
  };
};

const sanitizeAdminLecturer = (lecturer) => {
  if (!lecturer || typeof lecturer !== 'object') {
    return {};
  }

  const lecturerApplication = lecturer.lecturerApplication && typeof lecturer.lecturerApplication === 'object'
    ? lecturer.lecturerApplication
    : {};

  const safeLecturer = {
    _id: lecturer._id ? String(lecturer._id) : null,
    name: lecturer.name || '',
    email: lecturer.email || '',
    matricNumber: lecturer.matricNumber || '',
    department: sanitizeDepartment(lecturer.department),
    yearOfStudy: lecturer.yearOfStudy || null,
    lecturerStatus: lecturer.lecturerStatus || 'not_requested',
    lecturerProfile: sanitizeLecturerProfile(lecturer.lecturerProfile),
    lecturerApplicationDate: lecturerApplication.submittedAt
      ? new Date(lecturerApplication.submittedAt).toISOString()
      : null,
    lecturerRejectionReason: lecturerApplication.rejectionReason || ''
  };

  for (const key of Object.keys(lecturer)) {
    if (SENSITIVE_USER_FIELDS.has(key)) {
      delete safeLecturer[key];
    }
  }

  return safeLecturer;
};

const getAdminLecturerList = async ({ status } = {}) => {
  const filter = { role: 'lecturer' };
  if (status) {
    filter.lecturerStatus = status;
  }

  const lecturers = await User.find(filter)
    .populate('department', 'name code')
    .sort({ createdAt: -1 })
    .select([
      '_id',
      'name',
      'email',
      'matricNumber',
      'department',
      'yearOfStudy',
      'lecturerStatus',
      'lecturerProfile',
      'lecturerApplication',
      'createdAt',
      'updatedAt'
    ].join(' '))
    .lean();

  const filteredLecturers = Array.isArray(lecturers)
    ? lecturers.filter((lecturer) => !status || lecturer.lecturerStatus === status)
    : [];

  const safeLecturers = filteredLecturers.map((lecturer) => sanitizeAdminLecturer(lecturer));

  return {
    success: true,
    count: safeLecturers.length,
    lecturers: safeLecturers
  };
};

module.exports = {
  sanitizeAdminLecturer,
  getAdminLecturerList
};
