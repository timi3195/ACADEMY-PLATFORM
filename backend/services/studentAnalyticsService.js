const mongoose = require("mongoose");
const crypto = require("crypto");
const QuizSession = require("../models/QuizSession");
const Course = require("../models/course");
const gemini = require("../utils/gemini");
const { legacyVerificationExpressions } = require("../utils/legacyQuizResult");

const TOPIC_THRESHOLDS = Object.freeze({
  strong: 80,
  developing: 60,
  minimumAnsweredQuestions: 3
});
const READINESS_THRESHOLDS = Object.freeze({
  minimumGradedAttempts: 3,
  minimumGradedQuestions: 30,
  minimumQuestionsPerType: 3
});
const TREND_MINIMUM_ATTEMPTS = 4;
const TREND_CHANGE_THRESHOLD = 5;
const MAX_TREND_ATTEMPTS = 50;
const MAX_PROVISIONAL_ATTEMPTS = 10;
const RECOMMENDATION_CACHE_TTL_MS = 10 * 60 * 1000;
const RECOMMENDATION_CACHE_LIMIT = 500;
const recommendationCache = new Map();
const recommendationRequests = new Map();

const typedCriteriaAreValid = (
  path,
  awardedMarks = "$$typedQuestion.gradingResult.awardedMarks",
  maxMarks = "$$typedQuestion.gradingResult.maxMarks"
) => {
  const safePath = { $cond: [{ $isArray: path }, path, []] };
  return {
    $and: [
      { $isArray: path },
      { $gt: [{ $size: safePath }, 0] },
      {
        $allElementsTrue: [{
          $map: {
            input: safePath,
            as: "typedMark",
            in: {
              $and: [
                { $isNumber: "$$typedMark.awardedMarks" },
                { $isNumber: "$$typedMark.maxMarks" },
                { $gt: ["$$typedMark.maxMarks", 0] },
                { $gte: ["$$typedMark.awardedMarks", 0] },
                { $lte: ["$$typedMark.awardedMarks", "$$typedMark.maxMarks"] }
              ]
            }
          }
        }]
      },
      {
        $eq: [
          awardedMarks,
          {
            $round: [{
              $sum: {
                $map: {
                  input: safePath,
                  as: "typedMark",
                  in: "$$typedMark.awardedMarks"
                }
              }
            }, 2]
          }
        ]
      },
      {
        $eq: [
          maxMarks,
          {
            $round: [{
              $sum: {
                $map: {
                  input: safePath,
                  as: "typedMark",
                  in: "$$typedMark.maxMarks"
                }
              }
            }, 2]
          }
        ]
      }
    ]
  };
};

const typedCriteriaFillBlanksAreValid = (() => {
  const blanks = "$$typedQuestion.gradingResult.blanks";
  const safeBlanks = { $cond: [{ $isArray: blanks }, blanks, []] };
  return {
    $and: [
      { $isArray: blanks },
      { $eq: [{ $size: safeBlanks }, "$$typedQuestion.blankCount"] },
      {
        $allElementsTrue: [{
          $map: {
            input: safeBlanks,
            as: "typedBlank",
            in: {
              $and: [
                { $eq: ["$$typedBlank.status", "graded"] },
                { $isNumber: "$$typedBlank.awardedMarks" },
                { $isNumber: "$$typedBlank.maxMarks" },
                { $gt: ["$$typedBlank.maxMarks", 0] },
                { $gte: ["$$typedBlank.awardedMarks", 0] },
                { $lte: ["$$typedBlank.awardedMarks", "$$typedBlank.maxMarks"] },
                typedCriteriaAreValid(
                  "$$typedBlank.criteria",
                  "$$typedBlank.awardedMarks",
                  "$$typedBlank.maxMarks"
                )
              ]
            }
          }
        }]
      },
      {
        $eq: [
          "$$typedQuestion.gradingResult.awardedMarks",
          {
            $round: [{
              $sum: {
                $map: {
                  input: safeBlanks,
                  as: "typedBlank",
                  in: "$$typedBlank.awardedMarks"
                }
              }
            }, 2]
          }
        ]
      },
      {
        $eq: [
          "$$typedQuestion.gradingResult.maxMarks",
          {
            $round: [{
              $sum: {
                $map: {
                  input: safeBlanks,
                  as: "typedBlank",
                  in: "$$typedBlank.maxMarks"
                }
              }
            }, 2]
          }
        ]
      }
    ]
  };
})();

const typedStringValue = (value) => ({
  $cond: [{ $eq: [{ $type: value }, "string"] }, value, ""]
});
const typedIsString = (value) => ({ $eq: [{ $type: value }, "string"] });
const typedIsAsciiString = (value) => ({
  $and: [
    typedIsString(value),
    {
      $eq: [
        { $strLenBytes: typedStringValue(value) },
        { $strLenCP: typedStringValue(value) }
      ]
    }
  ]
});
const normalizeTypedAsciiAnswer = (value) => ({
  $regexReplace: {
    input: { $trim: { input: { $toLower: typedStringValue(value) } } },
    regex: "\\s+",
    replacement: " "
  }
});
const typedAdminAnswersMatch = (left, right) => ({
  $or: [
    {
      $and: [
        typedIsString(left),
        typedIsString(right),
        { $eq: [left, right] }
      ]
    },
    {
      $and: [
        typedIsAsciiString(left),
        typedIsAsciiString(right),
        {
          $eq: [
            normalizeTypedAsciiAnswer(left),
            normalizeTypedAsciiAnswer(right)
          ]
        }
      ]
    }
  ]
});

