import React, { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PremiumBadge from './PremiumBadge';
import PriceTag from './PriceTag';
import { useAuth } from '../utils/auth';
import { useLibrary } from '../context/LibraryContext';

const wrapHighlight = (text, term) => {
  if (!text || !term) return text;
  const parts = `${text}`.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((part, index) => (part.toLowerCase() === term.toLowerCase() ? <mark key={`${part}-${index}`} style={{ background: '#fef3c7', color: '#92400e', padding: '0 2px', borderRadius: '3px' }}>{part}</mark> : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>));
};

const buildCoverFallback = (material) => {
  const title = material?.title || 'Untitled';
  const department = material?.department?.name || material?.department || 'Department';
  const course = material?.course?.code || material?.course?.title || material?.course || 'Course';
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() || '')
    .join('');

  return {
    label: initials || 'BK',
    title,
    department,
    course,
    accentA: '#2563eb',
    accentB: '#7c3aed'
  };
};

const formatCount = (value) => Number(value || 0).toLocaleString();

const buildBadges = (material) => {
  const badges = [];
  const isFree = material?.isFree || Number(material?.price || 0) === 0;
  const rating = Number(material?.ratingAverage || 0);
  const sales = Number(material?.sales || material?.purchases || 0);
  const views = Number(material?.views || 0);
  const createdAt = material?.createdAt ? new Date(material.createdAt) : null;
  const isNew = createdAt && Date.now() - createdAt.getTime() < 1000 * 60 * 60 * 24 * 14;

  if (isFree) badges.push('FREE');
  if (isNew) badges.push('NEW');
  if (views > 100 || sales > 10) badges.push('TRENDING');
  if (sales > 20) badges.push('BEST SELLER');
  if (rating >= 4.5) badges.push('TOP RATED');
  if (material?.isPremium || material?.isPaid || Number(material?.price || 0) > 0) badges.push('PREMIUM');
  if (material?.featured || material?.approved === true) badges.push('FEATURED');

  return badges.slice(0, 4);
};

