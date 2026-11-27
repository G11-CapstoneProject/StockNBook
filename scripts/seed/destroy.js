/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Removes ONLY the stores created by run.js for one seed tag (slug starts with "<SEED_RUN_TAG>-"),
 * with all their rows, plus the seed platform admin. Real stores are never matched.
 *
 *   node scripts/seed/destroy.js
 *   SEED_RUN_TAG=another-run node scripts/seed/destroy.js
 *
 * You don't need this before run.js: run.js replaces an older demo set by itself.
 */
const { CONFIG } = require("./lib/config");
const { connect } = require("./lib/db");
const { removeSeededStores } = require("./lib/seeded-stores");

async function main() {
    const db = await connect();
    console.log(`Removing the seeded stores for tag "${CONFIG.runTag}" from ${CONFIG.db.database}...`);
    const removed = await removeSeededStores(db);
    console.log(removed ? "Seeded data removed." : `No seeded stores found for tag "${CONFIG.runTag}". Nothing was deleted.`);
    await db.end();
}

main().catch((error) => {
    console.error("Destroy failed:", error.message);
    process.exit(1);
});
