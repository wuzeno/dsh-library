# Changelog

## 1.0.0 — Release · Unified positioning

- Promote the plugin to 1.0.0. The positioning is now stated once, in one voice, in the package description, the plugin/component card and the README opening: every workspace gets its own library automatically, all libraries live in one local folder you choose, one panel manages them, any file format can go in, and each conversation decides whether the answer may use the library.
- `package.json` carries the same Chinese sentence the host renders on the plugin card (the English equivalent lives in `locale/en.json`), so the list card, the component card and the README no longer describe three different products.
- Export `BACKEND_VERSION` from `src/http.js` instead of an inline literal so the snapshot, the tests and the manifest cannot drift apart; `scripts/check.mjs` now fails when it differs from `package.json`, or when `CHANGELOG.md` has no section for the current version.
- Harden library deletion before the first public release: persist irreversible intent before removing bytes, refuse restoration after partial deletion, and allow ownership-checked retries. Reject nested-library roots and refuse deleting a directory containing another registered library.
- Enforce the eight-library session limit after including the default library.
- Add GitHub installation instructions, sanitized screenshots, repository links and reproducible release packaging. Existing 0.2.x entries below are historical development records, not claims that all real-host acceptance checks are complete.

## 0.2.5 — Preview · Confirmed library deletion

