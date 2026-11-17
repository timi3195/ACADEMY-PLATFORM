import React, { memo } from 'react';
import { Link } from 'react-router-dom';

function MaterialCard({ material }) {
  const courseId = material?.courseRef?._id || material?.courseRef;
  return (
    <article className="academic-material-card">
      <div className="academic-material-card__body">
        <span className="academic-material-card__type">{material?.materialType || 'Course material'}</span>
        <h3>{material?.title || 'Untitled material'}</h3>
        <p>{material?.description || 'Academic learning resource'}</p>
        <div className="academic-material-card__meta">
          <span>{material?.courseCode || material?.course || 'Assigned course'}</span>
          <span>{material?.status === 'draft' ? 'Draft' : 'Published'}</span>
        </div>
      </div>
      {courseId && (
        <Link className="academic-material-card__link" to={`/courses/${courseId}/materials`}>
          Open course materials
        </Link>
      )}
    </article>
  );
}

export default memo(MaterialCard);
