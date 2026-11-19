const mode = process.argv[2];

process.once("disconnect", () => process.exit(1));

process.once("message", () => {
  if (mode === "crash") {
    process.exit(1);
    return;
  }
  if (mode === "hang" || mode === "ignore-termination") {
    if (mode === "ignore-termination") process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    return;
  }
  const result = mode === "malformed"
    ? { status: "succeeded", unexpected: "not allowed" }
    : {
        status: "succeeded",
        extractionMethod: "docx_text",
        segments: [],
        ocrCandidatePages: [],
        diagnostics: []
      };
  const message = mode === "failure"
    ? { ok: false, errorCode: "CHILD_PROCESS_FAILED" }
    : mode === "oversized"
      ? { ok: true, result: { ...result, padding: "x".repeat(5 * 1024 * 1024) } }
      : { ok: true, result };
  process.send(message, () => process.exit(0));
});
