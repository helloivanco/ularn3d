# Ularn desktop edition

Ularn remains playable in the browser. The optional desktop edition bundles the complete game and Chromium in an Electron application. It starts in its own window, works offline, and needs neither a browser installation nor a running web server. The rendering engine is still Three.js; a desktop package is not by itself a performance optimization.

## Windows players

Run `Ularn.windows.exe` from the website's optional Windows download. This single file contains the entire game and runtime; no ZIP extraction or installer is required. It unpacks its runtime into a temporary directory when launched, then starts the game. It targets 64-bit Windows 10 or later and is unsigned.

The ZIP edition is still available through the build commands: extract every file from `Ularn-1.0.0-windows-x64.zip` and run its `Ularn.exe`. The configured `Ularn-1.0.0-windows-x64-setup.exe` target is a separate installer for creating shortcuts. Public distribution should add code signing before claiming a verified publisher.

Saves and preferences live in `%APPDATA%\Ularn` and survive app restarts and upgrades. The portable and installed editions share these saves. Portable means no installer is required; saves remain in the Windows user profile rather than beside the executable. Existing browser saves belong to a different origin and are not automatically imported. Uninstalling keeps saved progress.

## Build locally

Requires Node.js 22.12 or newer and npm. Install and launch the built desktop game:

```sh
npm ci
npm run desktop
```

Create the self-contained Windows download in `release/Ularn.windows.exe`, then verify its embedded runtime and game files:

```sh
npm run desktop:package:win:portable
npm run desktop:verify:portable
```

The package script rebuilds the game first and never publishes anything. `desktop/electron-builder.yml` pins NSIS toolset `1.2.1`, whose native Apple Silicon compiler supports portable cross builds without Rosetta or Wine. electron-builder downloads and checksum-verifies that toolset automatically. Website files under `dist/downloads/` are excluded from the desktop package so the executable cannot recursively embed another copy of itself.

`npm run desktop:package:win` builds both portable and installer targets; use Windows or the included Windows CI workflow for the installer. `npm run desktop:package:win:zip` builds the ZIP alternative. To create only the unpacked Windows app directory, run `npm run desktop:package:win:dir`; all files in `release/win-unpacked/` must remain beside its `Ularn.exe`.

The `Windows desktop` workflow runs on demand, on tags matching `desktop-v*`, and on pull requests affecting desktop packaging. It tests the real Electron game, verifies the portable payload, then uploads the executables and portable checksum as the `Ularn-Windows-x64` workflow artifact. It does not create a public release or deploy the website. The workflow has not been run from this local task.

For a local macOS app bundle, run `npm run desktop:package:mac`; the unsigned app is placed below `release/`. macOS development saves live in `~/Library/Application Support/Ularn`.

## Verification and implementation

```sh
npm run test:desktop
```

This builds the game, checks local asset routing and path traversal rejection, then launches Electron with an isolated temporary profile. It verifies renderer isolation, starts a character, takes a turn, saves, fully exits and relaunches, and compares restored progress. It also checks remote requests and popups are blocked. The test captures `test-results/desktop.png` and removes its temporary saves.

`npm run desktop:verify:portable` separately tests and extracts the NSIS executable, compares every embedded DLL/runtime file with `release/win-unpacked`, and compares the game archive with `dist/` and the desktop entry points. It writes `release/Ularn.windows.exe.sha256`. This verifies a self-contained payload; running the Electron smoke test on macOS validates app logic and saves but does not execute the Windows binary.

`desktop/main.cjs` serves only packaged assets through `ularn://game/`, registered as a secure, standard scheme so absolute asset paths, ES modules, and persistent local storage work. The renderer is sandboxed, has context isolation, and has no Node.js access or preload bridge. Remote network requests, remote navigation, webviews, and permissions are blocked. Windows use background throttling, save the last stable turn on close, and flush local storage. The application has no update service or telemetry.

Implementation references: [Electron custom protocols](https://www.electronjs.org/docs/latest/api/protocol), [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [electron-builder toolsets](https://www.electron.build/docs/toolsets/), and [the NSIS bundle's native platform builds](https://github.com/electron-userland/electron-builder-binaries/tree/master/packages/nsis).
