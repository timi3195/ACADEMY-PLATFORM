export const ACADEMIC_LEVELS = ['ND1', 'ND2', 'HND1', 'HND2'];
export const FILE_LEVELS = ACADEMIC_LEVELS;

export const normalizeAcademicLevel = (level) => {
  if (!level || typeof level !== 'string') return level;
  return level.trim().toUpperCase().replace(/\s+/g, '');
};

export const isValidYearOfStudy = (level) => ACADEMIC_LEVELS.includes(normalizeAcademicLevel(level));
