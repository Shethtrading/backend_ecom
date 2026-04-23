BEGIN;

ALTER TABLE order_details
ADD COLUMN IF NOT EXISTS line_order INTEGER;

WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (PARTITION BY cart_id ORDER BY order_id ASC) AS rn
  FROM order_details
  WHERE cart_id IS NOT NULL
    AND line_order IS NULL
)
UPDATE order_details od
SET line_order = ranked.rn
FROM ranked
WHERE od.ctid = ranked.ctid;

CREATE INDEX IF NOT EXISTS idx_order_details_cart_line_order
  ON order_details (cart_id, line_order, order_id);

COMMIT;
