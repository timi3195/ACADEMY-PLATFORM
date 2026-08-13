import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import marketplaceService from '../services/marketplaceService';
import purchaseService from '../services/purchaseService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import NotificationBanner from '../components/NotificationBanner';
import MaterialCard from '../components/MaterialCard';
import CheckoutModal from '../components/CheckoutModal';
import PurchaseReceipt from '../components/PurchaseReceipt';
import PDFViewer from '../components/PDFViewer';
import { formatCurrency } from '../utils/formatters';
import { useAuth } from '../utils/auth';
import { useMarketplace } from '../context/MarketplaceContext';
import { useLibrary } from '../context/LibraryContext';
import { addRecentlyViewed, clearPendingPurchase, isWishlisted, loadPendingPurchase, loadLatestPurchase, saveLatestPurchase, savePendingPurchase, toggleWishlistEntry } from '../utils/libraryState';
import { normalizeMaterialAccess } from '../utils/marketplaceAccess';

const buildList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(/\n|;|,/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

export default function MarketplaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { materials, loadMaterials } = useMarketplace();
  const { loadLibrary } = useLibrary();
  const [material, setMaterial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [wishlist, setWishlist] = useState(false);
  const [copied, setCopied] = useState(false);
  const [successState, setSuccessState] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [pendingPurchase, setPendingPurchase] = useState(null);

  const loadMaterial = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await marketplaceService.getMaterialById(id);
      const nextMaterial = response.material || response;
      setMaterial(nextMaterial);
      if (user) {
        setAccessLoading(true);
        try {
          const accessResponse = await purchaseService.getMaterialAccess(id);
          setAccess(normalizeMaterialAccess(accessResponse));
        } catch (accessErr) {
          setAccess({ access: false, reason: accessErr.message || 'Unable to verify access' });
        } finally {
          setAccessLoading(false);
        }
      } else {
        setAccess(null);
      }
    } catch (err) {
      setError(err.message || 'Unable to load material.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      if (!isMounted) return;
      await loadMaterial();
    };
    run();
    return () => {
      isMounted = false;
    };
  }, [id, user]);

  useEffect(() => {
    if (!material) return;
    addRecentlyViewed(material);
  }, [material]);

  useEffect(() => {
    if (!material) return;

    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');
    const status = params.get('status') || params.get('payment_status') || '';
    const cancelled = status === 'cancel' || status === 'cancelled' || status === 'canceled' || params.get('cancel') === '1';
    const failed = status === 'failed' || status === 'error' || params.get('success') === '0';
    const pending = loadPendingPurchase();
    const latest = loadLatestPurchase();

    if (pending?.materialId && pending.materialId === material._id) {
      setPendingPurchase(pending);
      setCheckoutOpen(Boolean(pending?.status === 'pending'));
      if (!reference && !cancelled && !failed) {
        setPurchaseMessage(`Payment reference ${pending.reference} is still being processed. Please complete the payment or retry if needed.`);
      }
    }

    if (latest && latest.materialId === material._id) {
      setReceipt(latest);
    }

    if (cancelled && material) {
      setPurchaseMessage('Payment was cancelled. You can try again anytime.');
      clearPendingPurchase();
      setPendingPurchase(null);
      return;
    }

    if (failed && material) {
      setPurchaseMessage('Payment verification failed. Please try again or contact support if the charge already went through.');
      clearPendingPurchase();
      setPendingPurchase(null);
      return;
    }

    if (!reference || !user) return;

    const alreadyHandled = latest?.reference === reference && latest?.status === 'Completed';
    if (alreadyHandled) {
      setSuccessState({ title: material.title, reference, date: new Date().toLocaleDateString() });
      return;
    }

    const verifyAfterCallback = async () => {
      setPurchaseLoading(true);
      setPurchaseMessage('Verifying your payment. Please wait…');
      try {
        const response = await purchaseService.verifyPurchase(material._id, reference);
        const transaction = response?.transaction || response;
        const nextReceipt = {
          materialId: material._id,
          materialTitle: material.title,
          lecturerName: material.lecturer?.name || 'Verified lecturer',
          reference: transaction?.reference || reference,
          receiptNumber: transaction?.reference || reference,
          amount: Number(transaction?.amount || material.price || 0),
          status: transaction?.status || 'Completed',
          paymentDate: transaction?.paidAt || new Date().toISOString(),
          paymentMethod: 'Card',
          studentName: user?.name || user?.email || 'Student'
        };
        saveLatestPurchase(nextReceipt);
        setReceipt(nextReceipt);
        setSuccessState({ title: material.title, reference: nextReceipt.reference, date: new Date().toLocaleDateString() });
        clearPendingPurchase();
        setPendingPurchase(null);
        setAccess({ access: true, reason: 'Access unlocked after successful verification' });

        await Promise.allSettled([
          refreshUser(),
          loadLibrary({ limit: 20 }),
          loadMaterials({ limit: 24 })
        ]);

        window.dispatchEvent(new Event('auth:updated'));
        window.dispatchEvent(new Event('marketplace:updated'));
        setPurchaseMessage('Payment verified. Your material is now available in your library.');
      } catch (err) {
        const message = err.message || 'Verification failed.';
        setPurchaseMessage(message);
        if (message.toLowerCase().includes('already')) {
          const nextReceipt = {
            materialId: material._id,
            materialTitle: material.title,
            lecturerName: material.lecturer?.name || 'Verified lecturer',
            reference,
            receiptNumber: reference,
            amount: Number(material.price || 0),
            status: 'Completed',
            paymentDate: new Date().toISOString(),
            paymentMethod: 'Card',
            studentName: user?.name || user?.email || 'Student'
          };
          saveLatestPurchase(nextReceipt);
          setReceipt(nextReceipt);
          setSuccessState({ title: material.title, reference, date: new Date().toLocaleDateString() });
          clearPendingPurchase();
          setPendingPurchase(null);
          setAccess({ access: true, reason: 'Access restored from an existing successful payment' });
        }
      } finally {
        setPurchaseLoading(false);
      }
    };

    verifyAfterCallback();
  }, [material, user, loadLibrary, loadMaterials]);

  useEffect(() => {
    if (materials.length === 0) {
      loadMaterials({ limit: 24 }).catch(() => undefined);
    }
  }, [loadMaterials, materials.length]);

  const handlePurchase = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    const alreadyOwned = Boolean(access?.access || material?.isPurchased || material?.hasAccess || material?.accessGranted || material?.canAccess || isFree || isOwner);
    if (alreadyOwned) {
      setPurchaseMessage('You already have access to this material. Opening the reader now.');
      document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (isFree) {
      setPurchaseMessage('This material is free. You can start reading it now.');
      document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setPurchaseLoading(true);
    setPurchaseMessage('Checkout started. You will be redirected to the secure payment page.');
    try {
      const response = await purchaseService.initializePurchase(material._id);
      const authorizationUrl = response?.data?.authorizationUrl || response?.authorizationUrl;
      const reference = response?.data?.reference || response?.reference || 'pending';
      const nextPending = {
        materialId: material._id,
        materialTitle: material.title,
        reference,
        status: 'pending',
        amount: price,
        lecturerName,
        paymentMethod: 'Card'
      };
      savePendingPurchase(nextPending);
      setPendingPurchase(nextPending);
      setCheckoutOpen(true);
      if (authorizationUrl) {
        window.location.href = authorizationUrl;
      } else {
        setPurchaseMessage('Purchase request created.');
      }
    } catch (err) {
      const message = err.message || 'Unable to start purchase.';
      setPurchaseMessage(message);
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleWishlistToggle = () => {
    if (!material) return;
    const nextWishlist = toggleWishlistEntry(material);
    setWishlist(nextWishlist.includes(material._id));
    setPurchaseMessage(wishlist ? 'Removed from wishlist' : 'Saved to wishlist');
  };

  const handleCopyLink = async () => {
    if (!window.location.href) return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      setPurchaseMessage('Unable to copy link automatically.');
    }
  };

  const handleRetry = () => {
    loadMaterial();
  };

  const price = Number(material?.price || 0);
  const wishlistState = isWishlisted(material);
  const isFree = material?.isFree || price === 0;
  const isOwner = Boolean(user && (material?.lecturer?._id === user._id || material?.lecturer?.id === user._id || material?.lecturer === user._id));
  const hasAccess = Boolean(material?.isPurchased || material?.hasAccess || material?.accessGranted || material?.canAccess || access?.access || isFree || isOwner);
  const previewPages = Number(material?.previewPages || material?.pageCount || 0);
  const previewLimitPages = hasAccess ? 0 : previewPages;
  const rating = Number(material?.ratingAverage || 0);
  const reviewCount = Number(material?.ratingCount || 0);
  const salesCount = Number(material?.sales || material?.purchases || 0);
  const viewsCount = Number(material?.views || 0);
  const downloadsCount = Number(material?.downloads || 0);
  const courseCode = material?.course?.code || material?.course?.title || 'General';
  const departmentName = material?.department?.name || 'General';
  const lecturerName = material?.lecturer?.name || 'Verified lecturer';
  const publicationDate = material?.createdAt ? new Date(material.createdAt).toLocaleDateString() : 'Available now';
  const coverFallback = useMemo(() => {
    const title = material?.title || 'Untitled';
    const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((segment) => segment[0]?.toUpperCase() || '').join('');
    return {
      label: initials || 'BK',
      title,
      department: material?.department?.name || material?.department || 'Department',
      course: material?.course?.code || material?.course?.title || material?.course || 'Course'
    };
  }, [material?.course, material?.department, material?.title]);
  const tags = useMemo(() => buildList(material?.tags), [material?.tags]);
  const topicsCovered = useMemo(() => buildList(material?.topicsCovered), [material?.topicsCovered]);
  const prerequisites = useMemo(() => buildList(material?.prerequisites), [material?.prerequisites]);
  const learningObjectives = useMemo(() => buildList(material?.learningObjectives), [material?.learningObjectives]);

  useEffect(() => {
    if (material) {
      setWishlist(wishlistState);
    }
  }, [material, wishlistState]);

  const relatedMaterials = useMemo(() => {
    const source = Array.isArray(materials) ? materials : [];
    const safeId = material?._id;
    const sameLecturer = source.filter((item) => item._id !== safeId && item.lecturer?._id === material?.lecturer?._id).slice(0, 4);
    const sameCourse = source.filter((item) => item._id !== safeId && item.course?._id === material?.course?._id).slice(0, 4);
    const sameDepartment = source.filter((item) => item._id !== safeId && item.department?._id === material?.department?._id).slice(0, 4);
    return {
      lecturer: sameLecturer,
      course: sameCourse,
      department: sameDepartment
    };
  }, [material?.course?._id, material?.department?._id, material?.lecturer?._id, material?._id, materials]);

  if (loading) {
    return (
      <div className="page">
        <div className="wp-section product-skeleton">
          <div className="product-skeleton__cover" />
          <div className="product-skeleton__content" />
        </div>
        <LoadingSpinner label="Loading material" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} />
        <div style={{ marginTop: '12px' }}>
          <button type="button" onClick={handleRetry}>Try again</button>
        </div>
      </div>
    );
  }

  if (!material) {
    return <EmptyState title="Material not found" description="This material is no longer available." />;
  }

  return (
    <div className="page">
      <div className="wp-section product-hero">
        <div className="product-hero__media">
          {material.coverImageUrl ? (
            <img src={material.coverImageUrl} alt={material.title || 'Material cover'} loading="lazy" />
          ) : (
            <div className="product-hero__placeholder" style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: '#fff' }}>
              <div style={{ display: 'grid', gap: '8px', justifyItems: 'center', textAlign: 'center' }}>
                <span style={{ fontSize: '3rem', fontWeight: 800 }}>{coverFallback.label}</span>
                <small style={{ fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{material.materialType || 'Resource'}</small>
                <strong style={{ fontSize: '1rem' }}>{coverFallback.title}</strong>
                <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.86)' }}>{coverFallback.department}</span>
                <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.86)' }}>{coverFallback.course}</span>
              </div>
            </div>
          )}
          <div className="product-hero__badges">
            <span className="product-hero__badge">{material.materialType || 'Resource'}</span>
            {material.featured && <span className="product-hero__badge product-hero__badge--accent">Featured</span>}
            {isFree && <span className="product-hero__badge product-hero__badge--success">Free</span>}
          </div>
        </div>

        <div className="product-hero__content">
          <div className="product-hero__header">
            <div>
              <div className="product-hero__eyebrow">Digital product</div>
              <h2>{material.title}</h2>
              <p>{material.description || 'No description available.'}</p>
            </div>
            <div className="product-hero__price-box">
              <div className="product-hero__price">{formatCurrency(price)}</div>
              {isFree ? <span className="product-hero__pill">Free access</span> : <span className="product-hero__pill">Premium resource</span>}
            </div>
          </div>

          <div className="product-hero__meta-grid">
            <div><span>Lecturer</span><strong>{lecturerName}</strong></div>
            <div><span>Department</span><strong>{departmentName}</strong></div>
            <div><span>Course</span><strong>{courseCode}</strong></div>
            <div><span>Semester</span><strong>{material.semester || '—'}</strong></div>
            <div><span>Level</span><strong>{material.level || '—'}</strong></div>
            <div><span>Language</span><strong>{material.language || 'English'}</strong></div>
            <div><span>Edition</span><strong>{material.edition || '—'}</strong></div>
            <div><span>Publisher</span><strong>{material.publisher || '—'}</strong></div>
          </div>

          <div className="product-hero__stats">
            <span>⭐ {rating.toFixed(1)} ({reviewCount} reviews)</span>
            <span>👁 {viewsCount.toLocaleString()} views</span>
            <span>🛒 {salesCount.toLocaleString()} sales</span>
            <span>⬇️ {downloadsCount.toLocaleString()} downloads</span>
            <span>📄 {previewPages > 0 ? `${previewPages} preview pages` : 'Full access'}</span>
          </div>

          <div className="product-hero__actions">
            {!user && !isFree && <span className="product-hero__note">Sign in to purchase</span>}
            {isFree || hasAccess ? (
              <button type="button" onClick={() => document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Read now</button>
            ) : (
              <button type="button" onClick={handlePurchase} disabled={purchaseLoading}>{purchaseLoading ? 'Preparing...' : 'Buy now'}</button>
            )}
            {!hasAccess && previewPages > 0 && <button type="button" className="button-ghost" onClick={() => document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Preview</button>}
            <button type="button" className="button-ghost" onClick={handleCopyLink}>{copied ? 'Link copied' : 'Share'}</button>
            <button type="button" className="button-ghost" onClick={handleWishlistToggle}>{wishlist ? '★ Saved' : '☆ Wishlist'}</button>
            {isOwner && (
              <>
                <button type="button" className="button-ghost" onClick={() => navigate('/lecturer-dashboard')}>Edit material</button>
                <button type="button" className="button-ghost" onClick={() => navigate('/lecturer-dashboard')}>Analytics</button>
              </>
            )}
          </div>

          {purchaseMessage && <NotificationBanner type="info" message={purchaseMessage} onClose={() => setPurchaseMessage('')} autoDismissMs={2400} />}
          {accessLoading && <p className="product-hero__helper">Checking access…</p>}
          {!isFree && !isOwner && !hasAccess && access && <p className="product-hero__helper">{access.reason}</p>}
        </div>
      </div>

      {successState && (
        <div className="wp-section" style={{ marginBottom: '20px', border: '1px solid #a7f3d0', background: '#ecfdf3' }}>
          <h3 style={{ marginTop: 0 }}>Purchase successful</h3>
          <p style={{ marginBottom: '8px' }}>{successState.title}</p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span className="nav-pill">Receipt: {successState.reference}</span>
            <span className="nav-pill">Date: {successState.date}</span>
          </div>
          <div className="product-hero__actions" style={{ marginTop: '14px' }}>
            <button type="button" onClick={() => navigate('/library')}>Go to library</button>
            <button type="button" className="button-ghost" onClick={() => navigate('/marketplace')}>Continue browsing</button>
          </div>
        </div>
      )}

      {receipt && (
        <div className="wp-section" style={{ marginBottom: '20px' }}>
          <PurchaseReceipt
            receipt={receipt}
            onPrint={() => window.print()}
            onDownload={() => setPurchaseMessage('Receipt download will be available in a future release.')} 
          />
        </div>
      )}

      <CheckoutModal
        open={checkoutOpen}
        material={material}
        loading={purchaseLoading}
        message={purchaseMessage || (pendingPurchase ? `Payment reference ${pendingPurchase.reference} is being processed.` : '')}
        onClose={() => {
          setCheckoutOpen(false);
          setPurchaseMessage('You can return to this purchase anytime from the library.');
        }}
        onProceed={handlePurchase}
      />

      <div className="product-layout">
        <div className="product-layout__main">
          <section className="wp-section product-section">
            <h3>About this resource</h3>
            <p>{material.description || 'No description available.'}</p>
            <div className="product-section__grid">
              {learningObjectives.length > 0 && (
                <div>
                  <h4>Learning objectives</h4>
                  <ul>{learningObjectives.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
              {topicsCovered.length > 0 && (
                <div>
                  <h4>Topics covered</h4>
                  <ul>{topicsCovered.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
              {prerequisites.length > 0 && (
                <div>
                  <h4>Prerequisites</h4>
                  <ul>{prerequisites.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
            </div>
          </section>

          <section className="wp-section product-section">
            <h3>Product details</h3>
            <div className="product-info-grid">
              <div className="product-info-card"><span>Course</span><strong>{courseCode}</strong></div>
              <div className="product-info-card"><span>Department</span><strong>{departmentName}</strong></div>
              <div className="product-info-card"><span>Semester</span><strong>{material.semester || '—'}</strong></div>
              <div className="product-info-card"><span>Level</span><strong>{material.level || '—'}</strong></div>
              <div className="product-info-card"><span>Language</span><strong>{material.language || 'English'}</strong></div>
              <div className="product-info-card"><span>Material type</span><strong>{material.materialType || 'Resource'}</strong></div>
              <div className="product-info-card"><span>Pages</span><strong>{material.pageCount || previewPages || '—'}</strong></div>
              <div className="product-info-card"><span>Edition</span><strong>{material.edition || '—'}</strong></div>
              <div className="product-info-card"><span>Publisher</span><strong>{material.publisher || '—'}</strong></div>
              <div className="product-info-card"><span>Published</span><strong>{publicationDate}</strong></div>
            </div>
          </section>

          <section id="preview-section" className="wp-section product-section">
            <h3>Preview</h3>
            {material.fileUrl ? (
              <PDFViewer
                fileUrl={material.fileUrl}
                fileName={material.title}
                downloadUrl={material.downloadUrl || material.fileUrl}
                canDownload={hasAccess || isFree}
                maxPages={previewLimitPages}
                disablePreviewLimit={hasAccess}
              />
            ) : (
              <EmptyState title="Preview unavailable" description="This material does not have a preview file attached yet." />
            )}
          </section>

          <section className="wp-section product-section">
            <h3>Ratings & reviews</h3>
            <div className="product-reviews-overview">
              <div>
                <div className="product-reviews-rating">{rating.toFixed(1)}</div>
                <div className="product-hero__stats"><span>⭐ {rating.toFixed(1)} average</span><span>{reviewCount} reviews</span></div>
              </div>
              <div className="product-reviews-list">
                {Array.isArray(material.reviews) && material.reviews.length > 0 ? material.reviews.slice(0, 3).map((review, index) => (
                  <div key={review._id || index} className="product-review-card">
                    <strong>{review.user?.name || 'Student'}</strong>
                    <p>{review.comment || 'Helpful review.'}</p>
                  </div>
                )) : (
                  <div className="product-review-card">
                    <strong>Reviews are coming soon</strong>
                    <p>Students will be able to leave feedback once this product is live.</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="wp-section product-section">
            <h3>More from this lecturer</h3>
            <div className="marketplace-grid">
              {relatedMaterials.lecturer.length > 0 ? relatedMaterials.lecturer.map((item) => (
                <MaterialCard key={item._id} material={item} onPreview={() => navigate(`/marketplace/${item._id}`)} onPurchase={() => navigate(`/marketplace/${item._id}`)} />
              )) : <p>No other materials from this lecturer yet.</p>}
            </div>
          </section>

          <section className="wp-section product-section">
            <h3>Related course materials</h3>
            <div className="marketplace-grid">
              {relatedMaterials.course.length > 0 ? relatedMaterials.course.map((item) => (
                <MaterialCard key={item._id} material={item} onPreview={() => navigate(`/marketplace/${item._id}`)} onPurchase={() => navigate(`/marketplace/${item._id}`)} />
              )) : <p>No related course materials yet.</p>}
            </div>
          </section>

          <section className="wp-section product-section">
            <h3>Same department</h3>
            <div className="marketplace-grid">
              {relatedMaterials.department.length > 0 ? relatedMaterials.department.map((item) => (
                <MaterialCard key={item._id} material={item} onPreview={() => navigate(`/marketplace/${item._id}`)} onPurchase={() => navigate(`/marketplace/${item._id}`)} />
              )) : <p>No materials in this department yet.</p>}
            </div>
          </section>
        </div>

        <aside className="product-purchase-panel">
          <div className="product-purchase-panel__inner">
            <div className="product-purchase-panel__price">{formatCurrency(price)}</div>
            <div className="product-purchase-panel__meta">{rating.toFixed(1)} • {reviewCount} reviews</div>
            <div className="product-purchase-panel__actions">
              {!user && !isFree && <p>Sign in to continue</p>}
              {isFree || hasAccess ? (
                <button type="button" onClick={() => document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Read now</button>
              ) : (
                <button type="button" onClick={handlePurchase} disabled={purchaseLoading}>{purchaseLoading ? 'Preparing...' : 'Buy now'}</button>
              )}
              {!hasAccess && previewPages > 0 && <button type="button" className="button-ghost" onClick={() => document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Preview</button>}
              <button type="button" className="button-ghost" onClick={handleCopyLink}>{copied ? 'Link copied' : 'Share'}</button>
              <button type="button" className="button-ghost" onClick={handleWishlistToggle}>{wishlist ? 'Saved' : 'Wishlist'}</button>
            </div>
            <div className="product-purchase-panel__meta">{tags.slice(0, 5).map((tag) => <span key={tag} className="product-hero__badge">{tag}</span>)}</div>
            {material._id && (
              <button
                type="button"
                className="product-purchase-panel__link"
                onClick={async () => {
                  try {
                    const response = await (await import('../services/fileService')).default.viewFile(material._id);
                    const blob = new Blob([response.data], { type: response.headers?.['content-type'] || 'application/pdf' });
                    const objectUrl = URL.createObjectURL(blob);
                    const newTab = window.open('', '_blank', 'noopener,noreferrer');
                    if (newTab) {
                      newTab.document.write('<html><body style="margin:0"><iframe src="' + objectUrl + '" style="width:100vw;height:100vh;border:0" /></body></html>');
                    }
                  } catch (viewError) {
                    const message = viewError?.response?.data?.message || viewError?.message || 'Unable to open this file.';
                    window.alert(message);
                  }
                }}
              >
                Open file
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
