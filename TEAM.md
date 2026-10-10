# Team split

Four lanes. **You edit only the files your lane owns.** If you need a change in someone else's file, message the owner or open a PR and they review it. Files marked *shared* need a heads-up in the team chat before you touch them.

| Lane | Owner | Mission |
|---|---|---|
| **A. Agent & API** | Bennish | The stuck-case solver gives correct, cited, confidence-rated answers and refuses unsafe requests |
| **B. Document Cart** | _name_ | Photo → on-device read → user confirms → "Not ready / Almost ready / Ready to book" |
| **C. App & UI** | _name_ | Every screen a hesitant user touches: chat, answer card, voice buttons, status, assisted mode, PWA |
| **D. Knowledge, language & eval** | _name_ | The corpus the agent reads, the voice and translation services, UI translations, and the eval that proves we beat a chatbot |

Plan references (§) point to [docs/implementation.md](docs/implementation.md). Search the code for your lane's tag to find every stub: `TODO(agent)`, `TODO(cart)`, `TODO(frontend)`, `TODO(voice)`.

---

## Lane A: Agent & API (Bennish)

**Owns**
```
backend/app/agent/**                 graph, state, prompts, every node
backend/app/llm.py  rag.py  corpus.py  pii.py  config.py  main.py
backend/app/routers/case.py  routers/health.py
backend/app/schemas.py               shared contract, A is steward
backend/scripts/ingest.py  query.py
backend/tests/test_api.py  test_pii.py
backend/pyproject.toml  uv.lock  Dockerfile
```

**Status (updated):** tasks 2 to 8 are built and tested (see `backend/tests/`); what remains is task 1 (first run with a Claude key and prompt tuning) and task 9. Provider switch: Claude, local Ollama (Qwen2.5-3B) or mock; set in `.env`.

**Tasks** (in order)
1. **Must.** Put a real `ANTHROPIC_API_KEY` in `.env` and get live answers from `triage` (Haiku) and `synthesize` (Sonnet). Tune both prompts.
2. **Must.** `retrieve`: query with `summary_en` and the raw text, merge the results, filter by service/category, re-weight by reliability and recency with a boost for official sources, dedupe by URL. Calibrate `LOW_CONFIDENCE` in `graph.py`; e5 scores bunch near 0.77 (§3.4 Retrieval design).
3. **Must.** `verify`: check each community remedy against the rule hits, set `conflicts_with_official`, and cluster contradicting remedies so the answer shows the conflict.
4. **Must.** `guardrail`: every citation id must exist in what was retrieved; no outcome or timeline promises; no forgery help. Regenerate once, then abstain.
5. **Must.** `triage` reads the `cart_issues` vocabulary (Interfaces §1) and asks its clarify question in the user's language.
6. **Must.** The unsafe prompts in `eval_cases.json` are refused or escalated.
7. **Should.** `action_draft`: name affidavit, RPO representation and grievance templates with `[____]` blanks, using only facts the user confirmed.
8. **Should.** Rate limiting per IP and thread; timeouts with friendly errors.
9. **Could.** `live_search` over allowlisted domains (cut first).

**Done when:** Journey B works (Hindi, police verification pending for 6 weeks): one clarify question, then a cited answer with a visible conflict and a confidence badge. "Write me a fake rent agreement" is refused with the legitimate route.

---

## Lane B: Document Cart

**Owns**
```
frontend/src/features/cart/**        CartPage, ocr.ts, extract.ts, checks.ts, types.ts, store.ts, tests
frontend/src/i18n/en/cart.json       your strings (Lane D translates them)
frontend/src/features/evisa/**       stretch, new folder
```

