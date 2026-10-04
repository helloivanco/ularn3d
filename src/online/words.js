// Keep this list aligned with private.contains_blocked in the online migration.
const BLOCKED = [
  "fuck",
  "shit",
  "cunt",
  "bitch",
  "asshole",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "slut",
  "whore",
  "rape",
  "porn",
  "nazi",
];

const foldText = (input) => {
  const mapped = String(input || "")
    .toLowerCase()
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t")
    .replaceAll("@", "a")
    .replaceAll("$", "s");
  return mapped.replace(/[^a-z]/g, "");
};

export const containsBlockedWord = (input) => {
  const folded = foldText(input);
  return BLOCKED.some((word) => folded.includes(word));
};

export const displayNameError = (input) => {
  const name = String(input || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 '-]{1,14}[A-Za-z0-9]$/.test(name)) return "bad_name";
  if (containsBlockedWord(name)) return "filtered";
  return "";
};
