const ACADEMIC_LEVELS = ["ND1", "ND2", "HND1", "HND2"];
const FILE_LEVELS = ACADEMIC_LEVELS;

const normalizeAcademicLevel = (level) => {
  if (!level || typeof level !== "string") return level;
  return level.trim().toUpperCase().replace(/\s+/g, "");
};

const isValidAcademicLevel = (level) => ACADEMIC_LEVELS.includes(normalizeAcademicLevel(level));

module.exports = {
  ACADEMIC_LEVELS,
  FILE_LEVELS,
  normalizeAcademicLevel,
  isValidAcademicLevel
};