function MaterialCard({ material, onPurchase, onPreview, searchTerm = '', progressPercent, showWishlist = false, isWishlisted = false, onWishlistToggle }) {
  const { user } = useAuth();
  const { items: libraryItems = [] } = useLibrary();
  const [imageLoading, setImageLoading] = useState(Boolean(material?.coverImageUrl));
  const [imageError, setImageError] = useState(false);

  const title = material?.title || 'Untitled material';
  const description = material?.description || 'Academic resource';
  const fallbackCover = useMemo(() => buildCoverFallback(material), [material]);
  const badges = useMemo(() => buildBadges(material), [material]);
  const isFree = material?.isFree || Number(material?.price || 0) === 0;
  const isPurchased = Boolean(
    material?.isPurchased ||
    material?.hasAccess ||
    material?.accessGranted ||
    material?.isOwned ||
    material?.purchased ||
    material?.canAccess ||
    Array.isArray(libraryItems) && libraryItems.some((item) => {
      const id = item?.material?._id || item?.materialId || item?._id;
      return Boolean(id && (id === material?._id || id === material?.id));
    })
  );
  const isOwner = Boolean(user && (material?.lecturer?._id === user._id || material?.lecturer?.id === user._id || material?.lecturer === user._id));
  const isAdminPreview = Boolean(user && (user.role === 'admin' || user.isAdmin) && material?.status && material.status !== 'approved');
  const isUnavailable = Boolean(material?.hidden || material?.visibility === 'private' || material?.status === 'rejected' || (material?.status === 'draft' && !isOwner));
  const detailHref = material?._id ? `/marketplace/${material._id}` : undefined;
  const rating = Number(material?.ratingAverage || 0);
  const reviewCount = Number(material?.ratingCount || 0);
  const salesCount = Number(material?.sales || material?.purchases || 0);
  const viewsCount = Number(material?.views || 0);
  const pages = Number(material?.pageCount || material?.previewPages || 0);
  const courseCode = material?.course?.code || material?.course?.title || 'General';
  const departmentName = material?.department?.name || 'General';
  const lecturerName = material?.lecturer?.name || 'Verified lecturer';
  const imageSrc = material?.coverImageUrl || '';

  useEffect(() => {
    setImageLoading(Boolean(imageSrc));
    setImageError(false);
  }, [imageSrc]);

  return (
    <article className="product-card">
      <div className="product-card__media">
        {imageSrc && !imageError ? (
          <img
            src={imageSrc}
            alt={title}
            loading="lazy"
            decoding="async"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageLoading(false);
              setImageError(true);
            }}
          />
        ) : (
          <div className="product-card__placeholder" style={{ background: `linear-gradient(135deg, ${fallbackCover.accentA}, ${fallbackCover.accentB})`, color: '#fff' }}>
            <span>{fallbackCover.label}</span>
            <small>{material?.materialType || 'Resource'}</small>
            <div className="product-card__placeholder-meta">
              <strong>{fallbackCover.title}</strong>
              <span>{fallbackCover.department}</span>
              <span>{fallbackCover.course}</span>
            </div>
          </div>
        )}
        {imageLoading && !imageError && <div className="product-card__skeleton" />}
        <div className="product-card__media-badges">
          {badges.map((badge) => (
            <span key={badge} className="product-card__badge">{badge}</span>
          ))}
        </div>
      </div>

      <div className="product-card__content">
        <div className="product-card__top-row">
          <span className="product-card__type">{material?.materialType || 'Resource'}</span>
          <PremiumBadge active={material?.isPremium || material?.isPaid || !isFree} />
        </div>

        <div>
          <h3>{wrapHighlight(title, searchTerm)}</h3>
          <p>{wrapHighlight(description, searchTerm)}</p>
        </div>

        <div className="product-card__meta-row product-card__meta-row--compact">
          <span>{material?.lecturer?.name || 'Verified lecturer'}</span>
          <span>{departmentName}</span>
          <span>{courseCode}</span>
        </div>

        <div className="product-card__meta-row product-card__meta-row--compact">
          {material?.level && <span>Level • {material.level}</span>}
          {material?.semester && <span>Sem • {material.semester}</span>}
          {material?.language && <span>Lang • {material.language}</span>}
        </div>

        <div className="product-card__rating-row">
          <div className="product-card__stars" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index}>{index < Math.round(rating) ? '★' : '☆'}</span>
            ))}
          </div>
          <span>{reviewCount ? `${reviewCount} reviews` : 'No reviews yet'}</span>
        </div>

        <div className="product-card__stats-row">
          <span>👁 {formatCount(viewsCount)}</span>
          <span>🛒 {formatCount(salesCount)}</span>
          <span>📄 {pages || '—'}</span>
        </div>

        {progressPercent !== undefined && (
          <div className="product-card__progress-row" aria-label={`Progress ${progressPercent}%`}>
            <div className="product-card__progress-track">
              <div className="product-card__progress-fill" style={{ width: `${Math.max(4, Math.min(100, Number(progressPercent) || 0))}%` }} />
            </div>
            <span>{Math.round(progressPercent)}% complete</span>
          </div>
        )}

        <div className="product-card__price-row">
          <PriceTag price={material?.price} isFree={isFree} discountedPrice={material?.discountedPrice} />
          {isFree && <span className="product-card__free-pill">FREE</span>}
        </div>

        <div className="product-card__state-row">
          {material?.status === 'pending' && <span className="product-card__status">Pending approval</span>}
          {material?.status === 'draft' && <span className="product-card__status">Draft</span>}
          {material?.status === 'rejected' && <span className="product-card__status">Rejected</span>}
          {isUnavailable && !isOwner && !isPurchased && <span className="product-card__status">Unavailable</span>}
          {isOwner && <span className="product-card__status">Your material</span>}
          {isAdminPreview && <span className="product-card__status">Admin preview</span>}
        </div>

        <div className="product-card__footer">
          <div className="product-card__actions">
            {showWishlist && onWishlistToggle && (
              <button type="button" className="product-card__button product-card__button--ghost" onClick={() => onWishlistToggle(material)}>
                {isWishlisted ? '★ Saved' : '☆ Save'}
              </button>
            )}
            {onPreview && (
              <button type="button" className="product-card__button product-card__button--ghost" onClick={() => onPreview(material)}>
                Preview
              </button>
            )}
            {onPurchase && !isPurchased && !isOwner && !isUnavailable && (
              <button type="button" className="product-card__button" onClick={() => onPurchase(material)}>
                {isFree ? 'Get now' : 'Buy now'}
              </button>
            )}
            {isPurchased && detailHref && (
              <Link className="product-card__button" to={detailHref}>
                Read now
              </Link>
            )}
            {isOwner && detailHref && (
              <Link className="product-card__button" to={detailHref}>
                Continue reading
              </Link>
            )}
            {!isPurchased && !isOwner && detailHref && !onPurchase && (
              <Link className="product-card__button" to={detailHref}>
                View details
              </Link>
            )}
          </div>
          {detailHref && (
            <Link className="product-card__link" to={detailHref}>
              Open
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export default memo(MaterialCard);
