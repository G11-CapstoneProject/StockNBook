/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * StockNBook demo seeder (realistic high-volume version).
 *
 * Default dataset:
 *   - 3 retail party-supply stores
 *   - 1 owner, 3 managers, and 6 staff per store (3 staff per first 2 branches)
 *   - 1,000 direct-sale inventory products per store
 *   - 5 retail party packages per store
 *   - POS sales from 2016 through 2026 with seasonality and growth
 *   - Realistic booking volumes and distributions (not fixed-16)
 *   - Booking windows span near-term and long-range through 2031
 *
 * Usage:
 *   node seed-demo-data.js
 *   SEED_DRY_RUN=true node seed-demo-data.js
 */
require("dotenv").config({ path: ".env.local" });

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

function todayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const TODAY = todayUtc();
const SALES_END_CAP = parseIsoDate("2026-12-31", "sales end cap");

const CONFIG = Object.freeze({
    runTag: sanitizeRunTag(process.env.SEED_RUN_TAG || "demo-v1"),

    storeCount: envInt("SEED_STORE_COUNT", 3, 1, 1000),
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

    salesStart: parseIsoDate(process.env.SEED_SALES_START || "2016-01-01", "SEED_SALES_START"),
    salesEnd: parseIsoDate(process.env.SEED_SALES_END || "2026-12-31", "SEED_SALES_END"),

    nearBookingStart: addDays(TODAY, 1),
    nearBookingEnd: addDays(TODAY, 365),
    longBookingStart: addDays(TODAY, 366),
    longBookingEnd: parseIsoDate(process.env.SEED_LONG_BOOKING_END || "2031-12-31", "SEED_LONG_BOOKING_END"),
});

if (CONFIG.salesStart > CONFIG.salesEnd || CONFIG.salesEnd > SALES_END_CAP) {
    throw new Error("SEED_SALES range must be 2016-01-01 through 2026-12-31.");
}
if (CONFIG.longBookingStart > CONFIG.longBookingEnd) {
    throw new Error("SEED_LONG_BOOKING_END must be after the next-12-month booking window.");
}

const VARIANT_PRODUCTS_PER_STORE = Math.floor(CONFIG.productsPerStore / 2);
const SIMPLE_PRODUCTS_PER_STORE = CONFIG.productsPerStore - VARIANT_PRODUCTS_PER_STORE;
const VARIANTS_PER_PRODUCT = 3;

const STORE_SLUG_PREFIX = `${CONFIG.runTag}-party-store-`;
const STORE_EMAIL_DOMAIN = `${CONFIG.runTag}.seed.stocknbook.test`;

const CATEGORIES = [
    "Balloons","Balloon Accessories","Tableware","Table Decorations","Backdrop Decorations",
    "Banners and Garlands","Cake Decorations","Candles","Party Favors","Gift Packaging",
    "Confetti and Poppers","Photo Booth Supplies","Artificial Flowers","Retail Lighting",
    "Food Service Supplies","Invitations and Stationery","Wearable Party Accessories",
    "Kids Party Supplies","Wedding Supplies","Corporate Event Supplies"
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
    { name: "Kids Birthday Supply Bundle", description: "A direct-sale birthday bundle with balloons, tableware, banners, favors, and cake decorations.", eventType: "Kids Birthday", categories: ["Balloons","Tableware","Banners and Garlands","Party Favors","Cake Decorations"], itemCount: 10, discountRate: 0.10 },
    { name: "Milestone Celebration Deluxe Pack", description: "A premium retail pack for debut, anniversary, and milestone birthday celebrations.", eventType: "Milestone Birthday", categories: ["Balloons","Backdrop Decorations","Table Decorations","Retail Lighting","Candles"], itemCount: 12, discountRate: 0.12 },
    { name: "Graduation Celebration Kit", description: "A complete retail supply kit for graduation parties, recognition events, and school celebrations.", eventType: "Graduation Party", categories: ["Banners and Garlands","Balloons","Tableware","Photo Booth Supplies","Party Favors"], itemCount: 11, discountRate: 0.11 },
    { name: "Complete Wedding Decor Pack", description: "A direct-purchase wedding decor pack with table accents, signage, artificial flowers, and lighting.", eventType: "Wedding Reception", categories: ["Wedding Supplies","Artificial Flowers","Table Decorations","Backdrop Decorations","Retail Lighting"], itemCount: 14, discountRate: 0.14 },
    { name: "Corporate Holiday Event Supply Bundle", description: "A scalable retail event-supply bundle for company celebrations, year-end parties, and conferences.", eventType: "Corporate Gathering", categories: ["Corporate Event Supplies","Tableware","Banners and Garlands","Retail Lighting","Food Service Supplies"], itemCount: 15, discountRate: 0.15 },
];

