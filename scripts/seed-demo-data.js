/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * StockNBook demo seeder (plan-aligned demo/testing dataset).
 *
 * Target dataset:
 *  - 9 stores total: 3 Starter, 3 Growth, 3 Scale
 *  - Starter: 1 manager, 1 staff, 1 branch, exactly 50 products
 *  - Growth: 3 managers, 3 staff, 3 branches, exactly 800 products
 *  - Scale: 5 managers, 5 staff, 5 branches, 1,500 demo products
 *  - exact simple / variant / inventory-attention product distributions per plan
 *  - persistent inventory-attention fixtures plus rolling expiry-soon dates
 *  - rolling 25-month demo window: 12 months back + current month + 12 months forward
 *  - deterministic high / medium / slow demand product groups
 *  - plan-aware monthly booking fixtures with exact current/historical distributions
 *  - current-month POS/bookings that populate dashboard KPIs through the seed date
 *  - future demo/test sales and bookings for forward-date filters without affecting current KPIs
 *  - 25-month restock and staff-activity source data for reports/analytics
 *  - admin subscription fixtures: Active, Expiring Soon + Pending Renewal, Expired
 *  - Philippine-date alignment (Asia/Manila by default)
 *
 * IMPORTANT ABOUT BOOKINGS:
 * Starter and Growth remain capped at exactly 20 bookings/month; Scale seeds
 * 100/month. The current month preserves those totals while ensuring TODAY has
 * operational bookings (one per branch where possible). Future months use
 * scheduled/forward-safe statuses rather than completed bookings.
 *
 * Usage:
 *   node seed-demo-data.js
 *   SEED_DRY_RUN=true node seed-demo-data.js
 */
require("dotenv").config({ path: ".env.local" });

const fs = require("fs");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const DAY_MS = 24 * 60 * 60 * 1000;

function envInt(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const raw = process.env[name];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    }
    return value;
}

function envFloat(name, fallback, min = 0, max = Number.MAX_VALUE) {
    const raw = process.env[name];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${name} must be a number from ${min} to ${max}.`);
    }
    return value;
}

function envBool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function sanitizeRunTag(value) {
    const tag = String(value || "demo-v1")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30);

    if (!tag) throw new Error("SEED_RUN_TAG must contain letters or numbers.");
    return tag;
}

function parseIsoDate(value, label) {
    const text = String(value || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error(`${label} must use YYYY-MM-DD format.`);
    }

    const date = new Date(`${text}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime()) || isoDate(date) !== text) {
        throw new Error(`${label} is not a valid date.`);
    }

    return date;
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function sqlDateTime(date, hour = 12, minute = 0, second = 0) {
    return `${isoDate(date)} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function addDays(date, days) {
    return new Date(date.getTime() + days * DAY_MS);
}

function addMonthsUtc(date, months) {
    const copy = new Date(date.getTime());
    copy.setUTCMonth(copy.getUTCMonth() + months);
    return copy;
}

function startOfUtcMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfPreviousUtcMonth(date) {
    return addDays(startOfUtcMonth(date), -1);
}

function maxDate(a, b) {
    return a > b ? new Date(a.getTime()) : new Date(b.getTime());
}

const SEED_TIME_ZONE = process.env.SEED_TIME_ZONE || "Asia/Manila";

function seedTimeParts(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: SEED_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(value);

    const byType = Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)])
    );

    return {
        year: byType.year,
        month: byType.month,
        day: byType.day,
        hour: byType.hour,
        minute: byType.minute,
    };
}

function todayUtc() {
    const parts = seedTimeParts();
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

const TODAY = todayUtc();
const CURRENT_MONTH_START = startOfUtcMonth(TODAY);
const DEMO_MONTHS_BACK = 12;
const DEMO_MONTHS_FORWARD = 12;
const DEMO_WINDOW_START = startOfUtcMonth(
    addMonthsUtc(CURRENT_MONTH_START, -DEMO_MONTHS_BACK)
);
const DEMO_FUTURE_MONTH_START = startOfUtcMonth(
    addMonthsUtc(CURRENT_MONTH_START, 1)
);
const DEMO_WINDOW_END = addDays(
    startOfUtcMonth(addMonthsUtc(CURRENT_MONTH_START, DEMO_MONTHS_FORWARD + 1)),
    -1
);

const CONFIG = Object.freeze({
    runTag: sanitizeRunTag(process.env.SEED_RUN_TAG || "demo-v1"),

    storeCount: envInt("SEED_STORE_COUNT", 9, 1, 1000),
    productsPerStore: envInt("SEED_PRODUCTS_PER_STORE", 1000, 1, 100000),
    packagesPerStore: 5,
    managersPerStore: 3,
    staffPerStore: 6,

    historicalBookingsPerStore: envInt("SEED_HISTORICAL_BOOKINGS_PER_STORE", 240, 0, 100000),
    nearTermBookingsPerStore: envInt("SEED_NEAR_BOOKINGS_PER_STORE", 420, 0, 1000000),
    longTermBookingsPerStore: envInt("SEED_LONG_BOOKINGS_PER_STORE", 180, 0, 1000000),

    averageDailyOrders: envFloat("SEED_AVERAGE_DAILY_ORDERS", 2.25, 0, 1000),
    batchSize: envInt("SEED_BATCH_SIZE", 400, 25, 2000),

    defaultPassword: process.env.SEED_DEFAULT_PASSWORD || "Demo12345",

    createIndexes: envBool("SEED_CREATE_INDEXES", true),
    resetExistingRun: envBool("SEED_RESET_EXISTING_RUN", true),
    dryRun: envBool("SEED_DRY_RUN", false) || process.argv.includes("--dry-run"),

    // By default sales use the rolling demo window from the specification:
    // 12 full months before the seed month, the current month through TODAY,
    // then 12 full future months. Environment overrides are still supported.
    salesStart: parseIsoDate(
        process.env.SEED_SALES_START || isoDate(DEMO_WINDOW_START),
        "SEED_SALES_START"
    ),
    salesEnd: parseIsoDate(
        process.env.SEED_SALES_END || isoDate(DEMO_WINDOW_END),
        "SEED_SALES_END"
    ),

    nearBookingStart: addDays(TODAY, 1),
    nearBookingEnd: addDays(TODAY, 365),
    longBookingStart: addDays(TODAY, 366),
    longBookingEnd: parseIsoDate(process.env.SEED_LONG_BOOKING_END || "2031-12-31", "SEED_LONG_BOOKING_END"),
});

if (CONFIG.salesStart > CONFIG.salesEnd) {
    throw new Error("SEED_SALES_START cannot be later than SEED_SALES_END.");
}
if (CONFIG.longBookingStart > CONFIG.longBookingEnd) {
    throw new Error("SEED_LONG_BOOKING_END must be after the next-12-month booking window.");
}

const STORES_PER_PLAN = 3;
const DEMO_PLAN_COUNT = 3;
const DEMO_STORE_COUNT = STORES_PER_PLAN * DEMO_PLAN_COUNT;
// Variant products intentionally contain either 2 or 3 variants.
const VARIANTS_PER_PRODUCT = 3;

const STORE_SLUG_PREFIX = `${CONFIG.runTag}-party-store-`;
const STORE_EMAIL_DOMAIN = `${CONFIG.runTag}.seed.stocknbook.test`;

const CATEGORIES = [
    "Balloons","Balloon Accessories","Tableware","Table Decorations","Backdrop Decorations",
    "Banners and Garlands","Cake Decorations","Candles","Party Favors","Gift Packaging",
    "Confetti and Poppers","Photo Booth Supplies","Artificial Flowers","Retail Lighting",
    "Food Service Supplies","Invitations and Stationery","Wearable Party Accessories",
    "Kids Party Supplies","Wedding Supplies","Corporate Event Supplies","Food and Beverages"
];

const PRODUCT_BLUEPRINTS = [
    ["Balloons", "Latex Balloons", "count", 280], ["Balloons", "Metallic Latex Balloons", "count", 340],
    ["Balloons", "Pastel Latex Balloons", "count", 320], ["Balloons", "Foil Number Balloon", "piece", 120],
    ["Balloons", "Foil Letter Balloon", "piece", 120], ["Balloons", "Heart Foil Balloon", "count", 260],
    ["Balloons", "Star Foil Balloon", "count", 250], ["Balloon Accessories", "Balloon Garland Kit", "kit", 680],
    ["Balloon Accessories", "Balloon Arch Strip", "roll", 190], ["Balloon Accessories", "Balloon Glue Dots", "count", 150],
    ["Balloon Accessories", "Balloon Ribbon", "roll", 110], ["Balloon Accessories", "Hand Balloon Pump", "piece", 180],
    ["Balloon Accessories", "Electric Balloon Inflator", "piece", 1650], ["Tableware", "Disposable Dinner Plates", "count", 220],
    ["Tableware", "Disposable Dessert Plates", "count", 190], ["Tableware", "Disposable Party Cups", "count", 210],
    ["Tableware", "Disposable Cutlery Set", "count", 250], ["Tableware", "Paper Napkins", "count", 160],
    ["Tableware", "Paper Drinking Straws", "count", 120], ["Table Decorations", "Disposable Table Cover", "piece", 170],
    ["Table Decorations", "Satin Table Runner", "piece", 290], ["Table Decorations", "Centerpiece Decoration Kit", "kit", 720],
    ["Table Decorations", "Table Number Cards", "count", 260], ["Backdrop Decorations", "Metallic Fringe Curtain", "piece", 240],
    ["Backdrop Decorations", "Fabric Backdrop Curtain", "piece", 780], ["Backdrop Decorations", "Shimmer Wall Panel", "count", 1150],
    ["Backdrop Decorations", "Paper Fan Decoration Set", "kit", 340], ["Banners and Garlands", "Happy Birthday Banner", "piece", 190],
    ["Banners and Garlands", "Congratulations Banner", "piece", 190], ["Banners and Garlands", "Tassel Garland", "kit", 280],
    ["Banners and Garlands", "Triangle Bunting Flags", "roll", 250], ["Banners and Garlands", "Hanging Swirl Decorations", "count", 210],
    ["Cake Decorations", "Acrylic Cake Topper", "piece", 220], ["Cake Decorations", "Cupcake Topper Set", "count", 180],
    ["Cake Decorations", "Cupcake Wrapper Set", "count", 170], ["Candles", "Birthday Number Candle", "piece", 70],
    ["Candles", "Spiral Birthday Candles", "count", 90], ["Candles", "Sparkler Cake Candles", "count", 150],
    ["Party Favors", "Party Favor Box", "count", 260], ["Party Favors", "Loot Bag", "count", 220],
    ["Party Favors", "Bubble Wand", "count", 190], ["Party Favors", "Glow Stick Bracelet", "count", 240],
    ["Party Favors", "Mini Whistle", "count", 170], ["Gift Packaging", "Satin Gift Ribbon", "roll", 180],
    ["Gift Packaging", "Gift Wrapping Tissue", "count", 140], ["Gift Packaging", "Thank You Sticker", "count", 120],
    ["Gift Packaging", "Printed Thank You Tag", "count", 150], ["Confetti and Poppers", "Confetti Popper", "count", 280],
    ["Confetti and Poppers", "Biodegradable Paper Confetti", "pack", 160], ["Confetti and Poppers", "Metallic Table Confetti", "pack", 150],
    ["Photo Booth Supplies", "Photo Booth Prop Set", "kit", 390], ["Photo Booth Supplies", "Speech Bubble Prop Set", "kit", 360],
    ["Photo Booth Supplies", "Selfie Frame", "piece", 420], ["Artificial Flowers", "Artificial Rose Garland", "piece", 420],
    ["Artificial Flowers", "Artificial Eucalyptus Garland", "piece", 450], ["Artificial Flowers", "Silk Flower Bouquet", "piece", 520],
    ["Retail Lighting", "Battery Fairy Light String", "piece", 330], ["Retail Lighting", "LED Curtain Lights", "piece", 890],
    ["Retail Lighting", "Mini LED Tea Lights", "count", 360], ["Food Service Supplies", "Disposable Food Container", "count", 330],
    ["Food Service Supplies", "Disposable Serving Tray", "count", 390], ["Food Service Supplies", "Paper Food Box", "count", 310],
    ["Food Service Supplies", "Chafing Fuel Can", "count", 280], ["Invitations and Stationery", "Printed Invitation Card Set", "count", 480],
    ["Invitations and Stationery", "Guest Book", "piece", 550], ["Invitations and Stationery", "Place Card Set", "count", 280],
    ["Invitations and Stationery", "Envelope and Seal Set", "count", 260], ["Wearable Party Accessories", "Party Hat", "count", 180],
    ["Wearable Party Accessories", "Birthday Sash", "piece", 190], ["Wearable Party Accessories", "Celebration Tiara", "piece", 240],
    ["Wearable Party Accessories", "Novelty Party Glasses", "count", 260], ["Kids Party Supplies", "Pull String Piñata", "piece", 740],
    ["Kids Party Supplies", "Kids Activity Sheet Set", "count", 190], ["Kids Party Supplies", "Coloring Crayon Favor Set", "count", 240],
    ["Wedding Supplies", "Wedding Welcome Sign", "piece", 780], ["Wedding Supplies", "Acrylic Name Sign", "piece", 690],
    ["Wedding Supplies", "Ring Box", "piece", 430], ["Wedding Supplies", "Wedding Confetti Cone Set", "count", 260],
    ["Corporate Event Supplies", "Corporate Logo Sticker Set", "count", 380], ["Corporate Event Supplies", "Name Badge and Lanyard Set", "count", 420],
    ["Corporate Event Supplies", "Event Wristband Set", "count", 350], ["Corporate Event Supplies", "Raffle Ticket Book", "piece", 180],
];

const ATTENTION_FOOD_BLUEPRINTS = [
    ["Fresh Milk 1L", "bottle", 115],
    ["Strawberry Yogurt Cup", "cup", 75],
    ["Cream Cheese Tub", "tub", 185],
    ["Butter Cake Loaf", "loaf", 240],
    ["Chicken Sandwich Pack", "pack", 165],
    ["Fresh Fruit Cup", "cup", 120],
    ["Mango Juice 1L", "bottle", 135],
    ["Chocolate Cake Slice", "slice", 95],
    ["Soft Bread Loaf", "loaf", 105],
    ["Assorted Cupcake Box", "box", 360],
    ["Baked Macaroni Tray", "tray", 520],
    ["Garden Salad Bowl", "bowl", 210],
    ["Leche Flan Family Tub", "tub", 280],
    ["Ube Cake Roll", "roll", 320],
    ["Ham and Cheese Sandwich", "pack", 145],
    ["Cheese Roll Box", "box", 250],
    ["Fresh Fruit Tart", "piece", 180],
    ["Buko Pandan Dessert Cup", "cup", 95],
    ["Mango Graham Tub", "tub", 190],
    ["Chocolate Brownie Box", "box", 290],
];

const INVENTORY_ATTENTION_ORDER = ["expired", "expiringSoon", "outOfStock", "lowStock"];

function inventoryAttentionStateForIndex(planProfile, itemIndex) {
    const attention = planProfile?.inventoryAttention;
    if (!attention) return null;

    let cursor = 0;
    for (const state of INVENTORY_ATTENTION_ORDER) {
        cursor += Math.max(0, Number(attention[state] || 0));
        if (itemIndex <= cursor) return state;
    }

    return null;
}

function totalInventoryAttention(planProfile) {
    return INVENTORY_ATTENTION_ORDER.reduce(
        (sum, state) => sum + Math.max(0, Number(planProfile?.inventoryAttention?.[state] || 0)),
        0
    );
}

function inventoryAttentionOrdinal(planProfile, itemIndex, targetState) {
    let cursor = 0;
    for (const state of INVENTORY_ATTENTION_ORDER) {
        const count = Math.max(0, Number(planProfile?.inventoryAttention?.[state] || 0));
        if (state === targetState) {
            const ordinal = itemIndex - cursor;
            return ordinal >= 1 && ordinal <= count ? ordinal : null;
        }
        cursor += count;
    }
    return null;
}

function evenlyDistributedIndexSet(total, selected) {
    const count = Math.max(0, Math.min(total, Number(selected || 0)));
    const slots = new Set();
    if (!count || !total) return slots;

    // floor(i * total / count) is unique when count <= total and spreads the
    // selected indexes across the complete healthy catalog instead of clustering.
    for (let i = 0; i < count; i += 1) {
        slots.add(Math.floor((i * total) / count));
    }
    return slots;
}

function attentionFoodProduct(storeIndex, itemIndex, attentionState) {
    const blueprint = ATTENTION_FOOD_BLUEPRINTS[(itemIndex - 1) % ATTENTION_FOOD_BLUEPRINTS.length];
    const cycle = Math.floor((itemIndex - 1) / ATTENTION_FOOD_BLUEPRINTS.length) + 1;
    const [baseName, format, basePrice] = blueprint;
    const stateLabel = {
        expired: "Expired Batch",
        expiringSoon: "Expiry-Soon Batch",
        outOfStock: "Out-of-Stock SKU",
        lowStock: "Low-Stock SKU",
    }[attentionState] || "Attention SKU";

    return {
        category: "Food and Beverages",
        name: `${baseName} - ${stateLabel} S${String(storeIndex).padStart(3, "0")}-${String(cycle).padStart(2, "0")}`,
        variantParentName: baseName,
        basePrice,
        baseName,
        format,
    };
}

const COLORS = ["Gold","Silver","Rose Gold","White","Black","Royal Blue","Sky Blue","Navy Blue","Blush Pink","Hot Pink","Lavender","Purple","Emerald Green","Sage Green","Red","Orange","Yellow","Champagne","Pastel Mix","Rainbow Mix"];
const STYLES = ["Classic","Elegant","Modern","Minimalist","Premium","Festive","Tropical","Rustic","Boho","Kids","Wedding","Corporate"];
const SIZES = ["Mini","Small","Medium","Large","Extra Large","6-inch","9-inch","12-inch","18-inch","24-inch"];
const PACK_COUNTS = [10,12,20,24,25,30,50,60,80,100];
const ROLL_LENGTHS = ["5-meter","10-meter","15-meter","20-meter","25-meter"];
const COLLECTIONS = ["Fiesta","Celebration","Luxe","Joyful","Milestone","Signature","Festive","Gathering","Radiance","Harmony","Spark","Grand","Delight","Mabuhay","Salu-Salo","Bayanihan","Aurora","Veranda","Manila","Pearl"];

const STORE_ADJECTIVES = ["Happy","Bright","Golden","Joyful","Festive","Grand","Sparkling","Colorful","Cheerful","Lovely","Prime","Celebration","Fiesta","Milestone","Party Lane","Confetti","Balloon Bay","Eventful","Gather","Radiant"];
const STORE_NOUNS = ["Party Supplies","Celebration Shop","Event Supply Market","Party Essentials","Celebration Depot","Party Boutique","Event Goods Center","Party Supply House","Celebration Corner","Party Retail Hub"];

const PH_LOCATIONS = [
    ["Quezon City","Metro Manila"],["Makati City","Metro Manila"],["Parañaque City","Metro Manila"],["Pasay City","Metro Manila"],
    ["Taguig City","Metro Manila"],["Pasig City","Metro Manila"],["Mandaluyong City","Metro Manila"],["Caloocan City","Metro Manila"],
    ["Las Piñas City","Metro Manila"],["Muntinlupa City","Metro Manila"],["Manila","Metro Manila"],["Marikina City","Metro Manila"],
    ["Antipolo City","Rizal"],["Bacoor City","Cavite"],["Imus City","Cavite"],["Dasmariñas City","Cavite"],["Santa Rosa City","Laguna"],
    ["Calamba City","Laguna"],["San Pedro City","Laguna"],["Biñan City","Laguna"],["Malolos City","Bulacan"],["Meycauayan City","Bulacan"],
    ["San Jose del Monte City","Bulacan"],["Cebu City","Cebu"],["Mandaue City","Cebu"],["Lapu-Lapu City","Cebu"],["Davao City","Davao del Sur"],
    ["Cagayan de Oro City","Misamis Oriental"],["Iloilo City","Iloilo"],["Bacolod City","Negros Occidental"]
];

const FIRST_NAMES = ["Aaron","Abigail","Adrian","Aileen","Albert","Alyssa","Ana","Andrea","Angela","Angelo","Anthony","Bea","Ben","Bianca","Carla","Carlo","Catherine","Cedric","Christian","Christine","Clarissa","Daniel","Danica","Daphne","David","Denise","Diana","Dominic","Elaine","Ella","Emmanuel","Erica","Francis","Gabriel","Grace","Hannah","Hazel","Ian","Isabel","Ivan","Janine","Jason","Jasmine","Jerome","Jessica","Joanna","Joel","John","Joshua","Julia","Karen","Kathleen","Kevin","Kimberly","Kristine","Lance","Lara","Leah","Leo","Liza","Lorraine","Luis","Marco","Maria","Mariel","Mark","Martin","Mary","Miguel","Mikaela","Nathan","Nicole","Paolo","Patricia","Paul","Paula","Rachel","Rafael","Regina","Rica","Robert","Ryan","Samantha","Sarah","Sean","Sophia","Stephanie","Theresa","Tricia","Vincent","Yvonne","Zoe"];
const LAST_NAMES = ["Abad","Aguilar","Alcantara","Aquino","Austria","Bautista","Bernardo","Cabrera","Castillo","Castro","Chavez","Cruz","David","De Guzman","De Leon","Del Rosario","Diaz","Domingo","Duran","Enriquez","Evangelista","Fernandez","Flores","Francisco","Garcia","Gomez","Gonzales","Gutierrez","Hernandez","Ignacio","Jimenez","Labrador","Lazaro","Lim","Lopez","Luna","Macaraeg","Manalo","Mendoza","Mercado","Miranda","Morales","Navarro","Ocampo","Ortega","Pascual","Perez","Ramos","Reyes","Rivera","Rodriguez","Rosales","Salazar","Santiago","Santos","Soriano","Sy","Tan","Tolentino","Torres","Valdez","Valencia","Vargas","Velasco","Villanueva","Yap","Zamora"];

const THEMES = ["Elegant Gold","Pastel Rainbow","Modern Minimalist","Rustic Garden","Royal Blue","Tropical Summer","Classic White","Rose Gold","Corporate Brand Colors","Colorful Kids"];
const VENUE_TYPES = ["Home Celebration","Restaurant Function Room","Hotel Ballroom","School Auditorium","Corporate Office","Community Hall","Garden Venue","Church Hall","Convention Space","Private Resort"];

const CORPORATE_PREFIXES = ["Apex","Bayan","Brightline","Crest","Evergreen","First Pacific","Golden Gate","Harbor","Horizon","Lighthouse","Metro","Northstar","OnePoint","Pioneer","PrimeCore","Radiant","Summit","Unity","Vertex","Westbridge"];
const CORPORATE_SUFFIXES = ["Trading","Solutions","Foods","Logistics","Holdings","Retail Group","Services","Technologies","Development","Manufacturing","Marketing","Enterprises"];

const PACKAGE_DEFINITIONS = [
    { name: "Kids Birthday Supply Bundle", description: "A direct-sale birthday bundle with balloons, tableware, banners, favors, and cake decorations.", eventType: "Kids Birthday", categories: ["Balloons","Tableware","Banners and Garlands","Party Favors","Cake Decorations"], itemCount: 8, discountRate: 0.10 },
    { name: "Graduation Celebration Kit", description: "A complete retail supply kit for graduation parties, recognition events, and school celebrations.", eventType: "Graduation Party", categories: ["Banners and Garlands","Balloons","Tableware","Photo Booth Supplies","Party Favors"], itemCount: 8, discountRate: 0.09 },
    { name: "Simple Celebration Package", description: "A practical all-around party package for small birthdays, family gatherings, and simple celebrations.", eventType: "Simple Celebration", categories: ["Balloons","Tableware","Banners and Garlands","Candles","Cake Decorations"], itemCount: 7, discountRate: 0.08 },
    { name: "Milestone Celebration Deluxe Pack", description: "A premium retail pack for debut, anniversary, and milestone birthday celebrations.", eventType: "Milestone Birthday", categories: ["Balloons","Backdrop Decorations","Table Decorations","Retail Lighting","Candles"], itemCount: 12, discountRate: 0.12 },
    { name: "Complete Wedding Decor Pack", description: "A direct-purchase wedding decor pack with table accents, signage, artificial flowers, and lighting.", eventType: "Wedding Reception", categories: ["Wedding Supplies","Artificial Flowers","Table Decorations","Backdrop Decorations","Retail Lighting"], itemCount: 12, discountRate: 0.14 },
    { name: "Anniversary Celebration Package", description: "A coordinated anniversary package with elegant table, backdrop, balloon, and lighting accents.", eventType: "Anniversary", categories: ["Balloons","Table Decorations","Backdrop Decorations","Artificial Flowers","Retail Lighting"], itemCount: 10, discountRate: 0.12 },
    { name: "Corporate Event Starter Bundle", description: "A business-event package for meetings, small company celebrations, and branded gatherings.", eventType: "Corporate Gathering", categories: ["Corporate Event Supplies","Tableware","Banners and Garlands","Food Service Supplies","Retail Lighting"], itemCount: 10, discountRate: 0.12 },
    { name: "Premium Birthday Celebration Package", description: "A larger birthday package with premium decorations, photo booth supplies, favors, and lighting.", eventType: "Premium Birthday", categories: ["Balloons","Backdrop Decorations","Photo Booth Supplies","Party Favors","Retail Lighting","Cake Decorations"], itemCount: 13, discountRate: 0.15 },
    { name: "Corporate Conference Package", description: "A larger corporate package with event identifiers, table supplies, signage, lighting, and food-service essentials.", eventType: "Corporate Conference", categories: ["Corporate Event Supplies","Food Service Supplies","Tableware","Banners and Garlands","Retail Lighting"], itemCount: 14, discountRate: 0.16 },
    { name: "Large Event Festival Package", description: "A high-volume package for large celebrations, festivals, community events, and corporate functions.", eventType: "Large Event", categories: ["Balloons","Tableware","Banners and Garlands","Corporate Event Supplies","Food Service Supplies","Retail Lighting"], itemCount: 15, discountRate: 0.18 },
];

const MONTH_FACTORS = { 1:0.92,2:0.96,3:1.00,4:1.04,5:1.08,6:1.02,7:0.97,8:0.95,9:1.00,10:1.05,11:1.12,12:1.22 };
const SALES_DAY_FACTORS = { 0:1.10,1:0.92,2:0.95,3:0.98,4:1.00,5:1.06,6:1.12 };
const BOOKING_DAY_FACTORS = { 0:2.25,1:0.55,2:0.70,3:0.78,4:0.90,5:1.45,6:2.55 };

function dbConfig() {
    return {
        host: "127.0.0.1",
        user: "root",
        password: process.env.DB_ROOT_PASSWORD || "BTA5EYVWLfWcebF",
        database: process.env.DB_NAME || "stocknbook",
        ssl: { rejectUnauthorized: false },
    };
}


function quoteIdentifier(identifier) {
    return `\`${String(identifier).replace(/`/g, "``")}\``;
}

