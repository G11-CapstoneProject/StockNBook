-- StockNBook v2: store events (elections, holidays, school seasons, local fiestas, promotions).
-- Forecasting uses past events to prepare for the next one (for example the next election).
--
-- HOW TO RUN (MySQL Workbench):
--   1. In the SCHEMAS panel, double-click your StockNBook database so it is bold (selected).
--   2. Run the WHOLE file with the lightning button (Ctrl+Shift+Enter).
-- Safe to run more than once: the table is only created if it does not exist yet.

CREATE TABLE IF NOT EXISTS `store_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `store_id` bigint unsigned NOT NULL,
  `branch_id` bigint unsigned DEFAULT NULL COMMENT 'NULL = all branches',
  `event_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other' COMMENT 'election | holiday | school | local_event | promotion | other',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `notes` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` bigint unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_store_event_dates` (`store_id`, `event_type`, `start_date`),
  KEY `branch_id` (`branch_id`, `store_id`),
  KEY `created_by` (`created_by`, `store_id`),
  CONSTRAINT `store_events_ibfk_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`),
  CONSTRAINT `store_events_ibfk_2` FOREIGN KEY (`branch_id`, `store_id`) REFERENCES `branches` (`id`, `store_id`),
  CONSTRAINT `store_events_ibfk_3` FOREIGN KEY (`created_by`, `store_id`) REFERENCES `users` (`id`, `store_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Check: this should show the new table's columns.
SHOW COLUMNS FROM `store_events`;
