# UI Foundation

Актуальная визуальная спецификация интерфейса Psych Factcheck. Документ отражает утверждённый preview-дизайн и является source of truth для следующих экранов.

## Принципы

- Интерфейс проверяет утверждения и источники, а не людей.
- Не добавлять новые визуальные паттерны без отдельного решения.
- Цвет не является единственным сигналом: статусы всегда сопровождаются текстом.
- Использовать семантический HTML, доступные имена, keyboard navigation и visible focus.

## Typography

- Интерфейс: `Inter`, weights 400/500/600.
- Заголовки страниц и бренд: `Lora`, weight 600.
- Page title: 30px, line-height 1.2, weight 600.
- Mobile page title: 28px.
- Body: 14px, line-height 1.55.
- UI labels/buttons: 13–14px, line-height 20px, weight 500/600.
- Metadata: 11.5–13px, muted color.
- Не использовать другие гарнитуры или произвольные промежуточные размеры.

## Color tokens

```css
--ink: #1B1916;
--ink-2: #4A443C;
--muted: #8A8177;
--paper: #FFFFFF;
--line: #E7DFD4;
--line-soft: #F0EAE1;
--accent: #17604C;
--accent-soft: #EAF2EE;
--warning: #96670F;
--warning-soft: #FAEEDE;
--danger: #B4551F;
--danger-soft: #FBE5DF;
```

Основной фон приложения: тёплый светлый фон с мягкими radial gradients, заданный в `.preview`. Не добавлять новые цвета и не заменять палитру на холодную blue/gray-схему.

## Geometry and layout

- Header: 68px высотой, content-aligned, с responsive horizontal padding.
- Основной container: max-width 1184px; desktop padding 44px 32px 40px.
- Mobile breakpoint: 760px; mobile content padding 32px 20px.
- Controls: min-height 44px, border-radius 12px.
- Cards: white translucent surface, 1px border, border-radius 16px, без декоративных теней.
- Базовые spacing: 4, 8, 12, 16, 20, 24, 28, 32, 36, 44px; новые значения добавлять только при необходимости конкретного layout.

## Navigation

Header содержит бренд и ссылки «Проверки» / «Профиль». Активная вкладка обозначается цветом текста и нижним accent-индикатором. Профиль ведёт на `/ui-preview/profile`, проверки — на `/ui-preview/history`.

## Controls

- Primary button: accent background, white text, radius 12px, min-height 44px.
- Secondary button: white background, line border, ink-2 text, radius 12px.
- Все интерактивные controls имеют `cursor: pointer`, hover и `:focus-visible`.
- Disabled controls используют muted text/line, `cursor: not-allowed`, opacity только для disabled state.
- Inputs: white background, 1px line border, radius 12px, min-height 44–48px, Inter.

## Statuses and verdicts

Каждый статус передаётся текстом и цветом:

- Contradicted / «Расходится с данными»: `--danger` / `--danger-soft`.
- Disputed / «Спорное утверждение»: `--warning` / `--warning-soft`.
- Not found / «Данные не найдены»: тёплый бледно-жёлтый фон `#F6EFCF`, текст `#806C27`.
- Supported / «Данные подтверждены»: `--accent` / `--accent-soft`.
- Processing / «Выполняется»: warning text, animated indicator; reduced-motion отключает animation.
- Completed / «Готово»: accent text and check icon.
- Failed / «Ошибка»: danger text and cross icon.

## Implemented screens

- `/` (`?mode=signup` и `?mode=reset`) — авторизация/регистрация/восстановление; по умолчанию открывается вход.
- `/ui-preview/history` — список проверок, фильтры, pagination, context menu, clickable rows.
- `/ui-preview/new-check` — новая проверка и выбор видеофайла.
- `/ui-preview/processing` — вертикальный прогресс обработки.
- `/ui-preview/report` — отчёт с метаданными, segmented verdict chart, tabs утверждений и источниками.
- `/ui-preview/profile` — email, editable password и modal 6-digit confirmation.

## Responsive rules

- Desktop uses full centered container and multi-column metadata/forms.
- Tablet keeps hierarchy and wraps controls when needed.
- Mobile stacks metadata, form fields, claim content and action buttons vertically.
- Horizontal tab groups may scroll; disabled tabs remain visibly disabled.

## Product component contracts

Следующие компоненты зарезервированы для будущей реализации и не содержат бизнес-логики в UI foundation:

- `UploadDropzone` — выбор/drag-and-drop файла.
- `ClaimCard` — отдельное утверждение и его статус.
- `EvidenceCard` — краткое представление доказательства.
- `SourceReference` — ссылка и тип научного источника.
- `TranscriptSegment` — фрагмент транскрипта с таймингом.

## Accessibility

- Использовать semantic HTML (`header`, `nav`, `main`, `section`, `table`, `form`, `dialog`).
- У каждого input есть label или accessible name.
- Tabs используют `role=tablist/tab`, выбранный tab — `aria-selected`.
- Меню действий использует `role=menu/menuitem`, закрывается при клике вне меню.
- Modal использует `role=dialog`, `aria-modal` и accessible heading.
- Focus ring: зелёный полупрозрачный outline 3.5px.
- Анимации должны уважать `prefers-reduced-motion`.

## Design decisions

- Для preview используются локальные моковые данные; подключение backend/API не входит в UI foundation.
- «Удалить» в context menu пока закрывает меню и не удаляет данные.
- Кнопка отчёта на processing активируется только после завершения всех preview-шагов.
- Если точное состояние или layout не определены этим документом, требуется отдельное решение дизайна до реализации.
