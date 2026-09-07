-- 0049_full_supplier_reclassification.sql
--
-- Full review of all 584 suppliers since Jan/2026 with Mickael on 2026-09-06.
-- Everything below is his explicit decision; the patterns were each checked
-- against the live ledger first (see the four traps avoided at the bottom).
--
-- NEW BUCKET: "Stupid Expenses" — his words. Not a reimbursement claim
-- (tracks_reimbursement = false, like 'suspeito'), and deliberately NOT added
-- to the hide-from-shared-ledger list: it is still real household money, it
-- just gets counted separately from Family.
--
-- FOUR TRAPS the pre-check caught, and how each is handled:
--   1. 'EINSTEIN' alone would catch DAMA EINSTEIN — a restaurant inside the
--      hospital, which Mickael says stays Family. Using the specific unit
--      names instead ('EINSTEIN MORUMBI', 'EINSTEIN IBI', 'ALBERTEINSTEIN').
--   2. 'KATZ' would catch "Pix recebido MAXIME AURELIEN BARKATZ" — a person,
--      not the clinic. Using 'D V KATZ'.
--   3. 'CAMPINAS' would catch "IFD*WR BURGER CAMPINAS" — a burger delivery.
--      Only hotels in Campinas are work, so: 'MELIA CAMPINAS' (Vitoria Hotel
--      Campinas is already tagged).
--   4. LAIK and AKIVA have money flowing BOTH ways (R$1,2 mi received from
--      Akiva alone). Every tagging statement below is restricted to
--      real_amount < 0 so only money going OUT is ever tagged.

-- ---------------------------------------------------------------------------
-- 1) The new bucket
-- ---------------------------------------------------------------------------
INSERT INTO reimbursement_tags (slug, name, color, icon, description, tracks_reimbursement)
VALUES ('stupid', 'Gastos Idiotas', 'warning', 'thumbs-down',
        'Gastos que não deveriam ter acontecido — contados fora do orçamento da família. Não é reembolso.',
        false)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) HEALTH — providers that were already tagged under another spelling,
--    plus one new clinic. DAMA EINSTEIN deliberately excluded (restaurant).
-- ---------------------------------------------------------------------------
INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'insurance'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount < 0
  AND t.description_raw NOT ILIKE '%DAMA EINSTEIN%'
  AND (
    t.description_raw ILIKE '%ALBERTEINSTEIN%'
    OR t.description_raw ILIKE '%EINSTEIN MORUMBI%'
    OR t.description_raw ILIKE '%EINSTEIN IBI%'
    OR t.description_raw ILIKE '%CEDIPI%'
    OR t.description_raw ILIKE '%OTICAMARELA%'
    OR t.description_raw ILIKE '%D V KATZ%'
    OR t.description_raw ILIKE '%MILHARCIC%'
  )
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) KENLO — infrastructure, dev and AI stack, work travel, consultancy.
--    Follows the split already in the ledger: Kenlo = dev/infra/AI tooling.
-- ---------------------------------------------------------------------------
INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'kenlo'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount < 0
  AND (
    t.description_raw ILIKE '%GOOGLE CLOUD%'
    OR t.description_raw ILIKE '%GOOGLECLOUD%'
    OR t.description_raw ILIKE '%GRAMMARLY%'
    OR t.description_raw ILIKE '%CONTABO%'
    OR t.description_raw ILIKE '%VERCEL%'
    OR t.description_raw ILIKE '%CLOUDFLARE%'
    OR t.description_raw ILIKE '%TWILIO%'
    OR t.description_raw ILIKE '%GROQ%'
    OR t.description_raw ILIKE '%RESEND%'
    OR t.description_raw ILIKE '%REGISTRO.BR%'
    OR t.description_raw ILIKE '%KINGHOST%'
    OR t.description_raw ILIKE '%CLICKSIGN%'
    OR t.description_raw ILIKE '%JUSBRASIL%'
    OR t.description_raw ILIKE '%MELIA CAMPINAS%'
    OR t.description_raw ILIKE '%AKIVA%'
  )
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) LAIK — the media company: its own Google Workspace, ads, and the
--    creative/marketing tooling. Money sent to Laik Mídia Digital included
--    per Mickael: it must not sit in Family.
-- ---------------------------------------------------------------------------
INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'laik'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount < 0
  AND (
    t.description_raw ILIKE '%LAIK%'
    OR t.description_raw ILIKE '%FACEBK%'
    OR t.description_raw ILIKE '%SUNO AI%'
    OR t.description_raw ILIKE '%CAPCUT%'
    OR t.description_raw ILIKE '%CANVA%'
    OR t.description_raw ILIKE '%UBERSUGGEST%'
    OR t.description_raw ILIKE '%ANSWERTHEP%'
    OR t.description_raw ILIKE '%SQSP%'
    OR t.description_raw ILIKE '%SQUARESPACE%'
    OR t.description_raw ILIKE '%RUNWAY%'
    OR t.description_raw ILIKE '%HEDRA INC%'
  )
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) STUPID EXPENSES — the mobile game, 214 micro-charges.
-- ---------------------------------------------------------------------------
INSERT INTO transaction_reimbursements (transaction_id, tag_id, status)
SELECT t.id, (SELECT id FROM reimbursement_tags WHERE slug = 'stupid'), 'pending'
FROM transactions t
WHERE t.is_fake = false AND t.real_amount < 0
  AND t.description_raw ILIKE '%LAST Z%'
ON CONFLICT (transaction_id, tag_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) Rules so all of this holds for FUTURE charges too.
--    Hand-written on purpose: these merchants put a random code in every
--    charge ("Google CLOUD TBv4zz", "FACEBK *29GP279WQ2"), so the automatic
--    first-3-words pattern would only ever match the one charge it came from.
--    A short stem matches the merchant instead of the receipt number.
-- ---------------------------------------------------------------------------
INSERT INTO merchant_rules (pattern, pattern_type, reimbursement_tag_id, confidence_default)
SELECT v.p, 'contains', (SELECT id FROM reimbursement_tags WHERE slug = v.s), 0.95
FROM (VALUES
  ('ALBERTEINSTEIN','insurance'), ('EINSTEIN MORUMBI','insurance'), ('EINSTEIN IBI','insurance'),
  ('CEDIPI','insurance'), ('OTICAMARELA','insurance'), ('D V KATZ','insurance'), ('MILHARCIC','insurance'),
  ('GOOGLE CLOUD','kenlo'), ('GOOGLECLOUD','kenlo'), ('GRAMMARLY','kenlo'), ('CONTABO','kenlo'),
  ('VERCEL','kenlo'), ('CLOUDFLARE','kenlo'), ('TWILIO','kenlo'), ('GROQ','kenlo'), ('RESEND','kenlo'),
  ('REGISTRO.BR','kenlo'), ('KINGHOST','kenlo'), ('CLICKSIGN','kenlo'), ('JUSBRASIL','kenlo'),
  ('MELIA CAMPINAS','kenlo'), ('AKIVA','kenlo'),
  ('LAIK','laik'), ('FACEBK','laik'), ('SUNO AI','laik'), ('CAPCUT','laik'), ('CANVA','laik'),
  ('UBERSUGGEST','laik'), ('ANSWERTHEP','laik'), ('SQSP','laik'), ('SQUARESPACE','laik'),
  ('RUNWAY','laik'), ('HEDRA INC','laik'),
  ('LAST Z','stupid')
) AS v(p, s)
ON CONFLICT (pattern) DO UPDATE
  SET reimbursement_tag_id = EXCLUDED.reimbursement_tag_id;
