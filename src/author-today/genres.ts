// AT genre slug → Russian display name
const GENRE_SLUG_MAP: Record<string, string> = {
  "fantasy": "Фэнтези",
  "romantic-fantasy": "Романтическое фэнтези",
  "fantasy-action": "Боевое фэнтези",
  "urban-fantasy": "Городское фэнтези",
  "dark-fantasy": "Тёмное фэнтези",
  "ironical-fantasy": "Юмористическое фэнтези",
  "boyar-anime": "Бояръ-Аниме",
  "heroic-fantasy": "Героическое фэнтези",
  "epic-fantasy": "Эпическое фэнтези",
  "historical-fantasy": "Историческое фэнтези",
  "magic-school": "Магическая академия",
  "everyday-fantasy": "Бытовое фэнтези",
  "classic-fantasy": "Классическое фэнтези",
  "wuxia": "Уся",
  "slavic-fantasy": "Славянское фэнтези",
  "techno-fantasy": "Технофэнтези",

  "sci-fi": "Фантастика",
  "sf-history": "Альтернативная история",
  "sf-action": "Боевая фантастика",
  "sf-space": "Космическая фантастика",
  "sf-social": "Социальная фантастика",
  "science-fiction": "Научная фантастика",
  "postapocalyptic": "Постапокалипсис",
  "sf-humor": "Юмористическая фантастика",
  "dystopia": "Антиутопия",
  "cyberpunk": "Киберпанк",
  "sf-heroic": "Героическая фантастика",
  "steampunk": "Стимпанк",
  "sf-romantic": "Романтическая фантастика",

  "litrpg": "ЛитРПГ",
  "realrpg": "РеалРПГ",
  "paranormal": "Мистика",
  "modern-prose": "Современная проза",
  "rusreal": "Русреал",
  "adventure": "Приключения",
  "historical-adventure": "Исторические приключения",
  "poetry": "Поэзия",
  "humor": "Юмор",
  "fanfiction": "Фанфик",
  "horror": "Ужасы",
  "popadantsy": "Попаданцы",
  "popadantsy-v-magicheskie-miry": "Попаданцы в магические миры",
  "popadantsy-vo-vremeni": "Попаданцы во времени",
  "back-to-ussr": "Назад в СССР",
  "popadantsy-v-kosmos": "Попаданцы в космос",
  "thriller": "Триллер",
  "other": "Разное",
  "fairy-tale": "Сказка",
  "publicism": "Публицистика",
  "detskaya-literatura": "Детская литература",
  "non-fiction": "Документальная проза",
  "drama": "Драма",
  "biznes-literatura": "Бизнес-литература",
  "action": "Боевик",
  "teen-prose": "Подростковая проза",
  "detective": "Детектив",
  "detective-science-fiction": "Фантастический детектив",
  "historical-mystery": "Исторический детектив",
  "spy-mystery": "Шпионский детектив",
  "romance": "Любовные романы",
  "contemporary-romance": "Современный любовный роман",
  "short-romance": "Короткий любовный роман",
  "historical-romance": "Исторический любовный роман",
  "historical-fiction": "Историческая проза",
  "erotica": "Эротика",
  "romantic-erotika": "Романтическая эротика",
  "fantasy-erotika": "Эротическое фэнтези",
  "sf-erotika": "Эротическая фантастика",
  "fanfiction-erotika": "Эротический фанфик",
  "dorama": "Дорама",
};

// Reverse lookup: Russian name → slug
const REVERSE_MAP = new Map<string, string>();
for (const [slug, name] of Object.entries(GENRE_SLUG_MAP)) {
  REVERSE_MAP.set(name.toLowerCase(), slug);
}