**Tasks** (in order)
1. **Must.** `ocr.ts` `preprocess`: resize to about 1600 px, grayscale, boost contrast on a canvas.
2. **Must.** `extract.ts` `classify`: PAN regex `[A-Z]{5}[0-9]{4}[A-Z]`, Aadhaar 12 digits, passport machine-readable zone lines with `<`, keyword anchors for the rest (§3.3).
3. **Must.** `extractFields` for PAN, Aadhaar, old passport, Class 10 marksheet, address proof and birth certificate. Keep `maskAadhaar` before anything is stored.
4. **Must, never cut.** Confirm/edit screen: show what we read, let the user fix every field, then mark the document `confirmed`. Manual entry when OCR fails.
5. **Must.** `checks.ts` `runChecks`:
   - Blockers: name mismatch (port `compare_names` from §3.3; `fastest-levenshtein` is installed), DOB mismatch between documents, completeness for the application type, age vs application type. **DOB-proof type is now unblocked:** the plan's "birth certificate if born on or after 26 Jan 1989" was outdated. Lane D verified the real rule from the official portal in `backend/data/rules/dob-proof.md` (`verified: true`): a birth certificate is the only proof for people born on or after **1 Oct 2023**; older applicants may use any one of the listed documents (school certificate, PAN, service record, driving licence, voter ID, LIC policy); PAN, service record, driving licence and voter ID count only if they show the exact date; and **Aadhaar is not a listed date-of-birth document** (it is accepted for address and identity). Code the check from that file, keep the cutoff date and accepted list in one constants file, and treat a date that differs between documents as a warning that commonly causes problems, since the portal says the final decision rests with the passport officer.
   - Warnings: address, parents' names.
   - Info: old passport expiry.
6. **Must.** Application-type picker (fresh / reissue / minor). Result card: verdict, then found / why / fix for each issue. Wording is "commonly causes problems", never "will be rejected".
7. **Must.** "Fix with Mitra" button (Interfaces §2).
8. **Should.** Vitest tests for `extract.ts` and `checks.ts` (`npm test`).
9. **Should.** Three clean demo images (Lane B owns demo document setup).
10. **Could.** M6 e-Visa pre-check in `features/evisa/`, using `evisaRules` from `src/lib/reference.ts` (§4.2).

**Done when:** Journey A works: photograph Aadhaar, PAN and marksheet, confirm the fields, see "Not ready to book" with the name mismatch, tap "Fix with Mitra", and land in the chat with the issue already filled in.

**Never commit real ID photos.** Use your own documents locally only, or clearly marked sample images with dummy numbers.

---

## Lane C: App & UI

**Owns**
```
frontend/src/App.tsx  main.tsx  index.css  index.html
frontend/src/components/**           Layout, BigButton, MicButton, ListenButton, ConfidenceBadge
frontend/src/features/{onboarding,home,stuck,status,assisted}/**
frontend/src/store/**                app state + reset registry (B and D only call it)
frontend/src/lib/**                  api.ts, sse.ts, speech.ts, langs.ts, reference.ts, types.ts (shared contract mirror)
frontend/src/i18n/en/{app,stuck,status}.json
frontend/vite.config.ts  package.json  package-lock.json  vercel.json  public/**
```

**Tasks** (in order)
1. **Must.** Journeys A and B end to end in the UI: chat polish, progress steps, clarify, answer card, draft viewer. Test against mock mode now and live mode when Lane A is ready.
2. **Must.** Voice UX on a real phone: `MicButton` (Sarvam recorder → browser recognition → typing), `ListenButton`. Split long answers into short spoken segments with "next" (§3.6). Text is always shown with audio.
3. **Must.** Loading, error and offline states. Large tap targets, screen-reader labels, high contrast (§5, §6 Accessibility).
4. **Must.** Share summary: text now, image if time allows.
5. **Should.** Status page: journey timeline (6 stages, §3.5), plus the chip "files pending over 30 days in your state, Dec 2025, official count" from `pvPending` in `src/lib/reference.ts`. It is never shown as a prediction.
6. **Should.** Assisted mode: printable one-page summary (client initials, issues, fixes) and an issues-first fast flow (§3.7).
7. **Should.** Frontend deploy (Vercel, `VITE_API_BASE`), then install the PWA on a phone.
8. **Freeze.** Record the fallback demo video.

**Done when:** a first-time user can complete both journeys on a phone without help, by voice or by typing.

---

## Lane D: Knowledge, language & eval

**Owns**
```
backend/data/**                      rules/, cases/, glossary.json, status_map.json, eval_cases.json, reference/, fixtures/
backend/app/speech.py  glossary.py  translation.py  status.py
backend/app/routers/speech.py  routers/status.py
backend/scripts/eval.py              new
backend/tests/test_data.py
frontend/src/i18n/{hi,ta,mr,bn}/**   all non-English UI strings
```