const typedAdminFillBlanksAreValid = (() => {
  const snapshotBlanks = "$$typedQuestion.markingSnapshot.fillInGap.blanks";
  const resultBlanks = "$$typedQuestion.gradingResult.blanks";
  const selectedAnswers = "$$typedQuestion.selectedAnswers";
  const safeSnapshotBlanks = { $cond: [{ $isArray: snapshotBlanks }, snapshotBlanks, []] };
  const safeResultBlanks = { $cond: [{ $isArray: resultBlanks }, resultBlanks, []] };
  const safeSelectedAnswers = { $cond: [{ $isArray: selectedAnswers }, selectedAnswers, []] };
  const blankCount = "$$typedQuestion.blankCount";

  const exactlyOneSnapshotForResultBlank = {
    $allElementsTrue: [{
      $map: {
        input: safeResultBlanks,
        as: "typedBlank",
        in: {
          $eq: [{
            $size: {
              $filter: {
                input: safeSnapshotBlanks,
                as: "adminBlank",
                cond: { $eq: ["$$adminBlank.blankNumber", "$$typedBlank.blankNumber"] }
              }
            }
          }, 1]
        }
      }
    }]
  };

  return {
    $and: [
      { $eq: ["$$typedQuestion.markingSnapshot.markingSource", "admin_authored"] },
      { $isNumber: blankCount },
      {
        $eq: [
          { $cond: [{ $isNumber: blankCount }, { $trunc: blankCount }, null] },
          blankCount
        ]
      },
      { $gt: [blankCount, 0] },
      { $isArray: snapshotBlanks },
      { $isArray: resultBlanks },
      { $isArray: selectedAnswers },
      { $eq: [{ $size: safeSnapshotBlanks }, blankCount] },
      { $eq: [{ $size: safeResultBlanks }, blankCount] },
      { $eq: [{ $size: safeSelectedAnswers }, blankCount] },
      { $isNumber: "$$typedQuestion.markingSnapshot.fillInGap.totalMarks" },
      {
        $lte: [{
          $abs: {
            $subtract: [
              {
                $cond: [
                  { $isNumber: "$$typedQuestion.markingSnapshot.fillInGap.totalMarks" },
                  "$$typedQuestion.markingSnapshot.fillInGap.totalMarks",
                  0
                ]
              },
              {
                $cond: [
                  { $isNumber: "$$typedQuestion.marks" },
                  "$$typedQuestion.marks",
                  0
                ]
              }
            ]
          }
        }, 0.01]
      },
      {
        $eq: [
          {
            $round: [{
              $sum: {
                $map: {
                  input: safeSnapshotBlanks,
                  as: "adminBlank",
                  in: {
                    $cond: [
                      { $isNumber: "$$adminBlank.marks" },
                      "$$adminBlank.marks",
                      0
                    ]
                  }
                }
              }
            }, 2]
          },
          { $round: ["$$typedQuestion.marks", 2] }
        ]
      },
      {
        $allElementsTrue: [{
          $map: {
            input: safeSnapshotBlanks,
            as: "adminBlank",
            in: {
              $let: {
                vars: {
                  resultMatches: {
                    $filter: {
                      input: safeResultBlanks,
                      as: "typedBlank",
                      cond: { $eq: ["$$typedBlank.blankNumber", "$$adminBlank.blankNumber"] }
                    }
                  },
                  safeAcceptedAnswers: {
                    $cond: [
                      { $isArray: "$$adminBlank.acceptableAnswers" },
                      "$$adminBlank.acceptableAnswers",
                      []
                    ]
                  },
                  savedAnswer: {
                    $arrayElemAt: [
                      safeSelectedAnswers,
                      {
                        $cond: [
                          { $isNumber: "$$adminBlank.blankNumber" },
                          {
                            $cond: [
                              {
                                $eq: [
                                  { $trunc: "$$adminBlank.blankNumber" },
                                  "$$adminBlank.blankNumber"
                                ]
                              },
                              { $subtract: ["$$adminBlank.blankNumber", 1] },
                              -1
                            ]
                          },
                          -1
                        ]
                      }
                    ]
                  }
                },
                in: {
                  $and: [
                    { $isNumber: "$$adminBlank.blankNumber" },
                    {
                      $eq: [
                        {
                          $cond: [
                            { $isNumber: "$$adminBlank.blankNumber" },
                            { $trunc: "$$adminBlank.blankNumber" },
                            null
                          ]
                        },
                        "$$adminBlank.blankNumber"
                      ]
                    },
                    { $gte: ["$$adminBlank.blankNumber", 1] },
                    { $lte: ["$$adminBlank.blankNumber", blankCount] },
                    { $isNumber: "$$adminBlank.marks" },
                    { $gt: ["$$adminBlank.marks", 0] },
                    { $isArray: "$$adminBlank.acceptableAnswers" },
                    { $gt: [{ $size: "$$safeAcceptedAnswers" }, 0] },
                    typedIsString("$$adminBlank.expectedAnswer"),
                    { $eq: [{ $size: "$$resultMatches" }, 1] },
                    {
                      $allElementsTrue: [{
                        $map: {
                          input: "$$safeAcceptedAnswers",
                          as: "acceptedAnswer",
                          in: typedIsString("$$acceptedAnswer")
                        }
                      }]
                    },
                    {
                      $anyElementTrue: [{
                        $map: {
                          input: "$$safeAcceptedAnswers",
                          as: "acceptedAnswer",
                          in: typedAdminAnswersMatch(
                            "$$acceptedAnswer",
                            "$$adminBlank.expectedAnswer"
                          )
                        }
                      }]
                    },
                    {
                      $let: {
                        vars: { resultBlank: { $arrayElemAt: ["$$resultMatches", 0] } },
                        in: {
                          $and: [
                            { $eq: ["$$resultBlank.status", "graded"] },
                            { $eq: ["$$resultBlank.maxMarks", "$$adminBlank.marks"] },
                            { $eq: ["$$resultBlank.response", "$$savedAnswer"] },
                            { $isArray: "$$resultBlank.criteria" },
                            { $eq: [{ $size: "$$resultBlank.criteria" }, 0] },
                            {
                              $eq: [
                                "$$resultBlank.awardedMarks",
                                {
                                  $cond: [
                                    {
                                      $anyElementTrue: [{
                                        $map: {
                                          input: "$$safeAcceptedAnswers",
                                          as: "acceptedAnswer",
                                          in: typedAdminAnswersMatch(
                                            "$$acceptedAnswer",
                                            "$$savedAnswer"
                                          )
                                        }
                                      }]
                                    },
                                    "$$adminBlank.marks",
                                    0
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        }]
      },
      exactlyOneSnapshotForResultBlank,
      {
        $allElementsTrue: [{
          $map: {
            input: safeSnapshotBlanks,
            as: "adminBlank",
            in: {
              $eq: [{
                $size: {
                  $filter: {
                    input: safeResultBlanks,
                    as: "typedBlank",
                    cond: { $eq: ["$$typedBlank.blankNumber", "$$adminBlank.blankNumber"] }
                  }
                }
              }, 1]
            }
          }
        }]
      }
    ]
  };
})();

const typedFillBlanksAreValid = {
  $cond: [
    { $eq: ["$$typedQuestion.markingSnapshot.markingSource", "admin_authored"] },
    typedAdminFillBlanksAreValid,
    typedCriteriaFillBlanksAreValid
  ]
};

const typedQuestionIsValid = {
  $and: [
    { $ne: ["$$typedQuestion.questionId", null] },
    {
      $in: [
        { $ifNull: ["$$typedQuestion.questionType", "objective"] },
        ["objective", "fill_in_gap", "theory"]
      ]
    },
    { $eq: ["$$typedQuestion.gradingResult.status", "graded"] },
    { $isNumber: "$$typedQuestion.marks" },
    { $isNumber: "$$typedQuestion.gradingResult.awardedMarks" },
    { $isNumber: "$$typedQuestion.gradingResult.maxMarks" },
    { $gt: ["$$typedQuestion.gradingResult.maxMarks", 0] },
    { $gte: ["$$typedQuestion.gradingResult.awardedMarks", 0] },
    {
      $lte: [
        "$$typedQuestion.gradingResult.awardedMarks",
        "$$typedQuestion.gradingResult.maxMarks"
      ]
    },
    { $eq: ["$$typedQuestion.marks", "$$typedQuestion.gradingResult.maxMarks"] },
    {
      $switch: {
        branches: [
          {
            case: {
              $eq: [
                { $ifNull: ["$$typedQuestion.questionType", "objective"] },
                "objective"
              ]
            },
            then: {
              $and: [
                { $eq: [{ $type: "$$typedQuestion.gradingResult.isCorrect" }, "bool"] },
                {
                  $eq: [
                    "$$typedQuestion.gradingResult.awardedMarks",
                    {
                      $cond: [
                        "$$typedQuestion.gradingResult.isCorrect",
                        "$$typedQuestion.gradingResult.maxMarks",
                        0
                      ]
                    }
                  ]
                }
              ]
            }
          },
          {
            case: { $eq: ["$$typedQuestion.questionType", "fill_in_gap"] },
            then: typedFillBlanksAreValid
          },
          {
            case: { $eq: ["$$typedQuestion.questionType", "theory"] },
            then: typedCriteriaAreValid("$$typedQuestion.gradingResult.criteria")
          }
        ],
        default: false
      }
    }
  ]
};

const typedGradingExpressions = {
  hasValidQuestionResults: {
    $and: [
      { $gt: [{ $size: "$questions" }, 0] },
      {
        $allElementsTrue: [{
          $map: {
            input: "$questions",
            as: "typedQuestion",
            in: typedQuestionIsValid
          }
        }]
      }
    ]
  },
  score: {
    $sum: {
      $map: {
        input: "$questions",
        as: "typedQuestion",
        in: {
          $cond: [
            { $isNumber: "$$typedQuestion.gradingResult.awardedMarks" },
            "$$typedQuestion.gradingResult.awardedMarks",
            0
          ]
        }
      }
    }
  },
  totalMarks: {
    $sum: {
      $map: {
        input: "$questions",
        as: "typedQuestion",
        in: {
          $cond: [
            { $isNumber: "$$typedQuestion.gradingResult.maxMarks" },
            "$$typedQuestion.gradingResult.maxMarks",
            0
          ]
        }
      }
    }
  }
};

const createAttemptSummaryStages = () => [
  {
    $group: {
      _id: "$_id",
      courseId: { $first: "$course" },
      completedAt: { $first: "$_analyticsCompletedAt" },
      finalEligible: { $first: "$_analyticsFinalEligible" },
      gradingState: { $first: "$_analyticsGradingState" },
      scorePercentage: { $first: "$_analyticsScorePercentage" },
      provisionalScore: { $first: "$provisionalScore" },
      provisionalMaxMarks: { $first: "$provisionalMaxMarks" },
      totalQuestions: {
        $sum: { $cond: ["$_analyticsQuestionExists", 1, 0] }
      },
      questionsGraded: { $sum: { $cond: ["$_analyticsQuestionGraded", 1, 0] } },
      questionsAnswered: { $sum: { $cond: ["$_analyticsAnswered", 1, 0] } },
      correctAnswers: { $sum: { $cond: ["$_analyticsCorrect", 1, 0] } },
      marksAwarded: {
        $sum: { $cond: ["$_analyticsQuestionGraded", "$_analyticsAwardedMarks", 0] }
      },
      maxMarks: {
        $sum: { $cond: ["$_analyticsQuestionGraded", "$_analyticsMaxMarks", 0] }
      }
    }
  },
  {
    $addFields: {
      incorrectAnswers: { $subtract: ["$questionsAnswered", "$correctAnswers"] },
      scorePercentage: {
        $cond: [
          { $isNumber: "$scorePercentage" },
          "$scorePercentage",
          {
            $cond: [
              { $gt: ["$maxMarks", 0] },
              { $multiply: [{ $divide: ["$marksAwarded", "$maxMarks"] }, 100] },
              null
            ]
          }
        ]
      }
    }
  }
];

const buildAnalyticsPipeline = (
  userId,
  { accessibleCourseIds, generatedAt = new Date() } = {}
) => {
  const completedSince = new Date(generatedAt.getTime() - 30 * 24 * 60 * 60 * 1000);
  const legacyAttempt = {
    $lt: [{ $ifNull: ["$attemptFormatVersion", 1] }, 2]
  };
  const legacyExpressions = legacyVerificationExpressions();
  const typedExpressions = typedGradingExpressions;
  const legacyScoreVerified = {
    $and: [
      legacyAttempt,
      "$_analyticsHasReliableLegacyQuestionResults",
      { $isNumber: "$score" },
      { $gte: ["$score", 0] },
      { $eq: ["$score", "$_analyticsVerifiedLegacyScore"] },
      {
        $or: [
          { $not: [{ $and: [{ $isNumber: "$totalQuestions" }, { $gt: ["$totalQuestions", 0] }] }] },
          { $eq: ["$totalQuestions", "$_analyticsLegacyQuestionCount"] }
        ]
      }
    ]
  };
  const typedGradingVerified = {
    $and: [
      { $gte: [{ $ifNull: ["$attemptFormatVersion", 1] }, 2] },
      "$_analyticsHasValidTypedQuestionResults",
      { $isNumber: "$score" },
      { $isNumber: "$totalMarks" },
      { $gt: ["$totalMarks", 0] },
      { $gte: ["$score", 0] },
      { $lte: ["$score", "$totalMarks"] },
      { $isNumber: "$percentage" },
      { $gte: ["$percentage", 0] },
      { $lte: ["$percentage", 100] },
      { $eq: ["$score", { $round: ["$_analyticsTypedScore", 2] }] },
      { $eq: ["$totalMarks", { $round: ["$_analyticsTypedMaxMarks", 2] }] },
      {
        $lte: [
          {
            $abs: {
              $subtract: [
                "$percentage",
                {
                  $round: [
                    {
                      $multiply: [
                        {
                          $divide: [
                            "$score",
                            { $cond: [{ $gt: ["$totalMarks", 0] }, "$totalMarks", 1] }
                          ]
                        },
                        100
                      ]
                    },
                    2
                  ]
                }
              ]
            }
          },
          0.01
        ]
      }
    ]
  };
  const finalEligible = {
    $or: [
      legacyScoreVerified,
      { $and: [{ $eq: ["$gradingStatus", "graded"] }, typedGradingVerified] }
    ]
  };
  const completedAttempts = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(String(userId)),
        ...(accessibleCourseIds
          ? { course: { $in: accessibleCourseIds.map((id) => new mongoose.Types.ObjectId(String(id))) } }
          : {}),
        $or: [
          { status: "completed" },
          {
            status: null,
            $or: [
              { timeEnded: { $type: "date" } },
              { completedAt: { $type: "date" } }
            ]
          }
        ]
      }
    },
    {
      $project: {
        course: 1,
        score: 1,
        totalMarks: 1,
        percentage: 1,
        attemptFormatVersion: 1,
        totalQuestions: 1,
        gradingStatus: 1,
        provisionalScore: 1,
        provisionalMaxMarks: 1,
        provisionalPercentage: 1,
        timeEnded: 1,
        completedAt: 1,
        questions: {
          $cond: [{ $isArray: "$questions" }, "$questions", []]
        }
      }
    },
    {
      $addFields: {
        _analyticsHasValidTypedQuestionResults: typedExpressions.hasValidQuestionResults,
        _analyticsTypedScore: typedExpressions.score,
        _analyticsTypedMaxMarks: typedExpressions.totalMarks,
        _analyticsLegacyQuestionCount: legacyExpressions.questionCount,
        _analyticsHasReliableLegacyQuestionResults: legacyExpressions.hasReliableQuestionResults,
        _analyticsVerifiedLegacyScore: legacyExpressions.verifiedScore
      }
    },
    {
      $addFields: {
        _analyticsLegacyScoreVerified: legacyScoreVerified,
        _analyticsTypedGradingVerified: typedGradingVerified
      }
    },
    {
      $addFields: {
        _analyticsScorePercentage: {
          $cond: [
            legacyAttempt,
            {
              $cond: [
                "$_analyticsLegacyScoreVerified",
                {
                  $multiply: [
                    { $divide: ["$_analyticsVerifiedLegacyScore", "$_analyticsLegacyQuestionCount"] },
                    100
                  ]
                },
                null
              ]
            },
            { $cond: [{ $isNumber: "$percentage" }, "$percentage", null] }
          ]
        }
      }
    },
    {
      $addFields: {
        _analyticsCompletedAt: { $ifNull: ["$completedAt", "$timeEnded"] }
      }
    },
    {
      $unwind: {
        path: "$questions",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $addFields: {
        _analyticsQuestionExists: { $ne: ["$questions.questionId", null] },
        _analyticsQuestionType: {
          $cond: [
            { $in: ["$questions.questionType", ["objective", "fill_in_gap", "theory"]] },
            "$questions.questionType",
            "objective"
          ]
        },
        _analyticsFinalEligible: finalEligible,
        _analyticsGradingState: {
          $cond: [
            legacyAttempt,
            { $cond: ["$_analyticsLegacyScoreVerified", "graded", "unscored"] },
            {
              $cond: [
                { $eq: ["$gradingStatus", "graded"] },
                {
                  $cond: [
                    "$_analyticsTypedGradingVerified",
                    "graded",
                    "unverified"
                  ]
                },
                {
                  $cond: [
                    { $in: ["$gradingStatus", ["pending", "grading", "failed", "needs_review"]] },
                    "$gradingStatus",
                    "pending"
                  ]
                }
              ]
            }
          ]
        },
        _analyticsTopic: {
          $cond: [
            { $eq: [{ $type: "$questions.topic" }, "string"] },
            { $trim: { input: "$questions.topic" } },
            ""
          ]
        }
      }
    },
    {
      $addFields: {
        _analyticsAnswered: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$_analyticsQuestionType", "objective"] },
                then: {
                  $and: [
                    { $eq: [{ $type: "$questions.selectedOptionId" }, "string"] },
                    {
                      $in: [
                        "$questions.selectedOptionId",
                        {
                          $map: {
                            input: { $ifNull: ["$questions.presentedOptions", []] },
                            as: "option",
                            in: "$$option.optionId"
                          }
                        }
                      ]
                    }
                  ]
                }
              },
              {
                case: { $eq: ["$_analyticsQuestionType", "fill_in_gap"] },
                then: {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: {
                            $cond: [
                              { $isArray: "$questions.selectedAnswers" },
                              "$questions.selectedAnswers",
                              []
                            ]
                          },
                          as: "answer",
                          cond: {
                            $ne: [
                              {
                                $trim: {
                                  input: {
                                    $cond: [
                                      { $eq: [{ $type: "$$answer" }, "string"] },
                                      "$$answer",
                                      ""
                                    ]
                                  }
                                }
                              },
                              ""
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                }
              },
              {
                case: { $eq: ["$_analyticsQuestionType", "theory"] },
                then: {
                  $ne: [
                    {
                      $trim: {
                        input: {
                          $cond: [
                            { $eq: [{ $type: "$questions.theoryResponse" }, "string"] },
                            "$questions.theoryResponse",
                            ""
                          ]
                        }
                      }
                    },
                    ""
                  ]
                }
              }
            ],
            default: false
          }
        },
        _analyticsQuestionGraded: {
          $and: [
            "$_analyticsQuestionExists",
            {
              $or: [
              {
                $and: [
                  legacyAttempt,
                  {
                    $or: [
                      { $eq: [{ $type: "$questions.isCorrect" }, "bool"] },
                      {
                        $and: [
                          { $eq: [{ $type: "$questions.selectedOptionId" }, "string"] },
                          { $eq: [{ $type: "$questions.correctOptionId" }, "string"] }
                        ]
                      }
                    ]
                  }
                ]
              },
                {
                  $and: [
                    { $eq: ["$questions.gradingResult.status", "graded"] },
                    { $isNumber: "$questions.gradingResult.awardedMarks" },
                    { $isNumber: "$questions.gradingResult.maxMarks" },
                    { $gt: ["$questions.gradingResult.maxMarks", 0] }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      $addFields: {
        _analyticsCorrect: {
          $cond: [
            { $eq: ["$_analyticsQuestionType", "objective"] },
            {
              $cond: [
                { $eq: [{ $type: "$questions.gradingResult.isCorrect" }, "bool"] },
                "$questions.gradingResult.isCorrect",
                {
                  $cond: [
                    { $eq: [{ $type: "$questions.isCorrect" }, "bool"] },
                    "$questions.isCorrect",
                    {
                      $and: [
                        "$_analyticsAnswered",
                        { $eq: ["$questions.selectedOptionId", "$questions.correctOptionId"] }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              $and: [
                "$_analyticsQuestionGraded",
                {
                  $gte: [
                    "$questions.gradingResult.awardedMarks",
                    "$questions.gradingResult.maxMarks"
                  ]
                }
              ]
            }
          ]
        },
        _analyticsMaxMarks: {
          $cond: [
            legacyAttempt,
            { $cond: ["$_analyticsQuestionGraded", 1, 0] },
            {
              $cond: [
                "$_analyticsQuestionGraded",
                "$questions.gradingResult.maxMarks",
                0
              ]
            }
          ]
        }
      }
    },
    {
      $addFields: {
        _analyticsAwardedMarks: {
          $cond: [
            legacyAttempt,
            { $cond: ["$_analyticsQuestionGraded", { $cond: ["$_analyticsCorrect", 1, 0] }, 0] },
            {
              $cond: [
                "$_analyticsQuestionGraded",
                "$questions.gradingResult.awardedMarks",
                0
              ]
            }
          ]
        }
      }
    }
  ];

  return [
    ...completedAttempts,
    {
      $facet: {
        attemptStates: [
          ...createAttemptSummaryStages(),
          {
            $group: {
              _id: null,
              totalCompletedAttempts: { $sum: 1 },
              gradedAttempts: { $sum: { $cond: ["$finalEligible", 1, 0] } },
              pendingAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "pending"] }, 1, 0] } },
              gradingAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "grading"] }, 1, 0] } },
              failedAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "failed"] }, 1, 0] } },
              reviewRequiredAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "needs_review"] }, 1, 0] } },
              unscoredHistoricalAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "unscored"] }, 1, 0] } },
              unverifiedGradingAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "unverified"] }, 1, 0] } },
              totalQuestionsAttempted: { $sum: "$totalQuestions" },
              attemptsLast30Days: {
                $sum: { $cond: [{ $gte: ["$completedAt", completedSince] }, 1, 0] }
              }
            }
          }
        ],
        unfinalizedAttempts: [
          ...createAttemptSummaryStages(),
          {
            $match: {
              gradingState: { $in: ["pending", "grading", "failed", "needs_review", "unscored", "unverified"] }
            }
          },
          { $sort: { completedAt: -1, _id: -1 } },
          { $limit: MAX_PROVISIONAL_ATTEMPTS },
          {
            $lookup: {
              from: Course.collection.name,
              localField: "courseId",
              foreignField: "_id",
              as: "course"
            }
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              attemptId: "$_id",
              courseId: 1,
              course: { $ifNull: ["$course.title", "Course unavailable"] },
              completedAt: 1,
              status: "$gradingState",
              provisionalScore: 1,
              provisionalMaxMarks: 1,
              provisionalPercentage: 1
            }
          }
        ],
        overview: [
          { $match: { _analyticsFinalEligible: true } },
          ...createAttemptSummaryStages(),
          {
            $group: {
              _id: null,
              gradedAttempts: { $sum: 1 },
              averageScorePercentage: { $avg: "$scorePercentage" },
              bestScorePercentage: { $max: "$scorePercentage" },
              lowestScorePercentage: { $min: "$scorePercentage" },
              totalQuestions: { $sum: "$totalQuestions" },
              questionsGraded: { $sum: "$questionsGraded" },
              totalQuestionsAnswered: { $sum: "$questionsAnswered" },
              totalCorrectAnswers: { $sum: "$correctAnswers" },
              totalIncorrectAnswers: { $sum: "$incorrectAnswers" },
              mostRecentCompletedAt: { $max: "$completedAt" }
            }
          }
        ],
        courses: [
          { $match: { _analyticsFinalEligible: true } },
          ...createAttemptSummaryStages(),
          {
            $group: {
              _id: "$courseId",
              gradedAttempts: { $sum: 1 },
              averageScorePercentage: { $avg: "$scorePercentage" },
              bestScorePercentage: { $max: "$scorePercentage" },
              lowestScorePercentage: { $min: "$scorePercentage" },
              totalQuestions: { $sum: "$totalQuestions" },
              questionsGraded: { $sum: "$questionsGraded" },
              questionsAnswered: { $sum: "$questionsAnswered" },
              correctAnswers: { $sum: "$correctAnswers" },
              incorrectAnswers: { $sum: "$incorrectAnswers" },
              marksAwarded: { $sum: "$marksAwarded" },
              maxMarks: { $sum: "$maxMarks" },
              mostRecentCompletedAt: { $max: "$completedAt" }
            }
          },
          {
            $lookup: {
              from: Course.collection.name,
              localField: "_id",
              foreignField: "_id",
              as: "course"
            }
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              courseId: "$_id",
              title: "$course.title",
              code: "$course.code",
              gradedAttempts: 1,
              averageScorePercentage: 1,
              bestScorePercentage: 1,
              lowestScorePercentage: 1,
              totalQuestions: 1,
              questionsGraded: 1,
              questionsAnswered: 1,
              correctAnswers: 1,
              incorrectAnswers: 1,
              marksAwarded: 1,
              maxMarks: 1,
              mostRecentCompletedAt: 1
            }
          },
          { $sort: { mostRecentCompletedAt: -1 } }
        ],
        courseAttemptStates: [
          ...createAttemptSummaryStages(),
          {
            $group: {
              _id: "$courseId",
              completedAttempts: { $sum: 1 },
              pendingAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "pending"] }, 1, 0] } },
              gradingAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "grading"] }, 1, 0] } },
              failedAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "failed"] }, 1, 0] } },
              reviewRequiredAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "needs_review"] }, 1, 0] } },
              unscoredHistoricalAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "unscored"] }, 1, 0] } },
              unverifiedGradingAttempts: { $sum: { $cond: [{ $eq: ["$gradingState", "unverified"] }, 1, 0] } },
              totalQuestionsAttempted: { $sum: "$totalQuestions" },
              mostRecentCompletedAt: { $max: "$completedAt" }
            }
          },
          {
            $lookup: {
              from: Course.collection.name,
              localField: "_id",
              foreignField: "_id",
              as: "course"
            }
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              courseId: "$_id",
              title: "$course.title",
              code: "$course.code",
              completedAttempts: 1,
              pendingAttempts: 1,
              gradingAttempts: 1,
              failedAttempts: 1,
              reviewRequiredAttempts: 1,
              unscoredHistoricalAttempts: 1,
              unverifiedGradingAttempts: 1,
              totalQuestionsAttempted: 1,
              mostRecentCompletedAt: 1
            }
          }
        ],
        topics: [
          {
            $match: {
              _analyticsFinalEligible: true,
              _analyticsQuestionGraded: true,
              _analyticsTopic: { $ne: "" }
            }
          },
          {
            $group: {
              _id: { courseId: "$course", topic: "$_analyticsTopic" },
              totalQuestions: {
                $sum: { $cond: ["$_analyticsQuestionGraded", 1, 0] }
              },
              questionsAnswered: { $sum: { $cond: ["$_analyticsAnswered", 1, 0] } },
              correctAnswers: { $sum: { $cond: ["$_analyticsCorrect", 1, 0] } },
              marksAwarded: { $sum: "$_analyticsAwardedMarks" },
              maxMarks: { $sum: "$_analyticsMaxMarks" }
            }
          },
          {
            $addFields: {
              incorrectAnswers: { $subtract: ["$questionsAnswered", "$correctAnswers"] },
              accuracy: {
                $cond: [
                  { $gt: ["$maxMarks", 0] },
                  {
                    $multiply: [
                      { $divide: ["$marksAwarded", "$maxMarks"] },
                      100
                    ]
                  },
                  null
                ]
              }
            }
          },
          {
            $lookup: {
              from: Course.collection.name,
              localField: "_id.courseId",
              foreignField: "_id",
              as: "course"
            }
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              courseId: "$_id.courseId",
              courseTitle: "$course.title",
              courseCode: "$course.code",
              topic: "$_id.topic",
              totalQuestions: 1,
              questionsAnswered: 1,
              correctAnswers: 1,
              incorrectAnswers: 1,
              marksAwarded: 1,
              maxMarks: 1,
              accuracy: 1
            }
          },
          { $sort: { courseTitle: 1, topic: 1 } }
        ],
        questionTypes: [
          { $match: { _analyticsFinalEligible: true } },
          {
            $group: {
              _id: "$_analyticsQuestionType",
              questionsAttempted: { $sum: { $cond: ["$_analyticsQuestionExists", 1, 0] } },
              questionsAnswered: { $sum: { $cond: ["$_analyticsAnswered", 1, 0] } },
              questionsGraded: { $sum: { $cond: ["$_analyticsQuestionGraded", 1, 0] } },
              fullCreditQuestions: { $sum: { $cond: ["$_analyticsCorrect", 1, 0] } },
              marksAwarded: { $sum: "$_analyticsAwardedMarks" },
              maxMarks: { $sum: "$_analyticsMaxMarks" }
            }
          }
        ],
        courseQuestionTypes: [
          { $match: { _analyticsFinalEligible: true } },
          {
            $group: {
              _id: { courseId: "$course", questionType: "$_analyticsQuestionType" },
              questionsAttempted: { $sum: { $cond: ["$_analyticsQuestionExists", 1, 0] } },
              questionsAnswered: { $sum: { $cond: ["$_analyticsAnswered", 1, 0] } },
              questionsGraded: { $sum: { $cond: ["$_analyticsQuestionGraded", 1, 0] } },
              fullCreditQuestions: { $sum: { $cond: ["$_analyticsCorrect", 1, 0] } },
              marksAwarded: { $sum: "$_analyticsAwardedMarks" },
              maxMarks: { $sum: "$_analyticsMaxMarks" }
            }
          }
        ],
        topicTrend: [
          {
            $match: {
              _analyticsFinalEligible: true,
              _analyticsQuestionGraded: true,
              _analyticsTopic: { $ne: "" },
              _analyticsCompletedAt: { $type: "date" }
            }
          },
          {
            $group: {
              _id: {
                attemptId: "$_id",
                courseId: "$course",
                topic: "$_analyticsTopic"
              },
              completedAt: { $first: "$_analyticsCompletedAt" },
              answered: { $sum: { $cond: ["$_analyticsAnswered", 1, 0] } },
              correct: { $sum: { $cond: ["$_analyticsCorrect", 1, 0] } },
              marksAwarded: { $sum: "$_analyticsAwardedMarks" },
              maxMarks: { $sum: "$_analyticsMaxMarks" }
            }
          },
          {
            $addFields: {
              accuracy: {
                $cond: [
                  { $gt: ["$maxMarks", 0] },
                  { $multiply: [{ $divide: ["$marksAwarded", "$maxMarks"] }, 100] },
                  null
                ]
              }
            }
          },
          {
            $addFields: {
              _analyticsAttemptOrder: {
                completedAt: "$completedAt",
                attemptId: "$_id.attemptId"
              }
            }
          },
          {
            $setWindowFields: {
              partitionBy: {
                courseId: "$_id.courseId",
                topic: "$_id.topic"
              },
              sortBy: { _analyticsAttemptOrder: -1 },
              output: { attemptRank: { $documentNumber: {} } }
            }
          },
          { $match: { attemptRank: { $lte: MAX_TREND_ATTEMPTS } } },
          { $sort: { completedAt: 1, "_id.attemptId": 1 } },
          {
            $group: {
              _id: { courseId: "$_id.courseId", topic: "$_id.topic" },
              attempts: {
                $push: {
                  attemptId: "$_id.attemptId",
                  completedAt: "$completedAt",
                  accuracy: "$accuracy",
                  questionsAnswered: "$answered",
                  correctAnswers: "$correct"
                }
              }
            }
          },
          {
            $project: {
              attempts: { $slice: ["$attempts", -MAX_TREND_ATTEMPTS] }
            }
          }
        ],
        courseTrend: [
          {
            $match: {
              _analyticsFinalEligible: true,
              _analyticsCompletedAt: { $type: "date" }
            }
          },
          ...createAttemptSummaryStages(),
          {
            $addFields: {
              _analyticsAttemptOrder: {
                completedAt: "$completedAt",
                attemptId: "$_id"
              }
            }
          },
          {
            $setWindowFields: {
              partitionBy: "$courseId",
              sortBy: { _analyticsAttemptOrder: -1 },
              output: { attemptRank: { $documentNumber: {} } }
            }
          },
          { $match: { attemptRank: { $lte: MAX_TREND_ATTEMPTS } } },
          { $sort: { courseId: 1, completedAt: 1, _id: 1 } },
          {
            $project: {
              attemptId: "$_id",
              courseId: 1,
              completedAt: 1,
              scorePercentage: 1,
              questionsAnswered: 1,
              correctAnswers: 1,
              accuracy: {
                $cond: [
                  { $gt: ["$maxMarks", 0] },
                  { $multiply: [{ $divide: ["$marksAwarded", "$maxMarks"] }, 100] },
                  null
                ]
              }
            }
          }
        ],
        trend: [
          {
            $match: {
              _analyticsFinalEligible: true,
              _analyticsCompletedAt: { $type: "date" }
            }
          },
          ...createAttemptSummaryStages(),
          { $sort: { completedAt: -1, _id: -1 } },
          { $limit: MAX_TREND_ATTEMPTS },
          { $sort: { completedAt: 1, _id: 1 } },
          {
            $project: {
              attemptId: "$_id",
              courseId: 1,
              completedAt: 1,
              scorePercentage: 1,
              questionsAnswered: 1,
              correctAnswers: 1,
              accuracy: {
                $cond: [
                  { $gt: ["$maxMarks", 0] },
                  {
                    $multiply: [
                      { $divide: ["$marksAwarded", "$maxMarks"] },
                      100
                    ]
                  },
                  null
                ]
              }
            }
          }
        ],
        unclassified: [
          {
            $match: {
              _analyticsFinalEligible: true,
              _analyticsQuestionGraded: true,
              _analyticsTopic: "",
              _analyticsAnswered: true
            }
          },
          { $count: "answeredQuestions" }
        ]
      }
    }
  ];
};

