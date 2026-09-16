// Hosting adapter for the optional classic fallback. No external score or replay service.
ENABLE_RECORDING = false;
ENABLE_RECORDING_REALTIME = false;
initRB = updateRB = initFS = () => {};
uploadStyle = () => true;
cloudflareWriteHighScore = async () => {};
dbQueryHighScores = async (score, winners, losers) =>
  showLocalScoreBoard(score, winners, losers, 0, "Local expedition records");

// Preserve diagnostics without calling an uninstalled telemetry client.
doRollbar = (severity, title, detail) => {
  if (severity === ROLLBAR_ERROR) console.error(title, detail);
  else if (severity === ROLLBAR_WARN) console.warn(title, detail);
};
