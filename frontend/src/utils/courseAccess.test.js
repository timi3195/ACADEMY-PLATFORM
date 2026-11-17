import { describe, expect, it } from 'vitest';
import { isCourseAccessibleToUser } from './courseAccess';

const courseId = '507f1f77bcf86cd799439021';
const departmentId = '507f1f77bcf86cd799439041';
const otherDepartmentId = '507f1f77bcf86cd799439042';
const course = { _id: courseId, department: departmentId, lecturers: ['lecturer-123'] };

describe('isCourseAccessibleToUser', () => {
  it('allows students in the course department without an assigned course ID', () => {
    expect(isCourseAccessibleToUser({
      role: 'student',
      department: { _id: departmentId },
      yearOfStudy: 'HND2',
      coursesEnrolled: []
    }, course)).toBe(true);
  });

  it('denies cross-department, missing, and invalid department access', () => {
    expect(isCourseAccessibleToUser({
      role: 'student',
      department: otherDepartmentId,
      yearOfStudy: 'ND1',
      coursesEnrolled: [courseId]
    }, course)).toBe(false);

    expect(isCourseAccessibleToUser({ role: 'student' }, course)).toBe(false);
    expect(isCourseAccessibleToUser({
      role: 'student',
      department: 'invalid-department'
    }, course)).toBe(false);
    expect(isCourseAccessibleToUser({
      role: 'student',
      department: departmentId
    }, { _id: courseId })).toBe(false);
  });

  it('preserves admin and approved assigned lecturer access', () => {
    expect(isCourseAccessibleToUser({ role: 'admin' }, { _id: courseId })).toBe(true);
    expect(isCourseAccessibleToUser({
      id: 'lecturer-123',
      role: 'lecturer',
      lecturerStatus: 'approved'
    }, course)).toBe(true);
    expect(isCourseAccessibleToUser({
      id: 'lecturer-123',
      role: 'lecturer',
      lecturerStatus: 'pending'
    }, course)).toBe(false);
  });
});