const roundOneDecimal = (value) =>
  Number.isFinite(value) ? Number(value.toFixed(1)) : null;

const classifyTopic = ({ accuracy, questionsAnswered }) => {
  if (questionsAnswered < TOPIC_THRESHOLDS.minimumAnsweredQuestions || !Number.isFinite(accuracy)) {
    return "Insufficient data";
  }
  if (accuracy >= TOPIC_THRESHOLDS.strong) return "Strong";
  if (accuracy >= TOPIC_THRESHOLDS.developing) return "Developing";
  return "Needs improvement";
};

const normalizeTopics = (topicRows = [], trendRows = []) => {
  const topicTrends = new Map(trendRows.map((row) => [
    `${String(row._id.courseId)}:${row._id.topic}`,
    calculateTrend(row.attempts || [])
  ]));
  return topicRows
  .filter((topic) => typeof topic.topic === "string" && topic.topic.trim())
  .map((topic) => ({
    courseId: topic.courseId,
    courseTitle: topic.courseTitle || "Course",
    courseCode: topic.courseCode || "",
    topic: topic.topic.trim(),
    totalQuestions: topic.totalQuestions || 0,
    questionsGraded: topic.totalQuestions || 0,
    questionsAnswered: topic.questionsAnswered || 0,
    correctAnswers: topic.correctAnswers || 0,
    incorrectAnswers: topic.incorrectAnswers || 0,
    marksAwarded: roundOneDecimal(topic.marksAwarded || 0),
    maxMarks: roundOneDecimal(topic.maxMarks || 0),
    accuracy: roundOneDecimal(topic.accuracy),
    trend: topicTrends.get(`${String(topic.courseId)}:${topic.topic.trim()}`) || {
      direction: "insufficient_data",
      comparedAttempts: 0,
      changePercentagePoints: null
    },
    classification: classifyTopic(topic)
  }));
};

