export const UNIVERSITY_LEVELS = [
  '100 Level',
  '200 Level',
  '300 Level',
  '400 Level',
  '500 Level'
];

export const FILE_LEVELS = [
  '100 Level',
  '200 Level',
  '300 Level',
  '400 Level',
  '500 Level',
  'PGD',
  'Masters',
  'PhD',
  'Other'
];

const POLYTECHNIC_TO_UNIVERSITY = {
  ND1: '100 Level',
  ND2: '200 Level',
  HND1: '300 Level',
  HND2: '400 Level'
};

export const normalizeAcademicLevel = (level) => {
  if (!level || typeof level !== 'string') return level;
  return POLYTECHNIC_TO_UNIVERSITY[level] || level;
};

export const isValidYearOfStudy = (level) => UNIVERSITY_LEVELS.includes(level);