- Add “删除资料库” to the detail header of deactivated (archived) libraries only. Active libraries keep just deactivate/rename; restoring the library removes the delete entry again.
- Confirmation requires typing the exact library name, states permanence, lists how many files will go (including recycle-bin counts and the library's own path), and blocks busy or unloadable libraries. Deleting removes the library record together with its own local directory — originals, extracted caches, recycle-bin entries and pending-deletion records — and nothing outside it.
- Source folders, other libraries, and attachments already delivered to past sessions are untouched. A partial failure keeps the library record, reports what was removed, and never claims success; the client refreshes and can retry.
- Advertise `capabilities.deleteLibrary` in authenticated snapshots so an older running backend keeps an un-updated client from deleting anything; `backendVersion` moves to 0.2.5. Model-facing tools still have no deletion authority.
- Real-Host acceptance (actual filesystem removal and dialog behaviour) still requires a full DSH restart and manual verification.
- Rewrite the plugin description from one 258-character run-on paragraph into four short sentences (116 characters): what the library is, what import does not do, when files become usable, and what deletion requires. The host repeats this text in both the plugin card and the component card, so the verbose version read as duplicated boilerplate; the dropped caveats stay in README, SECURITY and docs/validation.

## 0.2.4 — Preview · Import confirmation dialog

- Replace the bottom-of-page folder import preview with a centred native modal dialog and dimmed backdrop. Keep the file list scrollable and the action footer visible on small screens.
- Support Escape, close and cancel without uploading; default keyboard focus to cancel and restore the previous focus without scrolling the page. Preserve the existing explicit confirmation, queue limits, skip reports and selected-library guards.
- This is a client-only change; backend capability versions remain unchanged. Real-host visual acceptance is separate from automated handler tests.

## 0.2.3 — Preview · Mixed backend/client protection

- Advertise bulk-recycle capability and running-handler version in authenticated snapshots, checking the actual store method rather than trusting stale metadata. A new handler with an older store rejects bulk writes with an explicit backend-update error.
- Gate the whole-library button and confirmation form on the running backend capability. An absent/false capability explains that the backend has not declared support and asks for a full DSH process restart; single-file actions remain available.
- Explain the exact old-handler “未知资料库操作。” response as a frontend/backend mismatch; refresh the capability snapshot but never automatically retry writes or silently fall back to per-file requests.
- Correct the earlier advice that toggling the plugin alone guarantees reloading linked Host modules. Reload behavior depends on runtime HMR; fully exiting and restarting DSH is the reliable manual activation step. No host process was restarted automatically and no user library was modified by this fix.

## 0.2.2 — Preview · Confirmed whole-library recycling

- Add “全部移入回收区” to the file list. Exact library-name confirmation covers every non-recycled file, including excluded files, regardless of search or status filters; busy, empty and deactivated libraries are blocked.
- Add a browser-only trashAll action with one serialized batch mutation. Preserve each original status for restore and leave existing recycle-bin/pending-deletion records unchanged. No original/source file is moved or deleted and no model management tool gains batch authority.
- Refresh after success and display the actual server-reported moved count. Failure retains the confirmation dialog for retry; refresh failure after submission is explicitly distinguished from an uncommitted operation.
- Test only affected store/HTTP/Client paths using synthetic temporary data. This feature does not itself recycle any existing user library. Real-Host interaction still requires manual acceptance after reloading both plugin sides.

## 0.2.1 — Preview · Confirmed permanent deletion

- Add browser-only recycle-bin permanent deletion and empty-bin actions. Confirm an exact filename for one file or the full library name for the entire bin; active files are never included, even when the bin list is filtered.
- Delete only fixed, ownership-checked paths under the selected library's originals/extracted directories. Source paths, source folders, other libraries and already-delivered conversation attachments are not deletion targets. No recursive directory removal and no model deletion tool.
- Persist deletion intent before unlinking; interrupted or failed deletion remains marked pending, cannot be restored, and can be explicitly retried. Partial failure is not reported as complete success.
- Add Client and store/HTTP regressions using synthetic temporary files. No existing user files are deleted by implementing or testing this release. Real-Host destructive interaction remains a separate manual acceptance step.

## 0.2.0 — Preview · Project original-file libraries

- Reposition each workspace library as original files plus metadata. Import any non-empty format without text extraction, full-text indexing, OCR or background media understanding.
- Add `library_files` for authorized filenames/sources and `library_open` for on-demand native attachments via `ctx.attachments.saveFile`. The Host must project read-only paths as for chat attachments, allowing file tools/skills to read only when needed; this integration is not yet accepted on the real Host.
- Detect PNG/JPEG/WebP/GIF by magic bytes only when opening; use `ctx.attachments.saveImage` for native image blocks without changing originals. If image admission fails, explicitly fall back to a generic file rather than claiming visual understanding.
- Add `settings.originalConsent`, default false. Legacy `cloudConsent` covered snippets only and must not silently become whole-original permission; users must reconfirm in Storage & Privacy. Disabling consent cannot retract sent conversation attachments or content already seen by a model.
- Keep session/workspace cross-library authorization and privacy boundaries. Library mode uses authorized references, distinguishing citations from model knowledge/inference; no match does not force a refusal. General mode injects no library metadata body and denies files/open.
- Keep the default 50 MiB per-file limit, configurable to integer 1–200 MiB; reject empty files, count recycled files toward the 2000-file library cap, and retain bounded folder/batch scanning.
- Remove extracted-text/chunk previews, full-text search tests and retry-parsing UI. Retain original downloads, exclusion/inclusion in AI references, recycling and restore.
- Allow legacy ready/error/stored records to be used on demand without modifying originals, reparsing or deleting old extracted directories. Historical documents/parse helpers and tests remain, but the runtime store does not import or call them; mammoth/pdfjs-dist move to development-only dependencies.
- Real Host update/installation, native file/image blocks, attachment projection and on-demand tool/skill reading have not yet been jointly verified. Version 0.2.0 is a preview, not a certified or accepted integration release. Earlier parser/retrieval entries below describe historical behavior, not the current runtime path.

## 0.1.2 — 2026-10-26 · Parser crash containment

- Replace per-document Worker parsing with an OS helper process, using Electron Node mode on Desktop; a JS Worker was not a native-fault containment boundary.
- Wait for actual helper exit and pipe closure before accepting success or starting the next file; bound stdout, drain diagnostics, reject abnormal exits and kill timed-out helpers.
- Keep a safe compatibility shim for an already-loaded legacy Worker caller, delegating parsing to the OS helper rather than importing native parser dependencies into a thread.
- Handle HTTP 502/503/504 and network loss with actionable feedback and stop the remaining batch without an automatic write retry storm.
- Add synthetic abnormal-exit, protocol, timeout, output-limit and Client unavailable-backend regressions. The exact native fault behind the reported Desktop crash remains unconfirmed; this release mitigates the parser containment risk, not a proven root-cause fix.

## 0.1.1 — 2026-10-26 · Import improvements

- Add Host-native folder selection next to the storage-root input, retaining manual input and explicit save/acknowledgement.
- Add a highlighted drop zone for files and recursive folders, plus a folder picker, bounded scan, source-relative-path preview/recording, explicit confirmation, ignored-directory reports and stop-after-current-file control. Deactivated/unconfigured libraries remain blocked.
- Make the per-file limit configurable from 1–200 MiB (default 50); validate the active limit at Client, HTTP stream, store and isolated parser boundaries. Existing settings acquire the default without moving data.
- Upload raw binary bytes instead of Base64 JSON, retaining authenticated browser-only admission, bounded headers and UUID storage; metadata paths cannot select disk locations.
- Add Client handler and backend regressions for directory traversal/batches/cancellation/budgets, dynamic upload limits and request safety. Native dialog interaction, real folder drag gestures and rendered progress still require target-host manual verification.

## 0.1.0 — 2026-10-26 · Preview

- Workspace-ID based local libraries and consolidated sidebar management.
- User-configured storage, copy import, TXT/MD/DOCX/text-PDF extraction and bounded BM25 retrieval.
- Source locators, version fingerprints, pre-request evidence, per-turn output budgets.
- Explicit session cross-library grants, privacy consent and general-mode switch.
- Recoverable file exclusion/recycling, library deactivation and detached associations.
- Automated parser/store/HTTP/Host-contract/Client-contract tests and GitHub CI configuration.

Not yet a certified DSH integration release: real Host installation, rendered UI, model-answer behavior and restart/uninstall acceptance remain required. No OCR, vector service, permanent deletion or automatic data migration.
