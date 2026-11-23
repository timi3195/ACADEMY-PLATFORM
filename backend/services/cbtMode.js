const isNonAiModeEnabled = () =>
  String(process.env.CBT_NON_AI_MODE || "").toLowerCase() === "true";

module.exports = { isNonAiModeEnabled };