const calculateTrend = (attempts = []) => {
  const usable = attempts.map((attempt) => ({
    ...attempt,
    accuracy: Number.isFinite(attempt.scorePercentage)
      ? attempt.scorePercentage
      : attempt.accuracy
  })).filter((attempt) => Number.isFinite(attempt.accuracy));
  if (usable.length < TREND_MINIMUM_ATTEMPTS) {
    return { direction: "insufficient_data", comparedAttempts: usable.length, changePercentagePoints: null };
  }
  const previous = usable.slice(-4, -2);
  const recent = usable.slice(-2);
  const mean = (items) => items.reduce((sum, item) => sum + item.accuracy, 0) / items.length;
  const change = mean(recent) - mean(previous);
  return {
    direction: change > TREND_CHANGE_THRESHOLD
      ? "improving"
      : change < -TREND_CHANGE_THRESHOLD
        ? "declining"
        : "stable",
    comparedAttempts: usable.length,
    changePercentagePoints: roundOneDecimal(change)
  };
};

const normalizeQuestionTypeRows = (rows = []) => {
  const byType = new Map(rows.map((row) => [row._id, row]));
  return ["objective", "fill_in_gap", "theory"].map((questionType) => {
    const row = byType.get(questionType) || {};
    const accuracy = row.maxMarks > 0
      ? (row.marksAwarded / row.maxMarks) * 100
      : null;
    return {
      questionType,
      questionsAttempted: row.questionsAttempted || 0,
      questionsAnswered: row.questionsAnswered || 0,
      questionsGraded: row.questionsGraded || 0,
      fullCreditQuestions: row.fullCreditQuestions || 0,
      marksAwarded: roundOneDecimal(row.marksAwarded || 0),
      maxMarks: roundOneDecimal(row.maxMarks || 0),
      accuracy: roundOneDecimal(accuracy)
    };
  });
};

