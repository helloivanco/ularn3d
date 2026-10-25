/** Classifies engine journal lines for styling. Runs on every new line, so regexes are precompiled. */
const TAGS = /<[^>]*>/g;
const ENTITIES = /&(?:#(\d+)|([a-z]+));/gi;
const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const SPACES = /\s+/g;

const KINDS = [
  ["kill", /^the .+ (?:died|dies|is destroyed)\b|\bhits and kills the\b|\bbeheads the\b|^there will be no more\b/i],
  ["combat-in", new RegExp(
    "^the .+?(?: hits? you| bit you| bites you| stung you| stings you| miss(?:ed|es)\\b| breathes\\b" +
    "| blasts you| drains you| got you| flattens you| has confused you| picks your pocket" +
    "| is awestruck| couldn't find|'s flame doesn't faze you)" +
    "|^you have been slain\\b|^your heart stopped\\b|^you are hit by your own magic\\b", "i")],
  ["combat-out", /^you (?:hit|missed) the\b|^your lance of death\b/i],
  ["loot", /\byou (?:find|pick up)\b|^you have found\b|\bgold pieces\b|\bsome gold\b/i],
  ["warn", new RegExp(
    "\\byou feel\\b|\\bweak|\\bpoison|\\btrap|^you fall through\\b|^you fell\\b|\\bfall down the shaft\\b" +
    "|^you are hit by\\b|\\bhit points? damage\\b|\\bmobuls?\\b|\\b(?:running out of|low on) time\\b|\\bhurry\\b" +
    "|^you went down to level\\b|\\benveloped by the zone\\b", "i")],
  ["system", new RegExp(
    "^(?:welcome\\b|press\\b|exploring\\b|stopped\\b|game saved\\b|saving\\b|auto-loot\\b" +
    "|travel(?:ling)? to stairs\\b|sorry, your (?:game|saved game)\\b)|\\bpress \\w\\b", "i")],
];

const decode = (_, code, name) =>
  code ? String.fromCharCode(Number(code)) : NAMED[name.toLowerCase()] ?? `&${name};`;

/** Engine HTML to plain, trimmed text. */
export const plainLine = (html) =>
  String(html ?? "").replace(TAGS, "").replace(ENTITIES, decode).replace(SPACES, " ").trim();

/** "kill" | "combat-in" | "combat-out" | "loot" | "warn" | "system" | "plain" */
export const lineKind = (html) => {
  const text = plainLine(html);
  if (!text) return "plain";
  for (const [kind, pattern] of KINDS) if (pattern.test(text)) return kind;
  return "plain";
};
