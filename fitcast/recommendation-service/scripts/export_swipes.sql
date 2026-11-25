-- Wardrobes and swipes of every user with at least 30 swipes, as one JSON document for scripts/evaluate_taste.py.
-- Users are numbered (u1, u2, …) in the order they registered: no e-mail, name or photo leaves the database.
--
--   docker compose exec -T postgres psql -U fitcast -d fitcast -At < recommendation-service/scripts/export_swipes.sql > swipes.json
--
-- to_jsonb(w) -> 'attributes' also works on a database older than the attributes column (it gives null).
-- (from fitcast/; in PowerShell: Get-Content …\export_swipes.sql | docker compose exec -T postgres psql -U fitcast -d fitcast -At > swipes.json)
\set ON_ERROR_STOP on
SELECT json_build_object('users', coalesce(json_agg(json_build_object(
  'id', 'u' || u.n, 'wardrobe', u.wardrobe, 'swipes', u.swipes) ORDER BY u.n), '[]'::json))
FROM (
  SELECT row_number() OVER (ORDER BY us.created_at, us.id) AS n,
    (SELECT coalesce(json_agg(json_build_object(
        'id', w.id, 'type', w.type, 'dominantColor', w.dominant_color, 'fitTag', w.fit_tag,
        'attributes', to_jsonb(w) -> 'attributes') ORDER BY w.created_at, w.id), '[]'::json)
     FROM wardrobe_items w WHERE w.user_id = us.id) AS wardrobe,
    (SELECT json_agg(json_build_object(
        'items', f.item_ids, 'liked', f.verdict = 'LIKE', 'eventType', f.event_type,
        'temperatureC', f.temperature_c, 'at', f.created_at) ORDER BY f.created_at, f.id)
     FROM outfit_feedback f WHERE f.user_id = us.id) AS swipes
  FROM users us
  WHERE (SELECT count(*) FROM outfit_feedback f WHERE f.user_id = us.id) >= 30
) u;
