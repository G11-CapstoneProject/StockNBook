-- StockNBook: practice queries for the seeded 3-year sales history.
--
-- HOW TO USE (MySQL Workbench):
--   1. Double-click your StockNBook database in SCHEMAS so it is bold.
--   2. Run the first SET line, then run any query below on its own (put the cursor in it, Ctrl+Enter).
-- These only read data. Compare the answers with what the Analytics and Forecasting pages show.

-- The seeded "Demo Party Store" (change the tag if you used SEED_RUN_TAG).
SET @store := (SELECT id FROM stores WHERE slug LIKE 'demo-v1-%' ORDER BY id LIMIT 1);

-- 1. Sales per month for 3 years, side by side (is it going up or down? which months are busiest?)
SELECT MONTH(order_date) AS month_no, DATE_FORMAT(MIN(order_date), '%b') AS month,
       ROUND(SUM(CASE WHEN YEAR(order_date) = YEAR(CURDATE()) - 2 THEN total END)) AS two_years_ago,
       ROUND(SUM(CASE WHEN YEAR(order_date) = YEAR(CURDATE()) - 1 THEN total END)) AS last_year,
       ROUND(SUM(CASE WHEN YEAR(order_date) = YEAR(CURDATE()) THEN total END)) AS this_year
FROM orders WHERE store_id = @store AND status = 'completed'
GROUP BY month_no ORDER BY month_no;

