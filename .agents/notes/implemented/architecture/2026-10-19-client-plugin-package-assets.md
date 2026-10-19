# Agent Note: Client plugin package assets served by URL

Status: implemented

English | [中文](2026-10-19-client-plugin-package-assets.zh.md)

## Problem

The browser half of a dynamic Client plugin is a lazy-CJS factory built by the [client build preset](../../../../packages/client/tsdown.client.ts) and loaded through the `/plugins` route of the [Client module system](../../../../packages/client/modules/README.md). That route served only `client.js` and package-local chunks, so an image that plugin code referenced had to be embedded in the bundle as a base64 data URL, and an image used by a stylesheet needed a package-level build plugin that rewrote it into the inlined style.

The embedded bytes were downloaded and parsed with the JavaScript whether or not the image was shown, and base64 adds a third to their size: the onboarding illustrations made the ui-settings-account `client.js` about 3.4 MB. The Plugin Manager feature previews were embedded the same way, and ui-chat carried its own [tsdown plugin](../../../../packages/client/ui-chat/tsdown.config.ts) for one mask image.

## Decision

A Client plugin package keeps raw images under `src/client/assets/`. The shared preset emits each referenced image under `lib/assets/` and turns the reference into a document-relative URL; the package publishes the emitted files with `"exports": { "./assets/*": "./lib/assets/*" }` and `lib/assets` in `files`; the client-modules Host serves them at `/plugins/<package>/assets/<emitted path>`.

### References and file names

Client code imports an image (`import art from './assets/a.webp'`), and the package's own stylesheets reference one with a relative `url()`. Both compile to the same string. The emitted file name inserts the content revision, the first 12 hexadecimal digits of the SHA-1 digest of the bytes, before the extension, so one URL always names one content:

```text
src/client/assets/running-whale@2x.png
lib/assets/running-whale@2x-06738fa29b2f.png
plugins/@deepseek-ai/dsh-client-ui-chat/assets/running-whale%402x-06738fa29b2f.png
```

Each path segment is percent-encoded and the package name is emitted verbatim. The URL is relative to the shell document, like every app-owned route, so it resolves under any mount and from injected `<style>` text. Components need no hook, injected value, or service: the URL is a module constant.

The supported extensions are `.svg`, `.png`, `.webp`, `.jpg`, and `.jpeg`. [`src/assets.ts`](../../../../packages/client/modules/src/assets.ts) in client-modules owns the media-type table, the export key and target, the revision, the emitted name, and the URL, and the preset, the route, and the gates read them from there. The shared Client type root [`scripts/types/client-assets`](../../../../scripts/types/client-assets/index.d.ts), registered in [`tsconfig.base.client.json`](../../../../tsconfig.base.client.json), declares each extension as a module with a string default export; a test keeps it equal to the table.

### Build

The `dsh-package-asset` plugin of the dynamic browser face resolves an import against its source location and fails the build when the file's real path is outside the package's `src/client/assets/` (which also rejects another package's or a dependency's image), when `exports["./assets/*"]` is not exactly `./lib/assets/*`, when the extension is unsupported, or when a path segment contains `%`, `#`, `?`, `\`, or NUL, which the Host route cannot serve. It emits each file once per build and registers it as a watch input. The three CSS pipelines (CSS Modules, global, and `?inline`) rewrite relative `url()` values through a lightningcss visitor in stylesheets inside the package's own `src/`; `data:`, fragment, scheme, `/`-prefixed, and empty URLs stay unchanged, and dependency stylesheets are not rewritten. The Node Client face of a dual-face package rejects asset imports. The browser face is the only writer of `lib/assets/` and deletes files the current build did not emit.

### Host route

`bundleResource` matches `/plugins/<package>/assets/<path>` before the bundle tables, and such a path is answered by the asset route alone. For an active client row, the path is percent-decoded once and `createRequire(<package manifest>).resolve('<package>/assets/<path>')` applies the package's own exports, so unexported paths, `.` and `..` segments, missing files, and directories do not resolve. The media type comes from the resolved file's extension, because Node reads `#` and `?` in the subpath as URL syntax. Any resolution failure, an inactive package, and an unsupported type answer 404; the query selects nothing.

A served asset streams from disk on every request; the Host keeps neither its bytes nor a hash. It carries the media type, the bundle `cache-control: public, max-age=31536000, immutable`, `etag` equal to the requested path, `x-content-type-options: nosniff`, and, for SVG, `content-security-policy: script-src 'none'`. An `If-None-Match` equal to the tag answers 304 without opening the file; `HEAD` answers without a body. `fetchBundle()` returns the same responses with a streamed body that closes the file when cancelled.

### Changes and package manifests

A rebuilt image produces a new file name in a rebuilt `client.js`, which reaches the browser through the existing bundle HMR; assets have no channel of their own. Client-modules reads a package manifest on every reconciliation, that is, on each Loader entry construction and disposal, instead of caching it until restart, so an entry that restarts after a reinstall, upgrade, or move publishes its current declaration, client export, and manifest path; a reconciliation that reads the same manifest and bundle leaves the published graph unchanged.

### Gates and migration

