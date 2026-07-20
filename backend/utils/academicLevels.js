const POLYTECHNIC_LEVEL_MAP = {
  ND1: "100 Level",
  ND2: "200 Level",
  HND1: "300 Level",
  HND2: "400 Level"
};

const UNIVERSITY_LEVELS = [
  "100 Level",
  "200 Level",
  "300 Level",
  "400 Level",
  "500 Level"
];

const FILE_LEVELS = [
  ...UNIVERSITY_LEVELS,
  "PGD",
  "Masters",
  "PhD",
  "Other"
];

const normalizeAcademicLevel = (level) => {
  if (!level || typeof level !== "string") return level;
  return POLYTECHNIC_LEVEL_MAP[level] || level;
};

const isValidAcademicLevel = (level) => UNIVERSITY_LEVELS.includes(level);

module.exports = {
  POLYTECHNIC_LEVEL_MAP,
  UNIVERSITY_LEVELS,
  FILE_LEVELS,
  normalizeAcademicLevel,
  isValidAcademicLevel
};
