import React, { useEffect, useState } from 'react';
import lecturerService, { normalizePaymentSettingsResponse } from '../services/lecturerService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import NotificationBanner from '../components/NotificationBanner';

export default function LecturerPaymentSettings() {
  const [settings, setSettings] = useState(null);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({
    bankCode: '',
    bankName: '',
    accountNumber: '',
    accountName: ''
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [settingsRes, banksRes] = await Promise.all([
        lecturerService.getPaymentSettings(),
        lecturerService.getAvailableBanks()
      ]);

      const normalizedSettings = normalizePaymentSettingsResponse(settingsRes);
      setSettings(normalizedSettings);
      setBanks(banksRes.banks || []);

      // Populate form with current settings
      if (normalizedSettings.bankCode || normalizedSettings.bankName || normalizedSettings.accountName) {
        setFormData({
          bankCode: normalizedSettings.bankCode,
          bankName: normalizedSettings.bankName,
          accountNumber: '',
          accountName: normalizedSettings.accountName
        });
      }
    } catch (err) {
      setError(err.message || 'Unable to load payment settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleBankSelect = (e) => {
    const selectedBank = banks.find((b) => b.code === e.target.value);
    if (selectedBank) {
      setFormData((prev) => ({
        ...prev,
        bankCode: selectedBank.code,
        bankName: selectedBank.name
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (!formData.bankCode) {
      setError('Please select a bank');
      return;
    }
    if (!formData.accountNumber || formData.accountNumber.length < 10) {
      setError('Account number must be at least 10 digits');
      return;
    }
    if (!formData.accountName) {
      setError('Account name is required');
      return;
    }

    try {
      setSubmitting(true);
      const response = await lecturerService.updatePaymentSettings(formData);
      setSettings(normalizePaymentSettingsResponse(response));
      setSuccess(response.message || 'Payment settings updated successfully.');
      window.dispatchEvent(new Event('payment:updated'));
    } catch (err) {
      setError(err.message || 'Unable to update payment settings.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <LoadingSpinner label="Loading payment settings" />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="wp-section" style={{ marginBottom: '20px', background: 'linear-gradient(135deg, #f8fbff, #ffffff)', border: '1px solid #dbeafe', borderRadius: '12px', padding: '20px' }}>
        <div style={{ color: '#0f3d91', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Payment Account</div>
        <h2 style={{ marginBottom: '8px' }}>Payment Settings</h2>
        <p style={{ margin: 0, color: '#64748b' }}>Configure your bank account details to receive payments for your course materials.</p>
      </div>

      {error && <ErrorState message={error} />}
      {success && <NotificationBanner type="success" message={success} onClose={() => setSuccess('')} />}

      <div className="wp-section" style={{ maxWidth: '600px', margin: '0 auto' }}>
        {settings && settings.verified && (
          <div style={{ marginBottom: '20px', padding: '14px', background: '#ecfdf3', border: '1px solid #86efac', borderRadius: '8px', color: '#166534' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>✓ Account Verified</div>
            <div style={{ fontSize: '13px' }}>Your payment account has been verified with Paystack. You can now sell paid course materials.</div>
          </div>
        )}

        {settings && !settings.verified && settings.bankCode && (
          <div style={{ marginBottom: '20px', padding: '14px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', color: '#78350f' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>⏳ Pending Verification</div>
            <div style={{ fontSize: '13px' }}>Your account details have been saved. Verification with Paystack is in progress. You'll be notified once verified.</div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>Select Bank</label>
            <select
              name="bankCode"
              value={formData.bankCode}
              onChange={handleBankSelect}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: 'inherit'
              }}
            >
              <option value="">-- Choose a bank --</option>
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>Account Number</label>
            <input
              type="text"
              name="accountNumber"
              value={formData.accountNumber}
              onChange={handleChange}
              placeholder="10-digit account number"
              maxLength="20"
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
            {settings?.accountNumberMasked && !formData.accountNumber && (
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                Current account: {settings.accountNumberMasked}. Enter the full account number only to change it.
              </div>
            )}
            {formData.accountNumber && formData.accountNumber.length < 10 && (
              <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>Account number must be at least 10 digits</div>
            )}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>Account Name</label>
            <input
              type="text"
              name="accountName"
              value={formData.accountName}
              onChange={handleChange}
              placeholder="Name on the bank account"
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px',
              background: submitting ? '#9ca3af' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: submitting ? 'default' : 'pointer',
              marginTop: '8px'
            }}
          >
            {submitting ? 'Saving...' : 'Save Payment Settings'}
          </button>
        </form>

        <div style={{ marginTop: '24px', padding: '14px', background: '#f3f4f6', borderRadius: '8px', fontSize: '13px', color: '#374151' }}>
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>ℹ️ How it works:</div>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            <li>We verify your account details with Paystack</li>
            <li>Once verified, you can publish paid course materials</li>
            <li>When students purchase your materials, 90% goes to you, 10% is our platform fee</li>
            <li>Payments are settled to your account weekly</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
