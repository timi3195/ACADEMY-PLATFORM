import React from 'react';
import { Link } from 'react-router-dom';

export default function LecturerRejected() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center shadow-sm">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-3xl font-bold text-slate-900">Application not approved</h1>
        <p className="mt-4 text-slate-600">
          Your lecturer application was not approved at this time. Please contact the administrator for feedback or reapply with updated details.
        </p>
        <Link to="/" className="mt-6 inline-block rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white">Return home</Link>
      </div>
    </div>
  );
}