// AT API numeric genreId → slug mapping (discovered from library + web scraping)
const GENRE_ID_MAP: Record<number, string> = {
  1: "modern-prose",
  2: "fantasy",
  3: "sci-fi",
  4: "detective",
  5: "action",
  6: "romance",
  7: "erotica",
  8: "adventure",
  9: "fanfiction",
  10: "paranormal",
  12: "humor",
  16: "teen-prose",
  18: "horror",
  19: "other",
  20: "litrpg",
  21: "popadantsy",
  28: "sf-history",
  29: "dystopia",
  30: "sf-action",
  31: "sf-heroic",
  32: "postapocalyptic",
  33: "sf-space",
  34: "cyberpunk",
  35: "steampunk",
  36: "science-fiction",
  37: "sf-humor",
  38: "fantasy-action",
  39: "urban-fantasy",
  41: "historical-fantasy",
  42: "ironical-fantasy",
  43: "epic-fantasy",
  44: "dark-fantasy",
  47: "popadantsy-vo-vremeni",
  48: "popadantsy-v-magicheskie-miry",
  51: "spy-mystery",
  52: "detective-science-fiction",
  54: "sf-erotika",
  55: "fantasy-erotika",
  60: "fairy-tale",
  63: "sf-social",
  64: "heroic-fantasy",
  66: "popadantsy-v-kosmos",
  69: "realrpg",
  71: "boyar-anime",
  72: "back-to-ussr",
  73: "wuxia",
  74: "magic-school",
  75: "dorama",
  76: "rusreal",
  77: "everyday-fantasy",
  80: "techno-fantasy",
};

export function genreIdToSlug(id: number): string | null {
  return GENRE_ID_MAP[id] ?? null;
}

export function genreIdToName(id: number): string | null {
  const slug = genreIdToSlug(id);
  return slug ? genreSlugToName(slug) : null;
}

export function genreSlugToName(slug: string): string {
  return GENRE_SLUG_MAP[slug] ?? slug;
}

export function genreNameToSlug(name: string): string | null {
  return REVERSE_MAP.get(name.toLowerCase()) ?? null;
}

// Parent genre for sub-genres (for high-level categorization)
const PARENT_GENRE: Record<string, string> = {
  "romantic-fantasy": "fantasy",
  "fantasy-action": "fantasy",
  "urban-fantasy": "fantasy",
  "dark-fantasy": "fantasy",
  "ironical-fantasy": "fantasy",
  "boyar-anime": "fantasy",
  "heroic-fantasy": "fantasy",
  "epic-fantasy": "fantasy",
  "historical-fantasy": "fantasy",
  "magic-school": "fantasy",
  "everyday-fantasy": "fantasy",
  "classic-fantasy": "fantasy",
  "wuxia": "fantasy",
  "slavic-fantasy": "fantasy",
  "techno-fantasy": "fantasy",

  "sf-history": "sci-fi",
  "sf-action": "sci-fi",
  "sf-space": "sci-fi",
  "sf-social": "sci-fi",
  "science-fiction": "sci-fi",
  "postapocalyptic": "sci-fi",
  "sf-humor": "sci-fi",
  "dystopia": "sci-fi",
  "cyberpunk": "sci-fi",
  "sf-heroic": "sci-fi",
  "steampunk": "sci-fi",
  "sf-romantic": "sci-fi",

  "popadantsy-v-magicheskie-miry": "popadantsy",
  "popadantsy-vo-vremeni": "popadantsy",
  "back-to-ussr": "popadantsy",
  "popadantsy-v-kosmos": "popadantsy",

  "detective-science-fiction": "detective",
  "historical-mystery": "detective",
  "spy-mystery": "detective",

  "contemporary-romance": "romance",
  "short-romance": "romance",
  "historical-romance": "romance",

  "romantic-erotika": "erotica",
  "fantasy-erotika": "erotica",
  "sf-erotika": "erotica",
  "fanfiction-erotika": "erotica",

  "historical-adventure": "adventure",
  "rusreal": "modern-prose",
};

export function getParentGenreSlug(slug: string): string {
  return PARENT_GENRE[slug] ?? slug;
}

export function getParentGenreName(slug: string): string {
  const parentSlug = getParentGenreSlug(slug);
  return genreSlugToName(parentSlug);
}
