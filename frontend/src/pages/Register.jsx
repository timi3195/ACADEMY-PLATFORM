import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/api';

const Register = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    department: '',
    yearOfStudy: ''
  });
  const [departments, setDepartments] = useState([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

  useEffect(() => {
    fetchDepartments()
  }, [])

  const fetchDepartments = async () => {
    try {
      setDepartmentsLoading(true)
      setDepartmentsError('')
      const res = await apiGet('/api/departments')
      console.log('Departments response:', res)
      
      if (res.success && res.departments) {
        setDepartments(res.departments)
        if (res.departments.length === 0) {
          setDepartmentsError('No departments available. Please contact the administrator.')
        }
      } else {
        setDepartmentsError(res.message || 'Unable to load departments')
      }
    } catch (error) {
      console.error('Departments load failed:', error)
      setDepartmentsError('Unable to load departments. Please check your connection and refresh.')
    } finally {
      setDepartmentsLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = 'Name is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Invalid email format';
    if (!formData.department) newErrors.department = 'Department is required';
    if (!formData.yearOfStudy) newErrors.yearOfStudy = 'Year of study is required';
    if (!formData.password) newErrors.password = 'Password is required';
    else if (formData.password.length < 8) newErrors.password = 'Password must be at least 8 characters';
    if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setLoading(true);
    const emailAddress = formData.email;
    try {
      const response = await apiPost('/api/auth/register', formData);
      if (response.success) {
        setSuccess(true);
        setFormData({ name: '', email: '', password: '', confirmPassword: '', department: '', yearOfStudy: '' });
        setTimeout(() => {
          navigate('/verify-email', { state: { email: emailAddress } });
        }, 2000);
      }
    } catch (error) {
      setErrors({ submit: error.body?.message || error.message || 'Registration failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = `${apiBase}/api/auth/google`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-lg">
        {/* Logo/Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-full shadow-lg mb-4">
            <span className="text-3xl font-bold text-blue-600">✏️</span>
          </div>
          <h1 className="text-5xl font-bold text-white mb-3">Join Academy</h1>
          <p className="text-blue-100 text-lg">Start your learning journey today</p>
        </div>

        {/* Main Registration Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-10">
            {/* Success Message */}
            {success && (
              <div className="mb-6 p-4 bg-green-50 border-l-4 border-green-500 rounded-lg">
                <p className="text-green-700 font-medium text-sm flex items-center gap-2">
                  <span>✓</span>
                  Registration successful! Check your email to verify your account.
                </p>
              </div>
            )}

            {/* Error Message */}
            {errors.submit && (
              <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
                <p className="text-red-700 font-medium text-sm flex items-center gap-2">
                  <span>⚠️</span>
                  {errors.submit}
                </p>
              </div>
            )}

            {/* Registration Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Full Name Field */}
              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-gray-800 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="John Doe"
                  disabled={loading}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 transition-all disabled:bg-gray-100 ${
                    errors.name ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'
                  }`}
                />
                {errors.name && <p className="text-red-600 text-sm mt-1 font-medium">⚠️ {errors.name}</p>}
              </div>

              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-gray-800 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  disabled={loading}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 transition-all disabled:bg-gray-100 ${
                    errors.email ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'
                  }`}
                />
                {errors.email && <p className="text-red-600 text-sm mt-1 font-medium">⚠️ {errors.email}</p>}
              </div>

              {/* Department Field */}
              <div>
                <label htmlFor="department" className="block text-sm font-semibold text-gray-800 mb-2">
                  Department
                </label>
                <select
                  id="department"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  disabled={loading || departmentsLoading}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 transition-all disabled:bg-gray-100 ${
                    errors.department ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'
                  }`}
                >
                  <option value="">
                    {departmentsLoading ? 'Loading departments...' : 'Select department'}
                  </option>
                  {departments.map(dept => (
                    <option key={dept._id} value={dept._id}>
                      {dept.name} {dept.code ? `(${dept.code})` : ''}
                    </option>
                  ))}
                </select>
                {errors.department && <p className="text-red-600 text-sm mt-1 font-medium">⚠️ {errors.department}</p>}
                {departmentsError && <p className="text-red-600 text-sm mt-1">{departmentsError}</p>}
              </div>

              {/* Year of Study Field */}
              <div>
                <label htmlFor="yearOfStudy" className="block text-sm font-semibold text-gray-800 mb-2">
                  Year of Study
                </label>
                <select
                  id="yearOfStudy"
                  name="yearOfStudy"
                  value={formData.yearOfStudy}
                  onChange={handleChange}
                  disabled={loading}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 transition-all disabled:bg-gray-100 ${
                    errors.yearOfStudy ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'
                  }`}
                >
                  <option value="">Select year of study</option>
                  <option value="ND1">ND 1</option>
                  <option value="ND2">ND 2</option>
                  <option value="HND1">HND 1</option>
                  <option value="HND2">HND 2</option>
                </select>
                {errors.yearOfStudy && <p className="text-red-600 text-sm mt-1 font-medium">⚠️ {errors.yearOfStudy}</p>}
              </div>

              {/* Password Field */}
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-gray-800 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  disabled={loading}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 transition-all disabled:bg-gray-100 ${
                    errors.password ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'
                  }`}
                />
                {errors.password && <p className="text-red-600 text-sm mt-1 font-medium">⚠️ {errors.password}</p>}
                <p className="text-gray-600 text-xs mt-2">• At least 8 characters • Mix of letters & numbers</p>
              </div>

              {/* Confirm Password Field */}
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-800 mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="••••••••"
                  disabled={loading}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 transition-all disabled:bg-gray-100 ${
                    errors.confirmPassword ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'
                  }`}
                />
                {errors.confirmPassword && <p className="text-red-600 text-sm mt-1 font-medium">⚠️ {errors.confirmPassword}</p>}
              </div>

              {/* Create Account Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl disabled:shadow-none mt-6"
              >
                {loading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Creating account...
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    Create My Account
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t-2 border-gray-200"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 bg-white text-gray-500 font-medium text-sm">Or</span>
              </div>
            </div>

            {/* Google OAuth Button */}
            <button
              onClick={handleGoogleLogin}
              type="button"
              className="w-full py-3 px-4 border-2 border-gray-200 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 flex items-center justify-center gap-3 shadow-sm hover:shadow-md"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign up with Google
            </button>

            {/* Login Link */}
            <div className="mt-8 text-center">
              <p className="text-gray-700 font-medium">
                Already have an account?{' '}
                <Link to="/login" className="text-blue-600 hover:text-blue-700 font-bold transition-colors">
                  Sign in here →
                </Link>
              </p>
            </div>
          </div>

          {/* Features Section - Integrated in Card */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-10 py-8 border-t-2 border-gray-100">
            <p className="text-center text-gray-600 font-semibold text-sm mb-5">What you'll get:</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl mb-2">📚</div>
                <p className="text-xs text-gray-600 font-medium">Quality<br/>Content</p>
              </div>
              <div className="text-center">
                <div className="text-3xl mb-2">🎯</div>
                <p className="text-xs text-gray-600 font-medium">Practice<br/>Exams</p>
              </div>
              <div className="text-center">
                <div className="text-3xl mb-2">🚀</div>
                <p className="text-xs text-gray-600 font-medium">Fast<br/>Learning</p>
              </div>
            </div>
          </div>
        </div>

        {/* Trust Badges */}
        <div className="mt-8 text-center">
          <p className="text-blue-100 text-xs font-semibold mb-2">✓ Secure Signup • ✓ Free Forever • ✓ No Credit Card</p>
        </div>
      </div>
    </div>
  );
};

export default Register;
