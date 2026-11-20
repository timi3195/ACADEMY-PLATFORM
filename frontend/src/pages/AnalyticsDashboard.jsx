import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentAnalytics } from "../services/studentAnalyticsService";
import { fetchStudentLearningRecommendations } from "../services/studentLearningService";
import { useAuth } from "../utils/auth";
import { cbtPathForCourse, isValidCbtQuestionCount } from "../utils/cbt";
import "./AnalyticsDashboard.css";

const formatPercent = (value) => Number.isFinite(value) ? `${Math.round(value)}%` : "Not enough data";
const isMongoId = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const questionTypeLabel = (value) => ({
  objective: "Objective",
  fill_in_gap: "Fill-in-the-gap",
  theory: "Theory / essay"
}[value] || value);

const formatDate = (value) => {
  if (!value) return "No completed examination";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString();
};

const TrendChart = ({ attempts }) => {
  const usable = attempts
    .map((attempt) => ({
      ...attempt,
      plottedScore: Number.isFinite(attempt.scorePercentage)
        ? attempt.scorePercentage
        : attempt.accuracy
    }))
    .filter((attempt) => Number.isFinite(attempt.plottedScore));
  if (!usable.length) {
    return <p className="student-analytics-muted">Complete examinations with answered questions to see a trend.</p>;
  }

  const width = 720;
  const height = 220;
  const inset = 24;
  const points = usable.map((attempt, index) => {
    const x = usable.length === 1
      ? width / 2
      : inset + (index / (usable.length - 1)) * (width - inset * 2);
    const y = height - inset - (attempt.plottedScore / 100) * (height - inset * 2);
    return { x, y, attempt };
  });
  const path = points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
  ).join(" ");

  return (
    <div className="student-analytics-chart-scroll">
      <svg
        className="student-analytics-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Chronological completed practice-test score trend"
      >
        {[0, 50, 100].map((value) => {
          const y = height - inset - (value / 100) * (height - inset * 2);
          return (
            <g key={value}>
              <line x1={inset} x2={width - inset} y1={y} y2={y} className="student-analytics-gridline" />
              <text x="0" y={y + 4} className="student-analytics-axis-label">{value}%</text>
            </g>
          );
        })}
        <path d={path} className="student-analytics-line" />
        {points.map(({ x, y, attempt }) => (
          <circle key={attempt.attemptId} cx={x} cy={y} r="5" className="student-analytics-point">
            <title>{`${formatDate(attempt.completedAt)}: ${formatPercent(attempt.plottedScore)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="student-analytics-chart-dates">
        <span>{formatDate(usable[0].completedAt)}</span>
        {usable.length > 1 && <span>{formatDate(usable[usable.length - 1].completedAt)}</span>}
      </div>
    </div>
  );
};

export function recommendationDestination(candidate) {
  const action = candidate?.action || {};
  const courseId = candidate?.course?.courseId;
  if (!isMongoId(courseId)) return null;

  if (["study_material", "revisit_material"].includes(action.type) &&
      isMongoId(action.materialId)) {
    return {
      to: `/courses/${courseId}/materials?materialId=${encodeURIComponent(action.materialId)}`,
      label: action.type === "revisit_material" ? "Revisit material" : "Open material"
    };
  }

  if (action.type === "start_practice_test" &&
      isValidCbtQuestionCount(action.questionCount) &&
      Array.isArray(candidate.evidence?.supportedTestSizes) &&
      candidate.evidence.supportedTestSizes.includes(action.questionCount)) {
    return {
      to: cbtPathForCourse(courseId, action.questionCount),
      label: `Start ${action.questionCount}-question practice test`
    };
  }

  if (action.type === "continue_practising_topic") {
    return { to: `/courses/${courseId}`, label: "Open course" };
  }

  return null;
}

const recommendationTitle = (candidate) => {
  const action = candidate?.action || {};
  if (action.title) return action.title;
  if (action.type === "start_practice_test" && Number.isInteger(action.questionCount)) {
    return `${action.questionCount}-question practice test`;
  }
  return candidate?.evidence?.topic || action.topic || candidate?.course?.title || "Study recommendation";
};

const recommendationActionText = (candidate) => {
  const action = candidate?.action || {};
  if (action.type === "study_material") return "Study this course material.";
  if (action.type === "revisit_material") return "Revisit this course material.";
  if (action.type === "start_practice_test" && Number.isInteger(action.questionCount)) {
    return `Take a ${action.questionCount}-question practice test.`;
  }
  if (action.type === "continue_practising_topic") {
    return `Continue practising ${action.topic || candidate?.evidence?.topic || "this topic"}.`;
  }
  return "";
};

const recommendationEvidenceLabel = (candidate) => {
  const category = candidate?.evidence?.category;
  if (candidate?.evidence?.sufficiency === "insufficient" ||
      ["insufficient_cbt_evidence", "insufficient_topic_evidence"].includes(category)) {
    return "General study guidance · Not enough verified performance evidence";
  }
  if (["verified_topic_performance", "verified_topic_improvement"].includes(category)) {
    return "Based on verified CBT performance";
  }
  if (category === "practice_coverage") return "Eligible practice-test coverage";
  return "Based on available course learning options";
};

export function StudentLearningRecommendationsView({
  recommendations = [],
  loading = false,
  error = false,
  onRefresh = () => {}
}) {
  const candidates = Array.isArray(recommendations) ? recommendations : [];
  const materialCandidates = candidates.filter((candidate) =>
    ["study_material", "revisit_material"].includes(candidate?.action?.type)
  );
  const practiceCandidates = candidates.filter((candidate) =>
    candidate?.action?.type === "start_practice_test"
  );

  return (
    <section
      className="topics-section student-analytics-section student-learning-recommendations"
      aria-labelledby="student-learning-recommendations-title"
    >
      <div className="student-learning-recommendations-heading">
        <div>
          <h2 id="student-learning-recommendations-title">Your Personalized Study Recommendations</h2>
          <p className="student-analytics-muted">
            Suggested next steps from your accessible course materials and learning evidence.
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing…" : error ? "Try again" : "Refresh"}
        </button>
      </div>

      {loading && (
        <p className="student-analytics-muted" role="status">Loading your study recommendations…</p>
      )}
      {error && (
        <p className="student-learning-recommendations-error" role="alert">
          We couldn’t load your recommendations. Please try again.
        </p>
      )}
      {!loading && !error && candidates.length === 0 && (
        <div className="student-analytics-state">
          <p>No study actions are available right now.</p>
          <Link to="/courses">Browse your courses</Link>
        </div>
      )}
      {!loading && !error && candidates.length > 0 && (
        <>
          {!materialCandidates.length && (
            <p className="student-analytics-muted">No accessible material is included in these recommendations right now.</p>
          )}
          {!practiceCandidates.length && (
            <p className="student-analytics-muted">No eligible practice-test action is available in this recommendation list right now.</p>
          )}
          {materialCandidates.length > 0 && (
            <p className="student-analytics-disclaimer">
              Material completion is self-reported and does not prove mastery.
            </p>
          )}
          <div className="student-analytics-recommendations">
            {candidates.map((candidate, index) => {
              const action = candidate?.action || {};
              const destination = recommendationDestination(candidate);
              const course = candidate?.course;
              const topic = candidate?.evidence?.topic || action.topic;
              const materialTitle = action.title;
              const actionText = recommendationActionText(candidate);
              return (
                <article
                  className="student-analytics-recommendation"
                  key={candidate?.candidateId || `${course?.courseId || "course"}-${index}`}
                >
                  <div className="student-learning-recommendation-content">
                    <h3>{recommendationTitle(candidate)}</h3>
                    {course?.title && (
                      <p className="student-analytics-muted">
                        {course.title}{course.code ? ` (${course.code})` : ""}
                      </p>
                    )}
                    {topic && <p><strong>Topic:</strong> {topic}</p>}
                    {materialTitle && (
                      <p><strong>Relevant material:</strong> {materialTitle}</p>
                    )}
                    {candidate?.reason && <p>{candidate.reason}</p>}
                    {!candidate?.reason && candidate?.prioritizationExplanation && (
                      <p>{candidate.prioritizationExplanation}</p>
                    )}
                    <p className="student-learning-evidence-label">
                      {recommendationEvidenceLabel(candidate)}
                    </p>
                    {actionText && <p><strong>Suggested action:</strong> {actionText}</p>}
                  </div>
                  {destination && (
                    <Link className="student-learning-recommendation-action" to={destination.to}>
                      {destination.label}
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function StudentAnalyticsView({
  analytics,
  loading,
  error,
  onRetry,
  recommendations,
  recommendationsLoading,
  recommendationsError,
  onRefreshRecommendations,
  showRecommendations = false
}) {
  const recommendationPanel = showRecommendations ? (
    <StudentLearningRecommendationsView
      recommendations={recommendations}
      loading={recommendationsLoading}
      error={recommendationsError}
      onRefresh={onRefreshRecommendations}
    />
  ) : null;
  if (loading) {
    return (
      <div className="analytics-dashboard student-analytics">
        {recommendationPanel}
        <div className="student-analytics-state" role="status">Loading your examination analytics…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="analytics-dashboard student-analytics">
        {recommendationPanel}
        <div className="student-analytics-state student-analytics-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      </div>
    );
  }
  if (!analytics?.overview) {
    return (
      <div className="analytics-dashboard student-analytics">
        {recommendationPanel}
        <div className="student-analytics-state student-analytics-error" role="alert">
          Performance analytics are unavailable because the response did not contain a valid overview.
        </div>
      </div>
    );
  }

  const overview = analytics.overview;
  const courses = Array.isArray(analytics?.courses) ? analytics.courses : [];
  const topics = Array.isArray(analytics?.topics) ? analytics.topics : [];
  const attempts = Array.isArray(analytics?.performanceTrend) ? analytics.performanceTrend : [];
  const recentAttempts = Array.isArray(analytics?.recentPerformance) ? analytics.recentPerformance : [];
  const unfinalizedAttempts = Array.isArray(analytics?.unfinalizedAttempts)
    ? analytics.unfinalizedAttempts
    : [];
  const typeBreakdown = Array.isArray(analytics?.questionTypeBreakdown)
    ? analytics.questionTypeBreakdown
    : [];
  const hasAttempts = overview.totalCompletedAttempts > 0;
  const strongest = topics.filter((topic) => topic.classification === "Strong");
  const needsWork = topics.filter((topic) => topic.classification === "Needs improvement");
  const insufficient = topics.filter((topic) => topic.classification === "Insufficient data");
  const hasUnfinalizedResults = unfinalizedAttempts.length > 0 ||
    (overview.pendingGradingAttempts || 0) > 0 ||
    (overview.gradingAttempts || 0) > 0 ||
    (overview.failedGradingAttempts || 0) > 0 ||
    (overview.reviewRequiredAttempts || 0) > 0 ||
    (overview.unscoredHistoricalAttempts || 0) > 0 ||
    (overview.unverifiedGradingAttempts || 0) > 0;

  return (
    <div className="analytics-dashboard student-analytics">
      <header className="analytics-header">
        <h1>Your examination performance</h1>
        <p>These results come from your completed CBT attempts. Accuracy and examination score are reported separately.</p>
      </header>

      {recommendationPanel}

      {!hasAttempts ? (
        <section className="student-analytics-state" aria-labelledby="analytics-empty-title">
          <h2 id="analytics-empty-title">No completed examinations yet</h2>
          <p>Once you complete a CBT examination, your verified results and study recommendations will appear here.</p>
        </section>
      ) : (
        <>
          <section className="student-analytics-summary" aria-label="Performance overview">
            <article className="student-analytics-card">
              <span>Completed practice tests</span>
              <strong>{overview.totalCompletedAttempts}</strong>
            </article>
            <article className="student-analytics-card">
              <span>Average score</span>
              <strong>{formatPercent(overview.averageScorePercentage)}</strong>
              <small>Fully graded attempts only</small>
            </article>
            <article className="student-analytics-card">
              <span>Best score</span>
              <strong>{formatPercent(overview.bestScorePercentage)}</strong>
              <small>Fully graded attempts only</small>
            </article>
            <article className="student-analytics-card">
              <span>Questions attempted</span>
              <strong>{overview.totalQuestionsAttempted ?? 0}</strong>
              <small>{overview.totalGradedQuestions ?? 0} included in final results</small>
            </article>
            <article className="student-analytics-card">
              <span>Full-credit accuracy</span>
              <strong>{formatPercent(overview.overallAccuracy)}</strong>
              <small>Fully graded questions only</small>
            </article>
            <article className="student-analytics-card">
              <span>Practice frequency</span>
              <strong>{analytics.practiceFrequency?.attemptsLast30Days ?? 0}</strong>
              <small>Completed tests in the last 30 days</small>
            </article>
          </section>
          <p className="student-analytics-muted">
            Most recent completed examination: {formatDate(overview.mostRecentCompletedAt)}
          </p>

          <section className="topics-section student-analytics-section" aria-label="Readiness evidence">
            <h2>Practice readiness evidence</h2>
            <p className="student-analytics-muted">{analytics.readiness?.explanation}</p>
            {analytics.readiness?.status === "sufficient_evidence" ? (
              <p className="student-analytics-readiness">
                Practice evidence score: <strong>{formatPercent(analytics.readiness.percentage)}</strong>
              </p>
            ) : (
              <p className="student-analytics-readiness">
                Not enough evidence for a readiness percentage.
              </p>
            )}
            <p>
              Evidence: {analytics.readiness?.gradedAttempts ?? 0} fully graded attempt(s),{" "}
              {analytics.readiness?.gradedQuestions ?? 0} graded question(s).
            </p>
            {analytics.readiness?.missingEvidence?.length > 0 && (
              <ul>
                {analytics.readiness.missingEvidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            {analytics.readiness?.weakAreas?.length > 0 && (
              <div>
                <strong>Areas to focus on:</strong>
                <ul>
                  {analytics.readiness.weakAreas.map((area) => (
                    <li key={`${area.kind}-${area.courseId || area.questionType}-${area.topic || ""}`}>
                      {area.topic
                        ? `${area.topic}${area.course ? ` (${area.course})` : ""}`
                        : questionTypeLabel(area.questionType)}
                      {Number.isFinite(area.accuracy) ? ` — ${formatPercent(area.accuracy)}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {hasUnfinalizedResults && (
            <section className="topics-section student-analytics-section" aria-label="Provisional and ungraded results">
              <h2>Provisional and ungraded results</h2>
              <p className="student-analytics-muted">
                {overview.pendingGradingAttempts || 0} pending · {overview.gradingAttempts || 0} grading ·{" "}
                {overview.failedGradingAttempts || 0} failed · {overview.reviewRequiredAttempts || 0} review required ·{" "}
                {overview.unscoredHistoricalAttempts || 0} historical results unavailable ·{" "}
                {overview.unverifiedGradingAttempts || 0} unverified grading results.
                {" "}These attempts are excluded from final averages and readiness.
              </p>
              <ul className="student-analytics-unfinalized">
                {unfinalizedAttempts.map((attempt) => (
                  <li key={String(attempt.attemptId)}>
                    <span>{attempt.course} · {formatDate(attempt.completedAt)} · {attempt.status.replaceAll("_", " ")}</span>
                    {Number.isFinite(attempt.provisionalScore) &&
                      Number.isFinite(attempt.provisionalMaxMarks) && (
                        <strong>
                          Provisional: {attempt.provisionalScore} / {attempt.provisionalMaxMarks}
                          {Number.isFinite(attempt.provisionalPercentage)
                            ? ` (${formatPercent(attempt.provisionalPercentage)})`
                            : ""}
                        </strong>
                      )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="topics-section student-analytics-section">
            <h2>Performance over time</h2>
            <p className="student-analytics-muted">
              Trend: {analytics.trend?.direction === "insufficient_data"
                ? "Not enough completed attempts to determine a trend."
                : analytics.trend?.direction || "Not available"}
            </p>
            <TrendChart attempts={attempts} />
            <h3>Recent performance</h3>
            {recentAttempts.length ? (
              <ul className="student-analytics-recent">
                {recentAttempts.map((attempt) => (
                  <li key={String(attempt.attemptId)}>
                    <span>{formatDate(attempt.completedAt)}</span>
                    <strong>{formatPercent(attempt.scorePercentage)}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="student-analytics-muted">No fully graded attempts are available for a recent-performance summary.</p>}
          </section>

          <section className="topics-section student-analytics-section">
            <h2>Performance by question type</h2>
            <div className="student-analytics-type-grid">
              {typeBreakdown.map((item) => (
                <article className="student-analytics-type" key={item.questionType}>
                  <h3>{questionTypeLabel(item.questionType)}</h3>
                  <p><strong>{formatPercent(item.accuracy)}</strong> of available marks</p>
                  <small>
                    {item.questionsGraded} graded · {item.questionsAnswered} answered ·{" "}
                    {item.fullCreditQuestions} full-credit question(s)
                  </small>
                </article>
              ))}
            </div>
          </section>

          <section className="topics-section student-analytics-section">
            <h2>Course performance</h2>
            {courses.length ? (
              <div className="student-analytics-course-grid">
                {courses.map((course) => (
                  <article className="student-analytics-course" key={String(course.courseId)}>
                    <h3>{course.title}{course.code ? ` (${course.code})` : ""}</h3>
                    <dl>
                      <div><dt>Completed attempts</dt><dd>{course.completedAttempts}</dd></div>
                      <div><dt>Fully graded attempts</dt><dd>{course.gradedAttempts}</dd></div>
                      <div><dt>Average score</dt><dd>{formatPercent(course.averageScorePercentage)}</dd></div>
                      <div>
                        <dt>Score trend</dt>
                        <dd>
                          {course.trend?.direction || "Not available"}
                          {Number.isFinite(course.trend?.changePercentagePoints)
                            ? ` (${course.trend.changePercentagePoints > 0 ? "+" : ""}${course.trend.changePercentagePoints} points)`
                            : ""}
                        </dd>
                      </div>
                      <div><dt>Questions attempted</dt><dd>{course.totalQuestions}</dd></div>
                      <div><dt>Most recent examination</dt><dd>{formatDate(course.mostRecentCompletedAt)}</dd></div>
                    </dl>
                    <h4>Question-type breakdown</h4>
                    <ul className="student-analytics-course-types">
                      {(course.questionTypeBreakdown || [])
                        .filter((item) => item.questionsGraded > 0)
                        .map((item) => (
                          <li key={item.questionType}>
                            {questionTypeLabel(item.questionType)}: {formatPercent(item.accuracy)}
                          </li>
                        ))}
                    </ul>
                    {course.strongestTopics?.length > 0 && (
                      <p><strong>Strongest topics:</strong> {course.strongestTopics.map((topic) => topic.topic).join(", ")}</p>
                    )}
                    {course.weakestTopics?.length > 0 && (
                      <p><strong>Needs attention:</strong> {course.weakestTopics.map((topic) => topic.topic).join(", ")}</p>
                    )}
                  </article>
                ))}
              </div>
            ) : <p className="student-analytics-muted">Course information is not available for these attempts.</p>}
          </section>

          <section className="topics-section student-analytics-section">
            <h2>Topic strengths and areas to improve</h2>
            <p className="student-analytics-muted">Topic classifications require at least {analytics.topicThresholds?.minimumAnsweredQuestions ?? 3} answered questions.</p>
            <div className="student-analytics-topic-groups">
              <TopicGroup title="Strong topics" topics={strongest} />
              <TopicGroup title="Needs improvement" topics={needsWork} />
              <TopicGroup title="Not enough evidence yet" topics={insufficient} />
            </div>
            {analytics.overview?.unclassifiedAnsweredQuestions > 0 && (
              <p className="student-analytics-muted">
                {analytics.overview.unclassifiedAnsweredQuestions} answered question(s) have no reliable topic metadata and are excluded from topic recommendations.
              </p>
            )}
            {!topics.length && <p className="student-analytics-muted">No reliable topic information is available in your completed examinations.</p>}
          </section>

        </>
      )}
    </div>
  );
}

function TopicGroup({ title, topics }) {
  return (
    <section className="student-analytics-topic-group">
      <h3>{title}</h3>
      {topics.length ? (
        <ul>
          {topics.map((topic) => (
            <li key={`${topic.courseId}-${topic.topic}`}>
              <span>{topic.topic} <small>· {topic.courseTitle}</small></span>
              <strong>{formatPercent(topic.accuracy)}</strong>
              <small>{topic.marksAwarded}/{topic.maxMarks} marks · trend {topic.trend?.direction || "not available"}</small>
            </li>
          ))}
        </ul>
      ) : <p className="student-analytics-muted">No topics in this group.</p>}
    </section>
  );
}

function AnalyticsDashboardContent() {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [recommendationsError, setRecommendationsError] = useState(false);
  const [recommendationsRetryCount, setRecommendationsRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchStudentAnalytics(user?._id || user?.id)
      .then((response) => {
        if (active) {
          if (response?.analytics?.overview) setAnalytics(response.analytics);
          else setError("The analytics service returned incomplete performance data.");
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Unable to load examination analytics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [retryCount]);

  useEffect(() => {
    let active = true;
    if (user?.role?.toLowerCase() !== "student") {
      setRecommendations([]);
      setRecommendationsLoading(false);
      setRecommendationsError(false);
      return () => { active = false; };
    }

    setRecommendationsLoading(true);
    setRecommendationsError(false);
    fetchStudentLearningRecommendations()
      .then(({ candidates }) => {
        if (active) setRecommendations(candidates);
      })
      .catch(() => {
        if (active) {
          setRecommendations([]);
          setRecommendationsError(true);
        }
      })
      .finally(() => {
        if (active) setRecommendationsLoading(false);
      });
    return () => { active = false; };
  }, [recommendationsRetryCount, user?.role]);

  return (
    <StudentAnalyticsView
      analytics={analytics}
      loading={loading}
      error={error}
      onRetry={() => setRetryCount((count) => count + 1)}
      recommendations={recommendations}
      recommendationsLoading={recommendationsLoading}
      recommendationsError={recommendationsError}
      onRefreshRecommendations={() => setRecommendationsRetryCount((count) => count + 1)}
      showRecommendations={user?.role?.toLowerCase() === "student"}
    />
  );
}

export default function AnalyticsDashboard() {
  return <AnalyticsDashboardContent />;
}