const MONTH_FACTORS = { 1:0.72,2:0.90,3:1.05,4:1.30,5:1.48,6:1.22,7:0.88,8:0.84,9:0.92,10:1.08,11:1.34,12:1.72 };
const SALES_DAY_FACTORS = { 0:1.34,1:0.70,2:0.82,3:0.90,4:0.98,5:1.18,6:1.42 };
const BOOKING_DAY_FACTORS = { 0:2.25,1:0.55,2:0.70,3:0.78,4:0.90,5:1.45,6:2.55 };

function dbConfig() {
    const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
    const missing = required.filter((key) => !String(process.env[key] || "").trim());
    if (missing.length) throw new Error(`Missing ${missing.join(", ")} in .env.local.`);

    return {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT || 3306),
        ssl: String(process.env.DB_SSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : undefined,
        charset: "utf8mb4",
        supportBigNumbers: true,
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
    return weightedChoice(
        rng,
        branches.map((branch, index) => ({
            value: branch,
            weight: index === 0 ? 0.47 : index === 1 ? 0.30 : 0.23,
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

    await db.query(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id INT AUTO_INCREMENT PRIMARY KEY,
            plan_code VARCHAR(30) NOT NULL UNIQUE,
            plan_name VARCHAR(50) NOT NULL,
            plan_label VARCHAR(50) NOT NULL,
            monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            inventory_limit INT NULL,
            booking_limit INT NULL,
            staff_limit INT NOT NULL DEFAULT 1,
            features JSON NULL,
            is_active TINYINT NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            store_id INT NOT NULL,
            plan_id INT NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'active',
            amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly',
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at DATETIME NULL,
            starts_at DATE NULL,
            ends_at DATE NULL,
            admin_notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
        ["order_items", "idx_perf_order_items_product", ["product_id"]],
        ["bookings", "idx_perf_bookings_store_event", ["store_id", "event_date"]],
        ["bookings", "idx_perf_bookings_branch_event", ["branch_id", "event_date"]],
        ["booking_items", "idx_perf_booking_items_booking", ["booking_id"]],
        ["booking_items", "idx_perf_booking_items_product", ["product_id"]],
        ["subscriptions", "idx_perf_subscriptions_store", ["store_id"]],
    ];

    for (const [tableName, indexName, columns] of indexDefinitions) {
        await ensureIndex(db, tableName, indexName, columns);
    }
}

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
                values.push(row[column] === undefined ? null : row[column]);
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
    const { childTable, childColumn, parentTable, parentColumn } = relation;

    if (!(await tableExists(db, childTable)) || !(await tableExists(db, parentTable))) {
        return;
    }

    const childColumns = await getTableColumns(db, childTable);
    const parentColumns = await getTableColumns(db, parentTable);

    if (
        !childColumns.has(childColumn) ||
        !parentColumns.has(parentColumn) ||
        !parentColumns.has("store_id")
    ) {
        return;
    }

    const [result] = await db.query(
        `DELETE child
         FROM ${quoteIdentifier(childTable)} AS child
         INNER JOIN ${quoteIdentifier(parentTable)} AS parent
            ON child.${quoteIdentifier(childColumn)} = parent.${quoteIdentifier(parentColumn)}
         INNER JOIN tmp_perf_seed_store_ids AS seeded
            ON parent.store_id = seeded.id`
    );

    if (result.affectedRows) {
        console.log(`Removed ${result.affectedRows.toLocaleString()} rows from ${childTable}.`);
    }
}

async function removeExistingSeedRun(db) {
    if (!CONFIG.resetExistingRun) return;

    const count = await prepareSeedStoreTempTable(db);
    if (!count) return;

    console.log(`Removing ${count} existing ${CONFIG.runTag} seed stores before reseeding...`);

    await db.query("SET FOREIGN_KEY_CHECKS = 0");

    try {
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

        const [storeTables] = await db.execute(
            `SELECT DISTINCT TABLE_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND COLUMN_NAME = 'store_id'
               AND TABLE_NAME <> 'stores'
             ORDER BY TABLE_NAME`
        );

        for (const row of storeTables) {
            const tableName = String(row.TABLE_NAME);
            const [result] = await db.query(
                `DELETE scoped
                 FROM ${quoteIdentifier(tableName)} AS scoped
                 INNER JOIN tmp_perf_seed_store_ids AS seeded
                    ON scoped.store_id = seeded.id`
            );

            if (result.affectedRows) {
                console.log(`Removed ${result.affectedRows.toLocaleString()} rows from ${tableName}.`);
            }
        }

        const [storeResult] = await db.query(
            `DELETE store_row
             FROM stores AS store_row
             INNER JOIN tmp_perf_seed_store_ids AS seeded
                ON store_row.id = seeded.id`
        );

        console.log(`Removed ${storeResult.affectedRows} existing seeded stores.`);
    } finally {
        await db.query("SET FOREIGN_KEY_CHECKS = 1");
        await db.query("DROP TEMPORARY TABLE IF EXISTS tmp_perf_seed_store_ids");
    }
}

async function ensureEnterprisePlan(db) {
    const features = JSON.stringify([
        "Inventory", "Bookings", "POS", "Analytics",
        "Reports", "Forecasting", "Branches", "Staff Management",
    ]);

    await db.execute(
        `INSERT INTO subscription_plans
         (
            plan_code,
            plan_name,
            plan_label,
            monthly_price,
            inventory_limit,
            booking_limit,
            staff_limit,
            features,
            is_active
         )
         VALUES ('enterprise', 'Enterprise', 'Performance Test', 1299.00, 200000, NULL, 100, ?, 1)
         ON DUPLICATE KEY UPDATE
            plan_name = VALUES(plan_name),
            plan_label = VALUES(plan_label),
            monthly_price = VALUES(monthly_price),
            inventory_limit = VALUES(inventory_limit),
            booking_limit = VALUES(booking_limit),
            staff_limit = VALUES(staff_limit),
            features = VALUES(features),
            is_active = 1`,
        [features]
    );

    const [rows] = await db.execute(
        `SELECT id, monthly_price
         FROM subscription_plans
         WHERE plan_code = 'enterprise'
         LIMIT 1`
    );

    if (!rows.length) throw new Error("Unable to create or retrieve enterprise plan.");

    return {
        id: Number(rows[0].id),
        price: Number(rows[0].monthly_price),
    };
}

async function createStoreAndPeople(db, storeIndex, passwordHash, usedPersonnelNames) {
    const identity = storeIdentity(storeIndex);
    const rng = createRng(`${CONFIG.runTag}:people:${storeIndex}`);
    const ownerName = realisticName(rng, usedPersonnelNames);

    const [storeResult] = await db.execute(
        `INSERT INTO stores
         (store_name, owner_name, email, password, slug)
         VALUES (?, ?, ?, ?, ?)`,
        [identity.name, ownerName, identity.ownerEmail, passwordHash, identity.slug]
    );

    const storeId = Number(storeResult.insertId);
    const branches = [];
    const branchLabels = ["Main Retail Branch", "North Retail Branch", "South Retail Branch"];

    for (let branchIndex = 0; branchIndex < CONFIG.managersPerStore; branchIndex += 1) {
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

    for (let managerIndex = 0; managerIndex < CONFIG.managersPerStore; managerIndex += 1) {
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
        {
            dashboard: true, bookings: true, packages: true, packages_manage: false,
            inventory: false, pos: false, reports: false, staff_management: false,
            staff_roles: false, branch_settings: false,
        },
        {
            dashboard: true, bookings: false, packages: false, packages_manage: false,
            inventory: true, pos: true, reports: false, staff_management: false,
            staff_roles: false, branch_settings: false,
        },
        {
            dashboard: true, bookings: true, packages: false, packages_manage: false,
            inventory: true, pos: true, reports: false, staff_management: false,
            staff_roles: false, branch_settings: false,
        },
    ];

    const staffDistribution = [0, 0, 0, 1, 1, 1];
    const staffRows = [];

    for (let staffIndex = 0; staffIndex < CONFIG.staffPerStore; staffIndex += 1) {
        const managerIndex = staffDistribution[staffIndex];
        const staffName = realisticName(rng, usedPersonnelNames);

        staffRows.push({
            store_id: storeId,
            branch_id: managers[managerIndex].branchId,
            manager_id: managers[managerIndex].id,
            staff_name: staffName,
            staff_email: `${emailSlug(staffName)}.s${identity.code}.e${staffIndex + 1}@${STORE_EMAIL_DOMAIN}`,
            password: passwordHash,
            status: "active",
            permissions: JSON.stringify(staffPermissionProfiles[staffIndex % staffPermissionProfiles.length]),
        });
    }

    await insertRows(db, "staff", staffRows, 10);

    return { storeId, identity, ownerName, branches };
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

async function createProducts(db, storeId, storeIndex, branches) {
    const rng = createRng(`${CONFIG.runTag}:products:${storeIndex}`);
    const rows = [];
    const pendingVariants = [];

    for (let itemIndex = 1; itemIndex <= CONFIG.productsPerStore; itemIndex += 1) {
        const product = productName(storeIndex, itemIndex);
        const hasVariants = itemIndex % 2 === 1;
        const priceVariance = 0.80 + rng() * 0.55;
        const baseSalesPrice = Math.max(35, Math.round((product.basePrice * priceVariance) / 5) * 5);
        const baseOriginalPrice = Math.max(20, Math.round((baseSalesPrice * (0.54 + rng() * 0.18)) / 5) * 5);
        const alertLevel = randomInt(rng, 8, 25);
        const branch = branches[(itemIndex - 1) % branches.length];
        const sku = `${CONFIG.runTag.toUpperCase()}-${String(storeIndex).padStart(3, "0")}-${String(itemIndex).padStart(4, "0")}`;
        const variantTemplates = [];

        if (hasVariants) {
            for (let variantIndex = 0; variantIndex < VARIANTS_PER_PRODUCT; variantIndex += 1) {
                const values = variantValuesForProduct(product, storeIndex, itemIndex, variantIndex);
                const priceMultiplier = 0.92 + variantIndex * 0.12;
                const salesPrice = Math.max(35, Math.round((baseSalesPrice * priceMultiplier) / 5) * 5);
                const originalPrice = Math.max(20, Math.round((baseOriginalPrice * priceMultiplier) / 5) * 5);

                variantTemplates.push({
                    variant_values: JSON.stringify(values),
                    sku: `${sku}-V${String(variantIndex + 1).padStart(2, "0")}`,
                    barcode: String(8900000000000 + storeIndex * 100000 + itemIndex * 10 + variantIndex),
                    stock: productStock(rng, itemIndex + variantIndex),
                    alert_level: Math.max(3, Math.round(alertLevel / 3)),
                    original_price: originalPrice,
                    sales_price: salesPrice,
                    status: "active",
                });
            }
        }

        const stock = hasVariants
            ? variantTemplates.reduce((sum, variant) => sum + variant.stock, 0)
            : productStock(rng, itemIndex);

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
            barcode: `${String(8800000000000 + storeIndex * 10000 + itemIndex)}`,
            name,
            description: hasVariants
                ? `${name}. Direct-sale party supply item available in ${VARIANTS_PER_PRODUCT} realistic variants; not for rental.`
                : `${name}. Direct-sale party supply item; not for rental.`,
            category: product.category,
            stock,
            alert_level: alertLevel,
            original_price: originalPrice,
            sales_price: salesPrice,
            has_variants: hasVariants ? 1 : 0,
            status: "active",
        });

        pendingVariants.push(variantTemplates);
    }

    await insertRows(db, "products", rows);

    const [products] = await db.execute(
        `SELECT id, branch_id, name, category, sales_price, has_variants
         FROM products
         WHERE store_id = ?
         ORDER BY id`,
        [storeId]
    );

    if (products.length !== CONFIG.productsPerStore) {
        throw new Error(`Store ${storeId} expected ${CONFIG.productsPerStore} products but found ${products.length}.`);
    }

    const variantProductCount = products.filter((row) => dbBoolean(row.has_variants)).length;
    const simpleProductCount = products.length - variantProductCount;

    if (variantProductCount !== VARIANT_PRODUCTS_PER_STORE || simpleProductCount !== SIMPLE_PRODUCTS_PER_STORE) {
        throw new Error(
            `Store ${storeId} expected ${VARIANT_PRODUCTS_PER_STORE} variant products and ${SIMPLE_PRODUCTS_PER_STORE} simple products, but found ${variantProductCount} and ${simpleProductCount}.`
        );
    }

    const variantRows = [];
    for (let i = 0; i < products.length; i += 1) {
        const productId = Number(products[i].id);
        for (const template of pendingVariants[i]) {
            variantRows.push({ product_id: productId, ...template });
        }
    }

    await insertRows(db, "product_variants", variantRows, Math.max(CONFIG.batchSize, 800));

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

    const expectedVariantRows = VARIANT_PRODUCTS_PER_STORE * VARIANTS_PER_PRODUCT;
    if (storedVariants.length !== expectedVariantRows) {
        throw new Error(`Store ${storeId} expected ${expectedVariantRows} product variants but found ${storedVariants.length}.`);
    }

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

    return products.map((row) => {
        const id = Number(row.id);
        return {
            id,
            branchId: Number(row.branch_id),
            name: String(row.name),
            category: String(row.category),
            salesPrice: Number(row.sales_price),
            hasVariants: dbBoolean(row.has_variants),
            variants: variantsByProduct.get(id) || [],
        };
    });
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

async function createPackages(db, storeId, storeIndex, branches, products) {
    const rng = createRng(`${CONFIG.runTag}:packages:${storeIndex}`);
    const rows = [];
    const packageData = [];

    for (let index = 0; index < PACKAGE_DEFINITIONS.length; index += 1) {
        const definition = PACKAGE_DEFINITIONS[index];
        const branch = branches[index % branches.length];
        const branchProducts = products.filter((product) => product.branchId === branch.id);
        const categoryMatches = branchProducts.filter((product) =>
            definition.categories.includes(product.category)
        );

        const chosenProducts = selectDistinctProducts(
            rng,
            categoryMatches.length >= definition.itemCount ? categoryMatches : branchProducts,
            definition.itemCount
        );

        const inclusions = chosenProducts.map((product, productIndex) => {
            const selected = saleSelectionForProduct(rng, product);

            return {
                item: selected.saleName,
                productId: selected.id,
                product_id: selected.id,
                variantId: selected.variantId,
                variant_id: selected.variantId,
                variantLabel: selected.variantLabel,
                variant_label: selected.variantLabel,
                quantity: 1 + ((productIndex + index) % 4),
                unitPrice: selected.salesPrice,
                unit_price: selected.salesPrice,
            };
        });

        const originalValue = roundMoney(
            inclusions.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
        );
        const packagePrice = roundMoney(originalValue * (1 - definition.discountRate));

        rows.push({
            store_id: storeId,
            branch_id: branch.id,
            name: definition.name,
            description: `${definition.description} All contents are sold to the customer; no rental items are included.`,
            original_value: originalValue,
            discount_type: "amount",
            discount_value: roundMoney(originalValue - packagePrice),
            package_price: packagePrice,
            duration: "Retail purchase",
            status: "Active",
            inclusions: JSON.stringify(inclusions),
        });

        packageData.push({
            name: definition.name,
            eventType: definition.eventType,
            branchId: branch.id,
            price: packagePrice,
            inclusions,
        });
    }

    await insertRows(db, "packages", rows, 10);

    const [packageRows] = await db.execute(
        `SELECT id, branch_id, name, package_price
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
        };
    });
}

async function createSubscription(db, storeId, enterprisePlan) {
    const start = isoDate(TODAY);
    const end = isoDate(addDays(TODAY, 3650));

    await insertRows(
        db,
        "subscriptions",
        [
            {
                store_id: storeId,
                plan_id: enterprisePlan.id,
                status: "active",
                amount: enterprisePlan.price,
                billing_period: "annual",
                approved_at: sqlDateTime(TODAY, 9, 0, 0),
                starts_at: start,
                ends_at: end,
                admin_notes: `Performance-test subscription for seed run ${CONFIG.runTag}.`,
            },
        ],
        1
    );
}

function buildProductCatalog(products) {
    const byBranch = new Map();

    for (const product of products) {
        if (!byBranch.has(product.branchId)) byBranch.set(product.branchId, []);
        byBranch.get(product.branchId).push(product);
    }

    const popularByBranch = new Map();
    for (const [branchId, branchProducts] of byBranch) {
        popularByBranch.set(branchId, branchProducts.slice(0, Math.min(160, branchProducts.length)));
    }

    return { all: products, byBranch, popularByBranch };
}

function chooseSaleProducts(rng, catalog, branchId, count) {
    const branchProducts = catalog.byBranch.get(branchId) || catalog.all;
    const popularPool = catalog.popularByBranch.get(branchId) || branchProducts;
    const selected = [];
    const selectedIds = new Set();

    while (selected.length < Math.min(count, branchProducts.length)) {
        const pool = rng() < 0.64 ? popularPool : branchProducts;
        const product = randomChoice(rng, pool.length ? pool : branchProducts);
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

async function createHistoricalOrders(db, context, counters) {
    const { storeId, storeIndex, branches, catalog } = context;
    const orderRows = [];
    const orderItemRows = [];
    let cursor = new Date(CONFIG.salesStart.getTime());
    let orderSequence = 0;

    const flush = async () => {
        if (!orderRows.length) return;
        await insertRows(db, "orders", orderRows);
        await insertRows(db, "order_items", orderItemRows, Math.max(CONFIG.batchSize, 800));
        counters.orders += orderRows.length;
        counters.orderItems += orderItemRows.length;
        orderRows.length = 0;
        orderItemRows.length = 0;
    };

    while (cursor <= CONFIG.salesEnd) {
        const dayKey = isoDate(cursor);
        const rng = createRng(`${CONFIG.runTag}:sales:${storeIndex}:${dayKey}`);

        const lambda =
            CONFIG.averageDailyOrders *
            historicalGrowthFactor(cursor) *
            demandMonthFactor(cursor) *
            SALES_DAY_FACTORS[cursor.getUTCDay()] *
            paydayFactor(cursor) *
            specialEventFactor(cursor) *
            (0.88 + rng() * 0.28);

        const orderCount = Math.min(30, poisson(rng, lambda));

        for (let number = 0; number < orderCount; number += 1) {
            orderSequence += 1;
            const branch = branchWeightedChoice(rng, branches);
            const customerName = realisticName(rng);
            const lineCount = orderLineCount(rng);
            const selectedProducts = chooseSaleProducts(rng, catalog, branch.id, lineCount);
            const eventBoost = demandMonthFactor(cursor) >= 1.3 ? 1 : 0;

            const lines = selectedProducts.map((product, lineIndex) => {
                const selected = saleSelectionForProduct(rng, product);
                const quantity = Math.min(
                    20,
                    randomInt(rng, 1, 4 + eventBoost) +
                    (lineIndex === 0 && rng() < 0.22 ? randomInt(rng, 2, 6) : 0)
                );
                const unitPrice = roundMoney(selected.salesPrice * (0.96 + rng() * 0.08));
                return {
                    product: selected,
                    quantity,
                    unitPrice,
                    lineTotal: roundMoney(quantity * unitPrice),
                };
            });

            const total = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
            const compactDate = dayKey.replace(/-/g, "");
            const orderId = `PERF-${String(storeIndex).padStart(3, "0")}-${compactDate}-${String(orderSequence).padStart(6, "0")}`;
            const hour = randomInt(rng, 9, 20);
            const minute = randomInt(rng, 0, 59);

            orderRows.push({
                order_id: orderId,
                store_id: storeId,
                branch_id: branch.id,
                customer_name: customerName,
                item: lines.slice(0, 3).map((line) => `${line.product.saleName} x${line.quantity}`).join(", ").slice(0, 250),
                total,
                order_date: dayKey,
                created_at: sqlDateTime(cursor, hour, minute, randomInt(rng, 0, 59)),
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
                    created_at: sqlDateTime(cursor, hour, minute, randomInt(rng, 0, 59)),
                });
            }

            if (orderRows.length >= CONFIG.batchSize) await flush();
        }

        cursor = addDays(cursor, 1);
    }

    await flush();
}

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

    if (status === "confirmed") {
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
    const { storeId, storeIndex, branches, catalog, packages } = context;
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
            const pool = datePools[period];
            const eventDate = pickWeightedDate(rng, pool);
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

    await createPeriod("historical", CONFIG.historicalBookingsPerStore);
    await createPeriod("near", CONFIG.nearTermBookingsPerStore);
    await createPeriod("long", CONFIG.longTermBookingsPerStore);

    await flush();
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

function printConfiguration() {
    const estimatedOrders = estimateOrdersPerStore();
    const estimatedOrderItems = Math.round(estimatedOrders * 2.9);
    const bookingsPerStore =
        CONFIG.historicalBookingsPerStore +
        CONFIG.nearTermBookingsPerStore +
        CONFIG.longTermBookingsPerStore;
    const estimatedBookingItems = Math.round(bookingsPerStore * 11.5);

    console.log("\nStockNBook demo seeder configuration");
    console.log("------------------------------------");
    console.log(`Run tag:                     ${CONFIG.runTag}`);
    console.log(`Stores:                      ${CONFIG.storeCount.toLocaleString()}`);
    console.log(`Owners:                      ${CONFIG.storeCount.toLocaleString()}`);
    console.log(`Managers:                    ${(CONFIG.storeCount * 3).toLocaleString()}`);
    console.log(`Staff:                       ${(CONFIG.storeCount * 6).toLocaleString()} (3 per first 2 branches/store)`);
    console.log(`Products:                    ${(CONFIG.storeCount * CONFIG.productsPerStore).toLocaleString()}`);
    console.log(`Products with variants:      ${(CONFIG.storeCount * VARIANT_PRODUCTS_PER_STORE).toLocaleString()} (${VARIANT_PRODUCTS_PER_STORE.toLocaleString()} per store)`);
    console.log(`Products without variants:   ${(CONFIG.storeCount * SIMPLE_PRODUCTS_PER_STORE).toLocaleString()} (${SIMPLE_PRODUCTS_PER_STORE.toLocaleString()} per store)`);
    console.log(`Product variant rows:        ${(CONFIG.storeCount * VARIANT_PRODUCTS_PER_STORE * VARIANTS_PER_PRODUCT).toLocaleString()}`);
    console.log(`Packages:                    ${(CONFIG.storeCount * 5).toLocaleString()}`);
    console.log(`Sales period:                ${isoDate(CONFIG.salesStart)} to ${isoDate(CONFIG.salesEnd)}`);
    console.log(`Estimated POS orders:        ${(estimatedOrders * CONFIG.storeCount).toLocaleString()}`);
    console.log(`Estimated POS order items:   ${(estimatedOrderItems * CONFIG.storeCount).toLocaleString()}`);
    console.log(`Bookings/store:              ${bookingsPerStore.toLocaleString()} realistic mix (completed-heavy history + active upcoming pipeline)`);
    console.log(`Total bookings:              ${(bookingsPerStore * CONFIG.storeCount).toLocaleString()}`);
    console.log(`Estimated booking items:     ${(estimatedBookingItems * CONFIG.storeCount).toLocaleString()}`);
    console.log(`Batch size:                  ${CONFIG.batchSize}`);
    console.log(`Create query indexes:        ${CONFIG.createIndexes}`);
    console.log(`Reset matching seed run:     ${CONFIG.resetExistingRun}`);
    console.log(`Default test password:       ${CONFIG.defaultPassword}`);
    console.log("");
}

async function main() {
    printConfiguration();

    if (CONFIG.dryRun) {
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
        packages: 0,
        orders: 0,
        orderItems: 0,
        bookings: 0,
        bookingItems: 0,
    };

    try {
        await ensureSeederSchema(db);
        await ensureSeederLookupIndexes(db);
        await removeExistingSeedRun(db);

        const enterprisePlan = await ensureEnterprisePlan(db);
        const passwordHash = await bcrypt.hash(CONFIG.defaultPassword, 10);
        const usedPersonnelNames = new Set();
        const datePools = buildDatePools();

        for (let storeIndex = 1; storeIndex <= CONFIG.storeCount; storeIndex += 1) {
            const startedAt = Date.now();
            const identity = storeIdentity(storeIndex);
            console.log(`[${storeIndex}/${CONFIG.storeCount}] Seeding ${identity.name}...`);

            await db.beginTransaction();

            try {
                const store = await createStoreAndPeople(db, storeIndex, passwordHash, usedPersonnelNames);
                counters.stores += 1;
                counters.managers += CONFIG.managersPerStore;
                counters.staff += CONFIG.staffPerStore;

                await createCategories(db, store.storeId);

                const products = await createProducts(db, store.storeId, storeIndex, store.branches);
                counters.products += products.length;
                counters.productVariants += products.reduce(
                    (sum, product) => sum + product.variants.length,
                    0
                );

                const productCatalog = buildProductCatalog(products);

                const packages = await createPackages(
                    db,
                    store.storeId,
                    storeIndex,
                    store.branches,
                    products
                );
                counters.packages += packages.length;

                await createSubscription(db, store.storeId, enterprisePlan);

                await createHistoricalOrders(
                    db,
                    {
                        storeId: store.storeId,
                        storeIndex,
                        branches: store.branches,
                        catalog: productCatalog,
                    },
                    counters
                );

                await createBookings(
                    db,
                    {
                        storeId: store.storeId,
                        storeIndex,
                        branches: store.branches,
                        catalog: productCatalog,
                        packages,
                    },
                    datePools,
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
        console.log(`Packages:        ${counters.packages.toLocaleString()}`);
        console.log(`POS orders:      ${counters.orders.toLocaleString()}`);
        console.log(`POS order items: ${counters.orderItems.toLocaleString()}`);
        console.log(`Bookings:        ${counters.bookings.toLocaleString()}`);
        console.log(`Booking items:   ${counters.bookingItems.toLocaleString()}`);
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
    VARIANT_PRODUCTS_PER_STORE,
    SIMPLE_PRODUCTS_PER_STORE,
    VARIANTS_PER_PRODUCT,
    estimateOrdersPerStore,
};