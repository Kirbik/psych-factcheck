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

The `/ui-preview/*` pages are UI prototypes, not database-backed product flows:

- `/ui-preview/auth`
- `/ui-preview/history`
- `/ui-preview/new-check`
- `/ui-preview/processing`
- `/ui-preview/report`
- `/ui-preview/profile`

The actual `/` route hosts token login/registration UI. `/dashboard` is the currently persisted checks list and single-video upload entry. Login currently redirects to `/ui-preview/history`, so this route transition is not yet the final integration of the dashboard with the preview design.

## Known design alignment task

The preview CSS contains its own colors, typography, spacing, radii, shadows, and responsive rules. The root `UI_FOUNDATION.md` specifies Preline Default/Light tokens and components. Treat the foundation and approved screen references as the design authority; visually reconcile the preview implementation before calling those screens final. This is design alignment work, not evidence that upload, processing, report, or profile behavior is fully implemented.
