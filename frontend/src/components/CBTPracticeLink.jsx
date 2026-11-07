import React from 'react'
import { Link } from 'react-router-dom'
import { cbtPathForCourse } from '../utils/cbt'

export default function CBTPracticeLink({ courseId }) {
  return (
    <Link
      to={cbtPathForCourse(courseId)}
      className="inline-flex items-center rounded-lg bg-white px-4 py-2 font-semibold text-blue-700 hover:bg-blue-50"
    >
      Start CBT Practice
    </Link>
  )
}
