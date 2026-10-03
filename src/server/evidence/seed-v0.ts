import { createHash } from "node:crypto";
import { z } from "zod";

const sourceSchema = z.object({
  sourceKey: z.string().min(1).max(160),
  title: z.string().min(1).max(1000),
  authors: z.array(z.string().min(1)).min(1),
  journal: z.string().min(1).max(300),
  publisher: z.string().min(1).max(200),
  publishedAt: z.iso.date(),
  doi: z
    .string()
    .regex(/^10\.\d{4,9}\/.+/)
    .optional(),
  isbn: z
    .string()
    .regex(/^[0-9Xx-]{10,17}$/)
    .optional(),
  url: z.url().refine((value) => value.startsWith("https://")),
  sourceType: z.enum([
    "journal_article",
    "systematic_review",
    "meta_analysis",
    "commentary",
    "book",
    "textbook",
    "monograph",
  ]),
  status: z.enum(["active", "corrected", "retracted", "withdrawn"]),
  licenseCode: z.enum([
    "CC-BY-4.0",
    "CC-BY-3.0",
    "CC-BY-NC-4.0",
    "ALL-RIGHTS-RESERVED",
  ]),
  licenseUrl: z
    .url()
    .refine((value) => value.startsWith("https://"))
    .nullable(),
  licenseVerifiedAt: z.iso.date(),
  rightsPermission: z
    .object({
      basis: z.literal("user_attested_legal_permission"),
      confirmedAt: z.iso.date(),
      uses: z
        .array(
          z.enum(["store_excerpts", "create_embeddings", "retrieve_for_llm"]),
        )
        .length(3)
        .refine((uses) => new Set(uses).size === uses.length),
    })
    .optional(),
  topicTags: z
    .array(
      z.enum([
        "romantic_relationships",
        "couple_communication",
        "sexual_communication",
        "sexual_satisfaction",
        "sexual_wellbeing",
      ]),
    )
    .optional(),
});

const chunkSchema = z.object({
  sourceKey: z.string().min(1).max(160),
  chunkKey: z.string().min(1).max(160),
  content: z.string().trim().min(40).max(4000),
  locator: z.string().trim().min(1).max(500),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
});

export const evidenceSeedSchema = z
  .object({
    sources: z.array(sourceSchema).min(1),
    chunks: z.array(chunkSchema).max(1000),
  })
  .superRefine((seed, context) => {
    const sourceKeys = new Set<string>();
    const sourcesByKey = new Map<string, z.infer<typeof sourceSchema>>();
    const dois = new Set<string>();
    for (const [index, source] of seed.sources.entries()) {
      if (
        (source.doi && source.sourceKey !== `doi:${source.doi}`) ||
        (!source.doi &&
          (!source.isbn || source.sourceKey !== `isbn:${source.isbn}`))
      ) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "sourceKey"],
          message: "Source key must be derived from its DOI or ISBN",
        });
      }
      const expectedLicensePath = {
        "CC-BY-4.0": "/licenses/by/4.0/",
        "CC-BY-3.0": "/licenses/by/3.0/",
        "CC-BY-NC-4.0": "/licenses/by-nc/4.0/",
      }[source.licenseCode as "CC-BY-4.0" | "CC-BY-3.0" | "CC-BY-NC-4.0"];
      if (source.licenseCode === "ALL-RIGHTS-RESERVED" && source.licenseUrl) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "licenseUrl"],
          message:
            "All-rights-reserved sources must not declare a reuse license URL",
        });
      } else if (
        source.licenseCode !== "ALL-RIGHTS-RESERVED" &&
        (!source.licenseUrl ||
          !source.licenseUrl.startsWith(
            `https://creativecommons.org${expectedLicensePath}`,
          ))
      ) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "licenseUrl"],
          message: "License URL does not match the declared license",
        });
      }
      if (source.doi && source.isbn) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "isbn"],
          message: "A source must use either a DOI or an ISBN identifier",
        });
      }
      if (sourceKeys.has(source.sourceKey)) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "sourceKey"],
          message: "Duplicate source key",
        });
      }
      if (source.doi && dois.has(source.doi)) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "doi"],
          message: "Duplicate DOI",
        });
      }
      sourceKeys.add(source.sourceKey);
      sourcesByKey.set(source.sourceKey, source);
      if (source.doi) dois.add(source.doi);
    }

    const chunkKeys = new Set<string>();
    for (const [index, chunk] of seed.chunks.entries()) {
      if (!sourceKeys.has(chunk.sourceKey)) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "sourceKey"],
          message: "Chunk references an unknown source",
        });
      }
      const source = sourcesByKey.get(chunk.sourceKey);
      if (
        source &&
        source.licenseCode !== "CC-BY-4.0" &&
        source.licenseCode !== "CC-BY-3.0" &&
        !source.rightsPermission
      ) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "sourceKey"],
          message:
            "Evidence text requires a reusable CC BY license or recorded legal permission",
        });
      }
      const key = `${chunk.sourceKey}\u0000${chunk.chunkKey}`;
      if (chunkKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "chunkKey"],
          message: "Duplicate chunk key for source",
        });
      }
      chunkKeys.add(key);
    }
  });

