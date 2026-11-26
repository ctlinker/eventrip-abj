-- Communes extensibles (Abidjan et nouvelles zones de départ)
CREATE TABLE "communes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "slug" TEXT NOT NULL UNIQUE,
  "created_at" TEXT NOT NULL
);

INSERT INTO "communes" ("id", "name", "slug", "created_at") VALUES
  ('com-abobo', 'Abobo', 'abobo', '2026-11-26T00:00:00.000Z'),
  ('com-adjame', 'Adjamé', 'adjame', '2026-11-26T00:00:00.000Z'),
  ('com-anyama', 'Anyama', 'anyama', '2026-11-26T00:00:00.000Z'),
  ('com-attecoube', 'Attécoubé', 'attecoube', '2026-11-26T00:00:00.000Z'),
  ('com-bingerville', 'Bingerville', 'bingerville', '2026-11-26T00:00:00.000Z'),
  ('com-cocody', 'Cocody', 'cocody', '2026-11-26T00:00:00.000Z'),
  ('com-koumassi', 'Koumassi', 'koumassi', '2026-11-26T00:00:00.000Z'),
  ('com-marcory', 'Marcory', 'marcory', '2026-11-26T00:00:00.000Z'),
  ('com-plateau', 'Plateau', 'plateau', '2026-11-26T00:00:00.000Z'),
  ('com-port-bouet', 'Port-Bouët', 'port-bouet', '2026-11-26T00:00:00.000Z'),
  ('com-songon', 'Songon', 'songon', '2026-11-26T00:00:00.000Z'),
  ('com-treichville', 'Treichville', 'treichville', '2026-11-26T00:00:00.000Z'),
  ('com-yopougon', 'Yopougon', 'yopougon', '2026-11-26T00:00:00.000Z');
