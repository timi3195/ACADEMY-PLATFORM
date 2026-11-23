import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StudentAnalyticsView } from "./AnalyticsDashboard";

const renderView = (props) => renderToStaticMarkup(<StudentAnalyticsView {...props} />);

describe("StudentAnalyticsView", () => {
  it("shows a loading state", () => {
    expect(renderView({ loading: true })).toContain("Loading your examination analytics");
  });

  it("shows an empty state without fabricated academic data", () => {
    const markup = renderView({ loading: false, analytics: { overview: { totalCompletedAttempts: 0 } } });
    expect(markup).toContain("No completed examinations yet");
    expect(markup).not.toContain("0%");
  });

  it("renders actual overview, course, topic, and trend values", () => {
    const markup = renderView({
      loading: false,
      analytics: {
        overview: {
          totalCompletedAttempts: 2,
          overallAccuracy: 75,
          averageScorePercentage: 68,
          totalQuestionsAnswered: 8,
          totalCorrectAnswers: 6,
          totalIncorrectAnswers: 2,
          bestScorePercentage: 90,
          lowestScorePercentage: 45,
          mostRecentCompletedAt: "2025-02-01T12:00:00.000Z"
        },
        courses: [{
          courseId: "course-1",
          title: "Networking",
          code: "NET101",
          completedAttempts: 2,
          averageScorePercentage: 68,
          bestScorePercentage: 90,
          lowestScorePercentage: 45,
          accuracy: 75,
          questionsAnswered: 8,
          mostRecentCompletedAt: "2025-02-01T12:00:00.000Z",
          strongestTopics: [{ topic: "Routing" }],
          weakestTopics: []
        }],
        topics: [
          {
            courseId: "course-1",
            topic: "Routing",
            courseTitle: "Networking",
            classification: "Strong",
            accuracy: 90,
            correctAnswers: 9,
            questionsAnswered: 10
          },
          {
            courseId: "course-1",
            topic: "Subnetting",
            courseTitle: "Networking",
            classification: "Needs improvement",
            accuracy: 40,
            correctAnswers: 2,
            questionsAnswered: 5
          }
        ],
        performanceTrend: [{
          attemptId: "attempt-1",
          completedAt: "2025-02-01T12:00:00.000Z",
          accuracy: 75
        }],
        trend: { direction: "insufficient_data" },
        recommendations: [{
          courseId: "course-1",
          course: "Networking",
          topic: "Subnetting",
          reason: "Your results show 40% accuracy across 5 answered question(s).",
          evidence: { correctAnswers: 2, questionsAnswered: 5, accuracy: 40 },
          suggestedAction: "Review subnetting and practise related questions.",
          priority: "high"
        }]
      }
    });
    expect(markup).toContain("Total examinations");
    expect(markup).toContain("75%");
    expect(markup).toContain("Average score");
    expect(markup).toContain("Highest score");
    expect(markup).toContain("Lowest score");
    expect(markup).toContain("45%");
    expect(markup).toContain("Most recent completed examination");
    expect(markup).toContain("Networking (NET101)");
    expect(markup).toContain("Strong topics");
    expect(markup).toContain("Routing");
    expect(markup).toContain("Subnetting");
    expect(markup).not.toContain("Review subnetting and practise related questions.");
    expect(markup).toContain("Chronological completed practice-test score trend");
    expect(markup).toContain("student-analytics-performance-grid");
    expect(markup).toContain('aria-labelledby="student-analytics-recent-title"');
  });

  it("shows question types, readiness evidence, and provisional grades separately", () => {
    const markup = renderView({
      loading: false,
      analytics: {
        overview: {
          totalCompletedAttempts: 2,
          gradedAttemptCount: 1,
          totalQuestionsAttempted: 20,
          totalGradedQuestions: 10,
          averageScorePercentage: 70,
          bestScorePercentage: 70,
          attemptsLast30Days: 2,
          pendingGradingAttempts: 0,
          gradingAttempts: 0,
          failedGradingAttempts: 0,
          reviewRequiredAttempts: 1,
          unscoredHistoricalAttempts: 2
        },
        questionTypeBreakdown: [
          { questionType: "objective", questionsGraded: 10, questionsAnswered: 9, fullCreditQuestions: 7, accuracy: 70 },
          { questionType: "fill_in_gap", questionsGraded: 0, questionsAnswered: 0, fullCreditQuestions: 0, accuracy: null },
          { questionType: "theory", questionsGraded: 0, questionsAnswered: 0, fullCreditQuestions: 0, accuracy: null }
        ],
        readiness: {
          status: "insufficient_evidence",
          percentage: null,
          gradedAttempts: 1,
          gradedQuestions: 10,
          explanation: "A readiness percentage is withheld until there are enough fully graded attempts.",
          missingEvidence: ["3 fully graded practice attempts are required"],
          weakAreas: []
        },
        practiceFrequency: { attemptsLast30Days: 2 },
        recentPerformance: [],
        unfinalizedAttempts: [{
          attemptId: "review-attempt",
          course: "Networking",
          completedAt: "2025-02-01T12:00:00.000Z",
          status: "needs_review",
          provisionalScore: 4,
          provisionalMaxMarks: 6,
          provisionalPercentage: 66.7
        }],
        courses: [],
        topics: [],
        performanceTrend: [],
        trend: { direction: "insufficient_data" },
        recommendations: []
      }
    });

    expect(markup).toContain("Performance by question type");
    expect(markup).toContain("Fill-in-the-gap");
    expect(markup).toContain("Theory / essay");
    expect(markup).toContain("Not enough evidence for a readiness percentage");
    expect(markup).not.toContain("Practice evidence score:");
    expect(markup).toContain("Provisional: 4 / 6 (67%)");
    expect(markup).toContain("2 historical results unavailable");
    expect(markup).toContain("These attempts are excluded from final averages and readiness.");
  });

  it("shows API failures and offers retry", () => {
    const markup = renderView({
      loading: false,
      error: "Analytics API unavailable",
      onRetry: vi.fn()
    });
    expect(markup).toContain("Analytics API unavailable");
    expect(markup).toContain("Try again");
  });
});
