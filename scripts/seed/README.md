# StockNBook v2 demo data (seeder)

Adds 3 demo stores with **3 years of sales and bookings** (Nov 2023 to today) so you can test every page, especially Analytics and Forecasting.

- It **only adds rows**. It never changes your tables.
- **Your own stores and accounts are never touched.**
- Running it again replaces the old demo stores with a fresh set.

## Commands (run from the project folder)

| What | Command |
|---|---|
| Add (or refresh) the demo stores | `node scripts/seed/run.js` |
| Check the demo data is consistent | `node scripts/seed/verify.js` |
| Remove the demo stores | `node scripts/seed/destroy.js` |

It uses the database in `.env.local` (`DB_NAME=stocknbook_v2`). Stop the app (`npm run dev`) while it runs.

## Logins (password for all: `StockNBook@2026`)

| Store | Plan | Branches | Use it for |
|---|---|---|---|
| Demo Party Store | Scale | 5 | **Analytics and Forecasting** (most data) |
| Sunshine Party Supplies | Growth | 3 | a mid-size store |
| Fiesta Events Hub | Starter | 1 | a small store |

- Owner: `owner.s1@demo-v1.seed.stocknbook.test` (s1 = Demo Party Store, s2 = Sunshine, s3 = Fiesta)
- Manager of a branch: `manager.s1.al@demo-v1.seed.stocknbook.test` (branch codes: mn, mk, ps, al, mr)
- Staff of a branch: `staff.s1.al@demo-v1.seed.stocknbook.test`. Main-branch Staff (`.mn`) can view Analytics and Forecasting; Staff in other branches cannot.

## What's in the data

Demo Party Store: about 39,000 POS sales and 1,900 bookings over 3 years. The data is random but follows real patterns:
- **Months:** December is busiest and January is slowest.
- **Seasonal products:** Valentine's, graduation, fiesta, Halloween, Christmas and New Year items peak in their season.
- **2025 elections:** campaign items sell, and "Campaign Rally" bookings rent sound systems and tents.
- **Buying hours:** balloons in the morning, costumes in the evening.
- **Rentals by month:** tents in the rainy season, fans in summer.
- **Product trends:** some products rise, some fall.

`analysis-queries.sql` has 10 practice queries for MySQL Workbench.

## Optional

- **Events tab (Forecasting):** it needs the `store_events` table (`store-events-migration.sql`). Without the table, the demo events are skipped and everything else works.
- **Accuracy check:** `node scripts/seed/verify-analytics.js` compares the Analytics and Forecasting numbers with the database. Set `ANALYTICS_LAMBDA` and `FORECASTING_LAMBDA` to the Lambda `index.js` paths to run it without the app.