function hashString(value) {
    let hash = 2166136261;
    const text = String(value);

    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function createRng(seedValue) {
    let state = hashString(seedValue) || 1;

    return function random() {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function randomInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function randomChoice(rng, values) { return values[Math.floor(rng() * values.length)]; }
function roundMoney(value) { return Math.round(Number(value) * 100) / 100; }

function weightedChoice(rng, choices) {
    const total = choices.reduce((sum, item) => sum + item.weight, 0);
    let cursor = rng() * total;
    for (const item of choices) {
        cursor -= item.weight;
        if (cursor <= 0) return item.value;
    }
    return choices[choices.length - 1].value;
}

function poisson(rng, lambda) {
    if (lambda <= 0) return 0;

    if (lambda > 30) {
        const normal = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
        return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal));
    }

    const limit = Math.exp(-lambda);
    let product = 1;
    let count = 0;

    do {
        count += 1;
        product *= rng();
    } while (product > limit);

    return count - 1;
}

function dbBoolean(value) {
    if (Buffer.isBuffer(value)) return value.length > 0 && value[value.length - 1] !== 0;
    return value === true || Number(value) === 1 || String(value) === "1";
}

function buildPhoneNumber(storeIndex, personIndex) {
    const suffix = String(700000000 + storeIndex * 20 + personIndex).slice(-9);
    return `09${suffix}`;
}

function realisticName(rng, usedNames = null) {
    for (let i = 0; i < 5000; i += 1) {
        const first = randomChoice(rng, FIRST_NAMES);
        const last = randomChoice(rng, LAST_NAMES);
        const includeMiddleInitial = rng() < 0.28;
        const middle = includeMiddleInitial ? ` ${String.fromCharCode(65 + randomInt(rng, 0, 25))}.` : "";
        const suffix = rng() < 0.025 ? " Jr." : "";
        const name = `${first}${middle} ${last}${suffix}`;

        if (!usedNames || !usedNames.has(name)) {
            if (usedNames) usedNames.add(name);
            return name;
        }
    }

    throw new Error("Unable to generate another unique realistic personnel name.");
}

function corporateName(rng) {
    return `${randomChoice(rng, CORPORATE_PREFIXES)} ${randomChoice(rng, CORPORATE_SUFFIXES)}, Inc.`;
}

function emailSlug(name) {
    return String(name)
        .toLowerCase()
        .replace(/jr\.?/g, "")
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 50);
}

function storeIdentity(storeIndex) {
    const zeroBased = storeIndex - 1;
    const adjective = STORE_ADJECTIVES[zeroBased % STORE_ADJECTIVES.length];
    const noun = STORE_NOUNS[Math.floor(zeroBased / STORE_ADJECTIVES.length) % STORE_NOUNS.length];
    const location = PH_LOCATIONS[(zeroBased * 7) % PH_LOCATIONS.length][0];
    const code = String(storeIndex).padStart(3, "0");

    return {
        code,
        name: `${adjective} ${noun} - ${location}`,
        slug: `${STORE_SLUG_PREFIX}${code}`,
        ownerEmail: `owner${code}@${STORE_EMAIL_DOMAIN}`,
        location,
    };
}

function productName(storeIndex, itemIndex) {
    const zeroBased = itemIndex - 1;
    const blueprint = PRODUCT_BLUEPRINTS[zeroBased % PRODUCT_BLUEPRINTS.length];
    const cycle = Math.floor(zeroBased / PRODUCT_BLUEPRINTS.length);
    const color = COLORS[(zeroBased * 7 + storeIndex * 3) % COLORS.length];
    const style = STYLES[(zeroBased * 5 + storeIndex) % STYLES.length];
    const size = SIZES[(zeroBased * 11 + cycle) % SIZES.length];
    const collection = COLLECTIONS[(cycle + storeIndex * 2) % COLLECTIONS.length];
    const count = PACK_COUNTS[(zeroBased * 3 + cycle) % PACK_COUNTS.length];
    const rollLength = ROLL_LENGTHS[(zeroBased + cycle) % ROLL_LENGTHS.length];
    const [category, baseName, format] = blueprint;

    let label;
    switch (format) {
        case "count": label = `Pack of ${count} ${color} ${baseName}, ${size}`; break;
        case "roll": label = `${color} ${baseName}, ${rollLength} Roll`; break;
        case "kit": label = `${style} ${color} ${baseName}, ${size} Kit`; break;
        case "pack": label = `${style} ${color} ${baseName}, ${count}-Gram Pack`; break;
        default: label = `${style} ${color} ${baseName}, ${size}`; break;
    }

    return {
        category,
        name: `${label} - ${collection} Retail Series ${String(cycle + 1).padStart(2, "0")}`,
        variantParentName: `${style} ${baseName} - ${collection} Retail Series ${String(cycle + 1).padStart(2, "0")}`,
        basePrice: Number(blueprint[3]),
        baseName,
        format,
    };
}

function variantValuesForProduct(product, storeIndex, itemIndex, variantIndex) {
    const color = COLORS[(storeIndex * 5 + itemIndex * 7 + variantIndex * 3) % COLORS.length];
    const alternateColor = COLORS[(storeIndex * 3 + itemIndex * 11 + variantIndex * 5 + 4) % COLORS.length];
    const size = SIZES[(itemIndex * 3 + variantIndex * 4) % SIZES.length];
    const count = PACK_COUNTS[(itemIndex * 5 + variantIndex * 2) % PACK_COUNTS.length];
    const length = ROLL_LENGTHS[(itemIndex + variantIndex) % ROLL_LENGTHS.length];
    const style = STYLES[(storeIndex + itemIndex + variantIndex * 2) % STYLES.length];
    const baseName = product.baseName;
    const category = product.category;

    if (baseName === "Foil Number Balloon" || baseName === "Birthday Number Candle") return { number: String((itemIndex + variantIndex * 3) % 10), color };
    if (baseName === "Foil Letter Balloon") return { letter: String.fromCharCode(65 + ((itemIndex + variantIndex * 7) % 26)), color };
    if (category === "Balloons") return { color, size: randomChoice(createRng(`${CONFIG.runTag}:balloon-size:${storeIndex}:${itemIndex}:${variantIndex}`), ["9-inch", "12-inch", "18-inch"]), packCount: randomChoice(createRng(`${CONFIG.runTag}:balloon-count:${storeIndex}:${itemIndex}:${variantIndex}`), [10, 25, 50]) };
    if (category === "Tableware") {
        const plateSize = baseName.includes("Plate") ? ["7-inch", "9-inch", "10-inch"][variantIndex % 3] : undefined;
        return { color, ...(plateSize ? { size: plateSize } : {}), packCount: [20, 30, 50][variantIndex % 3] };
    }
    if (category === "Backdrop Decorations" || category === "Table Decorations") return { color, size: ["Small", "Medium", "Large"][variantIndex % 3] };
    if (category === "Banners and Garlands" || category === "Gift Packaging" || product.format === "roll") return { color, length };
    if (category === "Retail Lighting") return { lightColor: ["Warm White", "Cool White", "Multicolor"][variantIndex % 3], length: ["3-meter", "5-meter", "10-meter"][variantIndex % 3] };
    if (category === "Artificial Flowers") return { flowerColor: color, arrangement: ["Single Stem", "Garland", "Bouquet"][variantIndex % 3] };
    if (category === "Wedding Supplies" || baseName.includes("Sign") || baseName.includes("Topper")) return { finish: ["Clear Acrylic", "Gold Mirror", "White Matte"][variantIndex % 3], size: ["Small", "Medium", "Large"][variantIndex % 3] };
    if (category === "Wearable Party Accessories" || category === "Kids Party Supplies") return { design: style, color: alternateColor, size: ["Kids", "Standard", "Large"][variantIndex % 3] };
    if (category === "Party Favors" || category === "Corporate Event Supplies" || category === "Food Service Supplies" || category === "Invitations and Stationery") return { design: style, color, packCount: [10, 25, 50][variantIndex % 3] };
    return { color, style, size, ...(product.format === "count" ? { packCount: count } : {}) };
}

function variantDisplayLabel(values) {
    const labels = { number: "Number", letter: "Letter", color: "Color", size: "Size", packCount: "Pack", length: "Length", lightColor: "Light Color", flowerColor: "Flower Color", arrangement: "Arrangement", finish: "Finish", design: "Design", style: "Style" };
    return Object.entries(values).map(([key, value]) => `${labels[key] || key}: ${value}${key === "packCount" ? " pcs" : ""}`).join(" / ");
}

function parseVariantValues(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try { return JSON.parse(String(value)); } catch { return { option: String(value) }; }
}

function productStock(rng, itemIndex) {
    const roll = rng();
    if (roll < 0.025) return 0;
    if (roll < 0.08) return randomInt(rng, 1, 8);
    if (roll < 0.68) return randomInt(rng, 25, 140);
    if (roll < 0.93) return randomInt(rng, 141, 320);
    return randomInt(rng, 321, 650) + (itemIndex % 20);
}

function demandMonthFactor(date) { return MONTH_FACTORS[date.getUTCMonth() + 1] || 1; }

function paydayFactor(date) {
    const day = date.getUTCDate();
    const next = addDays(date, 1);
    const isMonthEnd = next.getUTCMonth() !== date.getUTCMonth();
    return day === 15 || day === 30 || day === 31 || isMonthEnd ? 1.15 : 1;
}

function specialEventFactor(date) {
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();

    if (month === 2 && day >= 8 && day <= 14) return 1.25;
    if (month === 5 && day >= 1 && day <= 31) return 1.20;
    if (month === 10 && day >= 20 && day <= 31) return 1.22;
    if (month === 12 && day >= 1 && day <= 23) return 1.40;

    return 1;
}

function historicalGrowthFactor(date) {
    const startYear = CONFIG.salesStart.getUTCFullYear();
    const endYear = CONFIG.salesEnd.getUTCFullYear();
    const span = Math.max(1, endYear - startYear);
    const progress = Math.max(0, Math.min(1, (date.getUTCFullYear() - startYear) / span));
    return 0.58 + progress * 0.78;
}

function branchWeightedChoice(rng, branches) {
    const branchWeights = [1.25, 1.10, 1.00, 0.92, 0.84];
    return weightedChoice(
        rng,
        branches.map((branch, index) => ({
            value: branch,
            weight: branchWeights[index] || Math.max(0.60, 0.84 - index * 0.05),
        }))
    );
}

function tableKey(tableName) { return String(tableName).toLowerCase(); }
const tableColumnCache = new Map();

async function tableExists(db, tableName) {
    const [rows] = await db.execute(
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
             LIMIT 1`,
        [tableName]
    );
    return rows.length > 0;
}

async function getTableColumns(db, tableName, refresh = false) {
    const key = tableKey(tableName);
    if (!refresh && tableColumnCache.has(key)) return tableColumnCache.get(key);

    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?`,
        [tableName]
    );

    const columns = new Set(rows.map((row) => String(row.COLUMN_NAME)));
    tableColumnCache.set(key, columns);
    return columns;
}

async function columnExists(db, tableName, columnName) {
    const columns = await getTableColumns(db, tableName);
    return columns.has(columnName);
}

async function ensureColumn(db, tableName, columnName, definition) {
    if (await columnExists(db, tableName, columnName)) return;
    console.log(`Adding required column ${tableName}.${columnName}...`);
    await db.query(
        `ALTER TABLE ${quoteIdentifier(tableName)}
            ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
    );
    await getTableColumns(db, tableName, true);
}

async function ensureIndex(db, tableName, indexName, columns) {
    if (!(await tableExists(db, tableName))) return;
    const tableColumns = await getTableColumns(db, tableName);
    if (columns.some((column) => !tableColumns.has(column))) return;

    const [rows] = await db.execute(
        `SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [tableName]
    );

    const indexes = new Map();
    for (const row of rows) {
        const key = String(row.INDEX_NAME);
        if (!indexes.has(key)) indexes.set(key, []);
        indexes.get(key).push(String(row.COLUMN_NAME));
    }

    for (const [existingName, existingColumns] of indexes) {
        const equivalentPrefix = columns.every(
            (column, index) => existingColumns[index] === column
        );
        if (existingName === indexName || equivalentPrefix) return;
    }

    console.log(`Creating performance index ${indexName}...`);
    await db.query(
        `CREATE INDEX ${quoteIdentifier(indexName)}
            ON ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")})`
    );
}