**Tasks** (in order)
1. **Must.** Write 6–8 rule files in `data/rules/` from passportindia.gov.in. Cover document lists per application type, DOB proof, name change, address proof, police verification, Tatkaal and minors. Paraphrase in your own words and include `url` and `date_retrieved`. Set `verified: true` only after comparing against the live page. **Verify first, because the code depends on them:** (a) the date-of-birth proof rule: **done** (`dob-proof.md`, from the official portal; optionally also cite the Gazette notification at egazette.gov.in for the 2025 amendment); (b) the document list per application type from the Document Advisor on passportindia.gov.in; (c) the A/B/C counter flow, from the official PDF "Steps to Submit an Application at PSK" (it is image-only, so read it by eye).
2. **Must.** Write 15+ case cards in `data/cases/` (§4.4 list). Own words, URL, reliability score. `category` must be one of the triage categories (Interfaces §4).
3. **Must.** `make ingest`, then run 10 test questions with `make query q="..."` and send retrieval misses to Lane A.
4. **Must.** Get a Sarvam key and test `/api/tts`, `/api/stt` and `/api/translate` live on a 5-second clip. Fix `speech.py` parameters and pick a voice per language (`SARVAM_TTS_SPEAKER`).
5. **Must.** UI translations for `hi` and `ta` first, then `mr` and `bn`. `npm run i18n:check -- --verbose` lists what's missing. Get a native speaker to check them.
6. **Must.** `translation.localize_answer`: translate the answer text using the glossary. Ids, URLs, dates and form/annexure names stay unchanged (Interfaces §5).
7. **Should.** Glossary of about 40 terms, native-speaker checked. Status map of 10–15 patterns.
8. **Should.** Eval (§8.1): 20–30 stuck cases plus 5 unsafe ones in `eval_cases.json`. `scripts/eval.py` runs them through `/api/case`. Score against a plain chatbot baseline.
9. **Freeze.** Demo script and the problem slide (figures in `data/reference/`).

**Done when:** retrieval finds the right case for 8 of 10 test questions, Hindi and Tamil answers read naturally to a native speaker, and the eval table exists.

---

## Where the data comes from, and what is only our judgment

Nothing from government sites has been collected yet: today the corpus is one e-Visa rule file and one case card, and the figures in `data/reference/` are copied from the plan. Lane D's first job is to fix that.

| Layer | What it is | Where to get it | Used for |
|---|---|---|---|
| **1. Law** | Passports Act 1967, Passport Rules 1980 and amendments, Annexures (affidavit forms) | passportindia.gov.in PDFs (Passport_Rules_1980, Revised_Annexures); amendments from egazette.gov.in | Rule files, draft templates |
| **2. Applicant-facing rules** | Document Advisor, per-service document lists, FAQs | passportindia.gov.in | Document Cart checks, rule files |
| **3. Officer instructions** | Passport Manual (only some chapters are public) | passportindia.gov.in disclosed-chapters PDF | Rule files |
| **4. Office practice** | What one PSK or RPO actually accepts | **No official source.** Community Q&A (Kaanoon, TechEnclave, public Reddit), RTI replies, asking at a PSK | Case cards, always marked as community sources with a reliability score |

How we collect: by hand, not by scraping. A person reads the page, writes it in their own words, and records the URL and date. Some official PDFs are image-only, and a person must compare each rule against the live page before `verified: true`.

**What is our judgment, not an official standard.** Government sources say which documents are required and valid. They do not publish how strictly names must match or how officers weigh a mismatch. So the name-matching tolerances in the plan (exact, reordered, initials, fuzzy at 0.85) are our own starting guess. The Document Cart is our approximation of what Counter B checks. It is not the officers' algorithm, and the app must never say it is.
- Hard blockers only for clear rule violations: a missing required document, a date-of-birth mismatch between documents, a proof type the rules do not accept.
- Reordered names, initials and fuzzy matches are warnings, never blockers.
- Adjust the 0.85 threshold as real cases show what actually gets returned.

**The A/B/C counters** (from secondary sources, still unverified): A = service-provider staff (scrutiny, biometrics, fee); B = Verifying Officer, government (originals checked, stamped); C = Granting Officer, government (decides, and decides whether police verification is needed).

---

## Shared files: ask first

| File | Steward | Rule |
|---|---|---|
| `backend/app/schemas.py` + `frontend/src/lib/types.ts` | A + C | The API contract. Change both in the same PR and post the change in chat. |
| `backend/pyproject.toml`, `uv.lock` | A | Adding a Python package? Tell A. After merging main, run `uv lock` if the lock conflicts. |
| `frontend/package.json`, `package-lock.json` | C | Adding an npm package? Tell C. After merging main, run `npm install` if the lock conflicts. |
| `.env.example`, `Makefile`, `README.md`, `CLAUDE.md`, `.github/**` | A | Ask before changing. |
| `docs/implementation.md` | everyone | Read-only reference. |