const buildReadiness = ({ overview, questionTypeBreakdown, topics }) => {
  const typeCoverage = Object.fromEntries(questionTypeBreakdown.map((item) => [
    item.questionType,
    item.questionsGraded
  ]));
  const gradedQuestions = Object.values(typeCoverage).reduce((total, count) => total + count, 0);
  const missingEvidence = [];
  if (overview.gradedAttemptCount < READINESS_THRESHOLDS.minimumGradedAttempts) {
    missingEvidence.push(
      `${READINESS_THRESHOLDS.minimumGradedAttempts} fully graded practice attempts are required`
    );
  }
  if (gradedQuestions < READINESS_THRESHOLDS.minimumGradedQuestions) {
    missingEvidence.push(
      `${READINESS_THRESHOLDS.minimumGradedQuestions} fully graded questions are required`
    );
  }
  for (const questionType of ["objective", "fill_in_gap", "theory"]) {
    if (typeCoverage[questionType] < READINESS_THRESHOLDS.minimumQuestionsPerType) {
      missingEvidence.push(
        `at least ${READINESS_THRESHOLDS.minimumQuestionsPerType} graded ${questionType.replaceAll("_", " ")} questions are required`
      );
    }
  }

  const weakAreas = topics
    .filter((topic) => topic.classification === "Needs improvement")
    .map((topic) => ({
      kind: "topic",
      courseId: topic.courseId,
      course: topic.courseTitle,
      topic: topic.topic,
      accuracy: topic.accuracy,
      questionsAnswered: topic.questionsAnswered
    }));
  for (const item of questionTypeBreakdown) {
    if (item.questionsGraded >= READINESS_THRESHOLDS.minimumQuestionsPerType &&
        Number.isFinite(item.accuracy) && item.accuracy < TOPIC_THRESHOLDS.developing) {
      weakAreas.push({
        kind: "question_type",
        questionType: item.questionType,
        accuracy: item.accuracy,
        questionsGraded: item.questionsGraded
      });
    }
  }

  const hasSufficientEvidence = missingEvidence.length === 0;
  return {
    status: hasSufficientEvidence ? "sufficient_evidence" : "insufficient_evidence",
    percentage: hasSufficientEvidence ? overview.averageScorePercentage : null,
    gradedAttempts: overview.gradedAttemptCount,
    gradedQuestions,
    questionTypeCoverage: typeCoverage,
    thresholds: READINESS_THRESHOLDS,
    missingEvidence,
    weakAreas: weakAreas.slice(0, 8),
    explanation: hasSufficientEvidence
      ? `This practice-evidence indicator is the mean score across fully graded attempts. It is shown after at least ${READINESS_THRESHOLDS.minimumGradedAttempts} attempts, ${READINESS_THRESHOLDS.minimumGradedQuestions} graded questions, and ${READINESS_THRESHOLDS.minimumQuestionsPerType} graded questions of each type. It is not a prediction or guarantee of examination success.`
      : "A readiness percentage is withheld until there are enough fully graded attempts and question coverage across all three formats."
  };
};