[`check-workspace-constraints`](../../../../scripts/check-workspace-constraints.ts) requires `lib/assets` in `files` when the export is declared. [`verify-client-packages`](../../../../scripts/verify-client-packages.ts) requires the exact export target, allows the export only on dynamic Web Client packages, and keeps the export and the package's references (imports, and `url()` in the stylesheets its Client sources import) consistent in both directions. [`verify-package-dependencies`](../../../../scripts/verify-package-dependencies.ts) treats `./assets/*` as a non-code export. ui-settings-account, ui-plugin-manager, and ui-chat moved to package assets, and ui-chat's tsdown plugin is gone.

Images that third-party libraries load themselves (PDF.js fonts, cmaps, wasm, and workers), plugin metadata icons, detail-document images, and static-linked packages keep their own delivery.

## Alternatives considered

**Keep data URLs.** No route is needed, but the bytes travel and parse with the JavaScript, and every package that styles with an image writes its own build plugin.

**A runtime helper such as `require.asset(path)` on the factory `require`.** The URL is known at build time, so a helper only adds a nonstandard code-generation target; Vite and webpack asset modules also give an import a URL string.

**A Client Cordis service such as `ctx.assets.url(path)`.** Current consumers reference fixed files; a runtime lookup also cannot know the content revision without publishing a per-package asset list.

**Raw files in a package-root `assets/` without the build.** Authors could not preprocess them, so naming and format conversion would stay manual.

**The revision in a `?rev=` query, verified by the Host.** The Host must read a whole file to decide between 200 and 404, so a first request reads it twice and the Host must cache hashes by file metadata; a revision in the file name lets the Host only resolve and stream.

**The `client.js` revision as the asset revision.** That revision comes from the written bundle's metadata after the build, too late to appear in the bundle.

**Images in CSS only through JavaScript style objects.** Masks, backgrounds, and `@supports` fallbacks would move into components, while the URL is known at build time and the same rules rewrite `url()`.

**One plugin file protocol shared with detail documents.** Detail images read any package version from local, npm, or Git sources, need authentication because they trigger Host network access, and cache by source. Joining them would move authentication, source providers, and cache policy into client-modules; the Plugin Manager and Plugin Market detail routes stay separate until another consumer needs files of other packages.

**Manifests from Plugin Manager, or a manifest cache with change checks.** Plugin Manager lists bundles, not every client row, and resolves from the profile installation rather than the Loader resolution of the running entry. The failure was timing: a cache that outlived entry restarts. Rereading on each reconciliation and skipping unchanged results removes the cache instead of adding validation to it.

## Consequences

- The ui-settings-account `client.js` is 214 KB, and the account, Plugin Manager, and ui-chat bundles contain no image data URLs; an image costs one same-origin request when shown and may appear after layout.
- The WebWorker preview reaches `/plugins` only through its tunnel, so `<img>` and CSS requests do not reach the Host running in the Worker; the WebWorker runtime owns serving them.
- The Desktop forwarder rewrites `/plugins/` cache headers to `no-store`, so Desktop reads an asset again on each display.
- The Host does not compare file contents with the revision in the name: a file under `lib/assets/` edited in place keeps its immutable cache entries. Only the build writes that directory.
- `require.resolve` runs synchronously on each request; a local measurement took about 43 µs for an existing file and 170 µs for a missing one. The route does not check the resolved file's real path, so a symbolic link under `lib/assets/` that leads outside the package is served.
- A package outside this repository must reproduce the emitted-name rule; the Client module system README records it.
- Pruning `lib/assets/` assumes that the browser face is its only writer and that every rebuild runs every load; another writer or rolldown incremental caching requires a different pruning rule.
- An entry restart reads its bundle again (all client bundles total about 8.1 MB, the largest 1.0 MB); an unchanged result publishes nothing, so no graph frame (about 30 KB for 69 rows) is broadcast. Editing only `package.json`, without an entry restart, still takes effect at the next entry or Host restart.

## Testing

- [package-assets.client.spec.ts](../../../../packages/client/modules/tests/package-assets.client.spec.ts) composes the real Web server and compares every answer with `fetchBundle()`: headers including the SVG policy, 304 without opening the file, `HEAD`, 405, multi-chunk streaming, stream closing on cancel, and 404 for excluded subpaths, missing exports and files, `..`, `%2e%2e`, encoded `..`, an empty path, malformed escapes, decoded `%` and `#`, unsupported types, directories, and inactive packages.
- [assets.client.spec.ts](../../../../packages/client/modules/tests/assets.client.spec.ts) covers media types, the revision, emitted names, and references; [client-asset-types.spec.ts](../../../../scripts/client-asset-types.spec.ts) keeps the type root equal to the table.
- [client-bundle-css.spec.ts](../../../../scripts/client-bundle-css.spec.ts) covers emitted names and URLs, CSS rewriting and preserved forms, each build rejection, the Node face guard, and pruning.
- The gate specs reject each invalid manifest or reference form, and [node-half.client.spec.ts](../../../../packages/client/modules/tests/node-half.client.spec.ts) covers declarations, moved exports, and added or removed client declarations after an entry restart, and an unchanged restart that publishes nothing.
- [desktop-onboarding.e2e.ts](../../../../apps/web/tests/desktop-onboarding.e2e.ts) and [reasoning-preview.e2e.ts](../../../../apps/web/tests/reasoning-preview.e2e.ts) assert the package-asset URLs and decode the images in a browser.
