// Hosting adapter for the optional classic fallback. Scores use their own edition.
ENABLE_RECORDING = false;
ENABLE_RECORDING_REALTIME = false;
initRB = updateRB = initFS = () => {};
uploadStyle = () => true;
cloudflareWriteHighScore = score => ularnScoreService.submit(score, "classic");
getHighscores = () => ularnScoreService.highscores(ULARN, "classic");
cloudflareLoadGame = async id => {
  const score = await ularnScoreService.details(id, "classic");
  return scoreDetailsText(score);
};

// Preserve diagnostics without calling an uninstalled telemetry client.
doRollbar = (severity, title, detail) => {
  if (severity === ROLLBAR_ERROR) console.error(title, detail);
  else if (severity === ROLLBAR_WARN) console.warn(title, detail);
};
