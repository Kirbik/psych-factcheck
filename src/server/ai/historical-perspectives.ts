import { z } from "zod";

export const HISTORICAL_PERSPECTIVES_VERSION = "historical-perspectives-v1";
export const historicalPerspectiveIdSchema = z.enum([
  "freud-repetition",
  "freud-forgetting",
  "adler-compensation",
  "adler-community",
]);

// Editorial paraphrases checked against the primary works below. These are
// historical interpretations for opinion only; never Evidence Package content.
export const HISTORICAL_PERSPECTIVES = [
  {
    id: "freud-repetition",
    author: "Зигмунд Фрейд",
    bookTitle: "По ту сторону принципа удовольствия",
    publicationYear: 1920,
    edition: "Немецкое издание, 1921",
    locator: "глава III",
    url: "https://www.gutenberg.org/files/28220/28220-h/28220-h.htm",
    paraphrase:
      "рассматривал повторение болезненных переживаний и сходных сценариев отношений как проявление навязчивого повторения",
    topics: "повторяющиеся отношения, болезненные сценарии, повторение опыта",
  },
  {
    id: "freud-forgetting",
    author: "Зигмунд Фрейд",
    bookTitle: "Психопатология обыденной жизни",
    publicationYear: 1901,
    edition: "Немецкое издание, 1904",
    locator: "глава I",
    url: "https://www.gutenberg.org/files/24429/24429-h/24429-h.htm",
    paraphrase:
      "предполагал, что в некоторых случаях забывание имён связано с вытесненным неприятным содержанием и ассоциациями",
    topics:
      "забывание, вытеснение, неосознаваемые мотивы; не недосып или лечение",
  },
  {
    id: "adler-compensation",
    author: "Альфред Адлер",
    bookTitle: "Познание человека",
    publicationYear: 1927,
    edition: "Немецкий оригинал Menschenkenntnis",
    locator: "общая часть, глава V, раздел 2",
    url: "https://www.textlog.de/adler-psychologie-machtstreben.html",
    paraphrase:
      "связывал чувство неполноценности со стремлением к признанию и превосходству, описывая также возможность чрезмерной компенсации",
    topics:
      "самооценка, неполноценность, признание, превосходство, компенсация",
  },
  {
    id: "adler-community",
    author: "Альфред Адлер",
    bookTitle: "Познание человека",
    publicationYear: 1927,
    edition: "Немецкий оригинал Menschenkenntnis",
    locator: "общая часть, глава V, раздел 2",
    url: "https://www.textlog.de/adler-psychologie-machtstreben.html",
    paraphrase:
      "подчёркивал значение чувства общности и участия в совместной жизни, противопоставляя их чрезмерному стремлению к власти над другими",
    topics: "общность, сотрудничество, отношения, стремление к власти",
  },
] as const;

export const historicalReferenceSchema = z
  .object({
    id: historicalPerspectiveIdSchema,
    claimId: z.uuid(),
    catalogVersion: z.literal(HISTORICAL_PERSPECTIVES_VERSION),
    author: z.string().min(1),
    bookTitle: z.string().min(1),
    publicationYear: z.number().int(),
    edition: z.string().min(1),
    locator: z.string().min(1),
    url: z.url(),
    paraphrase: z.string().min(1),
  })
  .strict();

export type HistoricalReference = z.infer<typeof historicalReferenceSchema>;

export function renderHistoricalReferences(
  opinion: string,
  references: readonly HistoricalReference[],
) {
  if (references.length === 0) return opinion;
  const examples = references.map(
    (reference) =>
      `${reference.author} в книге «${reference.bookTitle}» (${reference.publicationYear}, ${reference.locator}) ${reference.paraphrase}.`,
  );
  return `${opinion}\n\nИсторические параллели — пересказ теорий, не научное подтверждение: ${examples.join(" ")}`;
}