const verifiedDate = "2026-10-01";
const ccBy4 = "https://creativecommons.org/licenses/by/4.0/";
const allRightsReserved = "ALL-RIGHTS-RESERVED";

export const evidenceSeedV0 = evidenceSeedSchema.parse({
  sources: [
    {
      sourceKey: "doi:10.1371/journal.pone.0207629",
      title:
        "Fake science: The impact of pseudo-psychological demonstrations on people’s beliefs in psychological principles",
      authors: ["Yuxuan Lan", "Christine Mohr", "Xiaomeng Hu", "Gustav Kuhn"],
      journal: "PLOS ONE",
      publisher: "Public Library of Science",
      publishedAt: "2018-11-27",
      doi: "10.1371/journal.pone.0207629",
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0207629",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2024.1428732",
      title:
        "Is it really a neuromyth? A meta-analysis of the learning styles matching hypothesis",
      authors: ["Virginia Clinton-Lisell", "Christine Litzinger"],
      journal: "Frontiers in Psychology",
      publisher: "Frontiers Media SA",
      publishedAt: "2024-07-10",
      doi: "10.3389/fpsyg.2024.1428732",
      url: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1428732/full",
      sourceType: "meta_analysis",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.1038/s41539-021-00100-z",
      title:
        "Growth mindset and academic outcomes: a comparison of US and Chinese students",
      authors: [
        "Xin Sun",
        "Shaylene Nancekivell",
        "Susan A. Gelman",
        "Priti Shah",
      ],
      journal: "npj Science of Learning",
      publisher: "Springer Nature",
      publishedAt: "2021-07-19",
      doi: "10.1038/s41539-021-00100-z",
      url: "https://www.nature.com/articles/s41539-021-00100-z",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2022.572220",
      title:
        "Rethinking the Multidimensionality of Growth Mindset Amid the COVID-19 Pandemic: A Systematic Review and Framework Proposal",
      authors: ["Yun-Ruei Ku", "Catanya Stager"],
      journal: "Frontiers in Psychology",
      publisher: "Frontiers Media SA",
      publishedAt: "2022-07-01",
      doi: "10.3389/fpsyg.2022.572220",
      url: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.572220/full",
      sourceType: "systematic_review",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.1098/rsos.180390",
      title:
        "Searching for the bottom of the ego well: failure to uncover ego depletion in Many Labs 3",
      authors: ["Miguel A. Vadillo", "Natalie Gold", "Magda Osman"],
      journal: "Royal Society Open Science",
      publisher: "The Royal Society",
      publishedAt: "2018-08-01",
      doi: "10.1098/rsos.180390",
      url: "https://royalsocietypublishing.org/doi/10.1098/rsos.180390",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.1177/1948550619887702",
      title: "A Multilab Replication of the Ego Depletion Effect",
      authors: [
        "Junhua Dang",
        "Paul Barker",
        "Anna Baumert",
        "Margriet Bentvelzen",
        "Elliot Berkman",
        "Nita Buchholz",
        "Jacek Buczny",
        "Zhansheng Chen",
        "Valeria De Cristofaro",
        "Lianne de Vries",
        "Siegfried Dewitte",
        "Mauro Giacomantonio",
        "Ran Gong",
        "Maaike Homan",
        "Roland Imhoff",
        "Ismaharif Ismail",
        "Lile Jia",
        "Thomas Kubiak",
        "Florian Lange",
        "Dan-yang Li",
        "Jordan Livingston",
        "Rita Ludwig",
        "Angelo Panno",
        "Joshua Pearman",
        "Niklas Rassi",
        "Helgi B. Schiöth",
        "Manfred Schmitt",
        "A. Timur Sevincer",
        "Jiaxin Shi",
        "Angelos Stamos",
        "Yia Chin Tan",
        "Mario Wenzel",
        "Oulmann Zerhouni",
        "Li-wei Zhang",
        "Yi-jia Zhang",
        "Axel Zinkernagel",
      ],
      journal: "Social Psychological and Personality Science",
      publisher: "SAGE Publications",
      publishedAt: "2020-04-03",
      doi: "10.1177/1948550619887702",
      url: "https://journals.sagepub.com/doi/full/10.1177/1948550619887702",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-NC-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
      licenseVerifiedAt: verifiedDate,
      rightsPermission: {
        basis: "user_attested_legal_permission",
        confirmedAt: "2026-10-03",
        uses: ["store_excerpts", "create_embeddings", "retrieve_for_llm"],
      },
    },
    {
      sourceKey: "doi:10.1007/s00426-017-0862-x",
      title: "An updated meta-analysis of the ego depletion effect",
      authors: ["Junhua Dang"],
      journal: "Psychological Research",
      publisher: "Springer Nature",
      publishedAt: "2017-04-08",
      doi: "10.1007/s00426-017-0862-x",
      url: "https://doi.org/10.1007/s00426-017-0862-x",
      sourceType: "meta_analysis",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0292717",
      title:
        "Are most published research findings false? Trends in statistical power, publication selection bias, and the false discovery rate in psychology (1975–2017)",
      authors: ["Andreas Schneck"],
      journal: "PLOS ONE",
      publisher: "Public Library of Science",
      publishedAt: "2023-10-17",
      doi: "10.1371/journal.pone.0292717",
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0292717",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0280295",
      title:
        "Debriefing works: Successful retraction of misinformation following a fake news study",
      authors: ["Cormac M. Greene", "Gillian Murphy"],
      journal: "PLOS ONE",
      publisher: "Public Library of Science",
      publishedAt: "2023-01-20",
      doi: "10.1371/journal.pone.0280295",
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0280295",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0212592",
      title:
        "Telling a good story: The effects of memory retrieval and context processing on eyewitness suggestibility",
      authors: ["Jessica A. LaPaglia", "Jason C. K. Chan"],
      journal: "PLOS ONE",
      publisher: "Public Library of Science",
      publishedAt: "2019-02-21",
      doi: "10.1371/journal.pone.0212592",
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0212592",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: verifiedDate,
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0172855",
      title:
        "Satisfaction guaranteed? How individual, partner, and relationship factors impact sexual satisfaction within partnerships",
      authors: ["Julia Velten", "Jürgen Margraf"],
      journal: "PLOS ONE",
      publisher: "Public Library of Science",
      publishedAt: "2017-02-23",
      doi: "10.1371/journal.pone.0172855",
      url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0172855",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: "2026-10-02",
      topicTags: [
        "romantic_relationships",
        "sexual_communication",
        "sexual_satisfaction",
      ],
    },
    {
      sourceKey: "doi:10.1186/s13643-021-01719-0",
      title:
        "Improved couple satisfaction and communication with marriage and relationship programs: are there gender differences?—a systematic review and meta-analysis",
      authors: [
        "Zeinab Javadivala",
        "Hamid Allahverdipour",
        "Mohammad Asghari Jafarabadi",
        "Somaye Azimi",
        "Neda Gilani",
        "Vijay Kumar Chattu",
      ],
      journal: "Systematic Reviews",
      publisher: "BMC",
      publishedAt: "2021-06-21",
      doi: "10.1186/s13643-021-01719-0",
      url: "https://systematicreviewsjournal.biomedcentral.com/articles/10.1186/s13643-021-01719-0",
      sourceType: "meta_analysis",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: "2026-10-02",
      topicTags: ["romantic_relationships", "couple_communication"],
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2024.1420148",
      title:
        "Positive sexuality, relationship satisfaction, and health: a network analysis",
      authors: [
        "Giovanbattista Andreoli",
        "Chiara Rafanelli",
        "Paola Gremigni",
        "Stefan G. Hofmann",
        "Giulia Casu",
      ],
      journal: "Frontiers in Psychology",
      publisher: "Frontiers Media SA",
      publishedAt: "2024-06-06",
      doi: "10.3389/fpsyg.2024.1420148",
      url: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1420148/full",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: "2026-10-02",
      topicTags: [
        "romantic_relationships",
        "sexual_satisfaction",
        "sexual_wellbeing",
      ],
    },
    {
      sourceKey: "doi:10.60797/PSY.2025.6.1",
      title:
        "Взаимосвязь показателей эмоционального интеллекта и удовлетворенности романтическими отношениями у партнеров молодого возраста",
      authors: [
        "Мария Владиславовна Башутина",
        "Дмитрий Николаевич Чернов",
        "Анастасия Андреевна Кальчинская",
      ],
      journal: "Cifra. Психология, 1(6)",
      publisher: "Издательский дом «Цифра»",
      publishedAt: "2025-01-29",
      doi: "10.60797/PSY.2025.6.1",
      url: "https://psychology.cifra.science/archive/1-6-2025-january/10.60797/PSY.2025.6.1",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-4.0",
      licenseUrl: ccBy4,
      licenseVerifiedAt: "2026-10-03",
      topicTags: ["romantic_relationships", "couple_communication"],
    },
    {
      sourceKey: "doi:10.17759/sps.2021120109",
      title:
        "Социальные представления о брачном партнере: поколенческий подход",
      authors: ["Татьяна Петровна Емельянова", "Даниил Александрович Шмидт"],
      journal: "Социальная психология и общество, 12(1)",
      publisher:
        "Московский государственный психолого-педагогический университет",
      publishedAt: "2021-04-01",
      doi: "10.17759/sps.2021120109",
      url: "https://psyjournals.ru/journals/sps/archive/2021_n1/Emelyanova_Shmidt",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-NC-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
      licenseVerifiedAt: "2026-10-03",
      rightsPermission: {
        basis: "user_attested_legal_permission",
        confirmedAt: "2026-10-03",
        uses: ["store_excerpts", "create_embeddings", "retrieve_for_llm"],
      },
      topicTags: ["romantic_relationships"],
    },
    {
      sourceKey: "doi:10.17759/sps.2017080104",
      title:
        "Социально-психологические факторы удовлетворенности отношениями в молодых супружеских парах",
      authors: ["Олег Александрович Сычев"],
      journal: "Социальная психология и общество, 8(1)",
      publisher:
        "Московский государственный психолого-педагогический университет",
      publishedAt: "2017-03-26",
      doi: "10.17759/sps.2017080104",
      url: "https://psyjournals.ru/journals/sps/archive/2017_n1/sychev",
      sourceType: "journal_article",
      status: "active",
      licenseCode: "CC-BY-NC-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
      licenseVerifiedAt: "2026-10-03",
      rightsPermission: {
        basis: "user_attested_legal_permission",
        confirmedAt: "2026-10-03",
        uses: ["store_excerpts", "create_embeddings", "retrieve_for_llm"],
      },
      topicTags: ["romantic_relationships", "couple_communication"],
    },
    {
      sourceKey: "doi:10.21638/spbu16.2024.107",
      title:
        "Супружеские пары: значение психологического благополучия и субъективного одиночества для чувств любви",
      authors: ["Елена Геннадьевна Трошихина"],
      journal: "Вестник Санкт-Петербургского университета. Психология, 14(1)",
      publisher: "Санкт-Петербургский государственный университет",
      publishedAt: "2024-05-22",
      doi: "10.21638/spbu16.2024.107",
      url: "https://psyjournals.ru/journals/vspu_psychology/archive/2024_n1/Troshikhina",
      sourceType: "journal_article",
      status: "active",
      licenseCode: allRightsReserved,
      licenseUrl: null,
      licenseVerifiedAt: "2026-10-03",
      rightsPermission: {
        basis: "user_attested_legal_permission",
        confirmedAt: "2026-10-03",
        uses: ["store_excerpts", "create_embeddings", "retrieve_for_llm"],
      },
      topicTags: ["romantic_relationships"],
    },
    {
      sourceKey: "isbn:5-88782-394-1",
      title: "Психология и психотерапия семьи",
      authors: ["Эдмонд Георгиевич Эйдемиллер", "Виктор Викторович Юстицкис"],
      journal: "Книга; 2-е расширенное и дополненное издание",
      publisher: "Питер",
      publishedAt: "1999-01-01",
      isbn: "5-88782-394-1",
      url: "https://search.rsl.ru/ru/record/01000606829",
      sourceType: "monograph",
      status: "active",
      licenseCode: allRightsReserved,
      licenseUrl: null,
      licenseVerifiedAt: "2026-10-03",
      topicTags: ["romantic_relationships", "couple_communication"],
    },
    {
      sourceKey: "isbn:978-5-89353-338-5",
      title:
        "Теория семейных систем Мюррея Боуэна: основные понятия, методы и клиническая практика",
      authors: ["Кэтрин Бейкер", "Анна Яковлевна Варга"],
      journal: "Книга; научная редакция",
      publisher: "Когито-Центр",
      publishedAt: "2015-01-01",
      isbn: "978-5-89353-338-5",
      url: "https://www.hse.ru/edu/courses/795377934",
      sourceType: "textbook",
      status: "active",
      licenseCode: allRightsReserved,
      licenseUrl: null,
      licenseVerifiedAt: "2026-10-03",
      topicTags: ["romantic_relationships", "couple_communication"],
    },
    {
      sourceKey: "isbn:978-5-8291-1206-6",
      title: "Семейная психология: антология",
      authors: ["Лидия Бернгардовна Шнейдер"],
      journal: "Книга; антология",
      publisher: "Трикста; Академический проект",
      publishedAt: "2010-01-01",
      isbn: "978-5-8291-1206-6",
      url: "https://search.rsl.ru/ru/record/01004633364",
      sourceType: "textbook",
      status: "active",
      licenseCode: allRightsReserved,
      licenseUrl: null,
      licenseVerifiedAt: "2026-10-03",
      topicTags: ["romantic_relationships", "couple_communication"],
    },
    {
      sourceKey: "isbn:5-225-00129-7",
      title: "Введение в сексологию",
      authors: ["Игорь Семенович Кон"],
      journal: "Книга; учебное научное издание",
      publisher: "Медицина",
      publishedAt: "1988-01-01",
      isbn: "5-225-00129-7",
      url: "https://lib.mgppu.ru/OpacUnicode/index.php?url=%2Fauteurs%2Fview%2F3343%2Fsource%3Adefault%2Forder%3Atitle",
      sourceType: "monograph",
      status: "active",
      licenseCode: allRightsReserved,
      licenseUrl: null,
      licenseVerifiedAt: "2026-10-03",
      topicTags: ["sexual_wellbeing"],
    },
  ],
  chunks: [
    {
      sourceKey: "doi:10.1371/journal.pone.0207629",
      chunkKey: "abstract-purpose",
      locator: "Abstract — study purpose",
      language: "en",
      content:
        "We investigated whether witnessing a magic demonstration alters people’s beliefs in these pseudo-psychological principles. In the classroom, a magician claimed to use psychological skills to read a volunteer’s thoughts.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0207629",
      chunkKey: "method-sample",
      locator: "Method > Participants",
      language: "en",
      content:
        "We recruited 90 undergraduate students who enrolled for a psychology degree program at Tsinghua University (37 males). Our sample had a mean age of 19.6 years (SD = 1.2). All of the students attended a lecture on Psychology. The study was conducted in Mandarin.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0207629",
      chunkKey: "results-belief-change",
      locator: "Results > Does the demonstration change beliefs?",
      language: "en",
      content:
        "Whilst the demonstration did not change participants’ beliefs in the principle itself (BPPQ Belief), t(89) = .64, p = .54, Cohen’s d = .084, it significantly increased their beliefs that these principles were used in the performance (BPPQ Used), t(89) = 6.72, p < .001, Cohen’s d = .860, and that these principles can be used more generally (BPPQ General), t(89) = 3.24, p < .001, Cohen’s d = .379.",
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2024.1428732",
      chunkKey: "methods-inclusion",
      locator: "Methods > Inclusion criteria",
      language: "en",
      content:
        "A systematic search of the research findings yielded 21 eligible studies with 101 effect sizes and 1,712 participants for the meta-analysis.",
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2024.1428732",
      chunkKey: "results-pooled-effect",
      locator: "Abstract > Results",
      language: "en",
      content:
        "Based on robust variance estimation, there was an overall benefit of matching instruction to learning styles, g = 0.31, SE = 0.12, 95% CI = [0.05, 0.57], p = 0.02.",
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2024.1428732",
      chunkKey: "results-crossover-limit",
      locator: "Abstract > Results and conclusion",
      language: "en",
      content:
        "Only 26% of learning outcome measures indicated matched instruction benefits for at least two styles, indicating a crossover interaction supportive of the matching hypothesis. Given the time and financial expenses of implementation coupled with low study quality, the benefits are interpreted as too small and too infrequent to warrant widespread adoption.",
    },
    {
      sourceKey: "doi:10.1038/s41539-021-00100-z",
      chunkKey: "study-one-sample",
      locator: "Abstract > Study 1",
      language: "en",
      content:
        "Study 1 (N > 15,000) confirmed that US students endorsed more growth mindsets than Chinese students.",
    },
    {
      sourceKey: "doi:10.1038/s41539-021-00100-z",
      chunkKey: "cross-cultural-association",
      locator: "Abstract > Academic outcomes",
      language: "en",
      content:
        "US students’ mathematics grades were positively related to growth mindsets with a medium-to-large effect, but for Chinese students, this association was slightly negative.",
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2022.572220",
      chunkKey: "review-scope",
      locator: "Methods > Search strategy",
      language: "en",
      content:
        "We completed a search in four major electronic databases (APA PsycInfo, Web of Science, Scopus, and Pubmed) for articles up through January 2022 (i.e., no date restrictions) related to a combination of search terms relating to growth mindset, implicit theories of intelligence, population age (college and university), intervention (e.g., educational intervention), and the type of study.",
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2022.572220",
      chunkKey: "review-findings",
      locator: "Abstract > Findings",
      language: "en",
      content:
        "Generally, these findings showed that brief messages of growth mindset can improve underrepresented students’ academic performance and facilitate other relevant psychological constructs.",
    },
    {
      sourceKey: "doi:10.1098/rsos.180390",
      chunkKey: "study-design",
      locator: "Abstract > Study design",
      language: "en",
      content:
        "We reanalysed data from a large-scale study—Many Labs 3—to test whether performing a depleting task has any effect on a secondary task that also relies on self-control.",
    },
    {
      sourceKey: "doi:10.1098/rsos.180390",
      chunkKey: "main-result",
      locator: "Abstract > Results",
      language: "en",
      content:
        "Although we used a large sample of more than 2000 participants for our analyses, we did not find any significant evidence of ego depletion: persistence on an anagram-solving task (a typical measure of self-control) was not affected by previous completion of a Stroop task (a typical depleting task in this literature).",
    },
    {
      sourceKey: "doi:10.1098/rsos.180390",
      chunkKey: "conclusion-caveat",
      locator: "Abstract > Conclusion",
      language: "en",
      content:
        "Our results suggest that either ego depletion is not a real effect or, alternatively, persistence in anagram solving may not be an optimal measure to test it.",
    },
    {
      sourceKey: "doi:10.1007/s00426-017-0862-x",
      chunkKey: "review-method",
      locator: "Abstract > Meta-analysis scope",
      language: "en",
      content:
        "The current project conducted a stricter and updated meta-analysis of ego depletion by carefully inspecting problems in earlier inclusion decisions, adding new studies not covered before, and testing the effectiveness of each depleting task.",
    },
    {
      sourceKey: "doi:10.1007/s00426-017-0862-x",
      chunkKey: "task-effectiveness",
      locator: "Abstract > Conclusion",
      language: "en",
      content:
        "The research highlights the importance of the depleting task’s effectiveness. The estimated effect depends in part on whether the initial task successfully induces the proposed depletion manipulation.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0292717",
      chunkKey: "analysis-scope",
      locator: "Introduction > Research aim",
      language: "en",
      content:
        "This article shows the state and evolution of statistical power and publication selection bias in the form of publication bias or p-hacking in psychological articles published between 1975 and 2017. It also estimates the share of statistical artifacts on all statistically significant findings (hereinafter referred to as significant), called false discovery rate (FDR).",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0292717",
      chunkKey: "assumption-caveat",
      locator: "Abstract > Interpretation",
      language: "en",
      content:
        "As the analyses rely on multiple assumptions that cannot be tested, alternative scenarios were laid out, again resulting in the rather optimistic result that most reported statistically significant findings may contain substantial results rather than statistical artifacts.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0280295",
      chunkKey: "followup-design",
      locator: "Abstract > Study design",
      language: "en",
      content:
        "In the current study, we followed up with 1547 participants one week after they had been exposed to fake news stories about COVID-19 and then provided with a detailed debriefing.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0280295",
      chunkKey: "followup-result",
      locator: "Abstract > Results",
      language: "en",
      content:
        "False memories and beliefs for previously-seen fake stories declined from the original study, suggesting that the debrief was effective. The debriefing also resulted in reduced false memories and beliefs for novel fake stories.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0280295",
      chunkKey: "health-behavior-result",
      locator: "Abstract > Results",
      language: "en",
      content:
        "Small effects of misinformation on planned health behaviours observed in the original study were also eliminated at follow-up.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0212592",
      chunkKey: "paradigm",
      locator: "Introduction > Four-phase paradigm",
      language: "en",
      content:
        "Participants watch a video of the witnessed event. Some receive an initial test over several details presented in the video, whereas others do not. All participants are then provided with a narrative that contains misinformation about the witnessed event, followed by a final test for the video.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0212592",
      chunkKey: "context-result",
      locator: "Abstract > Results",
      language: "en",
      content:
        "Testing enhanced suggestibility when the misinformation phase reinstated contextual information of the event, but not when the misinformation phase included few contextual details, regardless of whether the misinformation was in a narrative or questions.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0212592",
      chunkKey: "context-conclusion",
      locator: "Abstract > Conclusion",
      language: "en",
      content:
        "In Experiment 3, disrupting narrative coherence by randomizing the order of contextual information eliminated retrieval-enhanced suggestibility. Context processing during the post-event information phase influences whether retrieval enhances or reduces eyewitness suggestibility.",
    },
    {
      sourceKey: "doi:10.1371/journal.pone.0172855",
      chunkKey: "sexual-satisfaction-conclusion",
      locator: "Abstract > Conclusion",
      language: "en",
      content:
        "Sexual satisfaction within steady partnerships was influenced by different actor-, partner-, and relationship-related factors, which together explained 57% of the outcome variance. Actor and partner sexual function, sexual communication, and actor's life satisfaction were positive predictors. Actor's and partner's sexual distress, actor's sexual desire discrepancy, sociosexual orientation, masturbation, and household income were negative predictors.",
    },
    {
      sourceKey: "doi:10.1186/s13643-021-01719-0",
      chunkKey: "relationship-programs-evidence-limitations",
      locator: "Abstract > Conclusion",
      language: "en",
      content:
        "Due to the high effect of the therapy programs on CRS and enhancement program on CRC in the current meta-analysis, the priority of their utilizations in interventions, especially by psychologists and mental health professionals, should be emphasized. Therefore, mental health planning in communities to develop MRP and care for couples' health should be given special attention to men's health. Due to the high heterogeneity of the results and with scanty literature in this specific domain, we are uncertain about their actual effect. However, well-designed RCTs with a larger sample size would be beneficial in closely examining the effect of MRPs on CRS and CRC.",
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2024.1420148",
      chunkKey: "positive-sexuality-sample",
      locator: "Abstract > Methods",
      language: "en",
      content:
        "The present study applied network analysis to uncover interconnections between positive sexuality, relationship satisfaction, and health indicators, highlight the most relevant variables and explore potential gender-based differences in a sample of 992 partnered individuals (51% women, aged 18–71 years). Networks were estimated via Gaussian Graphical Models, and network comparison test was used to compare men and women.",
    },
    {
      sourceKey: "doi:10.3389/fpsyg.2024.1420148",
      chunkKey: "positive-sexuality-results-caveat",
      locator: "Abstract > Results",
      language: "en",
      content:
        "Results indicated that variables related to positive sexuality were more highly interconnected than the rest of the network. There were small-to-negligible connections between positive sexuality and relationship satisfaction variables, both of which had negligible or no connections with health. The network was globally invariant across gender, though a few connections were gender-specific. The most important variables, regardless of gender, related to pleasurable feelings during sexual intercourse.",
    },
    {
      sourceKey: "doi:10.60797/PSY.2025.6.1",
      chunkKey: "methods-sample-limit",
      locator: "Раздел 2 > Цели и задачи исследования",
      language: "ru",
      content:
        "В исследовании приняли участие 44 юношей и девушек, находящихся в романтических отношениях больше полугода и не живущих вместе. Всего – 22 пары (средний возраст – 21,5 лет). Выборка состояла из студентов РНИМУ им. Н.И. Пирогова.",
    },
    {
      sourceKey: "doi:10.60797/PSY.2025.6.1",
      chunkKey: "results-correlational-limit",
      locator: "Раздел 6 > Заключение",
      language: "ru",
      content:
        "У молодых людей и девушек наблюдается взаимосвязь представлений о сплоченности и согласии в отношениях с показателями межличностного эмоционального интеллекта такими как способность управлять эмоциями других людей и способность понимать эмоции других людей.",
    },
    {
      sourceKey: "doi:10.17759/sps.2021120109",
      chunkKey: "millennials-relationship-concept",
      locator: "Результаты > Интерпретация социальных представлений",
      language: "ru",
      content:
        "Таким образом, подтверждается вывод, сделанный на основании предыдущих этапов исследования, о том, что миллениалы в силу свойственных их возрасту и образу жизни особенностей склонны рассматривать романтические отношения как самостоятельную ценность, а не шаг для создания семьи и продолжения рода.",
    },
    {
      sourceKey: "doi:10.17759/sps.2017080104",
      chunkKey: "relationship-satisfaction-correlation-limit",
      locator: "Заключение > Ограничения исследования",
      language: "ru",
      content:
        "Ограничения данного исследования связаны, в первую очередь, с использовавшимся корреляционным дизайном, не позволяющим с уверенностью делать выводы о причинно-следственных отношениях.",
    },
    {
      sourceKey: "doi:10.1177/1948550619887702",
      chunkKey: "ego-depletion-multilab-result",
      locator: "Abstract > Results",
      language: "en",
      content:
        "Data from 12 labs across the globe (N = 1,775) revealed a small and significant ego depletion effect, d = 0.10. After excluding participants who might have responded randomly during the outcome task, the effect size increased to d = 0.16.",
    },
    {
      sourceKey: "doi:10.21638/spbu16.2024.107",
      chunkKey: "married-couples-sample-and-findings",
      locator: "Аннотация > Результаты",
      language: "ru",
      content:
        "Выборку составили 387 супружеских пар со стажем брака от полугода до 50 лет. Результаты: респонденты в целом имеют высокий уровень чувств любви, удовлетворенности отношениями и психологического благополучия, причем сходный у обоих супругов.",
    },
  ],
});

