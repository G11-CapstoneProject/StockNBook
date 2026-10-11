/**
 * Run once daily while the StockNBook local development database is available.
 * Windows Task Scheduler: Program `node`, argument
 * `C:\path\to\StockNBook\scripts\run-subscription-expiry-notifications.js`
 * This job sends an email only when the seven-day warning or expired status
 * is newly eligible, and uses database records to prevent duplicates.
 */
const {
    runExpiryNotificationJob,
    closeExpiryNotificationPool,
} = require('../lambda-subscription-admin/index.js');

(async () => {
    try {
        const result = await runExpiryNotificationJob();
        console.log('[StockNBook subscription expiry notices]', result);
        if (result.failed > 0) process.exitCode = 1;
    } catch (error) {
        console.error('[StockNBook subscription expiry notices] Job failed:', error.message);
        process.exitCode = 1;
    } finally {
        await closeExpiryNotificationPool();
    }
})();