---

## Interfaces between lanes

These are the only places lanes touch. Keep them stable, and if you must change one, tell the other side first.

1. **Cart → Agent: `cart_issues`** (B produces, A consumes). Strings in the form `<check>:<detail>`. They contain no names, numbers or dates:
   `name_mismatch:aadhaar_vs_marksheet`, `name_order:pan_vs_aadhaar`, `name_initials:pan_vs_marksheet`, `dob_mismatch:aadhaar_vs_birth`, `dob_proof_missing`, `address_mismatch:address_vs_aadhaar`, `parent_name_mismatch:marksheet_vs_birth`, `passport_expired`, `minor_flow_required`, `missing_document:<doc>`.
   Document names are the `DocType` values: `aadhaar pan passport marksheet address birth`.
2. **Cart → Chat: "Fix with Mitra"** (B calls, C consumes; already wired). B calls `useApp.getState().setHandoff({ text, cartIssues })`, then `navigate('/stuck')`. The chat pre-fills `text` and sends `cartIssues`.
3. **Agent → UI: `CaseResult` / `Answer`** (A produces, C renders). The shapes are in `schemas.py` / `types.ts`. SSE events: `progress`, `clarify`, `result`, `error`.
4. **Data → Agent: corpus format** (D writes, A validates in `corpus.py`). Templates: `data/rules/_TEMPLATE.md` and `data/cases/_TEMPLATE.json`. `make ingest` fails loudly on bad files.
   - `category` must be one of: `name_discrepancy name_change_marriage dob_mismatch no_birth_certificate address_mismatch adverse_pv pv_delay minor_consent lost_passport refund_reschedule single_name other`.
   - `service` must be one of: `fresh reissue minor lost_damaged tatkaal pcc evisa`.
   - Adding a category means Lane A adds it to `Triage` in `nodes/triage.py` too.
5. **Agent → Language: `translation.localize_answer(answer, lang) -> Answer`** (A's `localize` node calls it, D implements it). Raise `LocalizationUnavailable` and the user gets English with a note.
6. **Speech → UI: HTTP 503 means "use the browser"** (D's endpoints, C's `lib/speech.ts`). Don't change status codes without telling C.
7. **Reference data → UI:** `frontend/src/lib/reference.ts` imports `backend/data/reference/*.json` read-only. D keeps the field names stable.

---

## Timeline (§7.2, adapted for four)

| Time | A: Agent | B: Cart | C: App & UI | D: Knowledge & language |
|---|---|---|---|---|
| **0:30–1:30** | Live Claude answers; `retrieve` merge + filters | Preprocess, classify, extract PAN + Aadhaar | Chat + answer card polish (mock mode); mic/listen on a phone | 4 rules + 8 cases ingested; Sarvam tested live |
| **1:30–3:00** | `verify`, `guardrail`, confidence calibration | Confirm/edit screen, all checks, result card, Fix with Mitra | Status timeline + PV chip; assisted summary; error states | All rules and cases; hi + ta strings; `localize_answer` |
| **3:00–4:00** | Integration: Journeys A and B in en / hi / ta. **Everyone on main, everyone runs `make dev`.** | | | |
| **4:00–4:40** | Fix eval failures; `action_draft` | Demo samples; e-Visa stretch | Polish; deploy frontend | Run eval; glossary check; demo script |
| **4:40–5:00** | **Freeze.** Smoke test twice. Fallback video. No new features. | | | |

Cut list if behind (§7.3): live search → WhatsApp → e-Visa → assisted extras → mr/bn → speech-to-text → drafts → clarify.

**Never cut:** confirm/edit screen, citations, confidence badge, disclaimer, Aadhaar masking.

---

## Git workflow

1. Work in the home repo: `git clone https://github.com/Kaveeshwar18/google-gdg-devfest-2026.git`. Run `gh auth setup-git` once if a push fails on authentication.
2. Branch per task with your lane prefix: `agent/verify-node`, `cart/checks`, `ui/status-timeline`, `data/rules-batch-1`.
3. Small PRs into `main`, at least every hour. Run `make check` before you push; CI must be green.
4. Pull `main` often (`git pull origin main`) so integration at 3:00 holds no surprises.
5. A PR that touches another lane's files needs that owner's approval.
6. Never force-push `main`. Never commit `.env`, keys or real document photos.