const buildRecommendations = ({
  courses,
  topics,
  questionTypeBreakdown = [],
  trend,
  generatedAt
}) => {
  const recommendations = [];
  for (const topic of topics) {
    const support = `${topic.accuracy ?? "Not enough"}% accuracy across ${topic.questionsAnswered} answered question(s)`;
    if (topic.classification === "Needs improvement") {
      recommendations.push({
        evidenceId: `topic:${String(topic.courseId)}:${topic.topic}`,
        courseId: topic.courseId,
        course: topic.courseTitle,
        topic: topic.topic,
        reason: `Your results show ${support}.`,
        evidence: {
          questionsAnswered: topic.questionsAnswered,
          correctAnswers: topic.correctAnswers,
          accuracy: topic.accuracy
        },
        suggestedAction: `Review the core ideas in ${topic.topic}, then practise related questions.`,
        priority: topic.accuracy < 40 ? "high" : "medium",
        generatedAt
      });
    } else if (topic.classification === "Developing") {
      recommendations.push({
        evidenceId: `topic:${String(topic.courseId)}:${topic.topic}`,
        courseId: topic.courseId,
        course: topic.courseTitle,
        topic: topic.topic,
        reason: `Your results show ${support}; more practice may help consolidate this topic.`,
        evidence: {
          questionsAnswered: topic.questionsAnswered,
          correctAnswers: topic.correctAnswers,
          accuracy: topic.accuracy
        },
        suggestedAction: `Practise a short set of ${topic.topic} questions and review any missed concepts.`,
        priority: "medium",
        generatedAt
      });
    } else if (topic.classification === "Insufficient data") {
      recommendations.push({
        evidenceId: `topic:${String(topic.courseId)}:${topic.topic}`,
        courseId: topic.courseId,
        course: topic.courseTitle,
        topic: topic.topic,
        reason: `Only ${topic.questionsAnswered} question(s) have been answered for this topic; there is not enough evidence to classify performance.`,
        evidence: {
          questionsAnswered: topic.questionsAnswered,
          correctAnswers: topic.correctAnswers,
          accuracy: topic.accuracy
        },
        suggestedAction: `Attempt more ${topic.topic} questions before drawing conclusions about your performance.`,
        priority: "low",
        generatedAt
      });
    }
  }

  for (const course of courses) {
    if (course.questionsAnswered > 0 && course.questionsAnswered < TOPIC_THRESHOLDS.minimumAnsweredQuestions) {
      recommendations.push({
        evidenceId: `course:${String(course.courseId)}`,
        courseId: course.courseId,
        course: course.title,
        topic: null,
        reason: `You have answered ${course.questionsAnswered} question(s) in this course, which is not enough to establish a reliable course-level pattern.`,
        evidence: {
          completedAttempts: course.completedAttempts,
          questionsAnswered: course.questionsAnswered,
          accuracy: course.accuracy
        },
        suggestedAction: `Complete another practice attempt in ${course.title}.`,
        priority: "low",
        generatedAt
      });
    } else if (course.completedAttempts > 0 &&
        course.totalQuestions >= TOPIC_THRESHOLDS.minimumAnsweredQuestions &&
        Number.isFinite(course.averageScorePercentage) &&
        course.averageScorePercentage < TOPIC_THRESHOLDS.developing) {
      recommendations.push({
        evidenceId: `course:${String(course.courseId)}`,
        courseId: course.courseId,
        course: course.title,
        topic: null,
        reason: `Your average score in ${course.title} is ${course.averageScorePercentage}% across ${course.completedAttempts} fully graded attempt(s).`,
        evidence: {
          completedAttempts: course.completedAttempts,
          questionsGraded: course.totalQuestions,
          accuracy: course.averageScorePercentage
        },
        suggestedAction: `Review missed questions in ${course.title}, then practise another set.`,
        priority: course.averageScorePercentage < 40 ? "high" : "medium",
        generatedAt
      });
    }
  }

  for (const item of questionTypeBreakdown) {
    if (item.questionsGraded >= TOPIC_THRESHOLDS.minimumAnsweredQuestions &&
        Number.isFinite(item.accuracy) && item.accuracy < TOPIC_THRESHOLDS.developing) {
      recommendations.push({
        evidenceId: `type:${item.questionType}`,
        courseId: null,
        course: null,
        topic: item.questionType.replaceAll("_", " "),
        questionType: item.questionType,
        reason: `Your ${item.questionType.replaceAll("_", " ")} results show ${item.accuracy}% of available marks across ${item.questionsGraded} graded question(s).`,
        evidence: {
          questionsAnswered: item.questionsAnswered,
          questionsGraded: item.questionsGraded,
          correctAnswers: item.fullCreditQuestions,
          accuracy: item.accuracy
        },
        suggestedAction: `Practise more ${item.questionType.replaceAll("_", " ")} questions and review the feedback.`,
        priority: item.accuracy < 40 ? "high" : "medium",
        generatedAt
      });
    }
  }

  if (trend.direction === "declining") {
    recommendations.push({
      evidenceId: "trend:overall",
      courseId: null,
      course: null,
      topic: null,
      reason: `Accuracy across the latest two completed attempts is ${Math.abs(trend.changePercentagePoints)} percentage points lower than the preceding two.`,
      evidence: {
        comparedAttempts: trend.comparedAttempts,
        changePercentagePoints: trend.changePercentagePoints
      },
      suggestedAction: "Review recent missed questions and schedule a focused practice session.",
      priority: "medium",
      generatedAt
    });
  }

  return recommendations
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
    .slice(0, 12);
};

