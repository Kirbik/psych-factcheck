# Design References and UI Preview Status

## Source of truth

The detailed product visual specification is [UI_FOUNDATION.md](../../UI_FOUNDATION.md) at the repository root. Approved product Figma screens take precedence when available. Do not treat a code prototype as an approved final design when it conflicts with those references.

## Screen reference images

The following PNGs are checked in as screen references:

1. [Sign in](01-vhod.png)
2. [Registration](02-registraciya.png)
3. [Home and recent checks](03-glavnaya-i-poslednie-proverki.png)
4. [Video upload](04-zagruzka-video.png)
5. [Video processing](05-obrabotka-video.png)
6. [Claim report](06-otchet-po-utverzhdeniyam.png)
7. [Check history](07-istoriya-proverok.png)

The same image set is also present in the root `design-prototypes/` folder and in `psych-factcheck-design-prototypes.zip`. `docs/design/` is the in-repository linked copy; avoid editing one copy without deciding whether the others should be synchronized.

## Preview routes

These root-level pages are UI prototypes, not fully database-backed product flows:

- `/auth`
- `/history`
- `/new-check`
- `/processing`
- `/report`
- `/profile`

`/new-check` submits the selected video through the authenticated upload API and displays the real upload status. Reloading during upload interrupts byte transfer; the same tab restores the paused progress view without briefly showing the later analysis stages. The resume action is a text link directly under the upload percentage. The user can resume the original file where the browser permits access, or select it again, and can cancel to choose a replacement. After upload, `/new-check` and `/processing?contentItemId=...` show persisted validation, screening, transcription, claim-extraction, evidence-search, and Session 12 judgment status; completed jobs mark judgment complete while report preparation remains pending. While a job is active, its current status message has an animated indicator. A high-confidence out-of-scope result is shown in the shared warning Alert. `/processing` without an ID remains a visual prototype. Session 12 progress code is deployed to Production; a fresh unrelated-video upload is still needed to verify the latest screening-duration fallback.

The actual `/` route hosts token login/registration UI. `/dashboard` is the currently persisted checks list and single-video upload entry. Login redirects to `/history`; legacy `/ui-preview/*` URLs redirect to the corresponding root-level paths.

## Known design alignment task

The preview CSS contains its own colors, typography, spacing, radii, shadows, and responsive rules. The root `UI_FOUNDATION.md` specifies Preline Default/Light tokens and components. Treat the foundation and approved screen references as the design authority; visually reconcile the preview implementation before calling those screens final. This is design alignment work, not evidence that upload, processing, report, or profile behavior is fully implemented.
