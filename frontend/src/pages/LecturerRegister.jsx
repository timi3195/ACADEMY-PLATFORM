import React, { useState } from 'react';
import { useAuth } from '../utils/auth';
import { useNavigate } from 'react-router-dom';

export default function LecturerRegister() {
  const { registerLecturer, user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    specialty: '',
    bio: '',
    institution: '',
    experience: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await registerLecturer(form);
      if (response?.success) {
        await refreshUser();
        navigate('/lecturer/pending');
      }
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Unable to submit lecturer application.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Academy Platform</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">Apply to become a lecturer</h1>
        <p className="mt-2 text-slate-600">Share your teaching background so the admin can review your application before you publish materials.</p>

        {error && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Specialty</label>
            <input
              name="specialty"
              value={form.specialty}
              onChange={handleChange}
              className="w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder="Computer Science, Mathematics, Economics..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Teaching bio</label>
            <textarea
              name="bio"
              value={form.bio}
              onChange={handleChange}
              rows="5"
              className="w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder="Tell us about your teaching experience and academic focus."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Institution</label>
            <input
              name="institution"
              value={form.institution}
              onChange={handleChange}
              className="w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder="School or organization name"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Experience</label>
            <textarea
              name="experience"
              value={form.experience}
              onChange={handleChange}
              rows="4"
              className="w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder="Years of teaching, publications, or relevant professional experience."
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : 'Submit application'}
          </button>
        </form>
      </div>
    </div>
  );
}