const buildStudentAnalytics = (aggregation = {}, generatedAt = new Date()) => {
  const overview = aggregation.overview?.[0] || {};
  const attemptStateSummary = aggregation.attemptStates?.[0] || {};
  const attempts = aggregation.trend || [];
  const topics = normalizeTopics(aggregation.topics, aggregation.topicTrend);
  const questionTypeBreakdown = normalizeQuestionTypeRows(aggregation.questionTypes);
  const courseRows = aggregation.courses || [];
  const courseStateRows = aggregation.courseAttemptStates || [];
  const courseTypeRows = aggregation.courseQuestionTypes || [];
  const courseRowsById = new Map(courseRows.map((course) => [String(course.courseId), course]));
  const courseStatesById = new Map(courseStateRows.map((course) => [String(course.courseId), course]));
  const courseTrendRows = aggregation.courseTrend || [];
  const courseTrendsById = new Map();
  for (const attempt of courseTrendRows) {
    const key = String(attempt.courseId);
    if (!courseTrendsById.has(key)) courseTrendsById.set(key, []);
    courseTrendsById.get(key).push(attempt);
  }
  const courseIds = new Set([
    ...courseRowsById.keys(),
    ...courseStatesById.keys()
  ]);
  const performanceTrend = attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    courseId: attempt.courseId,
    completedAt: attempt.completedAt,
    accuracy: roundOneDecimal(attempt.accuracy),
    scorePercentage: roundOneDecimal(attempt.scorePercentage),
    questionsAnswered: attempt.questionsAnswered || 0,
    correctAnswers: attempt.correctAnswers || 0
  }));
  const courses = [...courseIds].map((courseKey) => {
    const course = courseRowsById.get(courseKey) || {};
    const state = courseStatesById.get(courseKey) || course;
    const courseId = state.courseId || course.courseId;
    const courseTopics = topics.filter((topic) => String(topic.courseId) === String(courseId));
    const accuracy = course.maxMarks > 0
      ? (course.marksAwarded / course.maxMarks) * 100
      : course.questionsAnswered > 0
        ? (course.correctAnswers / course.questionsAnswered) * 100
        : null;
    const courseQuestionTypes = normalizeQuestionTypeRows(courseTypeRows
      .filter((row) => String(row._id.courseId) === String(courseId))
      .map((row) => ({ ...row, _id: row._id.questionType })));
    const coursePerformanceTrend = courseTrendsById.get(String(courseId)) || [];
    const courseTrend = calculateTrend(coursePerformanceTrend);
    return {
      courseId,
      title: state.title || course.title || "Course",
      code: state.code || course.code || "",
      completedAttempts: state.completedAttempts ?? course.completedAttempts ?? 0,
      gradedAttempts: course.gradedAttempts ?? course.completedAttempts ?? 0,
      pendingAttempts: state.pendingAttempts || 0,
      gradingAttempts: state.gradingAttempts || 0,
      failedAttempts: state.failedAttempts || 0,
      reviewRequiredAttempts: state.reviewRequiredAttempts || 0,
      unscoredHistoricalAttempts: state.unscoredHistoricalAttempts || 0,
      unverifiedGradingAttempts: state.unverifiedGradingAttempts || 0,
      averageScorePercentage: roundOneDecimal(course.averageScorePercentage),
      bestScorePercentage: roundOneDecimal(course.bestScorePercentage),
      lowestScorePercentage: roundOneDecimal(course.lowestScorePercentage),
      accuracy: roundOneDecimal(accuracy),
      totalQuestions: state.totalQuestionsAttempted ?? course.totalQuestions ?? 0,
      questionsAnswered: course.questionsAnswered || 0,
      questionsGraded: course.questionsGraded ?? course.totalQuestions ?? 0,
      correctAnswers: course.correctAnswers || 0,
      incorrectAnswers: course.incorrectAnswers || 0,
      trend: courseTrend,
      performanceTrend: coursePerformanceTrend.map((attempt) => ({
        attemptId: attempt.attemptId,
        completedAt: attempt.completedAt,
        accuracy: roundOneDecimal(attempt.accuracy),
        scorePercentage: roundOneDecimal(attempt.scorePercentage),
        questionsAnswered: attempt.questionsAnswered || 0,
        correctAnswers: attempt.correctAnswers || 0
      })),
      questionTypeBreakdown: courseQuestionTypes,
      strongestTopics: courseTopics
        .filter((topic) => topic.classification === "Strong")
        .sort((a, b) => b.accuracy - a.accuracy)
        .slice(0, 5),
      weakestTopics: courseTopics
        .filter((topic) => topic.classification === "Needs improvement")
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5),
      insufficientTopics: courseTopics
        .filter((topic) => topic.classification === "Insufficient data"),
      mostRecentCompletedAt: state.mostRecentCompletedAt || course.mostRecentCompletedAt || null
    };
  });
  const trend = calculateTrend(performanceTrend);
  const normalizedOverview = {
    totalCompletedAttempts: attemptStateSummary.totalCompletedAttempts ??
      overview.totalCompletedAttempts ?? overview.gradedAttempts ?? 0,
    gradedAttemptCount: overview.gradedAttempts ??
      attemptStateSummary.gradedAttempts ??
      overview.totalCompletedAttempts ??
      0,
    totalQuestions: attemptStateSummary.totalQuestionsAttempted ?? overview.totalQuestions ?? 0,
    totalQuestionsAttempted: attemptStateSummary.totalQuestionsAttempted ?? overview.totalQuestions ?? 0,
    totalGradedQuestions: overview.totalQuestions || 0,
    totalQuestionsAnswered: overview.totalQuestionsAnswered || 0,
    totalCorrectAnswers: overview.totalCorrectAnswers || 0,
    totalIncorrectAnswers: overview.totalIncorrectAnswers || 0,
    overallAccuracy: overview.totalQuestionsAnswered > 0
      ? roundOneDecimal((overview.totalCorrectAnswers / overview.totalQuestionsAnswered) * 100)
      : null,
    averageScorePercentage: roundOneDecimal(overview.averageScorePercentage),
    bestScorePercentage: roundOneDecimal(overview.bestScorePercentage),
    lowestScorePercentage: roundOneDecimal(overview.lowestScorePercentage),
    mostRecentCompletedAt: overview.mostRecentCompletedAt || null,
    unclassifiedAnsweredQuestions: aggregation.unclassified?.[0]?.answeredQuestions || 0,
    pendingGradingAttempts: attemptStateSummary.pendingAttempts || 0,
    gradingAttempts: attemptStateSummary.gradingAttempts || 0,
    failedGradingAttempts: attemptStateSummary.failedAttempts || 0,
    reviewRequiredAttempts: attemptStateSummary.reviewRequiredAttempts || 0,
    unscoredHistoricalAttempts: attemptStateSummary.unscoredHistoricalAttempts || 0,
    unverifiedGradingAttempts: attemptStateSummary.unverifiedGradingAttempts || 0,
    attemptsLast30Days: attemptStateSummary.attemptsLast30Days || 0
  };
  const recentPerformance = performanceTrend.slice(-5).reverse();
  const unfinalizedAttempts = aggregation.unfinalizedAttempts || [];
  const practiceFrequency = {
    attemptsLast30Days: normalizedOverview.attemptsLast30Days,
    averageAttemptsPerWeek: roundOneDecimal((normalizedOverview.attemptsLast30Days / 30) * 7)
  };

  const recommendations = buildRecommendations({
    courses,
    topics,
    questionTypeBreakdown,
    trend,
    generatedAt
  });
  const readiness = buildReadiness({
    overview: normalizedOverview,
    questionTypeBreakdown,
    topics
  });

  return {
    generatedAt,
    overview: normalizedOverview,
    courses,
    topics,
    questionTypeBreakdown,
    performanceTrend,
    recentPerformance,
    practiceFrequency,
    unfinalizedAttempts,
    trend,
    recommendations,
    recommendationsSource: recommendations.length ? "evidence_rules" : "no_supported_focus",
    readiness,
    topicThresholds: {
      strong: TOPIC_THRESHOLDS.strong,
      developing: TOPIC_THRESHOLDS.developing,
      minimumAnsweredQuestions: TOPIC_THRESHOLDS.minimumAnsweredQuestions
    },
    readinessThresholds: READINESS_THRESHOLDS
  };
};