export type EvidenceSeed = z.infer<typeof evidenceSeedSchema>;

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function toImportRows(seed: EvidenceSeed) {
  const validated = evidenceSeedSchema.parse(seed);
  return {
    sources: validated.sources.map((source) => ({
      source_key: source.sourceKey,
      title: source.title,
      authors: source.authors,
      journal: source.journal,
      publisher: source.publisher,
      published_at: source.publishedAt,
      doi: source.doi ?? null,
      canonical_url: source.url,
      source_type: source.sourceType,
      status: source.status,
      license_code: source.licenseCode,
      license_url: source.licenseUrl,
      provenance: {
        license_verified_at: source.licenseVerifiedAt,
        ...(source.isbn ? { isbn: source.isbn } : {}),
        ...(source.isbn ? { publication_date_precision: "year" } : {}),
        ...(source.licenseCode === "ALL-RIGHTS-RESERVED"
          ? {
              chunks_permitted: source.rightsPermission !== undefined,
              rights_status: source.rightsPermission
                ? "permission_confirmed"
                : "all_rights_reserved",
            }
          : {}),
        ...(source.rightsPermission
          ? { rights_permission: source.rightsPermission }
          : {}),
        ...(source.topicTags ? { topic_tags: source.topicTags } : {}),
      },
    })),
    chunks: validated.chunks.map((chunk) => ({
      source_key: chunk.sourceKey,
      chunk_key: chunk.chunkKey,
      content: chunk.content,
      locator: chunk.locator,
      language: chunk.language,
      content_sha256: sha256(chunk.content),
      provenance: { imported_from: "curated-seed-v0" },
    })),
  };
}