async function ensureSeederSchema(db) {
    const requiredTables = [
        "stores", "branches", "managers", "staff", "categories",
        "products", "packages", "bookings", "orders", "order_items",
        "employee_actions", "restock_history",
        "pos_daily_summary", "pos_product_monthly_summary",
        "plans", "platform_admins",

        // Database V2 additive tables. The seeder does not recreate these:
        // the V2 migration must already be applied so the demo dataset can test
        // the same normalized inventory/package structure used by the backend.
        "schema_migrations",
        "branch_inventory",
        "inventory_batches",
        "inventory_movements",
        "package_items",
        "manager_invite_otps",
        "staff_invite_otps",
    ];

    for (const tableName of requiredTables) {
        if (!(await tableExists(db, tableName))) {
            throw new Error(`Required table ${tableName} does not exist.`);
        }
    }

    await ensureColumn(db, "orders", "branch_id", "INT NULL");
    await ensureColumn(db, "orders", "customer_name", "VARCHAR(160) NOT NULL DEFAULT 'Walk-in Customer'");
    await ensureColumn(db, "orders", "item", "VARCHAR(500) NOT NULL DEFAULT ''");
    await ensureColumn(db, "orders", "total", "DECIMAL(14,2) NOT NULL DEFAULT 0.00");
    await ensureColumn(db, "orders", "order_date", "DATE NULL");
    await ensureColumn(db, "orders", "order_status", "VARCHAR(20) NOT NULL DEFAULT 'COMPLETED'");
    await ensureColumn(db, "orders", "status", "VARCHAR(20) NOT NULL DEFAULT 'COMPLETED'");
    await ensureColumn(db, "orders", "created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");

    await ensureColumn(db, "products", "has_variants", "TINYINT NOT NULL DEFAULT 0");

    await db.query(`
        CREATE TABLE IF NOT EXISTS product_variants (
                                                        id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                        product_id INT NOT NULL,
                                                        variant_values JSON NULL,
                                                        sku VARCHAR(120) NULL,
            barcode VARCHAR(32) NULL,
            stock INT NOT NULL DEFAULT 0,
            alert_level INT NOT NULL DEFAULT 0,
            original_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            sales_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            status VARCHAR(30) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await getTableColumns(db, "product_variants", true);

    await ensureColumn(db, "order_items", "product_id", "INT NULL");
    await ensureColumn(db, "order_items", "variant_id", "INT NULL");
    await ensureColumn(db, "order_items", "product_name", "VARCHAR(255) NOT NULL DEFAULT ''");
    await ensureColumn(db, "order_items", "quantity", "INT NOT NULL DEFAULT 1");
    await ensureColumn(db, "order_items", "unit_price", "DECIMAL(14,2) NOT NULL DEFAULT 0.00");
    await ensureColumn(db, "order_items", "cost_price_at_sale", "DECIMAL(12,2) NULL");

    await ensureColumn(db, "bookings", "booking_reference", "VARCHAR(100) NULL");

    await db.query(`
        CREATE TABLE IF NOT EXISTS booking_items (
                                                     id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                     booking_id BIGINT NOT NULL,
                                                     product_id INT NOT NULL,
                                                     variant_id INT NULL,
                                                     product_name VARCHAR(255) NOT NULL,
            quantity INT NOT NULL DEFAULT 1,
            unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            line_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await getTableColumns(db, "booking_items", true);

    // Fallback definitions only — on a real StockNBook database these tables
    // already exist (see stocknbook_subscriptions.sql, stocknbook_payments.sql,
    // stocknbook_subscription_history.sql, stocknbook_subscription_audit_logs.sql)
    // and CREATE TABLE IF NOT EXISTS is a no-op against them. Real plan/admin
    // rows come from the `plans` and `platform_admins` tables, never from here.
    await db.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
                                                     id INT AUTO_INCREMENT PRIMARY KEY,
                                                     store_id BIGINT NOT NULL,
                                                     plan_id INT NOT NULL,
                                                     status ENUM('active','expiring','expired','cancelled') NOT NULL DEFAULT 'active',
            auto_renew TINYINT(1) NOT NULL DEFAULT 0,
            started_at TIMESTAMP NULL DEFAULT NULL,
            expires_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS payments (
                                                id INT AUTO_INCREMENT PRIMARY KEY,
                                                store_id BIGINT NOT NULL,
                                                plan_id INT NOT NULL,
                                                amount DECIMAL(10,2) NOT NULL,
            reference_no VARCHAR(100) NOT NULL,
            receipt_url VARCHAR(500) NULL,
            status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            submitted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_by BIGINT NULL,
            reviewed_at TIMESTAMP NULL DEFAULT NULL,
            UNIQUE KEY uniq_reference_no (reference_no)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS subscription_history (
                                                            id INT AUTO_INCREMENT PRIMARY KEY,
                                                            subscription_id INT NOT NULL,
                                                            store_id BIGINT NOT NULL,
                                                            old_plan_id INT NULL,
                                                            new_plan_id INT NOT NULL,
                                                            change_type ENUM('upgrade','downgrade','renewal','cancellation','admin_override') NOT NULL,
            changed_by BIGINT NOT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS subscription_audit_logs (
                                                               audit_log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                               business_id BIGINT NOT NULL,
                                                               subscription_id INT NULL,
                                                               payment_submission_id INT NULL,
                                                               action VARCHAR(100) NOT NULL,
            previous_status VARCHAR(50) NULL,
            new_status VARCHAR(50) NULL,
            performed_by_admin_id BIGINT NULL,
            reason TEXT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    tableColumnCache.clear();
}

async function ensureSeederLookupIndexes(db) {
    const lookupIndexes = [
        ["stores", "idx_perf_stores_slug", ["slug"]],
        ["products", "idx_perf_products_store_branch", ["store_id", "branch_id"]],
        ["product_variants", "idx_perf_product_variants_product", ["product_id"]],
        ["packages", "idx_perf_packages_store_branch", ["store_id", "branch_id"]],
        ["bookings", "idx_perf_bookings_store_reference", ["store_id", "booking_reference"]],
        ["employee_actions", "idx_perf_employee_actions_store_created", ["store_id", "created_at"]],
    ];

    for (const [tableName, indexName, columns] of lookupIndexes) {
        await ensureIndex(db, tableName, indexName, columns);
    }
}

async function ensurePerformanceIndexes(db) {
    if (!CONFIG.createIndexes) return;

    const indexDefinitions = [
        ["stores", "idx_perf_stores_slug", ["slug"]],
        ["branches", "idx_perf_branches_store", ["store_id"]],
        ["managers", "idx_perf_managers_store_branch", ["store_id", "branch_id"]],
        ["staff", "idx_perf_staff_store_branch", ["store_id", "branch_id"]],
        ["categories", "idx_perf_categories_store", ["store_id"]],
        ["products", "idx_perf_products_store_branch", ["store_id", "branch_id"]],
        ["packages", "idx_perf_packages_store_branch", ["store_id", "branch_id"]],
        ["orders", "idx_perf_orders_store_date", ["store_id", "order_date"]],
        ["orders", "idx_perf_orders_branch_date", ["branch_id", "order_date"]],
        ["order_items", "idx_perf_order_items_order", ["order_id"]],
        ["order_items", "idx_perf_order_items_store_order", ["store_id", "order_id"]],
        ["order_items", "idx_perf_order_items_product", ["product_id"]],
        ["bookings", "idx_perf_bookings_store_event", ["store_id", "event_date"]],
        ["bookings", "idx_perf_bookings_branch_event", ["branch_id", "event_date"]],
        ["booking_items", "idx_perf_booking_items_booking", ["booking_id"]],
        ["booking_items", "idx_perf_booking_items_product", ["product_id"]],
        ["employee_actions", "idx_perf_employee_actions_store_created", ["store_id", "created_at"]],
        ["employee_actions", "idx_perf_employee_actions_branch_created", ["branch_id", "created_at"]],
        ["employee_actions", "idx_perf_employee_actions_employee_created", ["employee_id", "created_at"]],
        ["restock_history", "idx_perf_restock_store_branch_created", ["store_id", "branch_id", "created_at"]],
        ["subscriptions", "idx_perf_subscriptions_store", ["store_id"]],
        ["payments", "idx_perf_payments_store", ["store_id"]],
        ["payments", "idx_perf_payments_status", ["status"]],
        ["subscription_history", "idx_perf_subscription_history_store", ["store_id"]],
        ["subscription_audit_logs", "idx_perf_subscription_audit_business", ["business_id"]],
    ];

    for (const [tableName, indexName, columns] of indexDefinitions) {
        await ensureIndex(db, tableName, indexName, columns);
    }
}

// ---------------------
// Defensive insertRows
// ---------------------
async function insertRows(db, tableName, rows, batchSize = CONFIG.batchSize) {
    if (!rows.length) return 0;

    const availableColumns = await getTableColumns(db, tableName);
    const requestedColumns = Object.keys(rows[0]);
    const columns = requestedColumns.filter((column) => availableColumns.has(column));

    if (!columns.length) {
        throw new Error(`No insertable columns found for ${tableName}.`);
    }

    let inserted = 0;

    for (let offset = 0; offset < rows.length; offset += batchSize) {
        const chunk = rows.slice(offset, offset + batchSize);
        const placeholders = chunk
            .map(() => `(${columns.map(() => "?").join(", ")})`)
            .join(", ");
        const values = [];

        for (const row of chunk) {
            for (const column of columns) {
                let val = row[column] === undefined ? null : row[column];

                // Protect MySQL from NaN / Infinity (these would be sent unquoted and break SQL)
                if (typeof val === "number") {
                    if (!Number.isFinite(val)) val = null;
                } else if (typeof val === "boolean") {
                    // normalize booleans to tinyint(1)
                    val = val ? 1 : 0;
                } else if (val instanceof Date) {
                    // Date -> `YYYY-MM-DD HH:mm:ss`
                    val = sqlDateTime(val, val.getHours(), val.getMinutes(), val.getSeconds());
                } else if (val && typeof val === "object" && !Buffer.isBuffer(val)) {
                    // try to stringify plain objects (useful for JSON columns)
                    try { val = JSON.stringify(val); } catch (e) { val = String(val); }
                }

                values.push(val);
            }
        }

        await db.query(
            `INSERT INTO ${quoteIdentifier(tableName)}
                 (${columns.map(quoteIdentifier).join(", ")})
             VALUES ${placeholders}`,
            values
        );
        inserted += chunk.length;
    }

    return inserted;
}

// ---------------------
// rest of helper functions (no change)
// ---------------------
async function prepareSeedStoreTempTable(db) {
    await db.query("DROP TEMPORARY TABLE IF EXISTS tmp_perf_seed_store_ids");
    await db.query(`
        CREATE TEMPORARY TABLE tmp_perf_seed_store_ids (
            id BIGINT PRIMARY KEY
        ) ENGINE=InnoDB
    `);

    const [stores] = await db.execute(
        `SELECT id
         FROM stores
         WHERE slug LIKE ?
            OR email LIKE ?`,
        [`${STORE_SLUG_PREFIX}%`, `%@${STORE_EMAIL_DOMAIN}`]
    );

    if (!stores.length) return 0;

    for (let offset = 0; offset < stores.length; offset += 1000) {
        const chunk = stores.slice(offset, offset + 1000);
        const placeholders = chunk.map(() => "(?)").join(", ");
        await db.query(
            `INSERT INTO tmp_perf_seed_store_ids (id) VALUES ${placeholders}`,
            chunk.map((row) => row.id)
        );
    }

    return stores.length;
}

async function deleteChildByParent(db, relation) {
    const {
        childTable,
        childColumn,
        parentTable,
        parentColumn,
    } = relation;

    if (
        !(await tableExists(db, childTable)) ||
        !(await tableExists(db, parentTable))
    ) {
        return;
    }

    const childColumns = await getTableColumns(
        db,
        childTable
    );
    const parentColumns = await getTableColumns(
        db,
        parentTable
    );

    if (
        !childColumns.has(childColumn) ||
        !parentColumns.has(parentColumn) ||
        !parentColumns.has("store_id")
    ) {
        return;
    }

    const [seededStores] = await db.query(
        `SELECT id
         FROM tmp_perf_seed_store_ids
         ORDER BY id`
    );

    let totalDeleted = 0;

    for (const seeded of seededStores) {
        const storeId = Number(seeded.id);
        const [result] = await db.query(
            `DELETE child
             FROM ${quoteIdentifier(childTable)} AS child
             INNER JOIN ${quoteIdentifier(parentTable)} AS parent
                ON child.${quoteIdentifier(childColumn)} =
                   parent.${quoteIdentifier(parentColumn)}
             WHERE parent.store_id = ?`,
            [storeId]
        );
        totalDeleted += Number(
            result.affectedRows || 0
        );
    }

    console.log(
        `Deleted ${totalDeleted.toLocaleString()} rows from ${childTable}.`
    );
}

async function deleteRowsScopedByColumn(
    db,
    tableName,
    columnName,
    tempTableName
) {
    if (!(await tableExists(db, tableName))) return;

    const columns = await getTableColumns(
        db,
        tableName
    );
    if (!columns.has(columnName)) return;

    const [seededStores] = await db.query(
        `SELECT id
         FROM ${quoteIdentifier(tempTableName)}
         ORDER BY id`
    );

    let totalDeleted = 0;

    for (const seeded of seededStores) {
        const [result] = await db.query(
            `DELETE FROM ${quoteIdentifier(tableName)}
             WHERE ${quoteIdentifier(columnName)} = ?`,
            [Number(seeded.id)]
        );
        totalDeleted += Number(
            result.affectedRows || 0
        );
    }

    console.log(
        `Deleted ${totalDeleted.toLocaleString()} rows from ${tableName}.`
    );
}


async function deleteDemoInviteOtps(db) {
    for (const tableName of ["manager_invite_otps", "staff_invite_otps"]) {
        if (!(await tableExists(db, tableName))) continue;
        const columns = await getTableColumns(db, tableName);
        if (!columns.has("email")) continue;

        const [result] = await db.execute(
            `DELETE FROM ${quoteIdentifier(tableName)} WHERE email LIKE ?`,
            [`%@${STORE_EMAIL_DOMAIN}`]
        );

        if (Number(result.affectedRows || 0) > 0) {
            console.log(
                `Deleted ${Number(result.affectedRows || 0).toLocaleString()} demo OTP rows from ${tableName}.`
            );
        }
    }
}

async function removeExistingSeedRun(db) {
    if (!CONFIG.resetExistingRun) return;

    const count = await prepareSeedStoreTempTable(db);
    if (!count) return;

    console.log(`Removing ${count} existing ${CONFIG.runTag} seed stores before reseeding...`);

    await db.query("SET FOREIGN_KEY_CHECKS = 0");

    try {
        // Delete V2 inventory children before the generic store-scoped cleanup.
        // This keeps the reset deterministic even when foreign-key checks are
        // re-enabled later or a future schema adds stricter relationships.
        for (const tableName of [
            "inventory_movements",
            "inventory_batches",
            "branch_inventory",
        ]) {
            await deleteRowsScopedByColumn(
                db,
                tableName,
                "store_id",
                "tmp_perf_seed_store_ids"
            );
        }

        await deleteDemoInviteOtps(db);

        const childRelations = [
            ["order_items", "order_id", "orders", "order_id"],
            ["booking_items", "booking_id", "bookings", "id"],
            ["product_variants", "product_id", "products", "id"],
            ["package_items", "package_id", "packages", "id"],
            ["payment_submissions", "booking_id", "bookings", "id"],
            ["payment_submissions", "order_id", "orders", "order_id"],
            ["subscription_audit_logs", "subscription_id", "subscriptions", "id"],
            ["subscription_notifications", "subscription_id", "subscriptions", "id"],
            ["payment_submissions", "subscription_id", "subscriptions", "id"],
        ].map(([childTable, childColumn, parentTable, parentColumn]) => ({
            childTable,
            childColumn,
            parentTable,
            parentColumn,
        }));

        for (const relation of childRelations) {
            await deleteChildByParent(db, relation);
        }

        // subscription_audit_logs scopes to a store via `business_id`, not
        // `store_id`, so the generic store_id column scan below never finds it.
        await deleteRowsScopedByColumn(
            db,
            "subscription_audit_logs",
            "business_id",
            "tmp_perf_seed_store_ids"
        );

        const [storeTables] = await db.execute(
            `SELECT DISTINCT TABLE_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND COLUMN_NAME = 'store_id'
               AND TABLE_NAME <> 'stores'
             ORDER BY TABLE_NAME`
        );

        const [seededStores] = await db.query(
            `SELECT id
             FROM tmp_perf_seed_store_ids
             ORDER BY id`
        );

        for (const row of storeTables) {
            const tableName = String(row.TABLE_NAME);
            let totalDeleted = 0;

            for (const seeded of seededStores) {
                const [result] = await db.query(
                    `DELETE FROM ${quoteIdentifier(tableName)}
                     WHERE store_id = ?`,
                    [Number(seeded.id)]
                );
                totalDeleted += Number(
                    result.affectedRows || 0
                );
            }

            if (totalDeleted) {
                console.log(
                    `Deleted ${totalDeleted.toLocaleString()} rows from ${tableName}.`
                );
            }
        }

        const [storeResult] = await db.query(
            `DELETE store_row
             FROM stores AS store_row
             INNER JOIN tmp_perf_seed_store_ids AS seeded
                ON store_row.id = seeded.id`
        );

        console.log(`Deleted ${Number(storeResult.affectedRows || 0).toLocaleString()} existing seeded stores.`);
    } finally {
        await db.query("SET FOREIGN_KEY_CHECKS = 1");
        await db.query("DROP TEMPORARY TABLE IF EXISTS tmp_perf_seed_store_ids");
    }
}

async function fetchRealPlans(db) {
    const [rows] = await db.execute(
        `SELECT id, name, price
         FROM plans
         WHERE is_archived = 0
         ORDER BY price ASC`
    );

    if (!rows.length) {
        throw new Error(
            "No active rows found in the `plans` table. Seed at least one real plan " +
            "(e.g. via the Plans admin page) before running the demo seeder."
        );
    }

    return rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        price: Number(row.price),
    }));
}

async function fetchPlatformAdminIds(db) {
    const [rows] = await db.execute(
        `SELECT platform_admin_id
         FROM platform_admins
         WHERE is_active = 1
         ORDER BY platform_admin_id`
    );

    if (!rows.length) {
        throw new Error(
            "No active rows found in the `platform_admins` table. Create at least one " +
            "platform admin account before running the demo seeder."
        );
    }

    return rows.map((row) => Number(row.platform_admin_id));
}

async function createStoreAndPeople(db, storeIndex, passwordHash, usedPersonnelNames, planProfile) {
    const identity = storeIdentity(storeIndex);
    const rng = createRng(`${CONFIG.runTag}:people:${storeIndex}`);
    const ownerName = realisticName(rng, usedPersonnelNames);

    const [storeResult] = await db.execute(
        `INSERT INTO stores
             (store_name, owner_name, email, password, slug, plan)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [identity.name, ownerName, identity.ownerEmail, passwordHash, identity.slug, planProfile.name]
    );

    const storeId = Number(storeResult.insertId);
    const branches = [];
    const branchLabels = [];

    // Plan-driven branch count (Starter:1, Growth: up to 3, Scale: 4+)
    const branchCount = planProfile.branches;

    for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
        branchLabels.push(`${branchIndex === 0 ? "Main" : (branchIndex === 1 ? "North" : branchIndex === 2 ? "South" : `Branch ${branchIndex+1}`)} Retail Branch`);
    }

    for (let branchIndex = 0; branchIndex < branchLabels.length; branchIndex += 1) {
        const location = PH_LOCATIONS[(storeIndex * 5 + branchIndex * 3) % PH_LOCATIONS.length];
        const [branchResult] = await db.execute(
            `INSERT INTO branches
                 (store_id, branch_name, contact_number, address)
             VALUES (?, ?, ?, ?)`,
            [
                storeId,
                branchLabels[branchIndex],
                buildPhoneNumber(storeIndex, branchIndex + 1),
                `${randomInt(rng, 10, 999)} ${randomChoice(rng, ["Rizal", "Mabini", "Bonifacio", "Quezon", "Luna", "Sampaguita"])} Street, ${location[0]}, ${location[1]}`,
            ]
        );

        branches.push({
            id: Number(branchResult.insertId),
            name: branchLabels[branchIndex],
        });
    }

    const managers = [];
    const managerPermissions = JSON.stringify({
        dashboard: true,
        bookings: true,
        packages: true,
        packages_manage: true,
        inventory: true,
        pos: true,
        reports: true,
        staff_management: true,
        staff_roles: true,
        branch_settings: true,
    });

    const managerCount = Math.min(
        Number(planProfile.managers || CONFIG.managersPerStore),
        branches.length
    );

    for (let managerIndex = 0; managerIndex < managerCount; managerIndex += 1) {
        const managerName = realisticName(rng, usedPersonnelNames);
        const managerEmail = `${emailSlug(managerName)}.s${identity.code}.m${managerIndex + 1}@${STORE_EMAIL_DOMAIN}`;

        const [managerResult] = await db.execute(
            `INSERT INTO managers
             (
                 store_id,
                 branch_id,
                 manager_name,
                 manager_email,
                 password,
                 status,
                 permissions
             )
             VALUES (?, ?, ?, ?, ?, 'active', ?)`,
            [
                storeId,
                branches[managerIndex].id,
                managerName,
                managerEmail,
                passwordHash,
                managerPermissions,
            ]
        );

        managers.push({
            id: Number(managerResult.insertId),
            branchId: branches[managerIndex].id,
        });
    }

    const staffPermissionProfiles = [
        // Operations Staff: best all-around dashboard demo account.
        {
            dashboard: true, bookings: true, packages: true, packages_manage: false,
            inventory: true, pos: true, reports: false, staff_management: false,
            staff_roles: false, branch_settings: false,
        },
        // Booking-focused Staff.
        {
            dashboard: true, bookings: true, packages: true, packages_manage: false,
            inventory: false, pos: false, reports: false, staff_management: false,
            staff_roles: false, branch_settings: false,
        },
        // POS / inventory-focused Staff.
        {
            dashboard: true, bookings: false, packages: false, packages_manage: false,
            inventory: true, pos: true, reports: false, staff_management: false,
            staff_roles: false, branch_settings: false,
        },
    ];

    const staffCount = planProfile.staff;
    const staffDistribution = [];
    // distribute staff across managers/branches
    for (let i = 0; i < staffCount; i += 1) staffDistribution.push(i % Math.max(1, managers.length));

    const staffRows = [];

    for (let staffIndex = 0; staffIndex < staffCount; staffIndex += 1) {
        const managerIndex = staffDistribution[staffIndex];
        const staffName = realisticName(rng, usedPersonnelNames);

        staffRows.push({
            store_id: storeId,
            branch_id: managers[managerIndex] ? managers[managerIndex].branchId : branches[0].id,
            manager_id: managers[managerIndex] ? managers[managerIndex].id : null,
            staff_name: staffName,
            staff_email: `${emailSlug(staffName)}.s${identity.code}.e${staffIndex + 1}@${STORE_EMAIL_DOMAIN}`,
            password: passwordHash,
            status: "active",
            permissions: JSON.stringify(staffPermissionProfiles[staffIndex % staffPermissionProfiles.length]),
        });
    }

    if (staffRows.length) await insertRows(db, "staff", staffRows, 10);

    const [storedStaff] = await db.execute(
        `SELECT id, branch_id, manager_id, staff_name, staff_email, permissions
         FROM staff
         WHERE store_id = ?
         ORDER BY id`,
        [storeId]
    );

    const staff = storedStaff.map((row) => ({
        id: Number(row.id),
        branchId: Number(row.branch_id),
        managerId: row.manager_id == null ? null : Number(row.manager_id),
        name: String(row.staff_name),
        email: String(row.staff_email),
        permissions: row.permissions,
    }));

    return { storeId, identity, ownerName, branches, staff };
}

async function createCategories(db, storeId) {
    await insertRows(
        db,
        "categories",
        CATEGORIES.map((category) => ({
            store_id: storeId,
            category_name: category,
            status: "active",
        })),
        50
    );
}

async function createProducts(db, storeId, storeIndex, branches, planProfile) {
    const desiredProducts = Number(planProfile.productsPerStore || CONFIG.productsPerStore);
    const attentionTotal = totalInventoryAttention(planProfile);
    const requestedVariantProducts = Number(planProfile.variantProducts || 0);
    const requestedSimpleProducts = Number(
        planProfile.simpleProducts ?? (desiredProducts - attentionTotal - requestedVariantProducts)
    );

    if (attentionTotal > desiredProducts) {
        throw new Error(
            `${planProfile.name} requests ${attentionTotal} inventory-attention fixtures ` +
            `but only ${desiredProducts} products are configured.`
        );
    }

    if (requestedSimpleProducts + requestedVariantProducts + attentionTotal !== desiredProducts) {
        throw new Error(
            `${planProfile.name} product distribution must equal ${desiredProducts}: ` +
            `${requestedSimpleProducts} simple + ${requestedVariantProducts} variant + ` +
            `${attentionTotal} attention.`
        );
    }

    const healthyProductCount = desiredProducts - attentionTotal;
    const variantSlots = evenlyDistributedIndexSet(
        healthyProductCount,
        requestedVariantProducts
    );

    const rng = createRng(`${CONFIG.runTag}:products:${storeIndex}`);
    const rows = [];
    const pendingVariants = [];
    const attentionStates = [];

    for (let itemIndex = 1; itemIndex <= desiredProducts; itemIndex += 1) {
        const attentionState = inventoryAttentionStateForIndex(planProfile, itemIndex);
        const product = attentionState
            ? attentionFoodProduct(storeIndex, itemIndex, attentionState)
            : productName(storeIndex, itemIndex);
        const branch = branches[(itemIndex - 1) % branches.length];
        const isAttentionFixture = Boolean(attentionState);
        const healthyIndex = itemIndex - attentionTotal - 1; // 0-based after fixtures

        // Exact plan-specific variant count while keeping variants evenly spread
        // through the healthy catalog. Attention products remain simple so one
        // fixture always equals one dashboard attention item.
        const hasVariants =
            !isAttentionFixture &&
            healthyIndex >= 0 &&
            variantSlots.has(healthyIndex);

        const priceVariance = 0.86 + rng() * 0.28;
        const baseSalesPrice = Math.max(
            35,
            Math.round((product.basePrice * priceVariance) / 5) * 5
        );
        const baseOriginalPrice = Math.max(
            20,
            Math.round((baseSalesPrice * (0.58 + rng() * 0.12)) / 5) * 5
        );

        let alertLevel = randomInt(rng, 8, 25);
        let forcedStock = null;
        let forcedExpirationDate = null;

        if (attentionState === "expired") {
            const ordinal = inventoryAttentionOrdinal(planProfile, itemIndex, "expired") || 1;
            alertLevel = 12;
            forcedStock = randomInt(rng, 24, 80);
            // Keep the exact current expired-item count, but spread those
            // expiration dates across the previous 12 months so historical
            // expiry/report filters are not concentrated only around TODAY.
            const expiredCount = Math.max(
                1,
                Number(planProfile?.inventoryAttention?.expired || 1)
            );
            const daysAgo = Math.max(
                1,
                Math.round((ordinal / expiredCount) * 365)
            );
            forcedExpirationDate = addDays(TODAY, -daysAgo);
        } else if (attentionState === "expiringSoon") {
            const ordinal = inventoryAttentionOrdinal(planProfile, itemIndex, "expiringSoon") || 1;
            alertLevel = 12;
            forcedStock = randomInt(rng, 24, 80);
            // Spread expiry-soon fixtures across the next seven days. Combined
            // with persistent expired/out-of-stock/low-stock rows this guarantees
            // inventory attention remains visible every day after seeding.
            forcedExpirationDate = addDays(TODAY, ((ordinal - 1) % 7) + 1);
        } else if (attentionState === "outOfStock") {
            alertLevel = 12;
            forcedStock = 0;
        } else if (attentionState === "lowStock") {
            alertLevel = 12;
            forcedStock = randomInt(rng, 1, alertLevel);
        }

        const sku =
            `${CONFIG.runTag.toUpperCase()}-${String(storeIndex).padStart(3, "0")}-` +
            `${String(itemIndex).padStart(5, "0")}`;
        const variantTemplates = [];

        if (hasVariants) {
            // Alternate deterministically between 2 and 3 variants.
            const variantCount = 2 + ((healthyIndex + storeIndex) % 2);

            for (let variantIndex = 0; variantIndex < variantCount; variantIndex += 1) {
                const values = variantValuesForProduct(
                    product,
                    storeIndex,
                    itemIndex,
                    variantIndex
                );
                const priceMultiplier = 0.94 + variantIndex * 0.10;
                const salesPrice = Math.max(
                    35,
                    Math.round((baseSalesPrice * priceMultiplier) / 5) * 5
                );
                const originalPrice = Math.max(
                    20,
                    Math.round((baseOriginalPrice * priceMultiplier) / 5) * 5
                );
                const variantAlertLevel = Math.max(3, Math.round(alertLevel / 3));

                variantTemplates.push({
                    variant_values: JSON.stringify(values),
                    sku: `${sku}-V${String(variantIndex + 1).padStart(2, "0")}`,
                    barcode: String(
                        8900000000000 + storeIndex * 100000 + itemIndex * 10 + variantIndex
                    ),
                    stock: randomInt(
                        rng,
                        variantAlertLevel + 15,
                        variantAlertLevel + 180
                    ),
                    alert_level: variantAlertLevel,
                    original_price: originalPrice,
                    sales_price: salesPrice,
                    expiration_date: null,
                    expiry_date: null,
                    status: "active",
                });
            }
        }

        const stock = hasVariants
            ? variantTemplates.reduce(
                (sum, variant) => sum + Number(variant.stock || 0),
                0
            )
            : forcedStock !== null
                ? forcedStock
                : randomInt(rng, alertLevel + 15, alertLevel + 260);

        const salesPrice = hasVariants
            ? Math.min(...variantTemplates.map((variant) => variant.sales_price))
            : baseSalesPrice;

        const originalPrice = hasVariants
            ? Math.min(...variantTemplates.map((variant) => variant.original_price))
            : baseOriginalPrice;

        const name = hasVariants ? product.variantParentName : product.name;

        rows.push({
            store_id: storeId,
            branch_id: branch.id,
            package_id: null,
            package_name: null,
            sku,
            barcode: `${String(8800000000000 + storeIndex * 100000 + itemIndex)}`,
            name,
            description: isAttentionFixture
                ? `${name}. Persistent ${attentionState} inventory-attention fixture for dashboard testing.`
                : hasVariants
                    ? `${name}. Direct-sale party supply item with ${variantTemplates.length} realistic variants; not for rental.`
                    : `${name}. Direct-sale party supply item; not for rental.`,
            category: product.category,
            stock,
            alert_level: alertLevel,
            original_price: originalPrice,
            sales_price: salesPrice,
            expiration_date: forcedExpirationDate ? isoDate(forcedExpirationDate) : null,
            expiry_date: forcedExpirationDate ? isoDate(forcedExpirationDate) : null,
            has_variants: hasVariants ? 1 : 0,
            status: "active",
        });

        pendingVariants.push(variantTemplates);
        attentionStates.push(attentionState);
    }

    await insertRows(db, "products", rows);

    const [products] = await db.execute(
        `SELECT id, branch_id, name, category, original_price, sales_price, has_variants
         FROM products
         WHERE store_id = ?
         ORDER BY id`,
        [storeId]
    );

    const variantRows = [];
    for (let i = 0; i < products.length; i += 1) {
        const productId = Number(products[i].id);
        for (const template of pendingVariants[i] || []) {
            variantRows.push({ product_id: productId, ...template });
        }
    }

    if (variantRows.length) {
        await insertRows(
            db,
            "product_variants",
            variantRows,
            Math.max(CONFIG.batchSize, 800)
        );
    }

    const [storedVariants] = await db.execute(
        `SELECT
             pv.id,
             pv.product_id,
             pv.variant_values,
             pv.stock,
             pv.alert_level,
             pv.original_price,
             pv.sales_price
         FROM product_variants AS pv
                  INNER JOIN products AS product
                             ON product.id = pv.product_id
         WHERE product.store_id = ?
         ORDER BY pv.product_id, pv.id`,
        [storeId]
    );

    const variantsByProduct = new Map();

    for (const row of storedVariants) {
        const productId = Number(row.product_id);
        const values = parseVariantValues(row.variant_values);

        if (!variantsByProduct.has(productId)) variantsByProduct.set(productId, []);

        variantsByProduct.get(productId).push({
            id: Number(row.id),
            values,
            label: variantDisplayLabel(values),
            stock: Number(row.stock),
            alertLevel: Number(row.alert_level),
            originalPrice: Number(row.original_price),
            salesPrice: Number(row.sales_price),
        });
    }

    const result = products.map((row, index) => {
        const id = Number(row.id);
        return {
            id,
            branchId: Number(row.branch_id),
            name: String(row.name),
            category: String(row.category),
            originalPrice: Number(row.original_price),
            salesPrice: Number(row.sales_price),
            hasVariants: dbBoolean(row.has_variants),
            variants: variantsByProduct.get(id) || [],
            attentionState: attentionStates[index] || null,
        };
    });

    const actualVariantProducts = result.filter((product) => product.hasVariants).length;
    const actualAttentionProducts = result.filter((product) => product.attentionState).length;
    const actualSimpleProducts = result.length - actualVariantProducts - actualAttentionProducts;

    if (
        actualVariantProducts !== requestedVariantProducts ||
        actualSimpleProducts !== requestedSimpleProducts ||
        actualAttentionProducts !== attentionTotal
    ) {
        throw new Error(
            `${planProfile.name} product distribution mismatch after insert: ` +
            `${actualSimpleProducts} simple / ${actualVariantProducts} variant / ` +
            `${actualAttentionProducts} attention.`
        );
    }

    return result;
}


// -----------------------------------------------------------------------------
// Database V2 demo associations
// -----------------------------------------------------------------------------
// Keep the original seeded products/product_variants values unchanged, then
// mirror those values into the normalized V2 inventory tables. This makes the
// demo dataset exercise the same V2 read/write model as the application while
// preserving every existing product, stock, price, expiry, and plan fixture.
async function seedV2InventoryForStore(db, storeId) {
    const productColumns = await getTableColumns(db, "products");
    const variantColumns = await getTableColumns(db, "product_variants");

    const productExpiryExpression = productColumns.has("expiration_date")
        ? "p.expiration_date"
        : productColumns.has("expiry_date")
            ? "p.expiry_date"
            : "NULL";

    const variantExpiryExpression = variantColumns.has("expiration_date")
        ? "pv.expiration_date"
        : variantColumns.has("expiry_date")
            ? "pv.expiry_date"
            : "NULL";

    // 1) Simple/non-variant products: one V2 inventory row for the same branch.
    await db.execute(
        `INSERT INTO branch_inventory (
             store_id,
             branch_id,
             product_id,
             variant_id,
             quantity_on_hand,
             reorder_level,
             cost_price,
             sales_price,
             status,
             created_at,
             updated_at
         )
         SELECT
             p.store_id,
             p.branch_id,
             p.id,
             NULL,
             GREATEST(COALESCE(p.stock, 0), 0),
             GREATEST(COALESCE(p.alert_level, 0), 0),
             COALESCE(p.original_price, 0.00),
             COALESCE(p.sales_price, 0.00),
             'active',
             COALESCE(p.created_at, CURRENT_TIMESTAMP),
             CURRENT_TIMESTAMP
         FROM products AS p
         WHERE p.store_id = ?
           AND (
                COALESCE(p.has_variants, 0) = 0
                OR NOT EXISTS (
                    SELECT 1
                    FROM product_variants AS existing_variant
                    WHERE existing_variant.product_id = p.id
                )
           )
         ON DUPLICATE KEY UPDATE
             quantity_on_hand = VALUES(quantity_on_hand),
             reorder_level = VALUES(reorder_level),
             cost_price = VALUES(cost_price),
             sales_price = VALUES(sales_price),
             status = 'active',
             updated_at = CURRENT_TIMESTAMP`,
        [storeId]
    );

    // 2) Variant products: one V2 inventory row per variant. Do not add a second
    // parent row because products.stock is already the aggregate of the variants.
    await db.execute(
        `INSERT INTO branch_inventory (
             store_id,
             branch_id,
             product_id,
             variant_id,
             quantity_on_hand,
             reorder_level,
             cost_price,
             sales_price,
             status,
             created_at,
             updated_at
         )
         SELECT
             p.store_id,
             p.branch_id,
             p.id,
             pv.id,
             GREATEST(COALESCE(pv.stock, 0), 0),
             GREATEST(COALESCE(pv.alert_level, 0), 0),
             COALESCE(pv.original_price, 0.00),
             COALESCE(pv.sales_price, 0.00),
             'active',
             COALESCE(pv.created_at, p.created_at, CURRENT_TIMESTAMP),
             CURRENT_TIMESTAMP
         FROM products AS p
         INNER JOIN product_variants AS pv
             ON pv.product_id = p.id
         WHERE p.store_id = ?
           AND COALESCE(p.has_variants, 0) = 1
         ON DUPLICATE KEY UPDATE
             quantity_on_hand = VALUES(quantity_on_hand),
             reorder_level = VALUES(reorder_level),
             cost_price = VALUES(cost_price),
             sales_price = VALUES(sales_price),
             status = 'active',
             updated_at = CURRENT_TIMESTAMP`,
        [storeId]
    );

    const expiryExpression =
        `CASE WHEN bi.variant_id IS NULL ` +
        `THEN ${productExpiryExpression} ELSE ${variantExpiryExpression} END`;

    const batchPrefix = `SEED-${CONFIG.runTag.toUpperCase()}-`;

    // 3) One opening batch for each seeded inventory row with stock. Expired demo
    // fixtures remain expired in V2; non-expiring rows simply have NULL expiry.
    await db.execute(
        `INSERT INTO inventory_batches (
             store_id,
             branch_id,
             branch_inventory_id,
             batch_code,
             received_quantity,
             remaining_quantity,
             unit_cost,
             received_at,
             expiration_date,
             status
         )
         SELECT
             bi.store_id,
             bi.branch_id,
             bi.id,
             CASE
                 WHEN bi.variant_id IS NULL
                     THEN CONCAT(?, 'P', bi.product_id)
                 ELSE CONCAT(?, 'P', bi.product_id, '-V', bi.variant_id)
             END,
             bi.quantity_on_hand,
             bi.quantity_on_hand,
             bi.cost_price,
             COALESCE(pv.created_at, p.created_at, CURRENT_TIMESTAMP),
             ${expiryExpression},
             CASE
                 WHEN ${expiryExpression} IS NOT NULL
                  AND ${expiryExpression} < ?
                     THEN 'expired'
                 ELSE 'active'
             END
         FROM branch_inventory AS bi
         INNER JOIN products AS p
             ON p.id = bi.product_id
         LEFT JOIN product_variants AS pv
             ON pv.id = bi.variant_id
         WHERE bi.store_id = ?
           AND bi.status = 'active'
           AND bi.quantity_on_hand > 0
           AND NOT EXISTS (
               SELECT 1
               FROM inventory_batches AS existing_batch
               WHERE existing_batch.branch_inventory_id = bi.id
                 AND existing_batch.batch_code = CASE
                     WHEN bi.variant_id IS NULL
                         THEN CONCAT(?, 'P', bi.product_id)
                     ELSE CONCAT(?, 'P', bi.product_id, '-V', bi.variant_id)
                 END
           )`,
        [
            batchPrefix,
            batchPrefix,
            isoDate(TODAY),
            storeId,
            batchPrefix,
            batchPrefix,
        ]
    );

    // 4) Opening movement. This is the V2 ledger starting point for demo stock;
    // later real POS/restock/booking actions are written by the backend normally.
    const movementReferencePrefix = `seed:${CONFIG.runTag}:branch_inventory:`;
    await db.execute(
        `INSERT INTO inventory_movements (
             store_id,
             branch_id,
             branch_inventory_id,
             movement_type,
             quantity_delta,
             quantity_before,
             quantity_after,
             reference_type,
             reference_id,
             actor_id,
             actor_role,
             actor_name,
             notes,
             created_at
         )
         SELECT
             bi.store_id,
             bi.branch_id,
             bi.id,
             'OPENING_BALANCE',
             bi.quantity_on_hand,
             0,
             bi.quantity_on_hand,
             'DEMO_SEED',
             CONCAT(?, bi.id),
             NULL,
             'SYSTEM',
             'StockNBook Demo Seeder',
             'Opening balance mirrored from the unchanged seeded products/product_variants stock.',
             COALESCE(bi.created_at, CURRENT_TIMESTAMP)
         FROM branch_inventory AS bi
         WHERE bi.store_id = ?
           AND bi.status = 'active'
           AND bi.quantity_on_hand <> 0
           AND NOT EXISTS (
               SELECT 1
               FROM inventory_movements AS existing_movement
               WHERE existing_movement.branch_inventory_id = bi.id
                 AND existing_movement.movement_type = 'OPENING_BALANCE'
                 AND existing_movement.reference_type = 'DEMO_SEED'
                 AND existing_movement.reference_id = CONCAT(?, bi.id)
           )`,
        [movementReferencePrefix, storeId, movementReferencePrefix]
    );

    const [[counts]] = await db.execute(
        `SELECT
             (SELECT COUNT(*) FROM branch_inventory WHERE store_id = ?) AS inventory_rows,
             (SELECT COUNT(*) FROM inventory_batches WHERE store_id = ?) AS batch_rows,
             (SELECT COUNT(*) FROM inventory_movements WHERE store_id = ?) AS movement_rows`,
        [storeId, storeId, storeId]
    );

    return {
        inventoryRows: Number(counts?.inventory_rows || 0),
        batchRows: Number(counts?.batch_rows || 0),
        movementRows: Number(counts?.movement_rows || 0),
    };
}

async function seedV2PackageItems(db, storeId, packages) {
    const rows = [];

    for (const pkg of packages) {
        const inclusions = Array.isArray(pkg.inclusions) ? pkg.inclusions : [];
        inclusions.forEach((item, index) => {
            rows.push({
                package_id: pkg.id,
                product_id: Number(item.productId ?? item.product_id),
                variant_id:
                    item.variantId === null || item.variantId === undefined
                        ? item.variant_id === null || item.variant_id === undefined
                            ? null
                            : Number(item.variant_id)
                        : Number(item.variantId),
                quantity: Math.max(1, Number(item.quantity || 1)),
                unit_price_snapshot: Number(item.unitPrice ?? item.unit_price ?? 0),
                sort_order: index,
            });
        });
    }

    if (rows.length) {
        await insertRows(db, "package_items", rows, Math.max(CONFIG.batchSize, 500));
    }

    const [[result]] = await db.execute(
        `SELECT COUNT(*) AS package_item_rows
         FROM package_items AS pi
         INNER JOIN packages AS p ON p.id = pi.package_id
         WHERE p.store_id = ?`,
        [storeId]
    );

    return Number(result?.package_item_rows || 0);
}

async function verifyV2SeedStore(db, storeId, expectedPackageItems) {
    // The derived-table query below represents the legacy stock model exactly:
    // one row for a simple product, or one row per variant for variant products.
    const [[inventoryCheck]] = await db.execute(
        `SELECT COUNT(*) AS mismatch_count
         FROM (
             SELECT
                 p.store_id,
                 p.branch_id,
                 p.id AS product_id,
                 NULL AS variant_id,
                 GREATEST(COALESCE(p.stock, 0), 0) AS quantity_on_hand,
                 GREATEST(COALESCE(p.alert_level, 0), 0) AS reorder_level,
                 COALESCE(p.original_price, 0.00) AS cost_price,
                 COALESCE(p.sales_price, 0.00) AS sales_price
             FROM products AS p
             WHERE p.store_id = ?
               AND (
                    COALESCE(p.has_variants, 0) = 0
                    OR NOT EXISTS (
                        SELECT 1
                        FROM product_variants AS pv0
                        WHERE pv0.product_id = p.id
                    )
               )

             UNION ALL

             SELECT
                 p.store_id,
                 p.branch_id,
                 p.id AS product_id,
                 pv.id AS variant_id,
                 GREATEST(COALESCE(pv.stock, 0), 0) AS quantity_on_hand,
                 GREATEST(COALESCE(pv.alert_level, 0), 0) AS reorder_level,
                 COALESCE(pv.original_price, 0.00) AS cost_price,
                 COALESCE(pv.sales_price, 0.00) AS sales_price
             FROM products AS p
             INNER JOIN product_variants AS pv
                 ON pv.product_id = p.id
             WHERE p.store_id = ?
               AND COALESCE(p.has_variants, 0) = 1
         ) AS legacy_inventory
         LEFT JOIN branch_inventory AS bi
           ON bi.store_id = legacy_inventory.store_id
          AND bi.branch_id = legacy_inventory.branch_id
          AND bi.product_id = legacy_inventory.product_id
          AND bi.variant_id <=> legacy_inventory.variant_id
         WHERE bi.id IS NULL
            OR bi.status <> 'active'
            OR bi.quantity_on_hand <> legacy_inventory.quantity_on_hand
            OR bi.reorder_level <> legacy_inventory.reorder_level
            OR bi.cost_price <> legacy_inventory.cost_price
            OR bi.sales_price <> legacy_inventory.sales_price`,
        [storeId, storeId]
    );

    const [[coverageCheck]] = await db.execute(
        `SELECT
             SUM(
                 CASE WHEN bi.quantity_on_hand > 0
                       AND NOT EXISTS (
                           SELECT 1
                           FROM inventory_batches AS ib
                           WHERE ib.branch_inventory_id = bi.id
                       )
                      THEN 1 ELSE 0 END
             ) AS missing_batches,
             SUM(
                 CASE WHEN bi.quantity_on_hand <> 0
                       AND NOT EXISTS (
                           SELECT 1
                           FROM inventory_movements AS im
                           WHERE im.branch_inventory_id = bi.id
                             AND im.movement_type = 'OPENING_BALANCE'
                             AND im.reference_type = 'DEMO_SEED'
                       )
                      THEN 1 ELSE 0 END
             ) AS missing_opening_movements
         FROM branch_inventory AS bi
         WHERE bi.store_id = ?
           AND bi.status = 'active'`,
        [storeId]
    );

    const [[packageCheck]] = await db.execute(
        `SELECT COUNT(*) AS package_items
         FROM package_items AS pi
         INNER JOIN packages AS p ON p.id = pi.package_id
         WHERE p.store_id = ?`,
        [storeId]
    );

    const mismatchCount = Number(inventoryCheck?.mismatch_count || 0);
    const missingBatches = Number(coverageCheck?.missing_batches || 0);
    const missingOpeningMovements = Number(
        coverageCheck?.missing_opening_movements || 0
    );
    const packageItemCount = Number(packageCheck?.package_items || 0);

    if (
        mismatchCount !== 0 ||
        missingBatches !== 0 ||
        missingOpeningMovements !== 0 ||
        packageItemCount !== expectedPackageItems
    ) {
        throw new Error(
            `Database V2 seed verification failed for store ${storeId}: ` +
            `${mismatchCount} inventory mismatches, ${missingBatches} missing batches, ` +
            `${missingOpeningMovements} missing opening movements, ` +
            `${packageItemCount}/${expectedPackageItems} package items.`
        );
    }
}

function saleSelectionForProduct(rng, product) {
    if (!product.hasVariants || !product.variants.length) {
        return {
            ...product,
            variantId: null,
            variantLabel: "",
            saleName: product.name,
        };
    }

    const variant = randomChoice(rng, product.variants);

    return {
        ...product,
        variantId: variant.id,
        variantLabel: variant.label,
        originalPrice: variant.originalPrice,
        salesPrice: variant.salesPrice,
        saleName: `${product.name} (${variant.label})`,
    };
}

function selectDistinctProducts(rng, candidates, count) {
    if (!candidates.length) return [];

    const selected = [];
    const selectedIds = new Set();
    const maximum = Math.min(count, candidates.length);

    while (selected.length < maximum) {
        const candidate = randomChoice(rng, candidates);
        if (selectedIds.has(candidate.id)) continue;
        selectedIds.add(candidate.id);
        selected.push(candidate);
    }

    return selected;
}


async function createPackages(db, storeId, storeIndex, branches, products, planProfile = {}) {
    const rng = createRng(`${CONFIG.runTag}:packages:${storeIndex}`);
    const rows = [];
    const packageData = [];

    const requestedPackageCount = Math.max(
        1,
        Math.min(
            Number(planProfile.packagesPerStore || PACKAGE_DEFINITIONS.length),
            PACKAGE_DEFINITIONS.length
        )
    );
    const inactiveCount = Math.max(
        0,
        Math.min(Number(planProfile.inactivePackages || 0), requestedPackageCount)
    );
    const itemRange = Array.isArray(planProfile.packageItemRange)
        ? planProfile.packageItemRange
        : [6, 12];
    const minItems = Math.max(1, Number(itemRange[0] || 1));
    const maxItems = Math.max(minItems, Number(itemRange[1] || minItems));
    const discountRange = Array.isArray(planProfile.packageDiscountRange)
        ? planProfile.packageDiscountRange
        : [0.08, 0.15];
    const minDiscount = Math.max(0, Number(discountRange[0] || 0));
    const maxDiscount = Math.max(minDiscount, Number(discountRange[1] || minDiscount));

    for (let index = 0; index < requestedPackageCount; index += 1) {
        const definition = PACKAGE_DEFINITIONS[index];
        const branch = branches[index % branches.length];
        const branchProducts = products.filter((product) => product.branchId === branch.id);
        const sellableBranchProducts = branchProducts.filter((product) => !product.attentionState);
        const categoryMatches = sellableBranchProducts.filter((product) =>
            definition.categories.includes(product.category)
        );

        const targetItemCount = Math.min(
            maxItems,
            minItems + (index % Math.max(1, maxItems - minItems + 1))
        );
        const candidateProducts =
            categoryMatches.length >= targetItemCount
                ? categoryMatches
                : sellableBranchProducts;
        const chosenProducts = selectDistinctProducts(rng, candidateProducts, targetItemCount);

        const inclusions = chosenProducts.map((product, productIndex) => {
            const selected = saleSelectionForProduct(rng, product);
            const isScale = String(planProfile.tier || "").toLowerCase() === "scale";
            const quantityBase = isScale ? 2 : 1;
            const quantitySpread = isScale ? 6 : 4;

            return {
                item: selected.saleName,
                productId: selected.id,
                product_id: selected.id,
                variantId: selected.variantId,
                variant_id: selected.variantId,
                variantLabel: selected.variantLabel,
                variant_label: selected.variantLabel,
                quantity: quantityBase + ((productIndex + index) % quantitySpread),
                unitPrice: selected.salesPrice,
                unit_price: selected.salesPrice,
            };
        });

        const originalValue = roundMoney(
            inclusions.reduce(
                (sum, item) =>
                    sum +
                    (Number.isFinite(Number(item.unitPrice))
                        ? Number(item.unitPrice) * Number(item.quantity)
                        : 0),
                0
            )
        );
        const discountRate = Math.max(
            minDiscount,
            Math.min(maxDiscount, Number(definition.discountRate || minDiscount))
        );
        const packagePrice = roundMoney(originalValue * (1 - discountRate));
        const isInactive = index >= requestedPackageCount - inactiveCount;
        const status = isInactive ? "Inactive" : "Active";

        rows.push({
            store_id: storeId,
            branch_id: branch.id,
            name: definition.name,
            description: definition.description,
            original_value: originalValue,
            discount_type: "amount",
            discount_value: roundMoney(originalValue - packagePrice),
            package_price: packagePrice,
            duration: "Retail purchase",
            status,
            inclusions: JSON.stringify(inclusions),
        });

        packageData.push({
            name: definition.name,
            eventType: definition.eventType,
            branchId: branch.id,
            price: packagePrice,
            status,
            inclusions,
        });
    }

    await insertRows(db, "packages", rows, 10);

    const [packageRows] = await db.execute(
        `SELECT id, branch_id, name, package_price, status
         FROM packages
         WHERE store_id = ?
         ORDER BY id`,
        [storeId]
    );

    const byName = new Map(packageRows.map((row) => [String(row.name), row]));

    return packageData.map((item) => {
        const row = byName.get(item.name);
        if (!row) throw new Error(`Unable to retrieve package ${item.name}.`);

        return {
            ...item,
            id: Number(row.id),
            branchId: Number(row.branch_id),
            price: Number(row.package_price),
            status: String(row.status || item.status || "Active"),
        };
    });
}

// Each plan uses one deterministic 3-store admin scenario:
//   - Store 1: Active + auto-renew ON
//   - Store 2: Expiring Soon + pending renewal verification
//   - Store 3: Expired + manual renewal/extension testing
function subscriptionScenarioForStoreInTriplet(pos) {
    // Each plan has exactly three stores:
    // 0 = Active, 1 = Expiring Soon + Pending Renewal, 2 = Expired.
    if (pos === 0) return "active_current";
    if (pos === 1) return "expiring_soon";
    return "expired";
}

function subscriptionDemoTiming(planProfile, scenario, rng) {
    const tier = String(planProfile?.tier || "starter").toLowerCase();

    if (scenario === "active_current") {
        const range = tier === "scale" ? [60, 90] : tier === "growth" ? [40, 60] : [20, 30];
        return { expiresOffset: randomInt(rng, range[0], range[1]), autoRenew: true };
    }

    if (scenario === "expiring_soon") {
        return {
            expiresOffset: tier === "scale" ? 7 : tier === "growth" ? 5 : 3,
            autoRenew: false,
        };
    }

    const expiredRange =
        tier === "scale" ? [30, 60] : tier === "growth" ? [20, 45] : [15, 30];
    return {
        expiresOffset: -randomInt(rng, expiredRange[0], expiredRange[1]),
        autoRenew: false,
    };
}

function gcashReferenceNumber(storeIndex, seq, rng) {
    let tail = "";
    for (let i = 0; i < 7; i += 1) tail += String(randomInt(rng, 0, 9));
    return `${String(storeIndex).padStart(3, "0")}${String(seq).padStart(2, "0")}${tail}`;
}

function paymentReceiptUrl(storeIndex, seq) {
    return `/uploads/payments/${CONFIG.runTag}-store${storeIndex}-payment${seq}.jpg`;
}

async function createSubscriptionLifecycle(
    db,
    store,
    plans,
    adminIds,
    counters,
    forcedPlan = null,
    tripletPos = 0,
    planProfile = null
) {
    const { storeId, storeIndex } = store;
    const rng = createRng(`${CONFIG.runTag}:subscription:${storeIndex}`);
    const scenario = subscriptionScenarioForStoreInTriplet(tripletPos);
    const freePlan = plans.find((plan) => Number(plan.price) === 0) || plans[0];
    const currentPlan = forcedPlan || plans[0];
    const timing = subscriptionDemoTiming(planProfile, scenario, rng);
    const reviewer = randomChoice(rng, adminIds);
    const cycleDays = 30;
    let paymentSeq = 0;

    async function insertPayment({ status, submittedAt, reviewedAt = null, reviewedBy = null }) {
        paymentSeq += 1;
        const [result] = await db.execute(
            `INSERT INTO payments
             (store_id, plan_id, amount, reference_no, receipt_url, status, submitted_at, reviewed_by, reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                currentPlan.id,
                currentPlan.price,
                gcashReferenceNumber(storeIndex, paymentSeq, rng),
                paymentReceiptUrl(storeIndex, paymentSeq),
                status,
                sqlDateTime(submittedAt, randomInt(rng, 8, 20), randomInt(rng, 0, 59)),
                reviewedBy,
                reviewedAt
                    ? sqlDateTime(reviewedAt, randomInt(rng, 8, 20), randomInt(rng, 0, 59))
                    : null,
            ]
        );
        counters.payments += 1;
        return Number(result.insertId);
    }

    async function insertSubscription({ status, autoRenew, startedAt, expiresAt }) {
        const [result] = await db.execute(
            `INSERT INTO subscriptions
             (store_id, plan_id, status, auto_renew, started_at, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                currentPlan.id,
                status,
                autoRenew ? 1 : 0,
                sqlDateTime(startedAt, 9, 0, 0),
                sqlDateTime(expiresAt, 23, 59, 59),
                sqlDateTime(startedAt, 9, 0, 0),
            ]
        );
        counters.subscriptions += 1;
        return Number(result.insertId);
    }

    async function insertHistory(subscriptionId, {
        oldPlanId,
        changeType,
        createdAt,
        changedBy = reviewer,
    }) {
        await db.execute(
            `INSERT INTO subscription_history
             (subscription_id, store_id, old_plan_id, new_plan_id, change_type, changed_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                subscriptionId,
                storeId,
                oldPlanId,
                currentPlan.id,
                changeType,
                changedBy,
                sqlDateTime(createdAt, 9, 0, 0),
            ]
        );
        counters.subscriptionHistory += 1;
    }

    async function insertAudit(subscriptionId, {
        paymentId = null,
        action,
        previousStatus = null,
        newStatus = null,
        adminId = null,
        reason,
        createdAt,
    }) {
        await db.execute(
            `INSERT INTO subscription_audit_logs
             (business_id, subscription_id, payment_submission_id, action, previous_status, new_status, performed_by_admin_id, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                subscriptionId,
                paymentId,
                action,
                previousStatus,
                newStatus,
                adminId,
                reason,
                sqlDateTime(createdAt, randomInt(rng, 8, 20), randomInt(rng, 0, 59)),
            ]
        );
        counters.subscriptionAuditLogs += 1;
    }

    const expiresAt = addDays(TODAY, timing.expiresOffset);
    const startedAt = scenario === "active_current"
        ? addDays(TODAY, -randomInt(rng, 7, 21))
        : addDays(expiresAt, -cycleDays);
    const subscriptionStatus =
        scenario === "expired"
            ? "expired"
            : scenario === "expiring_soon"
                ? "expiring"
                : "active";

    const subscriptionId = await insertSubscription({
        status: subscriptionStatus,
        autoRenew: timing.autoRenew,
        startedAt,
        expiresAt,
    });

    const paidPlan = Number(currentPlan.price) > 0;
    const tier = String(planProfile?.tier || "starter").toLowerCase();
    const needsPreviousRenewal =
        scenario === "active_current" && (tier === "growth" || tier === "scale");

    if (needsPreviousRenewal) {
        const initialDate = addDays(startedAt, -cycleDays);
        const initialPayment = await insertPayment({
            status: "approved",
            submittedAt: initialDate,
            reviewedAt: addDays(initialDate, 1),
            reviewedBy: reviewer,
        });
        await insertHistory(subscriptionId, {
            oldPlanId: paidPlan ? freePlan.id : currentPlan.id,
            changeType: paidPlan ? "upgrade" : "renewal",
            createdAt: initialDate,
        });
        await insertAudit(subscriptionId, {
            paymentId: initialPayment,
            action: "payment_approved",
            previousStatus: "pending",
            newStatus: "approved",
            adminId: reviewer,
            reason: `Initial ${currentPlan.name} plan payment approved for demo history.`,
            createdAt: initialDate,
        });

        const renewalPayment = await insertPayment({
            status: "approved",
            submittedAt: startedAt,
            reviewedAt: addDays(startedAt, 1),
            reviewedBy: reviewer,
        });
        await insertHistory(subscriptionId, {
            oldPlanId: currentPlan.id,
            changeType: "renewal",
            createdAt: startedAt,
        });
        await insertAudit(subscriptionId, {
            paymentId: renewalPayment,
            action: "payment_approved",
            previousStatus: "pending",
            newStatus: "approved",
            adminId: reviewer,
            reason: `${currentPlan.name} renewal approved; auto-renew remains enabled.`,
            createdAt: startedAt,
        });
    } else {
        const approvedPayment = await insertPayment({
            status: "approved",
            submittedAt: startedAt,
            reviewedAt: addDays(startedAt, 1),
            reviewedBy: reviewer,
        });
        await insertHistory(subscriptionId, {
            oldPlanId: paidPlan ? freePlan.id : currentPlan.id,
            changeType: paidPlan ? "upgrade" : "renewal",
            createdAt: startedAt,
        });
        await insertAudit(subscriptionId, {
            paymentId: approvedPayment,
            action: "payment_approved",
            previousStatus: "pending",
            newStatus: "approved",
            adminId: reviewer,
            reason: `${currentPlan.name} subscription payment approved.`,
            createdAt: startedAt,
        });
    }

    if (scenario === "expiring_soon") {
        // This row drives Platform Admin -> Payments -> Pending and the dashboard
        // Pending Verifications card, while the expiring subscription drives
        // Renewal Watch. Submitted yesterday so it is clearly awaiting review.
        const submittedAt = addDays(TODAY, -1);
        const pendingPayment = await insertPayment({
            status: "pending",
            submittedAt,
        });
        await insertAudit(subscriptionId, {
            paymentId: pendingPayment,
            action: "payment_submitted",
            previousStatus: null,
            newStatus: "pending",
            adminId: null,
            reason: `Store submitted GCash proof to renew the ${currentPlan.name} plan.`,
            createdAt: submittedAt,
        });
        await insertAudit(subscriptionId, {
            action: "subscription_expiring_flagged",
            previousStatus: "active",
            newStatus: "expiring",
            adminId: null,
            reason: `${currentPlan.name} subscription is expiring within 7 days.`,
            createdAt: TODAY,
        });
    }

    if (scenario === "expired") {
        await insertAudit(subscriptionId, {
            action: "subscription_expired",
            previousStatus: "expiring",
            newStatus: "expired",
            adminId: null,
            reason: "Subscription expired with auto-renew disabled.",
            createdAt: addDays(expiresAt, 1),
        });
    }
}

function buildProductCatalog(products) {
    const sellableProducts = products.filter((product) => !product.attentionState);
    const sourceProducts = sellableProducts.length ? sellableProducts : products;
    const byBranch = new Map();

    for (const product of sourceProducts) {
        if (!byBranch.has(product.branchId)) byBranch.set(product.branchId, []);
        byBranch.get(product.branchId).push(product);
    }

    const demandPoolsByBranch = new Map();

    for (const [branchId, branchProducts] of byBranch) {
        const highCount = Math.max(1, Math.round(branchProducts.length * 0.20));
        const mediumCount = Math.max(
            1,
            Math.round(branchProducts.length * 0.30)
        );
        const high = branchProducts.slice(0, highCount);
        const medium = branchProducts.slice(highCount, highCount + mediumCount);
        const slow = branchProducts.slice(highCount + mediumCount);

        demandPoolsByBranch.set(branchId, {
            high,
            medium: medium.length ? medium : high,
            slow: slow.length ? slow : branchProducts,
        });
    }

    return { all: sourceProducts, byBranch, demandPoolsByBranch };
}

function chooseSaleProducts(rng, catalog, branchId, count) {
    const branchProducts = catalog.byBranch.get(branchId) || catalog.all;
    const pools = catalog.demandPoolsByBranch.get(branchId) || {
        high: branchProducts,
        medium: branchProducts,
        slow: branchProducts,
    };
    const selected = [];
    const selectedIds = new Set();
    const target = Math.min(count, branchProducts.length);

    let guard = 0;
    while (selected.length < target && guard < target * 80 + 100) {
        guard += 1;
        const demandClass = weightedChoice(rng, [
            { value: "high", weight: 0.60 },
            { value: "medium", weight: 0.30 },
            { value: "slow", weight: 0.10 },
        ]);
        const pool = pools[demandClass]?.length ? pools[demandClass] : branchProducts;
        const product = randomChoice(rng, pool);
        if (!product || selectedIds.has(product.id)) continue;
        selectedIds.add(product.id);
        selected.push(product);
    }

    // Defensive fallback if a tiny pool kept returning duplicates.
    for (const product of branchProducts) {
        if (selected.length >= target) break;
        if (selectedIds.has(product.id)) continue;
        selectedIds.add(product.id);
        selected.push(product);
    }

    return selected;
}

function orderLineCount(rng) {
    return weightedChoice(rng, [
        { value: 1, weight: 0.14 },
        { value: 2, weight: 0.28 },
        { value: 3, weight: 0.30 },
        { value: 4, weight: 0.19 },
        { value: 5, weight: 0.09 },
    ]);
}

// ---------------------
// Rolling 25-month POS demo generation
// ---------------------
function monthsBetweenUtc(startDate, currentDate) {
    return (
        (currentDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
        (currentDate.getUTCMonth() - startDate.getUTCMonth())
    );
}

function planDemandMonthFactor(date, planProfile) {
    const base = demandMonthFactor(date);
    const strength = Math.max(0, Number(planProfile?.seasonalStrength ?? 0.75));
    return 1 + (base - 1) * strength;
}

function stableDailyOrderCount(rng, date, profileSalesStart, planProfile) {
    const minOrders = Math.max(1, Number(planProfile?.minDailyOrders || 3));
    const maxOrders = Math.max(minOrders, Number(planProfile?.maxDailyOrders || minOrders));
    const midpoint = (minOrders + maxOrders) / 2;
    const monthIndex = Math.max(0, monthsBetweenUtc(profileSalesStart, date));
    const monthlyGrowthRate = Math.max(0, Number(planProfile?.monthlyGrowthRate || 0));
    const noisePct = Math.max(0, Number(planProfile?.salesNoisePct ?? 0.05));

    const seasonalDelta = planDemandMonthFactor(date, planProfile) - 1;
    const weekdayDelta = (SALES_DAY_FACTORS[date.getUTCDay()] - 1) * 0.35;
    const paydayDelta = (paydayFactor(date) - 1) * 0.30;
    const eventDelta = (specialEventFactor(date) - 1) * 0.30;
    const trendDelta = monthIndex * monthlyGrowthRate;
    const randomDelta = (rng() * 2 - 1) * noisePct;

    const raw = midpoint * (
        1 + seasonalDelta + weekdayDelta + paydayDelta + eventDelta + trendDelta + randomDelta
    );

    return Math.max(minOrders, Math.min(maxOrders, Math.round(raw)));
}

async function createHistoricalOrders(db, context, counters) {
    const { storeId, storeIndex, branches, catalog, planProfile } = context;
    const orderRows = [];
    const orderItemRows = [];

    const monthsBack = Math.max(
        0,
        Number(planProfile?.salesMonthsBack ?? DEMO_MONTHS_BACK)
    );
    const monthsForward = Math.max(
        0,
        Number(planProfile?.salesMonthsForward ?? DEMO_MONTHS_FORWARD)
    );

    const profileSalesStart = startOfUtcMonth(
        addMonthsUtc(CURRENT_MONTH_START, -monthsBack)
    );
    const profileFutureStart = startOfUtcMonth(
        addMonthsUtc(CURRENT_MONTH_START, 1)
    );
    const profileSalesEnd = addDays(
        startOfUtcMonth(
            addMonthsUtc(CURRENT_MONTH_START, monthsForward + 1)
        ),
        -1
    );

    let cursor = maxDate(CONFIG.salesStart, profileSalesStart);
    const configuredEnd =
        CONFIG.salesEnd < profileSalesEnd ? CONFIG.salesEnd : profileSalesEnd;
    let orderSequence = 0;
    const todayKey = isoDate(TODAY);
    const nowParts = seedTimeParts();

    if (
        Number(planProfile?.minDailyOrders || 0) < branches.length
    ) {
        throw new Error(
            `${planProfile.name} minDailyOrders must be at least the branch count ` +
            `so every branch has representative POS activity each seeded day.`
        );
    }

    const flush = async () => {
        if (!orderRows.length) return;
        await insertRows(db, "orders", orderRows);
        await insertRows(
            db,
            "order_items",
            orderItemRows,
            Math.max(CONFIG.batchSize, 800)
        );
        counters.orders += orderRows.length;
        counters.orderItems += orderItemRows.length;
        orderRows.length = 0;
        orderItemRows.length = 0;
    };

    while (cursor <= configuredEnd) {
        /*
         * The current month contains realized POS only through the seed date.
         * The remainder of the current month is intentionally skipped. The
         * 12 forward demo months begin on the first day of next month.
         */
        if (cursor > TODAY && cursor < profileFutureStart) {
            cursor = new Date(profileFutureStart.getTime());
            continue;
        }

        const dayKey = isoDate(cursor);
        const isFutureDemo = cursor > TODAY;
        const rng = createRng(`${CONFIG.runTag}:sales:${storeIndex}:${dayKey}`);
        const orderCount = stableDailyOrderCount(
            rng,
            cursor,
            profileSalesStart,
            planProfile
        );

        for (let number = 0; number < orderCount; number += 1) {
            orderSequence += 1;

            /*
             * Guarantee every branch receives at least one transaction every
             * seeded day. Remaining transactions keep the weighted branch
             * behavior so branches still have visibly different performance.
             */
            const branch =
                number < branches.length
                    ? branches[
                    (
                        number +
                        cursor.getUTCDate() +
                        cursor.getUTCMonth()
                    ) % branches.length
                        ]
                    : branchWeightedChoice(rng, branches);

            const customerName =
                planProfile?.tier === "scale" && rng() < 0.18
                    ? corporateName(rng)
                    : planProfile?.tier === "growth" && rng() < 0.06
                        ? corporateName(rng)
                        : realisticName(rng);

            const baseLineCount = orderLineCount(rng);
            const extraLines =
                planProfile?.tier === "scale"
                    ? randomInt(rng, 1, 3)
                    : planProfile?.tier === "growth"
                        ? randomInt(rng, 0, 2)
                        : 0;
            const lineCount = Math.min(8, baseLineCount + extraLines);
            const selectedProducts = chooseSaleProducts(
                rng,
                catalog,
                branch.id,
                lineCount
            );
            const eventBoost =
                planDemandMonthFactor(cursor, planProfile) >= 1.08 ? 1 : 0;

            const lines = selectedProducts.map((product, lineIndex) => {
                const selected = saleSelectionForProduct(rng, product);
                const safeSalesPrice = Number.isFinite(
                    Number(selected.salesPrice)
                )
                    ? Number(selected.salesPrice)
                    : 0;
                const safeCostPrice = Number.isFinite(
                    Number(selected.originalPrice)
                )
                    ? Number(selected.originalPrice)
                    : 0;

                let quantity;
                if (planProfile?.tier === "scale") {
                    quantity = randomInt(rng, 4, 18 + eventBoost * 4);
                    if (lineIndex === 0 && rng() < 0.25) {
                        quantity += randomInt(rng, 10, 35);
                    }
                } else if (planProfile?.tier === "growth") {
                    quantity = randomInt(rng, 2, 8 + eventBoost * 2);
                } else {
                    quantity = randomInt(rng, 1, 5 + eventBoost);
                }

                const unitPrice = roundMoney(
                    safeSalesPrice * (0.98 + rng() * 0.04)
                );

                return {
                    product: selected,
                    quantity,
                    unitPrice,
                    costPrice: roundMoney(safeCostPrice),
                    lineTotal: roundMoney(quantity * unitPrice),
                };
            });

            const total = roundMoney(
                lines.reduce(
                    (sum, line) => sum + Number(line.lineTotal || 0),
                    0
                )
            );
            const compactDate = dayKey.replace(/-/g, "");
            const prefix = isFutureDemo ? "FUT" : "PERF";
            const orderId =
                `${prefix}-${String(storeIndex).padStart(3, "0")}-${compactDate}-` +
                `${String(orderSequence).padStart(6, "0")}`;

            let hour = randomInt(rng, 9, 20);
            let minute = randomInt(rng, 0, 59);
            if (dayKey === todayKey) {
                const latestHour = Math.max(0, Math.min(20, nowParts.hour));
                hour = randomInt(rng, Math.min(8, latestHour), latestHour);
                if (hour === nowParts.hour) {
                    minute = randomInt(rng, 0, Math.max(0, nowParts.minute));
                }
            }

            orderRows.push({
                order_id: orderId,
                store_id: storeId,
                branch_id: branch.id,
                customer_name: customerName,
                item: lines
                    .slice(0, 3)
                    .map(
                        (line) =>
                            `${line.product.saleName} x${line.quantity}`
                    )
                    .join(", ")
                    .slice(0, 250),
                total,
                order_date: dayKey,
                order_status: isFutureDemo ? "SCHEDULED" : "COMPLETED",
                status: isFutureDemo ? "SCHEDULED" : "COMPLETED",
                created_at: sqlDateTime(
                    cursor,
                    hour,
                    minute,
                    randomInt(rng, 0, 59)
                ),
            });

            for (const line of lines) {
                orderItemRows.push({
                    order_id: orderId,
                    store_id: storeId,
                    branch_id: branch.id,
                    product_id: line.product.id,
                    variant_id: line.product.variantId,
                    product_name: line.product.saleName,
                    quantity: line.quantity,
                    unit_price: line.unitPrice,
                    line_total: line.lineTotal,
                    cost_price_at_sale: line.costPrice,
                    created_at: sqlDateTime(
                        cursor,
                        hour,
                        minute,
                        randomInt(rng, 0, 59)
                    ),
                });
            }

            if (orderRows.length >= CONFIG.batchSize) await flush();
        }

        cursor = addDays(cursor, 1);
    }

    await flush();
}

async function createDashboardCurrentDayOrders(db, context, counters) {
    const { storeId, storeIndex, branches, catalog, planProfile } = context;
    const orderRows = [];
    const orderItemRows = [];
    const todayKey = isoDate(TODAY);
    const nowParts = seedTimeParts();
    const transactionsPerBranch = Math.max(
        1,
        Number(planProfile?.todayPosPerBranch || 3)
    );

    const customerPool = [
        "Walk-in Customer",
        "Maria Santos",
        "Corporate Walk-in",
        "Angela Reyes",
        "Paolo Cruz",
        "Bianca Garcia",
        "Miguel Mendoza",
        "Event Organizer",
        "School Organization",
        "Company Purchasing",
    ];

    for (const [branchIndex, branch] of branches.entries()) {
        const branchProducts = catalog.byBranch.get(branch.id) || [];
        if (!branchProducts.length) continue;

        const rng = createRng(`${CONFIG.runTag}:dashboard-pos:${storeIndex}:${branch.id}`);
        const selectedProducts = branchProducts.slice(
            0,
            Math.min(20, branchProducts.length)
        );

        for (
            let transactionIndex = 0;
            transactionIndex < transactionsPerBranch;
            transactionIndex += 1
        ) {
            const product =
                selectedProducts[transactionIndex % selectedProducts.length] ||
                randomChoice(rng, branchProducts);
            const selected = saleSelectionForProduct(rng, product);

            const quantityRange =
                planProfile?.tier === "scale"
                    ? [12, 60]
                    : planProfile?.tier === "growth"
                        ? [3, 14]
                        : [2, 8];

            const quantity = randomInt(rng, quantityRange[0], quantityRange[1]);
            const unitPrice = roundMoney(Number(selected.salesPrice || 0));
            const total = roundMoney(quantity * unitPrice);
            const orderId =
                `DASH-${CONFIG.runTag.toUpperCase()}-${String(storeIndex).padStart(3, "0")}-` +
                `${String(branchIndex + 1).padStart(2, "0")}-${todayKey.replace(/-/g, "")}-` +
                `${String(transactionIndex + 1).padStart(3, "0")}`;

            // Keep showcase transactions at or before the local current hour.
            const latestHour = Math.max(9, Math.min(20, nowParts.hour));
            const earliestHour = Math.max(8, latestHour - transactionsPerBranch + 1);
            const hour = Math.min(
                latestHour,
                earliestHour + transactionIndex
            );
            const minute = (transactionIndex * 7 + branchIndex * 11) % 60;

            orderRows.push({
                order_id: orderId,
                store_id: storeId,
                branch_id: branch.id,
                customer_name:
                    customerPool[transactionIndex % customerPool.length],
                item: `${selected.saleName} x${quantity}`.slice(0, 250),
                total,
                order_date: todayKey,
                created_at: sqlDateTime(TODAY, hour, minute, 0),
            });

            orderItemRows.push({
                order_id: orderId,
                store_id: storeId,
                branch_id: branch.id,
                product_id: selected.id,
                variant_id: selected.variantId,
                product_name: selected.saleName,
                quantity,
                unit_price: unitPrice,
                line_total: total,
                created_at: sqlDateTime(TODAY, hour, minute, 0),
            });
        }
    }

    await insertRows(db, "orders", orderRows, Math.min(CONFIG.batchSize, 300));
    await insertRows(
        db,
        "order_items",
        orderItemRows,
        Math.max(CONFIG.batchSize, 600)
    );
    counters.orders += orderRows.length;
    counters.orderItems += orderItemRows.length;
}

async function ensureMinimumScaleSales(db, context, counters) {
    const { storeId, storeIndex, branches, catalog, planProfile } = context;
    const target = Number(planProfile?.minimumSalesTarget || 0);
    if (!target || planProfile?.tier !== "scale") return;

    const [[summary]] = await db.execute(
        `SELECT COALESCE(SUM(total), 0) AS total_sales
         FROM orders
         WHERE store_id = ?`,
        [storeId]
    );

    let runningSales = Number(summary?.total_sales || 0);
    if (runningSales >= target) return;

    const orderRows = [];
    const orderItemRows = [];
    let sequence = 0;

    const flush = async () => {
        if (!orderRows.length) return;
        await insertRows(db, "orders", orderRows, Math.min(CONFIG.batchSize, 300));
        await insertRows(db, "order_items", orderItemRows, Math.max(CONFIG.batchSize, 900));
        counters.orders += orderRows.length;
        counters.orderItems += orderItemRows.length;
        orderRows.length = 0;
        orderItemRows.length = 0;
    };

    while (runningSales < target) {
        sequence += 1;
        const rng = createRng(`${CONFIG.runTag}:scale-revenue-floor:${storeIndex}:${sequence}`);
        const branch = branches[(sequence - 1) % branches.length];
        const lineCount = randomInt(rng, 7, 10);
        const selectedProducts = chooseSaleProducts(rng, catalog, branch.id, lineCount);
        const orderDate = addDays(TODAY, -randomInt(rng, 30, 1095));
        const hour = randomInt(rng, 9, 18);
        const minute = randomInt(rng, 0, 59);

        const lines = selectedProducts.map((product, lineIndex) => {
            const selected = saleSelectionForProduct(rng, product);
            const quantity = randomInt(rng, lineIndex === 0 ? 180 : 60, lineIndex === 0 ? 420 : 220);
            const unitPrice = roundMoney(Number(selected.salesPrice || 0) * (0.97 + rng() * 0.05));
            return {
                product: selected,
                quantity,
                unitPrice,
                lineTotal: roundMoney(quantity * unitPrice),
            };
        });

        const total = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
        const orderId =
            `BULK-${CONFIG.runTag.toUpperCase()}-${String(storeIndex).padStart(3, "0")}-` +
            `${isoDate(orderDate).replace(/-/g, "")}-${String(sequence).padStart(6, "0")}`;

        orderRows.push({
            order_id: orderId,
            store_id: storeId,
            branch_id: branch.id,
            customer_name: corporateName(rng),
            item: lines.slice(0, 3).map((line) => `${line.product.saleName} x${line.quantity}`).join(", ").slice(0, 250),
            total,
            order_date: isoDate(orderDate),
            created_at: sqlDateTime(orderDate, hour, minute, randomInt(rng, 0, 59)),
        });

        for (const line of lines) {
            orderItemRows.push({
                order_id: orderId,
                store_id: storeId,
                branch_id: branch.id,
                product_id: line.product.id,
                variant_id: line.product.variantId,
                product_name: line.product.saleName,
                quantity: line.quantity,
                unit_price: line.unitPrice,
                line_total: line.lineTotal,
                created_at: sqlDateTime(orderDate, hour, minute, randomInt(rng, 0, 59)),
            });
        }

        runningSales += total;

        if (orderRows.length >= Math.min(CONFIG.batchSize, 300)) {
            await flush();
        }

        if (sequence > 20000) {
            throw new Error(
                `Unable to reach Scale sales target of ${target.toLocaleString()} after 20,000 bulk orders.`
            );
        }
    }

    await flush();
    console.log(
        `    Scale sales floor reached: PHP ${Math.round(runningSales).toLocaleString()} ` +
        `(target PHP ${Math.round(target).toLocaleString()})`
    );
}

// booking helper functions unchanged:
function buildWeightedDates(start, end, mode) {
    const entries = [];
    let cursor = new Date(start.getTime());
    let cumulative = 0;

    while (cursor <= end) {
        const monthFactor = demandMonthFactor(cursor);
        const dayFactor =
            mode === "corporate"
                ? [0.55, 1.15, 1.35, 1.42, 1.34, 1.05, 0.48][cursor.getUTCDay()]
                : BOOKING_DAY_FACTORS[cursor.getUTCDay()];

        const holidayBoost = specialEventFactor(cursor);
        const weight = Math.max(0.05, monthFactor * dayFactor * holidayBoost);
        cumulative += weight;
        entries.push({
            date: new Date(cursor.getTime()),
            cumulative,
        });
        cursor = addDays(cursor, 1);
    }

    return { entries, total: cumulative };
}

function pickWeightedDate(rng, pool) {
    const target = rng() * pool.total;
    let low = 0;
    let high = pool.entries.length - 1;

    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (pool.entries[middle].cumulative >= target) high = middle;
        else low = middle + 1;
    }

    return new Date(pool.entries[low].date.getTime());
}

function bookingStatus(rng, period) {
    if (period === "historical") {
        return weightedChoice(rng, [
            { value: "completed", weight: 0.74 },
            { value: "cancelled", weight: 0.10 },
            { value: "confirmed", weight: 0.12 },
            { value: "pending", weight: 0.04 },
        ]);
    }

    if (period === "near") {
        return weightedChoice(rng, [
            { value: "confirmed", weight: 0.44 },
            { value: "pending", weight: 0.26 },
            { value: "completed", weight: 0.22 },
            { value: "cancelled", weight: 0.08 },
        ]);
    }

    return weightedChoice(rng, [
        { value: "pending", weight: 0.58 },
        { value: "confirmed", weight: 0.27 },
        { value: "cancelled", weight: 0.10 },
        { value: "completed", weight: 0.05 },
    ]);
}

function paymentForBooking(status, agreedPrice, rng) {
    if (status === "completed") {
        return {
            paymentStatus: "paid",
            amountPaid: agreedPrice,
            requiredDownPayment: roundMoney(agreedPrice * 0.5),
        };
    }

    if (status === "cancelled") {
        return {
            paymentStatus: "unpaid",
            amountPaid: 0,
            requiredDownPayment: 0,
        };
    }

    if (status === "confirmed" || status === "preparing") {
        const paid = rng() < 0.18;
        const amountPaid = paid
            ? agreedPrice
            : roundMoney(agreedPrice * (rng() < 0.72 ? 0.5 : 0.3));

        return {
            paymentStatus: paid ? "paid" : "partial",
            amountPaid,
            requiredDownPayment: roundMoney(agreedPrice * 0.5),
        };
    }

    return {
        paymentStatus: "unpaid",
        amountPaid: 0,
        requiredDownPayment: roundMoney(agreedPrice * 0.5),
    };
}

function packageForPeriod(rng, packages, period) {
    const weighted = packages.map((pkg, index) => {
        let baseWeight = [0.30, 0.24, 0.19, 0.16, 0.11][index] || 0.08;

        if (period === "long" && pkg.eventType === "Corporate Gathering") {
            baseWeight += 0.20;
        }

        if (
            period === "near" &&
            (pkg.eventType === "Kids Birthday" || pkg.eventType === "Graduation Party")
        ) {
            baseWeight += 0.08;
        }

        return { value: pkg, weight: baseWeight };
    });

    return weightedChoice(rng, weighted);
}

function bookingProducts(rng, packageItem, catalog, branchId) {
    const included = packageItem.inclusions.map((item) => ({
        productId: Number(item.productId || item.product_id),
        variantId:
            item.variantId === null || item.variantId === undefined
                ? item.variant_id === null || item.variant_id === undefined
                    ? null
                    : Number(item.variant_id)
                : Number(item.variantId),
        productName: item.item,
        variantLabel: String(item.variantLabel || item.variant_label || ""),
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unitPrice || item.unit_price || 0),
    }));

    const extraCount = randomInt(rng, 1, 3);
    const extras = chooseSaleProducts(rng, catalog, branchId, extraCount).map((product) => {
        const selected = saleSelectionForProduct(rng, product);

        return {
            productId: selected.id,
            variantId: selected.variantId,
            productName: selected.saleName,
            variantLabel: selected.variantLabel,
            quantity: randomInt(rng, 1, 5),
            unitPrice: selected.salesPrice,
        };
    });

    const combined = [...included, ...extras];
    const byProductVariant = new Map();

    for (const item of combined) {
        const key = `${item.productId}:${item.variantId || 0}`;
        const existing = byProductVariant.get(key);
        if (existing) existing.quantity += item.quantity;
        else byProductVariant.set(key, { ...item });
    }

    return [...byProductVariant.values()];
}

async function createBookings(db, context, datePools, counters) {
    const { storeId, storeIndex, branches, catalog, packages, planProfile } = context;
    const bookingRows = [];
    const pendingItems = new Map();
    const monthlyBookingCounts = new Map();
    const monthlyBookingLimit = Number.isFinite(Number(planProfile?.bookingsPerMonth))
    && Number(planProfile?.bookingsPerMonth) > 0
        ? Number(planProfile.bookingsPerMonth)
        : null;
    let bookingSequence = 0;

    const historicalBookingMonths = Math.max(1, Number(planProfile?.historicalBookingMonths || 24));
    // Starter's historical window ends last month so its current 20-day booking
    // fixture can remain inside the published 20-bookings/month ceiling.
    const historicalBookingEnd = monthlyBookingLimit
        ? endOfPreviousUtcMonth(TODAY)
        : addDays(TODAY, -1);
    const historicalBookingStart = startOfUtcMonth(
        addMonthsUtc(historicalBookingEnd, -(historicalBookingMonths - 1))
    );
    const historicalBookingPool = buildWeightedDates(
        historicalBookingStart,
        historicalBookingEnd,
        "retail"
    );

    const flush = async () => {
        if (!bookingRows.length) return;

        const rowsToInsert = bookingRows.splice(0, bookingRows.length);
        await insertRows(db, "bookings", rowsToInsert, Math.min(CONFIG.batchSize, 250));

        const references = rowsToInsert.map((row) => row.booking_reference);
        const placeholders = references.map(() => "?").join(", ");
        const [insertedBookings] = await db.query(
            `SELECT id, booking_reference
             FROM bookings
             WHERE store_id = ?
               AND booking_reference IN (${placeholders})`,
            [storeId, ...references]
        );

        const bookingIds = new Map(
            insertedBookings.map((row) => [String(row.booking_reference), Number(row.id)])
        );

        const bookingItemRows = [];

        for (const reference of references) {
            const bookingId = bookingIds.get(reference);
            const items = pendingItems.get(reference) || [];

            if (!bookingId) {
                throw new Error(`Unable to retrieve inserted booking ${reference}.`);
            }

            for (const item of items) {
                bookingItemRows.push({
                    booking_id: bookingId,
                    store_id: storeId,
                    product_id: item.productId,
                    variant_id: item.variantId,
                    product_name: item.productName,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    line_total: roundMoney(item.quantity * item.unitPrice),
                });
            }

            pendingItems.delete(reference);
        }

        await insertRows(db, "booking_items", bookingItemRows, Math.max(CONFIG.batchSize, 800));
        counters.bookings += rowsToInsert.length;
        counters.bookingItems += bookingItemRows.length;
    };

    const createPeriod = async (period, targetCount) => {
        for (let index = 0; index < targetCount; index += 1) {
            bookingSequence += 1;

            const rng = createRng(`${CONFIG.runTag}:booking:${storeIndex}:${period}:${bookingSequence}`);
            const pool = period === "historical" ? historicalBookingPool : datePools[period];
            let eventDate = pickWeightedDate(rng, pool);

            if (monthlyBookingLimit) {
                // Starter has a hard 20-bookings/month test ceiling. Re-pick a
                // date when a weighted month is already full so historical data
                // never contradicts the plan limit.
                for (let attempt = 0; attempt < 80; attempt += 1) {
                    const monthKey = isoDate(eventDate).slice(0, 7);
                    if ((monthlyBookingCounts.get(monthKey) || 0) < monthlyBookingLimit) break;
                    eventDate = pickWeightedDate(rng, pool);
                }

                const monthKey = isoDate(eventDate).slice(0, 7);
                if ((monthlyBookingCounts.get(monthKey) || 0) >= monthlyBookingLimit) {
                    // The requested target count cannot fit in the available
                    // period without breaking the monthly cap. Skip this row.
                    continue;
                }
                monthlyBookingCounts.set(monthKey, (monthlyBookingCounts.get(monthKey) || 0) + 1);
            }

            const packageItem = packageForPeriod(rng, packages, period);
            const branch =
                branches.find((b) => b.id === packageItem.branchId) ||
                branchWeightedChoice(rng, branches);

            const status = bookingStatus(rng, period);
            const customerName = realisticName(rng);

            const isCorporate = period === "long" || packageItem.eventType === "Corporate Gathering";
            const company = isCorporate ? corporateName(rng) : null;
            const selectedProducts = bookingProducts(rng, packageItem, catalog, branch.id);

            const extrasTotal = selectedProducts
                .filter(
                    (item) =>
                        !packageItem.inclusions.some(
                            (included) => Number(included.productId || included.product_id) === item.productId
                        )
                )
                .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

            const agreedPrice = roundMoney(packageItem.price + extrasTotal);
            const payment = paymentForBooking(status, agreedPrice, rng);

            const reference = `BKG-${CONFIG.runTag.toUpperCase()}-${String(storeIndex).padStart(3, "0")}-${String(bookingSequence).padStart(6, "0")}`;

            const eventType = isCorporate
                ? (rng() < 0.45 ? "Corporate Gathering" : "Christmas Party")
                : packageItem.eventType;

            const packageJson = JSON.stringify({
                id: packageItem.id,
                packageId: packageItem.id,
                name: packageItem.name,
                price: packageItem.price,
                purchaseType: "advance retail order",
                inclusions: packageItem.inclusions,
                selectedProducts,
            });

            const createdDate =
                period === "historical"
                    ? addDays(eventDate, -randomInt(rng, 10, 120))
                    : period === "near"
                        ? addDays(TODAY, -randomInt(rng, 0, 60))
                        : addDays(TODAY, -randomInt(rng, 0, 120));

            const eventHour = randomChoice(rng, [8, 9, 10, 11, 13, 14, 15, 16, 18, 19]);

            bookingRows.push({
                store_id: storeId,
                branch_id: branch.id,
                booking_type: "package",
                name: customerName,
                phone: buildPhoneNumber(storeIndex, 100 + (bookingSequence % 8000)),
                event_date: isoDate(eventDate),
                event_type: eventType,
                package_name: packageItem.name,
                custom_order: selectedProducts
                    .slice(-3)
                    .map((item) => `${item.productName} x${item.quantity}`)
                    .join(", ")
                    .slice(0, 500),
                notes: company
                    ? `Advance retail supply order for ${company}. Goods are sold, not rented.`
                    : "Advance retail party-supply order. Goods are sold, not rented.",
                status,
                booking_reference: reference,
                package_json: packageJson,
                packageJSON: packageJson,
                facebook_name: customerName,
                email: `${emailSlug(customerName)}.${storeIndex}.${bookingSequence}@customer.example`,
                event_time: `${eventHour > 12 ? eventHour - 12 : eventHour}:00 ${eventHour >= 12 ? "PM" : "AM"}`,
                theme: isCorporate ? "Corporate Brand Colors" : randomChoice(rng, THEMES),
                venue: `${randomChoice(rng, VENUE_TYPES)}, ${storeIdentity(storeIndex).location}`,
                agreed_price: agreedPrice,
                package_price: packageItem.price,
                payment_status: payment.paymentStatus,
                required_down_payment: payment.requiredDownPayment,
                amount_paid: payment.amountPaid,
                balance: Math.max(0, roundMoney(agreedPrice - payment.amountPaid)),
                created_at: sqlDateTime(
                    createdDate,
                    randomInt(rng, 8, 20),
                    randomInt(rng, 0, 59),
                    randomInt(rng, 0, 59)
                ),
            });

            pendingItems.set(reference, selectedProducts);

            if (bookingRows.length >= Math.min(CONFIG.batchSize, 250)) {
                await flush();
            }
        }
    };

    const bookingCounts = planProfile?.bookingCounts || {
        historical: CONFIG.historicalBookingsPerStore,
        near: CONFIG.nearTermBookingsPerStore,
        long: CONFIG.longTermBookingsPerStore,
    };

    await createPeriod("historical", Number(bookingCounts.historical || 0));
    await createPeriod("near", Number(bookingCounts.near || 0));
    await createPeriod("long", Number(bookingCounts.long || 0));

    await flush();
}

function daysInUtcMonth(monthStart) {
    return new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
    ).getUTCDate();
}

function distributedBookingDays(monthStart, targetCount, storeIndex, includeToday) {
    const days = daysInUtcMonth(monthStart);
    const values = [];

    for (let i = 0; i < targetCount; i += 1) {
        // For <= number of days this produces unique, evenly spaced dates.
        // For Scale (100/month) each day naturally receives 3-4 bookings.
        values.push(1 + Math.floor((i * days) / targetCount));
    }

    if (includeToday) {
        const todayDay = TODAY.getUTCDate();
        if (!values.includes(todayDay)) {
            // Replace the closest generated day so the monthly total remains exact.
            let closestIndex = 0;
            let closestDistance = Number.MAX_SAFE_INTEGER;
            for (let i = 0; i < values.length; i += 1) {
                const distance = Math.abs(values[i] - todayDay);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = i;
                }
            }
            values[closestIndex] = todayDay;
        }
    }

    // Shift stores within the same plan slightly so plan-wide demo activity is
    // spread across more calendar dates while each store keeps its exact limit.
    if (targetCount <= days) {
        const shift = (storeIndex % 3) * 2;
        const shifted = values.map((day) => ((day - 1 + shift) % days) + 1);
        if (includeToday && !shifted.includes(TODAY.getUTCDate())) {
            shifted[0] = TODAY.getUTCDate();
        }
        return shifted;
    }

    return values;
}

function interleavedBranchIndexes(branchCount, targetCount, requestedDistribution) {
    const requested = Array.isArray(requestedDistribution)
        ? requestedDistribution.map((value) => Math.max(0, Number(value || 0)))
        : [];
    const validRequested =
        requested.length === branchCount &&
        requested.reduce((sum, value) => sum + value, 0) === targetCount;

    const remaining = validRequested
        ? [...requested]
        : Array.from({ length: branchCount }, (_, index) =>
            Math.floor(targetCount / branchCount) +
            (index < targetCount % branchCount ? 1 : 0)
        );

    const result = [];
    while (result.length < targetCount) {
        let added = false;
        for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
            if (remaining[branchIndex] <= 0) continue;
            remaining[branchIndex] -= 1;
            result.push(branchIndex);
            added = true;
            if (result.length >= targetCount) break;
        }
        if (!added) break;
    }
    return result;
}

function expandStatusDistribution(distribution, targetCount) {
    const order = ["completed", "confirmed", "pending", "preparing", "cancelled"];
    const remaining = Object.fromEntries(
        order.map((status) => [status, Math.max(0, Number(distribution?.[status] || 0))])
    );
    const configuredTotal = Object.values(remaining).reduce((sum, value) => sum + value, 0);

    if (configuredTotal !== targetCount) {
        throw new Error(
            `Booking status distribution totals ${configuredTotal}; expected ${targetCount}.`
        );
    }

    const statuses = [];
    while (statuses.length < targetCount) {
        let added = false;
        for (const status of order) {
            if (remaining[status] <= 0) continue;
            remaining[status] -= 1;
            statuses.push(status);
            added = true;
            if (statuses.length >= targetCount) break;
        }
        if (!added) break;
    }
    return statuses;
}

function futureBookingStatusDistribution(targetCount) {
    const total = Math.max(1, Number(targetCount || 1));
    const confirmed = Math.floor(total * 0.40);
    const pending = Math.floor(total * 0.40);
    const preparing = Math.floor(total * 0.10);
    const cancelled = total - confirmed - pending - preparing;

    return {
        completed: 0,
        confirmed,
        pending,
        preparing,
        cancelled,
    };
}

function demoBookingPayment(status, agreedPrice, bookingIndex) {
    const downPayment = roundMoney(agreedPrice * 0.50);

    if (status === "completed") {
        return {
            paymentStatus: "paid",
            amountPaid: agreedPrice,
            requiredDownPayment: downPayment,
        };
    }

    if (status === "cancelled") {
        return {
            paymentStatus: "unpaid",
            amountPaid: 0,
            requiredDownPayment: 0,
        };
    }

    if (status === "pending") {
        return {
            paymentStatus: "unpaid",
            amountPaid: 0,
            requiredDownPayment: downPayment,
        };
    }

    if (status === "preparing") {
        return {
            paymentStatus: "partial",
            amountPaid: downPayment,
            requiredDownPayment: downPayment,
        };
    }

    // Confirmed bookings deliberately contain both full payments and partial /
    // downpayments so payment filters always have testable rows.
    if (bookingIndex % 3 === 0) {
        return {
            paymentStatus: "paid",
            amountPaid: agreedPrice,
            requiredDownPayment: downPayment,
        };
    }

    const amountPaid = bookingIndex % 2 === 0
        ? downPayment
        : roundMoney(agreedPrice * 0.30);
    return {
        paymentStatus: "partial",
        amountPaid,
        requiredDownPayment: downPayment,
    };
}

async function createMonthlyBookingFixtures(db, context, counters) {
    const {
        storeId,
        storeIndex,
        branches,
        catalog,
        packages,
        planProfile,
    } = context;

    const monthsBack = Math.max(
        0,
        Number(planProfile?.bookingMonthsBack ?? DEMO_MONTHS_BACK)
    );
    const monthsForward = Math.max(
        0,
        Number(planProfile?.bookingMonthsForward ?? DEMO_MONTHS_FORWARD)
    );
    const monthlyTarget = Math.max(
        1,
        Number(planProfile?.monthlyBookingTarget || planProfile?.bookingsPerMonth || 20)
    );
    const statusDistribution = planProfile?.bookingStatusDistribution;
    const bookingRows = [];
    const pendingItems = new Map();
    let bookingSequence = 0;

    const flush = async () => {
        if (!bookingRows.length) return;
        const rowsToInsert = bookingRows.splice(0, bookingRows.length);
        await insertRows(db, "bookings", rowsToInsert, Math.min(CONFIG.batchSize, 250));

        const references = rowsToInsert.map((row) => row.booking_reference);
        const placeholders = references.map(() => "?").join(", ");
        const [insertedBookings] = await db.query(
            `SELECT id, booking_reference
             FROM bookings
             WHERE store_id = ?
               AND booking_reference IN (${placeholders})`,
            [storeId, ...references]
        );
        const bookingIds = new Map(
            insertedBookings.map((row) => [
                String(row.booking_reference),
                Number(row.id),
            ])
        );
        const bookingItemRows = [];

        for (const reference of references) {
            const bookingId = bookingIds.get(reference);
            if (!bookingId) {
                throw new Error(`Unable to retrieve monthly booking ${reference}.`);
            }
            for (const item of pendingItems.get(reference) || []) {
                bookingItemRows.push({
                    booking_id: bookingId,
                    store_id: storeId,
                    product_id: item.productId,
                    variant_id: item.variantId,
                    product_name: item.productName,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    line_total: roundMoney(item.quantity * item.unitPrice),
                });
            }
            pendingItems.delete(reference);
        }

        await insertRows(
            db,
            "booking_items",
            bookingItemRows,
            Math.max(CONFIG.batchSize, 800)
        );
        counters.bookings += rowsToInsert.length;
        counters.bookingItems += bookingItemRows.length;
    };

    for (
        let monthOffset = -monthsBack;
        monthOffset <= monthsForward;
        monthOffset += 1
    ) {
        const monthStart = startOfUtcMonth(
            addMonthsUtc(CURRENT_MONTH_START, monthOffset)
        );
        const isCurrentMonth =
            monthStart.getUTCFullYear() === TODAY.getUTCFullYear() &&
            monthStart.getUTCMonth() === TODAY.getUTCMonth();
        const bookingDays = distributedBookingDays(
            monthStart,
            monthlyTarget,
            storeIndex,
            isCurrentMonth
        );
        const branchIndexes = interleavedBranchIndexes(
            branches.length,
            monthlyTarget,
            planProfile?.bookingBranchDistribution
        );
        const isFutureMonth = monthOffset > 0;
        const statuses = expandStatusDistribution(
            isFutureMonth
                ? futureBookingStatusDistribution(monthlyTarget)
                : statusDistribution,
            monthlyTarget
        );

        /*
         * Make every branch operationally testable on TODAY while preserving
         * the exact per-month booking total and branch distribution. Starter
         * gets one TODAY booking; Growth gets one per 3 branches; Scale gets
         * one per 5 branches.
         */
        if (isCurrentMonth) {
            for (
                let branchIndex = 0;
                branchIndex < branches.length &&
                branchIndex < bookingDays.length;
                branchIndex += 1
            ) {
                bookingDays[branchIndex] = TODAY.getUTCDate();
                branchIndexes[branchIndex] = branchIndex;
            }
        }

        // Ensure the current-day dashboard has an actionable Preparing booking
        // without changing the exact monthly status totals.
        if (isCurrentMonth) {
            const todayIndex = bookingDays.findIndex((day) => day === TODAY.getUTCDate());
            const preparingIndex = statuses.findIndex((status) => status === "preparing");
            if (todayIndex >= 0 && preparingIndex >= 0 && todayIndex !== preparingIndex) {
                [statuses[todayIndex], statuses[preparingIndex]] = [
                    statuses[preparingIndex],
                    statuses[todayIndex],
                ];
            }
        }

        for (let monthBookingIndex = 0; monthBookingIndex < monthlyTarget; monthBookingIndex += 1) {
            bookingSequence += 1;
            const rng = createRng(
                `${CONFIG.runTag}:monthly-booking:${storeIndex}:` +
                `${isoDate(monthStart).slice(0, 7)}:${monthBookingIndex}`
            );
            const branch = branches[branchIndexes[monthBookingIndex] % branches.length];
            const activePackages = packages.filter(
                (pkg) => String(pkg.status || "Active").toLowerCase() === "active"
            );
            const branchPackages = activePackages.filter((pkg) => pkg.branchId === branch.id);
            const packageItem =
                branchPackages[monthBookingIndex % Math.max(1, branchPackages.length)] ||
                activePackages[monthBookingIndex % activePackages.length];
            const eventDate = new Date(
                Date.UTC(
                    monthStart.getUTCFullYear(),
                    monthStart.getUTCMonth(),
                    bookingDays[monthBookingIndex]
                )
            );
            let status = statuses[monthBookingIndex];
            if (eventDate > TODAY && status === "completed") {
                // A booking whose event is still in the future must not look
                // realized/completed in current KPIs. Keep the monthly total,
                // but convert that fixture to a scheduled operational status.
                status =
                    monthBookingIndex % 2 === 0
                        ? "confirmed"
                        : "pending";
            }

            const isScaleCorporate =
                planProfile?.tier === "scale" && monthBookingIndex % 5 === 0;
            const selectedProducts = bookingProducts(
                rng,
                packageItem,
                catalog,
                branch.id
            ).map((item) => ({
                ...item,
                quantity: isScaleCorporate
                    ? item.quantity * randomInt(rng, 2, 5)
                    : item.quantity,
            }));

            const productValue = roundMoney(
                selectedProducts.reduce(
                    (sum, item) => sum + item.unitPrice * item.quantity,
                    0
                )
            );
            const agreedPrice = isScaleCorporate
                ? roundMoney(Math.max(packageItem.price, productValue * 0.92))
                : roundMoney(
                    packageItem.price +
                    selectedProducts
                        .filter(
                            (item) =>
                                !packageItem.inclusions.some(
                                    (included) =>
                                        Number(included.productId || included.product_id) ===
                                        item.productId
                                )
                        )
                        .reduce(
                            (sum, item) => sum + item.unitPrice * item.quantity,
                            0
                        )
                );
            const payment = demoBookingPayment(
                status,
                agreedPrice,
                monthBookingIndex
            );
            const customerName = isScaleCorporate
                ? corporateName(rng)
                : realisticName(rng);
            const dayKey = isoDate(eventDate);
            const reference =
                `MON-BKG-${CONFIG.runTag.toUpperCase()}-` +
                `${String(storeIndex).padStart(3, "0")}-` +
                `${dayKey.replace(/-/g, "")}-` +
                `${String(monthBookingIndex + 1).padStart(3, "0")}`;

            const now = seedTimeParts();
            let eventHour = 9 + ((monthBookingIndex * 2) % 10);
            let eventMinute = (monthBookingIndex * 13) % 60;
            if (isCurrentMonth && dayKey === isoDate(TODAY)) {
                eventHour = Math.min(20, Math.max(10, now.hour + 2));
                eventMinute = (now.minute + 20) % 60;
            }

            const packageJson = JSON.stringify({
                id: packageItem.id,
                packageId: packageItem.id,
                name: packageItem.name,
                price: packageItem.price,
                purchaseType: isScaleCorporate
                    ? "corporate advance retail order"
                    : "advance retail order",
                inclusions: packageItem.inclusions,
                selectedProducts,
            });
            const leadDays = randomInt(rng, 3, 21);
            let createdDate = addDays(eventDate, -leadDays);
            if (createdDate > TODAY) {
                createdDate = addDays(TODAY, -randomInt(rng, 0, 5));
            }

            bookingRows.push({
                store_id: storeId,
                branch_id: branch.id,
                booking_type: "package",
                name: customerName,
                phone: buildPhoneNumber(storeIndex, 1000 + (bookingSequence % 7000)),
                event_date: dayKey,
                event_type: isScaleCorporate
                    ? "Corporate Gathering"
                    : packageItem.eventType,
                package_name: packageItem.name,
                custom_order: selectedProducts
                    .slice(-3)
                    .map((item) => `${item.productName} x${item.quantity}`)
                    .join(", ")
                    .slice(0, 500),
                notes: isScaleCorporate
                    ? "Large corporate/event booking fixture for Scale-plan analytics."
                    : "Plan-aligned monthly booking fixture for dashboard and report testing.",
                status,
                booking_reference: reference,
                package_json: packageJson,
                packageJSON: packageJson,
                facebook_name: customerName,
                email: `${emailSlug(customerName)}.${storeIndex}.${bookingSequence}@customer.example`,
                event_time: formatSeedEventTime(eventHour, eventMinute),
                theme: isScaleCorporate
                    ? "Corporate Brand Colors"
                    : randomChoice(rng, THEMES),
                venue: `${randomChoice(rng, VENUE_TYPES)}, ${storeIdentity(storeIndex).location}`,
                agreed_price: agreedPrice,
                package_price: packageItem.price,
                payment_status: payment.paymentStatus,
                required_down_payment: payment.requiredDownPayment,
                amount_paid: payment.amountPaid,
                balance: Math.max(0, roundMoney(agreedPrice - payment.amountPaid)),
                created_at: sqlDateTime(
                    createdDate,
                    randomInt(rng, 8, 18),
                    randomInt(rng, 0, 59),
                    randomInt(rng, 0, 59)
                ),
            });
            pendingItems.set(reference, selectedProducts);

            if (bookingRows.length >= Math.min(CONFIG.batchSize, 250)) {
                await flush();
            }
        }
    }

    await flush();
}


function scheduledBookingStatus(eventDate, slotMinutes, rng) {
    const eventDateKey = isoDate(eventDate);
    const todayKey = isoDate(TODAY);

    if (eventDateKey < todayKey) return "completed";

    if (eventDateKey > todayKey) {
        return rng() < 0.72 ? "confirmed" : "pending";
    }

    const now = seedTimeParts();
    const nowMinutes = now.hour * 60 + now.minute;
    const minutesUntilSlot = slotMinutes - nowMinutes;

    // Today is intentionally a mixed operational day so the Staff dashboard
    // can calculate booking completion and preparation progress from real rows.
    if (minutesUntilSlot <= -30) return "completed";
    if (minutesUntilSlot <= 150) return "preparing";
    if (minutesUntilSlot <= 360) return "confirmed";
    return "pending";
}

async function createScheduledDailyBookings(db, context, counters) {
    const {
        storeId,
        storeIndex,
        branches,
        catalog,
        packages,
        planProfile,
    } = context;

    const schedule = planProfile?.dailyBookingSchedule;
    if (!schedule) return;

    const days = Math.max(0, Number(schedule.days || 0));
    const bookingsPerBranchPerDay = Math.max(
        0,
        Number(schedule.bookingsPerBranchPerDay || 0)
    );
    const startOffsetDays = Number(schedule.startOffsetDays || 0);
    const firstSlotMinutes = Math.max(
        0,
        Math.min(23 * 60 + 59, Number(schedule.firstHour || 9) * 60 + Number(schedule.firstMinute || 0))
    );
    const gapMinutes = Math.max(60, Number(schedule.gapMinutes || 150));

    if (!days || !bookingsPerBranchPerDay) return;

    const lastSlotMinutes = firstSlotMinutes + (bookingsPerBranchPerDay - 1) * gapMinutes;
    if (lastSlotMinutes > 23 * 60 + 45) {
        throw new Error(
            `${planProfile.name} daily booking schedule exceeds the end of the day. ` +
            `Reduce bookingsPerBranchPerDay or gapMinutes.`
        );
    }

    const bookingRows = [];
    const pendingItems = new Map();
    let sequence = 0;

    const flush = async () => {
        if (!bookingRows.length) return;

        const rowsToInsert = bookingRows.splice(0, bookingRows.length);
        await insertRows(db, "bookings", rowsToInsert, Math.min(CONFIG.batchSize, 250));

        const references = rowsToInsert.map((row) => row.booking_reference);
        const placeholders = references.map(() => "?").join(", ");
        const [insertedBookings] = await db.query(
            `SELECT id, booking_reference
             FROM bookings
             WHERE store_id = ?
               AND booking_reference IN (${placeholders})`,
            [storeId, ...references]
        );

        const bookingIds = new Map(
            insertedBookings.map((row) => [String(row.booking_reference), Number(row.id)])
        );
        const bookingItemRows = [];

        for (const reference of references) {
            const bookingId = bookingIds.get(reference);
            if (!bookingId) {
                throw new Error(`Unable to retrieve scheduled booking ${reference}.`);
            }

            for (const item of pendingItems.get(reference) || []) {
                bookingItemRows.push({
                    booking_id: bookingId,
                    store_id: storeId,
                    product_id: item.productId,
                    variant_id: item.variantId,
                    product_name: item.productName,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    line_total: roundMoney(item.quantity * item.unitPrice),
                });
            }
            pendingItems.delete(reference);
        }

        await insertRows(db, "booking_items", bookingItemRows, Math.max(CONFIG.batchSize, 800));
        counters.bookings += rowsToInsert.length;
        counters.bookingItems += bookingItemRows.length;
    };

    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
        const eventDate = addDays(TODAY, startOffsetDays + dayIndex);
        const eventDateKey = isoDate(eventDate);

        for (const [branchIndex, branch] of branches.entries()) {
            const activePackages = packages.filter(
                (pkg) => String(pkg.status || "Active").toLowerCase() === "active"
            );
            const branchPackages = activePackages.filter((pkg) => pkg.branchId === branch.id);
            const branchProducts = catalog.byBranch.get(branch.id) || [];
            if (!branchProducts.length || !activePackages.length) continue;

            for (let slotIndex = 0; slotIndex < bookingsPerBranchPerDay; slotIndex += 1) {
                sequence += 1;
                const rng = createRng(
                    `${CONFIG.runTag}:scheduled-booking:${storeIndex}:${branch.id}:${eventDateKey}:${slotIndex}`
                );
                const packageItem =
                    branchPackages[(dayIndex + slotIndex) % Math.max(1, branchPackages.length)] ||
                    activePackages[(dayIndex + branchIndex + slotIndex) % activePackages.length];
                const selectedProducts = bookingProducts(rng, packageItem, catalog, branch.id);

                const extrasTotal = selectedProducts
                    .filter(
                        (item) =>
                            !packageItem.inclusions.some(
                                (included) => Number(included.productId || included.product_id) === item.productId
                            )
                    )
                    .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

                const agreedPrice = roundMoney(packageItem.price + extrasTotal);
                const slotMinutes = firstSlotMinutes + slotIndex * gapMinutes;
                const status = scheduledBookingStatus(eventDate, slotMinutes, rng);
                const payment = paymentForBooking(status, agreedPrice, rng);
                const eventHour = Math.floor(slotMinutes / 60);
                const eventMinute = slotMinutes % 60;
                const customerName = realisticName(rng);

                const leadDays = randomInt(
                    rng,
                    3,
                    Math.min(120, Math.max(14, dayIndex + 14))
                );
                let createdDate = addDays(eventDate, -leadDays);
                if (createdDate > TODAY) {
                    createdDate = addDays(TODAY, -randomInt(rng, 0, 30));
                }

                const reference =
                    `DAILY-BKG-${CONFIG.runTag.toUpperCase()}-` +
                    `${String(storeIndex).padStart(3, "0")}-` +
                    `${eventDateKey.replace(/-/g, "")}-` +
                    `${String(branchIndex + 1).padStart(2, "0")}-` +
                    `${String(slotIndex + 1).padStart(2, "0")}`;

                const packageJson = JSON.stringify({
                    id: packageItem.id,
                    packageId: packageItem.id,
                    name: packageItem.name,
                    price: packageItem.price,
                    purchaseType: "scheduled retail booking",
                    inclusions: packageItem.inclusions,
                    selectedProducts,
                });

                bookingRows.push({
                    store_id: storeId,
                    branch_id: branch.id,
                    booking_type: "package",
                    name: customerName,
                    phone: buildPhoneNumber(storeIndex, 500 + (sequence % 7000)),
                    event_date: eventDateKey,
                    event_type: packageItem.eventType,
                    package_name: packageItem.name,
                    custom_order: selectedProducts
                        .slice(-3)
                        .map((item) => `${item.productName} x${item.quantity}`)
                        .join(", ")
                        .slice(0, 500),
                    notes:
                        `Daily workload fixture with ${gapMinutes}-minute booking allowance. ` +
                        "Designed for booking overview and Staff pending-task testing.",
                    status,
                    booking_reference: reference,
                    package_json: packageJson,
                    packageJSON: packageJson,
                    facebook_name: customerName,
                    email: `${emailSlug(customerName)}.daily.${storeIndex}.${sequence}@customer.example`,
                    event_time: formatSeedEventTime(eventHour, eventMinute),
                    theme: randomChoice(rng, THEMES),
                    venue: `${randomChoice(rng, VENUE_TYPES)}, ${storeIdentity(storeIndex).location}`,
                    agreed_price: agreedPrice,
                    package_price: packageItem.price,
                    payment_status: payment.paymentStatus,
                    required_down_payment: payment.requiredDownPayment,
                    amount_paid: payment.amountPaid,
                    balance: Math.max(0, roundMoney(agreedPrice - payment.amountPaid)),
                    created_at: sqlDateTime(
                        createdDate,
                        randomInt(rng, 8, 18),
                        randomInt(rng, 0, 59),
                        0
                    ),
                });

                pendingItems.set(reference, selectedProducts);

                if (bookingRows.length >= Math.min(CONFIG.batchSize, 250)) {
                    await flush();
                }
            }
        }
    }

    await flush();
}

function formatSeedEventTime(hour, minute = 0) {
    const normalizedHour = Math.max(0, Math.min(23, hour));
    const normalizedMinute = Math.max(0, Math.min(59, minute));
    const period = normalizedHour >= 12 ? "PM" : "AM";
    const displayHour = normalizedHour % 12 || 12;
    return `${displayHour}:${String(normalizedMinute).padStart(2, "0")} ${period}`;
}

async function createDashboardTodayBookings(db, context, counters) {
    const {
        storeId,
        storeIndex,
        branches,
        catalog,
        packages,
        planProfile,
    } = context;

    const bookingRows = [];
    const pendingItems = new Map();
    const nowParts = seedTimeParts();
    const todayKey = isoDate(TODAY);
    const bookingsPerBranch = Math.max(
        0,
        Number(planProfile?.todayBookingsPerBranch ?? 4)
    );

    // Plan profiles with a deterministic daily booking schedule already seed
    // today's bookings, so avoid double-counting the same day.
    if (!bookingsPerBranch) return;

    const statusCycle = [
        "completed",
        "confirmed",
        "preparing",
        "pending",
        "confirmed",
        "preparing",
        "completed",
        "pending",
    ];

    const customerPool = [
        "Angela Reyes",
        "Paolo Cruz",
        "Bianca Santos",
        "Miguel Garcia",
        "Samantha Lopez",
        "Andrea Mendoza",
        "Carlo Bautista",
        "Sophia Ramos",
    ];

    for (const [branchIndex, branch] of branches.entries()) {
        const activePackages = packages.filter(
            (pkg) => String(pkg.status || "Active").toLowerCase() === "active"
        );
        const branchPackages = activePackages.filter((pkg) => pkg.branchId === branch.id);
        const branchProducts = catalog.byBranch.get(branch.id) || [];
        if (!branchProducts.length || !activePackages.length) continue;

        const rng = createRng(
            `${CONFIG.runTag}:dashboard-bookings:${storeIndex}:${branch.id}`
        );

        for (
            let scenarioIndex = 0;
            scenarioIndex < bookingsPerBranch;
            scenarioIndex += 1
        ) {
            const status = statusCycle[scenarioIndex % statusCycle.length];

            let eventHour;
            if (status === "completed") {
                eventHour = Math.max(
                    8,
                    Math.min(18, nowParts.hour - 3 + (scenarioIndex % 2))
                );
            } else {
                eventHour = Math.min(
                    23,
                    Math.max(9, nowParts.hour + 1 + (scenarioIndex % 4))
                );
            }

            const eventMinute = (15 + scenarioIndex * 10 + branchIndex * 5) % 60;

            const packageItem =
                branchPackages[
                scenarioIndex % Math.max(1, branchPackages.length)
                    ] ||
                activePackages[scenarioIndex % activePackages.length];

            const selectedProducts = bookingProducts(
                rng,
                packageItem,
                catalog,
                branch.id
            );

            const extrasTotal = selectedProducts
                .filter(
                    (item) =>
                        !packageItem.inclusions.some(
                            (included) =>
                                Number(
                                    included.productId ||
                                    included.product_id
                                ) === item.productId
                        )
                )
                .reduce(
                    (sum, item) =>
                        sum + item.unitPrice * item.quantity,
                    0
                );

            const agreedPrice = roundMoney(packageItem.price + extrasTotal);
            const payment = paymentForBooking(
                status === "preparing" ? "confirmed" : status,
                agreedPrice,
                rng
            );

            const sequence =
                branchIndex * bookingsPerBranch + scenarioIndex + 1;

            const reference =
                `DASH-BKG-${CONFIG.runTag.toUpperCase()}-` +
                `${String(storeIndex).padStart(3, "0")}-` +
                `${String(branchIndex + 1).padStart(2, "0")}-` +
                `${String(sequence).padStart(3, "0")}`;

            const customerName =
                customerPool[scenarioIndex % customerPool.length];

            const packageJson = JSON.stringify({
                id: packageItem.id,
                packageId: packageItem.id,
                name: packageItem.name,
                price: packageItem.price,
                purchaseType: "advance retail order",
                inclusions: packageItem.inclusions,
                selectedProducts,
            });

            bookingRows.push({
                store_id: storeId,
                branch_id: branch.id,
                booking_type: "package",
                name: customerName,
                phone: buildPhoneNumber(storeIndex, 900 + sequence),
                event_date: todayKey,
                event_type: packageItem.eventType,
                package_name: packageItem.name,
                custom_order: selectedProducts
                    .slice(-3)
                    .map(
                        (item) =>
                            `${item.productName} x${item.quantity}`
                    )
                    .join(", ")
                    .slice(0, 500),
                notes:
                    "Dashboard showcase booking generated for realistic same-day operations.",
                status,
                booking_reference: reference,
                package_json: packageJson,
                packageJSON: packageJson,
                facebook_name: customerName,
                email:
                    `${emailSlug(customerName)}.dashboard.` +
                    `${storeIndex}.${sequence}@customer.example`,
                event_time: formatSeedEventTime(eventHour, eventMinute),
                theme: randomChoice(rng, THEMES),
                venue:
                    `${randomChoice(rng, VENUE_TYPES)}, ` +
                    `${storeIdentity(storeIndex).location}`,
                agreed_price: agreedPrice,
                package_price: packageItem.price,
                payment_status: payment.paymentStatus,
                required_down_payment: payment.requiredDownPayment,
                amount_paid: payment.amountPaid,
                balance: Math.max(
                    0,
                    roundMoney(agreedPrice - payment.amountPaid)
                ),
                created_at: sqlDateTime(
                    addDays(TODAY, -randomInt(rng, 1, 12)),
                    11,
                    0,
                    0
                ),
            });

            pendingItems.set(reference, selectedProducts);
        }
    }

    if (!bookingRows.length) return;

    await insertRows(
        db,
        "bookings",
        bookingRows,
        Math.min(CONFIG.batchSize, 300)
    );

    const references = bookingRows.map((row) => row.booking_reference);
    const placeholders = references.map(() => "?").join(", ");
    const [insertedBookings] = await db.query(
        `SELECT id, booking_reference
         FROM bookings
         WHERE store_id = ?
           AND booking_reference IN (${placeholders})`,
        [storeId, ...references]
    );

    const bookingIds = new Map(
        insertedBookings.map((row) => [
            String(row.booking_reference),
            Number(row.id),
        ])
    );

    const bookingItemRows = [];

    for (const reference of references) {
        const bookingId = bookingIds.get(reference);
        if (!bookingId) continue;

        for (const item of pendingItems.get(reference) || []) {
            bookingItemRows.push({
                booking_id: bookingId,
                store_id: storeId,
                product_id: item.productId,
                variant_id: item.variantId,
                product_name: item.productName,
                quantity: item.quantity,
                unit_price: item.unitPrice,
                line_total: roundMoney(
                    item.quantity * item.unitPrice
                ),
            });
        }
    }

    await insertRows(
        db,
        "booking_items",
        bookingItemRows,
        Math.max(CONFIG.batchSize, 700)
    );

    counters.bookings += bookingRows.length;
    counters.bookingItems += bookingItemRows.length;
}

function parsePermissions(value) {
    if (!value) return {};
    if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
    try { return JSON.parse(String(value)); } catch { return {}; }
}

function databaseDateKey(value) {
    if (!value) return "";

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }

    const text = String(value).trim();
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return "";
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function groupRowsByBranchAndDate(rows, dateField) {
    const grouped = new Map();
    for (const row of rows) {
        const branchId = Number(row.branch_id);
        const dayKey = databaseDateKey(row[dateField]);
        if (!branchId || !dayKey) continue;
        const key = `${branchId}:${dayKey}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    }
    return grouped;
}

function actionKindsForPermissions(permissions) {
    const kinds = [];
    if (permissions.pos) kinds.push("pos", "pos");
    if (permissions.bookings) kinds.push("booking", "booking");
    if (permissions.inventory) kinds.push("inventory", "inventory");
    if (permissions.packages) kinds.push("package");
    return kinds.length ? kinds : ["inventory"];
}

function representativeActivityDates(
    monthsBack,
    monthsForward,
    daysPerMonth
) {
    const dates = [];
    const targetDays = Math.max(1, Number(daysPerMonth || 1));

    for (
        let monthOffset = -monthsBack;
        monthOffset <= monthsForward;
        monthOffset += 1
    ) {
        const monthStart = startOfUtcMonth(
            addMonthsUtc(CURRENT_MONTH_START, monthOffset)
        );
        const monthDays = daysInUtcMonth(monthStart);
        const chosen = new Set();

        if (monthOffset === 0) {
            chosen.add(TODAY.getUTCDate());
        }

        for (let index = 0; chosen.size < targetDays; index += 1) {
            let day =
                1 +
                Math.floor(
                    ((index + 1) * monthDays) /
                    (targetDays + 1)
                );

            if (monthOffset === 0) {
                day = Math.min(day, TODAY.getUTCDate());
            }

            chosen.add(Math.max(1, Math.min(monthDays, day)));

            if (index > monthDays + targetDays) break;
        }

        for (const day of [...chosen].sort((a, b) => a - b)) {
            dates.push(
                new Date(
                    Date.UTC(
                        monthStart.getUTCFullYear(),
                        monthStart.getUTCMonth(),
                        day
                    )
                )
            );
        }
    }

    return dates;
}

function employeeActionTimestampForDate(
    actionDate,
    actionIndex,
    actionsPerDay,
    rng
) {
    const actionKey = isoDate(actionDate);
    const todayKey = isoDate(TODAY);

    if (actionKey === todayKey) {
        const now = seedTimeParts();
        const nowMinutes = now.hour * 60 + now.minute;
        const latestMinute = Math.max(0, nowMinutes - 1);
        const earliestMinute = Math.max(0, latestMinute - 240);
        const spread = Math.max(1, latestMinute - earliestMinute);
        const minuteOfDay = Math.min(
            latestMinute,
            earliestMinute +
            Math.floor(
                ((actionIndex + 1) / (actionsPerDay + 1)) *
                spread
            )
        );
        return sqlDateTime(
            actionDate,
            Math.floor(minuteOfDay / 60),
            minuteOfDay % 60,
            Math.min(59, 5 + actionIndex * 7)
        );
    }

    const minuteOfDay = randomInt(
        rng,
        8 * 60,
        18 * 60 + 30
    );
    return sqlDateTime(
        actionDate,
        Math.floor(minuteOfDay / 60),
        minuteOfDay % 60,
        randomInt(rng, 0, 59)
    );
}

async function createStaffEmployeeActionHistory(db, context, counters) {
    const {
        storeId,
        storeIndex,
        staff,
        catalog,
        packages,
        planProfile,
    } = context;

    if (
        !staff?.length ||
        !(await tableExists(db, "employee_actions"))
    ) {
        return;
    }

    const monthsBack = Math.max(
        0,
        Number(
            planProfile?.employeeActionMonthsBack ??
            DEMO_MONTHS_BACK
        )
    );
    const monthsForward = Math.max(
        0,
        Number(
            planProfile?.employeeActionMonthsForward ??
            DEMO_MONTHS_FORWARD
        )
    );
    const actionDaysPerMonth = Math.max(
        1,
        Number(
            planProfile?.employeeActionDaysPerMonth || 2
        )
    );
    const actionsPerStaffPerDay = Math.max(
        4,
        Number(
            planProfile?.employeeActionsPerStaffPerDay || 4
        )
    );

    const actionDates = representativeActivityDates(
        monthsBack,
        monthsForward,
        actionDaysPerMonth
    );
    const rangeStart = isoDate(
        startOfUtcMonth(
            addMonthsUtc(
                CURRENT_MONTH_START,
                -monthsBack
            )
        )
    );
    const rangeEnd = isoDate(
        addDays(
            startOfUtcMonth(
                addMonthsUtc(
                    CURRENT_MONTH_START,
                    monthsForward + 1
                )
            ),
            -1
        )
    );

    const [ordersInWindow] = await db.execute(
        `SELECT order_id, branch_id, order_date, created_at, total, item
         FROM orders
         WHERE store_id = ?
           AND order_date BETWEEN ? AND ?
         ORDER BY order_date, created_at, order_id`,
        [storeId, rangeStart, rangeEnd]
    );

    const [bookingsInWindow] = await db.execute(
        `SELECT id, branch_id, booking_reference, event_date, event_type,
                package_name, name, status
         FROM bookings
         WHERE store_id = ?
           AND event_date BETWEEN ? AND ?
         ORDER BY event_date, id`,
        [storeId, rangeStart, rangeEnd]
    );

    const ordersByBranchDate = groupRowsByBranchAndDate(
        ordersInWindow,
        "order_date"
    );
    const bookingsByBranchDate = groupRowsByBranchAndDate(
        bookingsInWindow,
        "event_date"
    );

    const packagesByBranch = new Map();
    for (const pkg of packages || []) {
        if (!packagesByBranch.has(pkg.branchId)) {
            packagesByBranch.set(pkg.branchId, []);
        }
        packagesByBranch.get(pkg.branchId).push(pkg);
    }

    const actionRows = [];

    for (const [staffIndex, employee] of staff.entries()) {
        const permissions = parsePermissions(
            employee.permissions
        );
        const kinds = actionKindsForPermissions(permissions);
        const branchProducts =
            catalog.byBranch.get(employee.branchId) ||
            catalog.all ||
            [];
        const branchPackages =
            packagesByBranch.get(employee.branchId) ||
            packages ||
            [];

        for (const actionDate of actionDates) {
            const dayKey = isoDate(actionDate);
            const isFutureDemo = actionDate > TODAY;
            const rng = createRng(
                `${CONFIG.runTag}:employee-actions:` +
                `${storeIndex}:${employee.id}:${dayKey}`
            );
            const dayOrders =
                ordersByBranchDate.get(
                    `${employee.branchId}:${dayKey}`
                ) || [];
            const dayBookings =
                bookingsByBranchDate.get(
                    `${employee.branchId}:${dayKey}`
                ) || [];

            for (
                let actionIndex = 0;
                actionIndex < actionsPerStaffPerDay;
                actionIndex += 1
            ) {
                let kind =
                    kinds[
                    (
                        actionIndex +
                        actionDate.getUTCDate() +
                        staffIndex
                    ) % kinds.length
                        ];

                const availableKinds = kinds.filter(
                    (candidate) => {
                        if (candidate === "pos") {
                            return dayOrders.length > 0;
                        }
                        if (candidate === "booking") {
                            return dayBookings.length > 0;
                        }
                        if (candidate === "package") {
                            return branchPackages.length > 0;
                        }
                        if (candidate === "inventory") {
                            return branchProducts.length > 0;
                        }
                        return false;
                    }
                );

                if (
                    !availableKinds.includes(kind) &&
                    availableKinds.length
                ) {
                    kind =
                        availableKinds[
                        actionIndex %
                        availableKinds.length
                            ];
                }

                let referenceNumber = null;
                let referenceId = null;
                let action = isFutureDemo
                    ? "Scheduled operational activity"
                    : "Recorded operational activity";
                let details = isFutureDemo
                    ? "Scheduled demo activity for future-date report testing."
                    : "Completed a routine branch operation.";

                if (kind === "pos" && dayOrders.length) {
                    const order =
                        dayOrders[
                        (actionIndex + staffIndex) %
                        dayOrders.length
                            ];
                    referenceNumber = String(order.order_id);
                    referenceId = String(order.order_id);
                    action = isFutureDemo
                        ? "Scheduled POS readiness review"
                        : "Processed POS transaction";
                    details = isFutureDemo
                        ? `Planned branch review for future demo transaction ${String(order.order_id)}.`
                        : `Completed a ₱${Number(
                            order.total || 0
                        ).toLocaleString("en-PH", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        })} sale for ${String(
                            order.item || "customer order"
                        ).slice(0, 140)}.`;
                } else if (
                    kind === "booking" &&
                    dayBookings.length
                ) {
                    const booking =
                        dayBookings[
                        (actionIndex + staffIndex) %
                        dayBookings.length
                            ];
                    const normalizedStatus = String(
                        booking.status || ""
                    ).toLowerCase();
                    referenceNumber = String(
                        booking.booking_reference ||
                        `BK-${booking.id}`
                    );
                    referenceId = String(booking.id);

                    if (isFutureDemo) {
                        action =
                            "Scheduled booking preparation";
                        details =
                            `${String(
                                booking.name || "Customer"
                            )} • ${String(
                                booking.event_type ||
                                booking.package_name ||
                                "Future booking"
                            )}.`;
                    } else {
                        action =
                            normalizedStatus === "completed"
                                ? "Completed booking"
                                : normalizedStatus.includes(
                                    "prepar"
                                )
                                    ? "Prepared booking requirements"
                                    : normalizedStatus ===
                                    "pending"
                                        ? "Reviewed pending booking"
                                        : "Confirmed booking details";
                        details =
                            `${String(
                                booking.name || "Customer"
                            )} • ${String(
                                booking.event_type ||
                                booking.package_name ||
                                "Event booking"
                            )}.`;
                    }
                } else if (
                    kind === "package" &&
                    branchPackages.length
                ) {
                    const pkg =
                        branchPackages[
                        (
                            actionIndex +
                            actionDate.getUTCDate()
                        ) %
                        branchPackages.length
                            ];
                    referenceNumber = `PKG-${String(
                        pkg.id
                    ).padStart(6, "0")}`;
                    referenceId = String(pkg.id);
                    action = isFutureDemo
                        ? "Scheduled package review"
                        : actionIndex % 2 === 0
                            ? "Reviewed package inclusions"
                            : "Prepared package items";
                    details = isFutureDemo
                        ? `${pkg.name} scheduled for a future demo-period review.`
                        : `${pkg.name} checked for an upcoming customer booking.`;
                } else if (
                    kind === "inventory" &&
                    branchProducts.length
                ) {
                    const product =
                        branchProducts[
                        (
                            actionIndex * 7 +
                            actionDate.getUTCDate() +
                            staffIndex
                        ) %
                        branchProducts.length
                            ];
                    referenceNumber = `INV-${String(
                        product.id
                    ).padStart(6, "0")}`;
                    referenceId = String(product.id);

                    const inventoryActions = isFutureDemo
                        ? [
                            "Scheduled inventory check",
                            "Scheduled stock-adjustment review",
                            "Scheduled reorder-level review",
                            "Scheduled expiry review",
                        ]
                        : [
                            "Checked inventory stock",
                            "Recorded stock adjustment",
                            "Verified reorder level",
                            "Reviewed expiry status",
                        ];

                    action =
                        inventoryActions[
                        actionIndex %
                        inventoryActions.length
                            ];
                    details = isFutureDemo
                        ? `${product.name} is included in the future demo inventory schedule.`
                        : `${product.name} was reviewed during the branch inventory check.`;
                }

                const module =
                    kind === "pos"
                        ? "Sales / POS"
                        : kind === "booking"
                            ? "Bookings"
                            : kind === "package"
                                ? "Packages"
                                : "Inventory";

                actionRows.push({
                    store_id: storeId,
                    branch_id: employee.branchId,
                    employee_id: employee.id,
                    employee_name: employee.name,
                    employee_role: "Staff",
                    module,
                    reference_number: referenceNumber,
                    action,
                    reference_id: referenceId,
                    details,
                    created_at:
                        employeeActionTimestampForDate(
                            actionDate,
                            actionIndex,
                            actionsPerStaffPerDay,
                            rng
                        ),
                });

                if (actionRows.length >= 1500) {
                    await insertRows(
                        db,
                        "employee_actions",
                        actionRows.splice(
                            0,
                            actionRows.length
                        ),
                        Math.max(
                            CONFIG.batchSize,
                            800
                        )
                    );
                }
            }
        }
    }

    if (actionRows.length) {
        await insertRows(
            db,
            "employee_actions",
            actionRows,
            Math.max(CONFIG.batchSize, 800)
        );
    }

    const seededActionCount =
        staff.length *
        actionDates.length *
        actionsPerStaffPerDay;
    counters.employeeActions += seededActionCount;
}

async function createWeeklySameDayBookings(db, context, counters) {
    const {
        storeId,
        storeIndex,
        branches,
        catalog,
        packages,
        planProfile,
    } = context;

    const weekCount = Math.max(
        0,
        Number(planProfile?.weeklySameDayWeeks || 0)
    );
    const bookingsPerBranchPerWeek = Math.max(
        0,
        Number(planProfile?.weeklySameDayBookingsPerBranch || 0)
    );

    if (!weekCount || !bookingsPerBranchPerWeek) return;

    const bookingRows = [];
    const pendingItems = new Map();

    for (let weekOffset = 1; weekOffset <= weekCount; weekOffset += 1) {
        const eventDate = addDays(TODAY, -(weekOffset * 7));
        const eventDateKey = isoDate(eventDate);

        for (const [branchIndex, branch] of branches.entries()) {
            const activePackages = packages.filter(
                (pkg) => String(pkg.status || "Active").toLowerCase() === "active"
            );
            const branchPackages = activePackages.filter(
                (pkg) => pkg.branchId === branch.id
            );
            const branchProducts = catalog.byBranch.get(branch.id) || [];
            if (!branchProducts.length || !activePackages.length) continue;

            const rng = createRng(
                `${CONFIG.runTag}:weekly-sameday:${storeIndex}:${branch.id}:${eventDateKey}`
            );

            for (
                let bookingIndex = 0;
                bookingIndex < bookingsPerBranchPerWeek;
                bookingIndex += 1
            ) {
                const packageItem =
                    branchPackages[
                    (weekOffset + bookingIndex) %
                    Math.max(1, branchPackages.length)
                        ] ||
                    activePackages[
                    (weekOffset + branchIndex + bookingIndex) %
                    activePackages.length
                        ];

                const selectedProducts = bookingProducts(
                    rng,
                    packageItem,
                    catalog,
                    branch.id
                );

                const extrasTotal = selectedProducts
                    .filter(
                        (item) =>
                            !packageItem.inclusions.some(
                                (included) =>
                                    Number(
                                        included.productId ||
                                        included.product_id
                                    ) === item.productId
                            )
                    )
                    .reduce(
                        (sum, item) =>
                            sum + item.unitPrice * item.quantity,
                        0
                    );

                const agreedPrice = roundMoney(
                    packageItem.price + extrasTotal
                );
                const payment = paymentForBooking(
                    "completed",
                    agreedPrice,
                    rng
                );

                const sequence =
                    (weekOffset - 1) *
                    branches.length *
                    bookingsPerBranchPerWeek +
                    branchIndex * bookingsPerBranchPerWeek +
                    bookingIndex +
                    1;

                const reference =
                    `WKLY-BKG-${CONFIG.runTag.toUpperCase()}-` +
                    `${String(storeIndex).padStart(3, "0")}-` +
                    `${eventDateKey.replace(/-/g, "")}-` +
                    `${String(branchIndex + 1).padStart(2, "0")}-` +
                    `${String(bookingIndex + 1).padStart(2, "0")}`;

                const customerName = realisticName(rng);
                const eventHour = 10 + ((weekOffset + branchIndex) % 8);
                const eventMinute =
                    (15 + weekOffset * 7 + branchIndex * 11) % 60;

                const packageJson = JSON.stringify({
                    id: packageItem.id,
                    packageId: packageItem.id,
                    name: packageItem.name,
                    price: packageItem.price,
                    purchaseType: "same-day retail booking",
                    inclusions: packageItem.inclusions,
                    selectedProducts,
                });

                bookingRows.push({
                    store_id: storeId,
                    branch_id: branch.id,
                    booking_type: "package",
                    name: customerName,
                    phone: buildPhoneNumber(
                        storeIndex,
                        3000 + (sequence % 6000)
                    ),
                    event_date: eventDateKey,
                    event_type: packageItem.eventType,
                    package_name: packageItem.name,
                    custom_order: selectedProducts
                        .slice(-3)
                        .map(
                            (item) =>
                                `${item.productName} x${item.quantity}`
                        )
                        .join(", ")
                        .slice(0, 500),
                    notes:
                        "Guaranteed weekly same-day demo booking. " +
                        "The booking was created on the same calendar date as the event.",
                    status: "completed",
                    booking_reference: reference,
                    package_json: packageJson,
                    packageJSON: packageJson,
                    facebook_name: customerName,
                    email:
                        `${emailSlug(customerName)}.weekly.` +
                        `${storeIndex}.${sequence}@customer.example`,
                    event_time: formatSeedEventTime(
                        eventHour,
                        eventMinute
                    ),
                    theme: randomChoice(rng, THEMES),
                    venue:
                        `${randomChoice(rng, VENUE_TYPES)}, ` +
                        `${storeIdentity(storeIndex).location}`,
                    agreed_price: agreedPrice,
                    package_price: packageItem.price,
                    payment_status: payment.paymentStatus,
                    required_down_payment:
                    payment.requiredDownPayment,
                    amount_paid: payment.amountPaid,
                    balance: Math.max(
                        0,
                        roundMoney(
                            agreedPrice - payment.amountPaid
                        )
                    ),
                    // This is the important same-day condition:
                    // created_at and event_date share the same calendar date.
                    created_at: sqlDateTime(
                        eventDate,
                        Math.max(8, eventHour - 2),
                        eventMinute,
                        0
                    ),
                });

                pendingItems.set(reference, selectedProducts);
            }
        }
    }

    if (!bookingRows.length) return;

    for (
        let offset = 0;
        offset < bookingRows.length;
        offset += Math.min(CONFIG.batchSize, 250)
    ) {
        const chunk = bookingRows.slice(
            offset,
            offset + Math.min(CONFIG.batchSize, 250)
        );

        await insertRows(
            db,
            "bookings",
            chunk,
            Math.min(CONFIG.batchSize, 250)
        );

        const references = chunk.map(
            (row) => row.booking_reference
        );
        const placeholders = references
            .map(() => "?")
            .join(", ");

        const [insertedBookings] = await db.query(
            `SELECT id, booking_reference
             FROM bookings
             WHERE store_id = ?
               AND booking_reference IN (${placeholders})`,
            [storeId, ...references]
        );

        const bookingIds = new Map(
            insertedBookings.map((row) => [
                String(row.booking_reference),
                Number(row.id),
            ])
        );

        const bookingItemRows = [];

        for (const reference of references) {
            const bookingId = bookingIds.get(reference);
            if (!bookingId) {
                throw new Error(
                    `Unable to retrieve weekly same-day booking ${reference}.`
                );
            }

            for (const item of pendingItems.get(reference) || []) {
                bookingItemRows.push({
                    booking_id: bookingId,
                    store_id: storeId,
                    product_id: item.productId,
                    variant_id: item.variantId,
                    product_name: item.productName,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    line_total: roundMoney(
                        item.quantity * item.unitPrice
                    ),
                });
            }

            pendingItems.delete(reference);
        }

        await insertRows(
            db,
            "booking_items",
            bookingItemRows,
            Math.max(CONFIG.batchSize, 800)
        );

        counters.bookings += chunk.length;
        counters.bookingItems += bookingItemRows.length;
    }
}



async function createRestockHistory25Month(db, context, counters) {
    const {
        storeId,
        storeIndex,
        branches,
        catalog,
        staff,
        planProfile,
    } = context;

    if (!(await tableExists(db, "restock_history"))) {
        console.warn(
            "    restock_history table not found; skipping 25-month restock fixtures."
        );
        return;
    }

    const monthsBack = Math.max(
        0,
        Number(
            planProfile?.restockMonthsBack ??
            DEMO_MONTHS_BACK
        )
    );
    const monthsForward = Math.max(
        0,
        Number(
            planProfile?.restockMonthsForward ??
            DEMO_MONTHS_FORWARD
        )
    );
    const perBranchPerMonth = Math.max(
        1,
        Number(
            planProfile?.restocksPerBranchPerMonth || 1
        )
    );

    const staffByBranch = new Map();
    for (const employee of staff || []) {
        if (!staffByBranch.has(employee.branchId)) {
            staffByBranch.set(employee.branchId, []);
        }
        staffByBranch.get(employee.branchId).push(employee);
    }

    const rows = [];

    for (
        let monthOffset = -monthsBack;
        monthOffset <= monthsForward;
        monthOffset += 1
    ) {
        const monthStart = startOfUtcMonth(
            addMonthsUtc(CURRENT_MONTH_START, monthOffset)
        );
        const monthDays = daysInUtcMonth(monthStart);
        const isFutureDemo = monthOffset > 0;

        for (
            let branchIndex = 0;
            branchIndex < branches.length;
            branchIndex += 1
        ) {
            const branch = branches[branchIndex];
            const branchProducts =
                catalog.byBranch.get(branch.id) ||
                catalog.all ||
                [];
            if (!branchProducts.length) continue;

            const branchStaff =
                staffByBranch.get(branch.id) || [];

            for (
                let eventIndex = 0;
                eventIndex < perBranchPerMonth;
                eventIndex += 1
            ) {
                const rng = createRng(
                    `${CONFIG.runTag}:restock:${storeIndex}:` +
                    `${branch.id}:${isoDate(monthStart)}:${eventIndex}`
                );
                const product =
                    branchProducts[
                    (
                        monthOffset +
                        branchIndex * 7 +
                        eventIndex * 13 +
                        branchProducts.length * 100
                    ) % branchProducts.length
                        ];

                let day =
                    1 +
                    Math.floor(
                        ((eventIndex + 1) * monthDays) /
                        (perBranchPerMonth + 1)
                    );

                if (monthOffset === 0) {
                    day = Math.min(
                        day,
                        TODAY.getUTCDate()
                    );
                }

                const activityDate = new Date(
                    Date.UTC(
                        monthStart.getUTCFullYear(),
                        monthStart.getUTCMonth(),
                        Math.max(
                            1,
                            Math.min(monthDays, day)
                        )
                    )
                );

                const stockBefore = randomInt(
                    rng,
                    2,
                    planProfile?.tier === "scale"
                        ? 80
                        : 40
                );
                const quantityAdded = randomInt(
                    rng,
                    planProfile?.tier === "scale"
                        ? 30
                        : 10,
                    planProfile?.tier === "scale"
                        ? 160
                        : planProfile?.tier === "growth"
                            ? 90
                            : 45
                );
                const receiver = branchStaff.length
                    ? branchStaff[
                    eventIndex %
                    branchStaff.length
                        ].name
                    : "Demo Inventory Team";

                rows.push({
                    store_id: storeId,
                    branch_id: branch.id,
                    product_id: product.id,
                    product_name: product.name,
                    variant_name: null,
                    stock_before: stockBefore,
                    quantity_added: quantityAdded,
                    current_stock:
                        stockBefore + quantityAdded,
                    received_by: receiver,
                    notes: isFutureDemo
                        ? "Scheduled demo restock fixture for future-date report testing."
                        : monthOffset === 0
                            ? "Current-month demo restock fixture."
                            : "Historical demo restock fixture.",
                    created_at: sqlDateTime(
                        activityDate,
                        9 + ((eventIndex + branchIndex) % 8),
                        (eventIndex * 17 + branchIndex * 11) % 60,
                        0
                    ),
                });

                if (rows.length >= 1000) {
                    await insertRows(
                        db,
                        "restock_history",
                        rows.splice(0, rows.length),
                        Math.max(CONFIG.batchSize, 800)
                    );
                }
            }
        }
    }

    if (rows.length) {
        await insertRows(
            db,
            "restock_history",
            rows,
            Math.max(CONFIG.batchSize, 800)
        );
    }

    counters.restockHistory +=
        (monthsBack + monthsForward + 1) *
        branches.length *
        perBranchPerMonth;
}

async function rebuildPosDashboardSummariesForStore(
    db,
    storeId
) {
    const hasDaily = await tableExists(
        db,
        "pos_daily_summary"
    );
    const hasProducts = await tableExists(
        db,
        "pos_product_monthly_summary"
    );

    if (!hasDaily || !hasProducts) {
        console.warn(
            "    POS dashboard summary tables are not present; " +
            "skipping summary rebuild for this store."
        );
        return;
    }

    await db.execute(
        `DELETE FROM pos_product_monthly_summary
         WHERE store_id = ?`,
        [storeId]
    );
    await db.execute(
        `DELETE FROM pos_daily_summary
         WHERE store_id = ?`,
        [storeId]
    );

    await db.execute(
        `INSERT INTO pos_daily_summary
         (
             store_id,
             branch_id,
             summary_date,
             gross_sales,
             cost_of_sales,
             transaction_count
         )
         SELECT
             o.store_id,
             o.branch_id,
             o.order_date,
             SUM(o.total) AS gross_sales,
             SUM(
                 COALESCE(
                     item_cost.cost,
                     o.total
                 )
             ) AS cost_of_sales,
             COUNT(*) AS transaction_count
         FROM orders o
         LEFT JOIN (
             SELECT
                 oi.store_id,
                 oi.order_id,
                 SUM(
                     COALESCE(
                         oi.cost_price_at_sale,
                         CASE
                             WHEN oi.variant_id IS NOT NULL
                                 THEN COALESCE(
                                     pv.original_price,
                                     p.original_price,
                                     0
                                 )
                             ELSE COALESCE(
                                 p.original_price,
                                 0
                             )
                         END,
                         0
                     ) * oi.quantity
                 ) AS cost
             FROM order_items oi
             LEFT JOIN products p
               ON p.id = oi.product_id
              AND p.store_id = oi.store_id
             LEFT JOIN product_variants pv
               ON pv.id = oi.variant_id
              AND pv.product_id = oi.product_id
             WHERE oi.store_id = ?
             GROUP BY
                 oi.store_id,
                 oi.order_id
         ) item_cost
           ON item_cost.store_id = o.store_id
          AND item_cost.order_id = o.order_id
         WHERE o.store_id = ?
           AND LOWER(
               TRIM(COALESCE(o.status, ''))
           ) NOT IN (
               'pending',
               'pending payment',
               'unpaid',
               'cancelled',
               'canceled',
               'refunded',
               'void',
               'draft',
               'failed'
           )
         GROUP BY
             o.store_id,
             o.branch_id,
             o.order_date`,
        [storeId, storeId]
    );

    await db.execute(
        `INSERT INTO pos_product_monthly_summary
         (
             store_id,
             branch_id,
             month_start,
             product_id,
             product_name,
             units_sold,
             sales_amount
         )
         SELECT
             o.store_id,
             o.branch_id,
             STR_TO_DATE(
                 DATE_FORMAT(
                     o.order_date,
                     '%Y-%m-01'
                 ),
                 '%Y-%m-%d'
             ) AS month_start,
             oi.product_id,
             MAX(oi.product_name) AS product_name,
             SUM(oi.quantity) AS units_sold,
             SUM(oi.line_total) AS sales_amount
         FROM orders o
         INNER JOIN order_items oi
            ON oi.store_id = o.store_id
           AND oi.order_id = o.order_id
         WHERE o.store_id = ?
           AND LOWER(
               TRIM(COALESCE(o.status, ''))
           ) NOT IN (
               'pending',
               'pending payment',
               'unpaid',
               'cancelled',
               'canceled',
               'refunded',
               'void',
               'draft',
               'failed'
           )
         GROUP BY
             o.store_id,
             o.branch_id,
             STR_TO_DATE(
                 DATE_FORMAT(
                     o.order_date,
                     '%Y-%m-01'
                 ),
                 '%Y-%m-%d'
             ),
             oi.product_id`,
        [storeId]
    );
}


function buildDatePools() {
    return {
        historical: buildWeightedDates(addDays(TODAY, -730), addDays(TODAY, -1), "retail"),
        near: buildWeightedDates(CONFIG.nearBookingStart, CONFIG.nearBookingEnd, "retail"),
        long: buildWeightedDates(CONFIG.longBookingStart, CONFIG.longBookingEnd, "corporate"),
    };
}

function estimateOrdersPerStore() {
    let expected = 0;
    let cursor = new Date(CONFIG.salesStart.getTime());

    while (cursor <= CONFIG.salesEnd) {
        expected +=
            CONFIG.averageDailyOrders *
            historicalGrowthFactor(cursor) *
            demandMonthFactor(cursor) *
            SALES_DAY_FACTORS[cursor.getUTCDay()] *
            paydayFactor(cursor) *
            specialEventFactor(cursor);
        cursor = addDays(cursor, 1);
    }

    return Math.round(expected);
}

// Modified printConfiguration to accept storeCount (not mutate CONFIG)
function printConfiguration(storeCount = DEMO_STORE_COUNT) {
    console.log("\nStockNBook plan-aligned demo seeder");
    console.log("----------------------------------");
    console.log(`Run tag:               ${CONFIG.runTag}`);
    console.log(`Target stores:         ${storeCount} total`);
    console.log(`Plan distribution:     3 Starter / 3 Growth / 3 Scale`);
    console.log(`Starter catalog:       50 products, 20 bookings/month`);
    console.log(`Growth catalog:        800 products, 20 bookings/month`);
    console.log(`Scale catalog:         1,500 products, 100 demo bookings/month`);
    console.log(
        `Demo date coverage:     12 months back + current month + 12 months forward`
    );
    console.log(
        `Current POS coverage:   ${isoDate(CURRENT_MONTH_START)} through ${isoDate(TODAY)}`
    );
    console.log(
        `Future POS coverage:    ${isoDate(DEMO_FUTURE_MONTH_START)} through ${isoDate(DEMO_WINDOW_END)}`
    );
    console.log(`Default test password: ${CONFIG.defaultPassword}`);
    console.log("");
}

async function main() {
    // Dry run shortcut (no DB connection / writes)
    if (CONFIG.dryRun) {
        // If dry run and store count env override present, just show
        printConfiguration(DEMO_STORE_COUNT);
        console.log("Dry run complete. No database connection or writes were performed.");
        return;
    }

    const db = await mysql.createConnection(dbConfig());
    console.log("Connected to database.");

    const counters = {
        stores: 0,
        managers: 0,
        staff: 0,
        products: 0,
        productVariants: 0,
        branchInventory: 0,
        inventoryBatches: 0,
        inventoryMovements: 0,
        packageItems: 0,
        packages: 0,
        orders: 0,
        orderItems: 0,
        bookings: 0,
        bookingItems: 0,
        subscriptions: 0,
        payments: 0,
        subscriptionHistory: 0,
        subscriptionAuditLogs: 0,
        employeeActions: 0,
        restockHistory: 0,
    };

    try {
        // Ensure schema/tables exist so we can fetch plans
        await ensureSeederSchema(db);

        const plans = await fetchRealPlans(db);

        // Determine the three published plans from the real plans table.
        const starter = plans.find(p => /starter/i.test(p.name)) || plans[0];
        const growth = plans.find(p => /growth/i.test(p.name)) || plans[1] || starter;
        const scale = plans.find(p => /scale/i.test(p.name) || /enterprise|pro/i.test(p.name)) || plans[2] || growth;

        const planOrder = [starter, growth, scale];

        // Exactly 3 stores per plan => 9 demo stores total.
        const assignedPlans = [];
        for (const p of planOrder) {
            for (let i = 0; i < STORES_PER_PLAN; i += 1) assignedPlans.push(p);
        }

        const STORE_COUNT = assignedPlans.length;
        printConfiguration(STORE_COUNT);

        await ensureSeederLookupIndexes(db);
        await removeExistingSeedRun(db);

        const platformAdminIds = await fetchPlatformAdminIds(db);
        const passwordHash = await bcrypt.hash(CONFIG.defaultPassword, 10);
        const usedPersonnelNames = new Set();

        // Plan-specific demo profiles requested for StockNBook testing.
        const planProfiles = {};

        planProfiles[starter.id] = {
            tier: "starter",
            name: starter.name,
            productsPerStore: 50,
            simpleProducts: 20,
            variantProducts: 20,
            bookingsPerMonth: 20,
            monthlyBookingTarget: 20,
            bookingBranchDistribution: [20],
            bookingStatusDistribution: {
                completed: 8,
                confirmed: 4,
                pending: 4,
                preparing: 2,
                cancelled: 2,
            },
            staff: 1,
            branches: 1,
            managers: 1,
            salesMonthsBack: 12,
            salesMonthsForward: 12,
            bookingMonthsBack: 12,
            bookingMonthsForward: 12,
            employeeActionMonthsBack: 12,
            employeeActionMonthsForward: 12,
            employeeActionDaysPerMonth: 2,
            restockMonthsBack: 12,
            restockMonthsForward: 12,
            restocksPerBranchPerMonth: 1,
            minDailyOrders: 3,
            maxDailyOrders: 8,
            todayPosPerBranch: 5,
            seasonalStrength: 0.55,
            monthlyGrowthRate: 0.004,
            salesNoisePct: 0.04,
            employeeActionsPerStaffPerDay: 4,
            inventoryAttention: {
                expired: 2,
                expiringSoon: 3,
                outOfStock: 2,
                lowStock: 3,
            },
            packagesPerStore: 3,
            inactivePackages: 0,
            packageItemRange: [4, 8],
            packageDiscountRange: [0.05, 0.10],
        };

        planProfiles[growth.id] = {
            tier: "growth",
            name: growth.name,
            productsPerStore: 800,
            simpleProducts: 614,
            variantProducts: 150,
            bookingsPerMonth: 20,
            monthlyBookingTarget: 20,
            bookingBranchDistribution: [7, 7, 6],
            bookingStatusDistribution: {
                completed: 8,
                confirmed: 4,
                pending: 4,
                preparing: 2,
                cancelled: 2,
            },
            staff: 3,
            branches: 3,
            managers: 3,
            salesMonthsBack: 12,
            salesMonthsForward: 12,
            bookingMonthsBack: 12,
            bookingMonthsForward: 12,
            employeeActionMonthsBack: 12,
            employeeActionMonthsForward: 12,
            employeeActionDaysPerMonth: 2,
            restockMonthsBack: 12,
            restockMonthsForward: 12,
            restocksPerBranchPerMonth: 1,
            minDailyOrders: 10,
            maxDailyOrders: 25,
            todayPosPerBranch: 6,
            seasonalStrength: 0.85,
            monthlyGrowthRate: 0.006,
            salesNoisePct: 0.05,
            employeeActionsPerStaffPerDay: 6,
            inventoryAttention: {
                expired: 6,
                expiringSoon: 8,
                outOfStock: 8,
                lowStock: 14,
            },
            packagesPerStore: 6,
            inactivePackages: 1,
            packageItemRange: [6, 12],
            packageDiscountRange: [0.08, 0.15],
        };

        planProfiles[scale.id] = {
            tier: "scale",
            name: scale.name,
            productsPerStore: 1500,
            simpleProducts: 1130,
            variantProducts: 300,
            bookingsPerMonth: null,
            monthlyBookingTarget: 100,
            bookingBranchDistribution: [20, 20, 20, 20, 20],
            bookingStatusDistribution: {
                completed: 45,
                confirmed: 20,
                pending: 15,
                preparing: 10,
                cancelled: 10,
            },
            staff: 5,
            branches: 5,
            managers: 5,
            salesMonthsBack: 12,
            salesMonthsForward: 12,
            bookingMonthsBack: 12,
            bookingMonthsForward: 12,
            employeeActionMonthsBack: 12,
            employeeActionMonthsForward: 12,
            employeeActionDaysPerMonth: 2,
            restockMonthsBack: 12,
            restockMonthsForward: 12,
            restocksPerBranchPerMonth: 1,
            minDailyOrders: 25,
            maxDailyOrders: 50,
            todayPosPerBranch: 8,
            seasonalStrength: 1.15,
            monthlyGrowthRate: 0.008,
            salesNoisePct: 0.06,
            employeeActionsPerStaffPerDay: 8,
            inventoryAttention: {
                expired: 10,
                expiringSoon: 15,
                outOfStock: 15,
                lowStock: 30,
            },
            packagesPerStore: 10,
            inactivePackages: 2,
            packageItemRange: [8, 15],
            packageDiscountRange: [0.10, 0.18],
        };

        // Seed each plan as one deterministic triplet: Active / Expiring Soon / Expired
        for (let storeIndex = 1; storeIndex <= STORE_COUNT; storeIndex += 1) {
            const startedAt = Date.now();
            const identity = storeIdentity(storeIndex);
            const planForStore = assignedPlans[storeIndex - 1];
            const planProfile = planProfiles[planForStore.id] || {
                tier: "custom",
                name: planForStore.name,
                productsPerStore: CONFIG.productsPerStore,
                simpleProducts: Math.floor(CONFIG.productsPerStore / 2),
                variantProducts: CONFIG.productsPerStore - Math.floor(CONFIG.productsPerStore / 2),
                bookingsPerMonth: 20,
                monthlyBookingTarget: 20,
                bookingBranchDistribution: null,
                bookingStatusDistribution: {
                    completed: 8,
                    confirmed: 4,
                    pending: 4,
                    preparing: 2,
                    cancelled: 2,
                },
                staff: CONFIG.staffPerStore,
                branches: CONFIG.managersPerStore,
                managers: CONFIG.managersPerStore,
                salesMonthsBack: 12,
                salesMonthsForward: 12,
                bookingMonthsBack: 12,
                bookingMonthsForward: 12,
                employeeActionMonthsBack: 12,
                employeeActionMonthsForward: 12,
                employeeActionDaysPerMonth: 2,
                restockMonthsBack: 12,
                restockMonthsForward: 12,
                restocksPerBranchPerMonth: 1,
                minDailyOrders: 3,
                maxDailyOrders: 12,
                todayPosPerBranch: 3,
                seasonalStrength: 0.75,
                monthlyGrowthRate: 0.005,
                salesNoisePct: 0.05,
                employeeActionsPerStaffPerDay: 4,
                inventoryAttention: null,
                packagesPerStore: 5,
                inactivePackages: 0,
                packageItemRange: [6, 12],
                packageDiscountRange: [0.08, 0.15],
            };

            console.log(`[${storeIndex}/${STORE_COUNT}] Seeding store (plan: ${planProfile.name})...`);
            console.log(
                `    Profile: ${planProfile.productsPerStore} products ` +
                `(${planProfile.simpleProducts} simple / ${planProfile.variantProducts} variant / ` +
                `${totalInventoryAttention(planProfile)} attention), ` +
                `${planProfile.branches} branches, ${planProfile.staff} staff, ` +
                `${planProfile.packagesPerStore} packages/store, ` +
                `${planProfile.monthlyBookingTarget} bookings/month, ` +
                `${planProfile.minDailyOrders}-${planProfile.maxDailyOrders} POS/day across the 25-month demo window`
            );

            await db.beginTransaction();

            try {
                const store = await createStoreAndPeople(db, storeIndex, passwordHash, usedPersonnelNames, planProfile);
                counters.stores += 1;
                counters.managers += Math.min(
                    Number(planProfile.managers || CONFIG.managersPerStore),
                    store.branches.length
                );
                counters.staff += planProfile.staff;

                // categories
                await createCategories(db, store.storeId);

                // products
                const products = await createProducts(db, store.storeId, storeIndex, store.branches, planProfile);
                counters.products += products.length;
                counters.productVariants += products.reduce(
                    (sum, product) => sum + product.variants.length,
                    0
                );

                // Mirror the unchanged seeded stock/prices/expiry into Database V2.
                const v2Inventory = await seedV2InventoryForStore(
                    db,
                    store.storeId
                );
                counters.branchInventory += v2Inventory.inventoryRows;
                counters.inventoryBatches += v2Inventory.batchRows;
                counters.inventoryMovements += v2Inventory.movementRows;

                const productCatalog = buildProductCatalog(products);

                // packages
                const packages = await createPackages(
                    db,
                    store.storeId,
                    storeIndex,
                    store.branches,
                    products,
                    planProfile
                );
                counters.packages += packages.length;

                // Keep packages.inclusions unchanged for compatibility, while also
                // populating the normalized Database V2 package_items table.
                const v2PackageItems = await seedV2PackageItems(
                    db,
                    store.storeId,
                    packages
                );
                counters.packageItems += v2PackageItems;

                // Fail the current store transaction immediately if the V2 mirror
                // does not exactly match the original seeded inventory/package data.
                await verifyV2SeedStore(
                    db,
                    store.storeId,
                    packages.reduce(
                        (sum, pkg) =>
                            sum + (Array.isArray(pkg.inclusions) ? pkg.inclusions.length : 0),
                        0
                    )
                );

                // Inside each plan's 3-store group: Active / Expiring Soon / Expired.
                const withinPlanIndex = (storeIndex - 1) % STORES_PER_PLAN;
                const tripletPos = withinPlanIndex;

                // create subscription lifecycle with forced plan and tripletPos to control status distribution
                await createSubscriptionLifecycle(
                    db,
                    { storeId: store.storeId, storeIndex },
                    plans,
                    platformAdminIds,
                    counters,
                    planForStore,
                    tripletPos,
                    planProfile
                );

                // historical orders (defensive math inside)
                await createHistoricalOrders(
                    db,
                    {
                        storeId: store.storeId,
                        storeIndex,
                        branches: store.branches,
                        catalog: productCatalog,
                        planProfile,
                    },
                    counters
                );

                // Keep the optimized Owner dashboard summary tables in sync
                // with the complete 25-month POS demo window.
                await rebuildPosDashboardSummariesForStore(
                    db,
                    store.storeId
                );

                // Plan-aligned monthly booking fixtures. Starter/Growth keep
                // the 20/month limit; Scale seeds 100/month across all 5 branches.
                await createMonthlyBookingFixtures(
                    db,
                    {
                        storeId: store.storeId,
                        storeIndex,
                        branches: store.branches,
                        catalog: productCatalog,
                        packages,
                        planProfile,
                    },
                    counters
                );

                // Seed branch-scoped restock/report source data across the
                // same rolling 25-month window.
                await createRestockHistory25Month(
                    db,
                    {
                        storeId: store.storeId,
                        storeIndex,
                        branches: store.branches,
                        catalog: productCatalog,
                        staff: store.staff,
                        planProfile,
                    },
                    counters
                );

                // Seed representative staff activity in every month of the
                // 25-month window. TODAY is always included for Staff Recent
                // Activity; future rows are clearly labeled as scheduled demo
                // activity so they do not pretend to be completed work.
                await createStaffEmployeeActionHistory(
                    db,
                    {
                        storeId: store.storeId,
                        storeIndex,
                        staff: store.staff,
                        catalog: productCatalog,
                        packages,
                        planProfile,
                    },
                    counters
                );

                await db.commit();

                console.log(
                    `    Completed store ${storeIndex} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. Owner: ${store.identity.ownerEmail}`
                );
            } catch (error) {
                await db.rollback();
                throw new Error(
                    `Store ${storeIndex} (${identity.name}) failed: ${error.message}`,
                    { cause: error }
                );
            }
        }

        await ensurePerformanceIndexes(db);

        console.log("\nDemo dataset created successfully.");
        console.log("---------------------------------");
        console.log(`Stores:          ${counters.stores.toLocaleString()}`);
        console.log(`Managers:        ${counters.managers.toLocaleString()}`);
        console.log(`Staff:           ${counters.staff.toLocaleString()}`);
        console.log(`Products:        ${counters.products.toLocaleString()}`);
        console.log(`Variants:        ${counters.productVariants.toLocaleString()}`);
        console.log(`Branch inventory:${String(counters.branchInventory.toLocaleString()).padStart(12, " ")}`);
        console.log(`Inv. batches:    ${counters.inventoryBatches.toLocaleString()}`);
        console.log(`Inv. movements:  ${counters.inventoryMovements.toLocaleString()}`);
        console.log(`Packages:        ${counters.packages.toLocaleString()}`);
        console.log(`Package items:   ${counters.packageItems.toLocaleString()}`);
        console.log(`POS orders:      ${counters.orders.toLocaleString()}`);
        console.log(`POS order items: ${counters.orderItems.toLocaleString()}`);
        console.log(`Bookings:        ${counters.bookings.toLocaleString()}`);
        console.log(`Booking items:   ${counters.bookingItems.toLocaleString()}`);
        console.log(`Subscriptions:   ${counters.subscriptions.toLocaleString()}`);
        console.log(`Payments:        ${counters.payments.toLocaleString()}`);
        console.log(`Sub. history:    ${counters.subscriptionHistory.toLocaleString()}`);
        console.log(`Sub. audit logs: ${counters.subscriptionAuditLogs.toLocaleString()}`);
        console.log(`Employee actions:${String(counters.employeeActions.toLocaleString()).padStart(12, " ")}`);
        console.log(`Restock history: ${counters.restockHistory.toLocaleString()}`);
        console.log("");
        console.log(`Owner 001 login: owner001@${STORE_EMAIL_DOMAIN}`);
        console.log(`Password:        ${CONFIG.defaultPassword}`);
    } finally {
        await db.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error("Demo seed failed:", error);
        if (error.cause) console.error("Original error:", error.cause);
        process.exit(1);
    });
}

module.exports = {
    CONFIG,
    createRng,
    realisticName,
    storeIdentity,
    productName,
    variantValuesForProduct,
    variantDisplayLabel,
    STORES_PER_PLAN,
    DEMO_STORE_COUNT,
    VARIANTS_PER_PRODUCT,
    estimateOrdersPerStore,
};