const isAiRecommendationTarget = (recommendation) => {
  const evidence = recommendation.evidence || {};
  const questions = evidence.questionsAnswered ?? evidence.questionsGraded ?? 0;
  return recommendation.evidenceId &&
    ((Number.isFinite(evidence.accuracy) &&
      evidence.accuracy < TOPIC_THRESHOLDS.strong &&
      questions >= TOPIC_THRESHOLDS.minimumAnsweredQuestions) ||
     (Number.isFinite(evidence.changePercentagePoints) && evidence.changePercentagePoints < 0));
};

const getRecommendationEvidence = (targets) => targets
  .slice(0, 8)
  .map((recommendation, index) => {
    const source = recommendation.evidence || {};
    const evidence = Object.fromEntries([
      "accuracy",
      "questionsAnswered",
      "questionsGraded",
      "correctAnswers",
      "completedAttempts",
      "comparedAttempts",
      "changePercentagePoints"
    ].filter((key) => Number.isFinite(source[key])).map((key) => [key, source[key]]));
    return {
      evidenceId: `evidence-${index + 1}`,
      course: typeof recommendation.course === "string"
        ? recommendation.course.slice(0, 100)
        : null,
      topic: typeof recommendation.topic === "string"
        ? recommendation.topic.slice(0, 120)
        : null,
      questionType: recommendation.questionType || null,
      evidence
    };
  });

const validateAiRecommendations = (message, evidence) => {
  const output = JSON.parse(String(message || ""));
  if (!output || typeof output !== "object" || Array.isArray(output) ||
      Object.keys(output).length !== 1 ||
      !Array.isArray(output.recommendations) ||
      output.recommendations.length !== evidence.length) {
    throw new Error("invalid_recommendations");
  }
  const allowedIds = new Set(evidence.map((item) => item.evidenceId));
  const seenIds = new Set();
  const allowedActions = new Set([
    "review_missed",
    "practise_target",
    "explain_from_memory",
    "compare_solutions"
  ]);
  return output.recommendations.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).length !== 2 ||
        typeof item.evidenceId !== "string" ||
        !allowedIds.has(item.evidenceId) ||
        seenIds.has(item.evidenceId) ||
        !allowedActions.has(item.actionType)) {
      throw new Error("invalid_recommendations");
    }
    seenIds.add(item.evidenceId);
    return {
      evidenceId: item.evidenceId,
      actionType: item.actionType
    };
  });
};

const formatAiStudyAction = (recommendation, actionType) => {
  const target = recommendation.questionType
    ? `${recommendation.questionType.replaceAll("_", " ")} questions`
    : recommendation.topic
      ? `${recommendation.topic}${recommendation.course ? ` in ${recommendation.course}` : ""}`
      : recommendation.course || "your recent CBT questions";
  switch (actionType) {
    case "review_missed":
      return `Review feedback from ${target}, then retry similar questions.`;
    case "practise_target":
      return `Practise another set focused on ${target} and check the feedback.`;
    case "explain_from_memory":
      return `Explain the key ideas in ${target} from memory, then check your course notes.`;
    case "compare_solutions":
      return `Compare your responses on ${target} with the feedback and correct any gaps.`;
    default:
      throw new Error("invalid_recommendation_action");
  }
};

const cacheRecommendations = (key, recommendations, expiresAt) => {
  if (recommendationCache.size >= RECOMMENDATION_CACHE_LIMIT) {
    const oldestKey = recommendationCache.keys().next().value;
    if (oldestKey) recommendationCache.delete(oldestKey);
  }
  recommendationCache.set(key, { recommendations, expiresAt });
};

const applyGeneratedActions = (recommendations, targets, evidence, generated) => {
  const actions = new Map(generated.map((item) => [item.evidenceId, item.actionType]));
  const actionByRecommendation = new Map(targets.map((recommendation, index) => [
    recommendation,
    actions.get(evidence[index].evidenceId)
  ]));
  return recommendations.map((item) => {
    const actionType = actionByRecommendation.get(item);
    return actionType
      ? { ...item, suggestedAction: formatAiStudyAction(item, actionType) }
      : item;
  });
};

const getAiStudyRecommendations = async (userId, analytics, now = new Date()) => {
  const targets = (analytics.recommendations || []).filter(isAiRecommendationTarget).slice(0, 8);
  const evidence = getRecommendationEvidence(targets);
  if (!evidence.length) {
    return {
      recommendations: analytics.recommendations || [],
      recommendationsSource: (analytics.recommendations || []).length
        ? "evidence_rules"
        : "no_supported_focus"
    };
  }

  const cacheKey = crypto.createHash("sha256")
    .update(JSON.stringify({ userId: String(userId), evidence }))
    .digest("hex");
  const cached = recommendationCache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) {
    return {
      recommendations: applyGeneratedActions(
        analytics.recommendations || [],
        targets,
        evidence,
        cached.recommendations
      ),
      recommendationsSource: "gemini"
    };
  }
  if (cached) recommendationCache.delete(cacheKey);

  let pending = recommendationRequests.get(cacheKey);
  if (!pending) {
    pending = gemini.generateStudyRecommendations(evidence, userId)
      .then((response) => validateAiRecommendations(response.message, evidence));
    recommendationRequests.set(cacheKey, pending);
  }

  try {
    const generated = await pending;
    const recommendations = applyGeneratedActions(
      analytics.recommendations || [],
      targets,
      evidence,
      generated
    );
    cacheRecommendations(
      cacheKey,
      generated,
      now.getTime() + RECOMMENDATION_CACHE_TTL_MS
    );
    return { recommendations, recommendationsSource: "gemini" };
  } catch {
    return {
      recommendations: analytics.recommendations || [],
      recommendationsSource: "evidence_rules",
      recommendationsNotice: "Gemini recommendations could not be generated or validated; suggestions shown are based on recorded results."
    };
  } finally {
    if (recommendationRequests.get(cacheKey) === pending) {
      recommendationRequests.delete(cacheKey);
    }
  }
};

const getStudentAnalytics = async (
  userId,
  generatedAt = new Date(),
  { accessibleCourseIds } = {}
) => {
  const aggregation = await QuizSession.aggregate(buildAnalyticsPipeline(userId, {
    accessibleCourseIds,
    generatedAt
  })).allowDiskUse(true);
  return buildStudentAnalytics(aggregation[0] || {}, generatedAt);
};

const buildCoursePerformanceContext = (analytics = {}, courseId) => {
  const course = (analytics.courses || []).find(
    (item) => String(item.courseId) === String(courseId)
  );
  if (!course || course.completedAttempts < 1) {
    return {
      hasCompletedAttempts: false,
      scope: "selected_course",
      completedAttempts: 0
    };
  }

  const summarizeTopics = (topics = [], includeAccuracy) => topics.slice(0, 5).map((topic) => ({
    topic: topic.topic,
    questionsAnswered: topic.questionsAnswered,
    ...(includeAccuracy ? { accuracy: topic.accuracy } : {})
  }));
  const trend = analytics.trend || {};

  return {
    hasCompletedAttempts: true,
    scope: "selected_course",
    completedAttempts: course.completedAttempts,
    averageScorePercentage: course.averageScorePercentage,
    accuracy: course.accuracy,
    questionsAnswered: course.questionsAnswered,
    strongTopics: summarizeTopics(course.strongestTopics, true),
    weakTopics: summarizeTopics(course.weakestTopics, true),
    topicsWithInsufficientEvidence: summarizeTopics(course.insufficientTopics),
    overallTrend: {
      scope: "all_courses",
      direction: trend.direction || "insufficient_data",
      comparedAttempts: trend.comparedAttempts || 0,
      changePercentagePoints: trend.changePercentagePoints ?? null
    }
  };
};

module.exports = {
  TOPIC_THRESHOLDS,
  READINESS_THRESHOLDS,
  TREND_MINIMUM_ATTEMPTS,
  TREND_CHANGE_THRESHOLD,
  MAX_TREND_ATTEMPTS,
  buildAnalyticsPipeline,
  classifyTopic,
  calculateTrend,
  buildReadiness,
  buildRecommendations,
  validateAiRecommendations,
  buildStudentAnalytics,
  getStudentAnalytics,
  getAiStudyRecommendations,
  buildCoursePerformanceContext
};
