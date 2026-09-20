import path from "node:path";

// @electron/asar walks nested entries with path.sep. Forward-slash archive
// paths therefore miss files such as dist/about/index.html on Windows.
export const toArchivePath = (file) =>
  String(file).replaceAll("\\", "/").split("/").filter(Boolean).join(path.sep);

export const toPosixPath = (file) => String(file).replaceAll("\\", "/");
