/**
 * Next.js Node runtime startup hook. While `npm run dev` is running, subscription
 * expiry emails are checked when the server starts and then once every 24 hours.
 * The DB unique notice record prevents duplicate delivery on server restarts.
 * For reliable delivery while the web app is NOT running, schedule the separate
 * `scripts/run-subscription-expiry-notifications.js` script daily.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    const globalScheduler = globalThis as typeof globalThis & { __stockNBookExpiryTimer?: ReturnType<typeof setInterval> };
    if (globalScheduler.__stockNBookExpiryTimer) return;

    const run = async () => {
        try {
            const admin = await import("./lambda-subscription-admin/index.js");
            const task = (admin as any).runExpiryNotificationJob || (admin as any).default?.runExpiryNotificationJob;
            if (typeof task === "function") await task();
        } catch (error) {
            console.error("[StockNBook] Subscription expiry notification check failed:", error);
        }
    };
    // Run soon after the Node worker becomes available, not during module import.
    void run();
    globalScheduler.__stockNBookExpiryTimer = setInterval(() => void run(), 24 * 60 * 60 * 1000);
    globalScheduler.__stockNBookExpiryTimer.unref?.();
}