-- 2. This month vs the same month last year, per product (biggest increases first)
SELECT p.product_name,
       SUM(CASE WHEN DATE_FORMAT(o.order_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN oi.quantity ELSE 0 END) AS this_month,
       SUM(CASE WHEN DATE_FORMAT(o.order_date, '%Y-%m') = DATE_FORMAT(CURDATE() - INTERVAL 1 YEAR, '%Y-%m') THEN oi.quantity ELSE 0 END) AS same_month_last_year
FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
JOIN product_variants pv ON pv.id = oi.variant_id JOIN products p ON p.id = pv.product_id
WHERE o.store_id = @store AND o.status = 'completed' AND o.order_date >= CURDATE() - INTERVAL 13 MONTH
GROUP BY p.id ORDER BY this_month - same_month_last_year DESC LIMIT 15;

-- 3. Best and least sold products this month
(SELECT 'best' AS list, p.product_name, SUM(oi.quantity) AS units
 FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
 JOIN product_variants pv ON pv.id = oi.variant_id JOIN products p ON p.id = pv.product_id
 WHERE o.store_id = @store AND o.status = 'completed' AND o.order_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
 GROUP BY p.id ORDER BY units DESC LIMIT 5)
UNION ALL
(SELECT 'least', p.product_name, SUM(oi.quantity)
 FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
 JOIN product_variants pv ON pv.id = oi.variant_id JOIN products p ON p.id = pv.product_id
 WHERE o.store_id = @store AND o.status = 'completed' AND o.order_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
 GROUP BY p.id ORDER BY SUM(oi.quantity) ASC LIMIT 5);

-- 4. What time each category is usually bought (units per hour)
SELECT c.category_name, HOUR(o.order_date) AS hour, SUM(oi.quantity) AS units
FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
JOIN product_variants pv ON pv.id = oi.variant_id JOIN products p ON p.id = pv.product_id
JOIN categories c ON c.id = p.category_id
WHERE o.store_id = @store AND o.status = 'completed'
GROUP BY c.category_name, hour ORDER BY c.category_name, units DESC;

-- 5. Seasonal products: units per month (Valentine's, graduation, fiesta, Halloween, Christmas, New Year, election)
SELECT p.product_name, DATE_FORMAT(o.order_date, '%Y-%m') AS month, SUM(oi.quantity) AS units
FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
JOIN product_variants pv ON pv.id = oi.variant_id JOIN products p ON p.id = pv.product_id
WHERE o.store_id = @store AND o.status = 'completed'
  AND p.product_name IN ('Valentine Heart Balloon Bouquet', 'Graduation Balloon Set', 'Congrats Grad Banner', 'Fiesta Banderitas (50m)',
      'Kids Halloween Costume', 'Halloween Pumpkin and Bat Decor Set', 'Trick-or-Treat Bags (12 pcs)', 'Christmas Balloon Set',
      'Christmas Curtain Lights', 'Christmas Party Giveaways (25 pcs)', 'New Year Horns and Hats Kit',
      'Campaign Buntings (50m)', 'Campaign Balloons (100 pcs)', 'Event Tarpaulin Stand Banner')
GROUP BY p.product_name, month ORDER BY p.product_name, month;

-- 6. Rental equipment: which items are booked most in which calendar month (all years together)
SELECT REGEXP_REPLACE(bi.item_name_snapshot, '^(Premium|Deluxe) ', '') AS equipment,
       SUM(CASE WHEN MONTH(b.event_date) = 1 THEN bi.quantity ELSE 0 END) AS jan, SUM(CASE WHEN MONTH(b.event_date) = 2 THEN bi.quantity ELSE 0 END) AS feb,
       SUM(CASE WHEN MONTH(b.event_date) = 3 THEN bi.quantity ELSE 0 END) AS mar, SUM(CASE WHEN MONTH(b.event_date) = 4 THEN bi.quantity ELSE 0 END) AS apr,
       SUM(CASE WHEN MONTH(b.event_date) = 5 THEN bi.quantity ELSE 0 END) AS may, SUM(CASE WHEN MONTH(b.event_date) = 6 THEN bi.quantity ELSE 0 END) AS jun,
       SUM(CASE WHEN MONTH(b.event_date) = 7 THEN bi.quantity ELSE 0 END) AS jul, SUM(CASE WHEN MONTH(b.event_date) = 8 THEN bi.quantity ELSE 0 END) AS aug,
       SUM(CASE WHEN MONTH(b.event_date) = 9 THEN bi.quantity ELSE 0 END) AS sep, SUM(CASE WHEN MONTH(b.event_date) = 10 THEN bi.quantity ELSE 0 END) AS oct,
       SUM(CASE WHEN MONTH(b.event_date) = 11 THEN bi.quantity ELSE 0 END) AS nov, SUM(CASE WHEN MONTH(b.event_date) = 12 THEN bi.quantity ELSE 0 END) AS `dec`
FROM bookings b JOIN booking_items bi ON bi.booking_id = b.id
WHERE b.store_id = @store AND bi.item_type = 'rental' AND bi.item_status <> 'cancelled'
  AND LOWER(b.status) IN ('confirmed', 'preparing', 'released', 'return inspection', 'pending settlement', 'completed')
  AND b.event_date <= CURDATE()
GROUP BY equipment ORDER BY equipment;

-- 7. Election season (the 90 days before 12 May 2025) vs the same days a year before
SELECT c.category_name,
       SUM(CASE WHEN o.order_date >= '2025-02-11' AND o.order_date < '2025-05-11' THEN oi.quantity ELSE 0 END) AS campaign_2025,
       SUM(CASE WHEN o.order_date >= '2024-02-11' AND o.order_date < '2024-05-11' THEN oi.quantity ELSE 0 END) AS same_days_2024
FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
JOIN product_variants pv ON pv.id = oi.variant_id JOIN products p ON p.id = pv.product_id
JOIN categories c ON c.id = p.category_id
WHERE o.store_id = @store AND o.status = 'completed'
GROUP BY c.category_name ORDER BY campaign_2025 - same_days_2024 DESC;

-- 8. Campaign rallies booked (equipment rentals for the election)
SELECT DATE_FORMAT(event_date, '%Y-%m') AS month, event_type, COUNT(*) AS bookings
FROM bookings WHERE store_id = @store AND event_type IN ('Campaign Rally', 'Miting de Avance')
GROUP BY month, event_type ORDER BY month;

-- 9. Branch growth: sales per branch per year
SELECT br.branch_name, YEAR(o.order_date) AS year, ROUND(SUM(o.total)) AS sales
FROM orders o JOIN branches br ON br.id = o.branch_id
WHERE o.store_id = @store AND o.status = 'completed'
GROUP BY br.branch_name, year ORDER BY br.branch_name, year;

-- 10. Event types per month (Christmas parties in December, Halloween parties in October, ...)
SELECT MONTH(event_date) AS month_no, event_type, COUNT(*) AS bookings
FROM bookings WHERE store_id = @store AND LOWER(status) NOT IN ('cancelled', 'rejected')
GROUP BY month_no, event_type ORDER BY month_no, bookings DESC;
