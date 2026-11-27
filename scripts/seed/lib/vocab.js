/**
 * Every status / type value the seeder writes, in ONE place.
 * The Bookings values match lambda-bookings-v2.js exactly. The other modules
 * (POS, Inventory, Rentals, Subscriptions) should confirm theirs: if a teammate's
 * Lambda uses a different word, change it here once and re-run the seeder.
 */
module.exports = {
    STORE_STATUS: "active",
    USER_STATUS: "active",
    ROLE: { OWNER: "owner", MANAGER: "manager", STAFF: "staff" },
    // employee_actions.user_role is stored capitalized, as in the team's data.
    ROLE_LABEL: { owner: "Owner", manager: "Manager", staff: "Staff" },
    PLATFORM_ADMIN_ROLE: "platform_admin",

    CATEGORY_TYPE: { PRODUCT: "product", EQUIPMENT: "equipment" },
    PACKAGE_ITEM: { CONSUMABLE: "consumable", RENTAL: "rental" },
    DISCOUNT_TYPE: { PERCENT: "percentage", FIXED: "fixed" },

    // ── Bookings (same as lambda-bookings-v2.js) ──
    BOOKING_TYPE: { PACKAGE: "package", CUSTOM: "custom", RENTAL: "rental" },
    BOOKING_STATUS: {
        PENDING_REVIEW: "Pending Review", AWAITING_DP: "Awaiting Down Payment", CONFIRMED: "Confirmed",
        PREPARING: "Preparing", RELEASED: "Released", RETURN_INSPECTION: "Return Inspection",
        PENDING_SETTLEMENT: "Pending Settlement", COMPLETED: "Completed", CANCELLED: "Cancelled", REJECTED: "Rejected",
    },
    SETTLEMENT: { PENDING: "pending", REVIEWED: "reviewed", SETTLED: "settled" },
    ITEM: { PACKAGE: "package", CONSUMABLE: "consumable", RENTAL: "rental" },
    // After inspection a returned rental line becomes "cleared" (no damage) or "damaged" (same words as the Rental Lambda).
    ITEM_STATUS: { PENDING: "pending", RESERVED: "reserved", RELEASED: "released", RETURNED: "returned", CLEARED: "cleared", DAMAGED: "damaged", CANCELLED: "cancelled" },
    PAYMENT_TYPE: { BOOKING: "booking_payment", DEPOSIT: "security_deposit", CHARGE: "additional_charge", ORDER: "order_payment" },
    PAYMENT_STATUS: "recorded",
    BOOKING_PAYMENT_METHODS: [["cash", 50], ["gcash", 40], ["bank_transfer", 10]],
    REFUND: { DEPOSIT: "deposit_refund", DONE: "completed" },

    // ── POS (confirm with the POS owner) ──
    ORDER_STATUS: "completed",
    POS_PAYMENT_MODES: [["Cash", 62], ["GCash", 30], ["Maya", 8]],
    TAX: { NON_VAT: "non_vat", VAT: "vat" },

    // ── Inventory movements (BOOKING_* match the Bookings Lambda; the rest: confirm with Inventory/POS) ──
    MOVE: {
        OPENING: "OPENING_STOCK", RESTOCK: "RESTOCK", SALE: "POS_SALE", ADJUST: "STOCK_ADJUSTMENT",
        ISSUE_REPORTED: "STOCK_ISSUE_REPORTED", ISSUE_RESOLVED: "STOCK_ISSUE_RESOLVED", WRITE_OFF: "STOCK_WRITE_OFF",
        BOOKING_RESERVE: "BOOKING_RESERVE", BOOKING_UNRESERVE: "BOOKING_RESERVATION_RELEASE", BOOKING_ISSUE: "BOOKING_ISSUE",
    },
    REF: { OPENING: "PRODUCT_OPENING", RESTOCK: "RESTOCK", ORDER: "ORDER", BOOKING: "BOOKING", STOCK_ISSUE: "STOCK_ISSUE", COUNT: "STOCK_COUNT" },
    BUCKET: { ON_HAND: "on_hand", RESERVED: "reserved", UNAVAILABLE: "unavailable" },

    // ── Stock issues (confirm with Inventory/Rentals) ──
    ISSUE_TYPE: { DAMAGED: "damaged", EXPIRED: "expired", MAINTENANCE: "maintenance", MISSING: "missing" },
    ISSUE_STATUS: { OPEN: "open", RESOLVED: "resolved" },

    // ── Subscriptions (same words the Bookings Lambda checks) ──
    SUBSCRIPTION_STATUS: { ACTIVE: "active", EXPIRING: "expiring", EXPIRED: "expired" },
    SUBSCRIPTION_PAYMENT_STATUS: { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" },
};
