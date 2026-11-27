/* eslint-disable @typescript-eslint/no-require-imports */
/** categories, products, product_variants, equipment, and the branch_inventory row ids. */
const V = require("../lib/vocab");
const { dt } = require("../lib/dates");

// [category, perishable, bookable (may go into packages / custom bookings)]
const PRODUCT_CATEGORIES = [
    ["Balloons", false, true], ["Backdrops", false, true], ["Tables & Chairs", false, true], ["Linens & Covers", false, true],
    ["Decorations", false, true], ["Party Favors", false, true], ["Catering / Food", true, false], ["Cake & Desserts", true, false],
    ["Lights & Sounds", false, true], ["Costumes & Props", false, true], ["Candles & Accessories", false, true],
    ["Miscellaneous", false, false],
];
const EQUIPMENT_CATEGORIES = ["Tables & Chairs", "Tents & Canopies", "Lights & Sounds", "Backdrops & Stands", "Catering Equipment"];

// [category, base name, unit, price range, variant dimension or null, demand: high|medium|slow]
const PRODUCT_TEMPLATES = [
    ["Balloons", "Latex Balloons 12in (50 pcs)", "pack", [180, 320], "Color", "high"],
    ["Balloons", "Foil Number Balloon 32in", "piece", [90, 160], "Color", "high"],
    ["Balloons", "Confetti Balloons (10 pcs)", "pack", [150, 260], "Color", "medium"],
    ["Balloons", "Heart Foil Balloon 18in", "piece", [60, 120], "Color", "medium"],
    ["Balloons", "Balloon Garland Kit", "set", [450, 900], "Color", "medium"],
    ["Balloons", "Balloon Ribbon Roll", "roll", [35, 80], null, "high"],
    ["Backdrops", "Fabric Backdrop Cloth 2x3m", "piece", [650, 1400], "Color", "slow"],
    ["Backdrops", "Happy Birthday Banner", "piece", [120, 250], "Color", "high"],
    ["Backdrops", "Sequin Shimmer Wall Panel", "piece", [220, 420], "Color", "medium"],
    ["Backdrops", "Foil Fringe Curtain", "piece", [80, 160], "Color", "high"],
    ["Tables & Chairs", "Chair Cover Spandex", "piece", [45, 90], "Color", "medium"],
    ["Tables & Chairs", "Chair Sash Satin", "piece", [20, 45], "Color", "medium"],
    ["Tables & Chairs", "Table Skirting 14ft", "piece", [380, 650], "Color", "slow"],
    ["Linens & Covers", "Round Tablecloth 120in", "piece", [280, 520], "Color", "medium"],
    ["Linens & Covers", "Table Runner Satin", "piece", [90, 180], "Color", "medium"],
    ["Linens & Covers", "Cloth Napkins (12 pcs)", "pack", [180, 320], "Color", "slow"],
    ["Decorations", "Paper Pom-Pom Set", "set", [150, 300], "Color", "high"],
    ["Decorations", "Centerpiece Flower Arrangement", "piece", [350, 750], null, "medium"],
    ["Decorations", "Fairy String Lights 10m", "piece", [180, 350], null, "high"],
    ["Decorations", "Paper Lantern Set", "set", [200, 380], "Color", "medium"],
    ["Decorations", "Cake Topper", "piece", [80, 180], null, "high"],
    ["Decorations", "Photo Booth Props (20 pcs)", "set", [220, 420], null, "medium"],
    ["Party Favors", "Loot Bags (12 pcs)", "pack", [120, 240], "Color", "high"],
    ["Party Favors", "Party Hats (12 pcs)", "pack", [90, 180], "Color", "high"],
    ["Party Favors", "Party Blowers (24 pcs)", "pack", [80, 150], null, "high"],
    ["Party Favors", "Souvenir Keychains (25 pcs)", "pack", [300, 600], null, "medium"],
    ["Party Favors", "Thank-You Tags (50 pcs)", "pack", [90, 180], null, "medium"],
    ["Catering / Food", "Party Chips Assorted (12 packs)", "box", [240, 380], null, "high"],
    ["Catering / Food", "Juice Drinks (24 pcs)", "box", [260, 420], null, "high"],
    ["Catering / Food", "Lollipop Jar (50 pcs)", "pack", [180, 320], null, "medium"],
    ["Catering / Food", "Chocolate Coins (100 pcs)", "pack", [220, 380], null, "medium"],
    ["Cake & Desserts", "Cupcakes (12 pcs)", "tray", [420, 720], null, "medium"],
    ["Cake & Desserts", "Mini Donuts (24 pcs)", "tray", [280, 480], null, "medium"],
    ["Cake & Desserts", "Cake Pops (12 pcs)", "tray", [360, 600], null, "slow"],
    ["Lights & Sounds", "LED Neon Sign", "piece", [900, 1800], "Color", "slow"],
    ["Lights & Sounds", "Party Glow Sticks (50 pcs)", "pack", [150, 300], null, "high"],
    ["Costumes & Props", "Party Masks (12 pcs)", "pack", [180, 360], null, "medium"],
    ["Costumes & Props", "Tiara and Sash Set", "set", [150, 300], "Color", "medium"],
    ["Costumes & Props", "Mascot Head Prop", "piece", [800, 1600], null, "slow"],
    ["Candles & Accessories", "Number Candle", "piece", [35, 70], "Color", "high"],
    ["Candles & Accessories", "Sparkler Candles (10 pcs)", "pack", [60, 120], null, "high"],
    ["Candles & Accessories", "Scented Pillar Candle", "piece", [120, 260], "Color", "slow"],
    ["Miscellaneous", "Paper Plates (25 pcs)", "pack", [90, 160], "Color", "high"],
    ["Miscellaneous", "Plastic Cups (50 pcs)", "pack", [80, 140], null, "high"],
    ["Miscellaneous", "Party Tape and Adhesive Dots", "pack", [45, 90], null, "medium"],
];
// Seasonal products: [category, name, unit, price range, variant dimension, demand, season, peak lift].
// They sell a little all year and many times more in their season (see lib/demand.js).
const SEASONAL_TEMPLATES = [
    ["Balloons", "Valentine Heart Balloon Bouquet", "set", [250, 450], "Color", "medium", "valentine", 9],
    ["Balloons", "Graduation Balloon Set", "set", [220, 420], null, "medium", "graduation", 7],
    ["Backdrops", "Congrats Grad Banner", "piece", [120, 240], null, "medium", "graduation", 8],
    ["Decorations", "Fiesta Banderitas (50m)", "roll", [180, 350], "Color", "medium", "fiesta", 8],
    ["Costumes & Props", "Kids Halloween Costume", "piece", [350, 750], null, "slow", "halloween", 22],
    ["Decorations", "Halloween Pumpkin and Bat Decor Set", "set", [180, 380], null, "slow", "halloween", 22],
    ["Party Favors", "Trick-or-Treat Bags (12 pcs)", "pack", [90, 180], null, "medium", "halloween", 16],
    ["Balloons", "Christmas Balloon Set", "set", [200, 400], null, "medium", "christmas", 8],
    ["Decorations", "Christmas Curtain Lights", "piece", [250, 500], null, "medium", "christmas", 9],
    ["Party Favors", "Christmas Party Giveaways (25 pcs)", "pack", [350, 650], null, "medium", "christmas", 9],
    ["Party Favors", "New Year Horns and Hats Kit", "set", [150, 300], null, "medium", "newyear", 30],
    ["Decorations", "Campaign Buntings (50m)", "roll", [250, 450], "Color", "slow", "election", 25],
    ["Balloons", "Campaign Balloons (100 pcs)", "pack", [380, 650], "Color", "slow", "election", 25],
    ["Backdrops", "Event Tarpaulin Stand Banner", "piece", [300, 600], null, "slow", "election", 12],
];
const THEMES = ["", "Unicorn", "Safari", "Princess", "Superhero", "Floral", "Minimalist", "Rose Gold", "Pastel", "Mermaid",
    "Dinosaur", "Outer Space", "Rustic", "Tropical", "Under the Sea", "Hollywood", "Vintage", "Boho", "Glam Gold", "Rainbow",
    "Fairy Garden", "Carnival", "K-Pop", "Barnyard", "Winter Wonderland", "Neon Party", "Baby Blue", "Blush Pink", "Sports Fan",
    "Pirate", "Construction", "Racing", "Ballerina", "Jungle", "Cowboy", "Royal", "Candyland"];
const VARIANT_VALUES = {
    Color: ["Red", "Blue", "Pink", "Gold", "Silver", "White", "Black", "Pastel Mix", "Rose Gold", "Lavender"],
};
// [category, name, rental rate/day range, units per branch range]
const EQUIPMENT_TEMPLATES = [
    ["Tables & Chairs", "Monobloc Chair", [15, 25], [120, 220]], ["Tables & Chairs", "Tiffany Chair", [45, 80], [60, 120]],
    ["Tables & Chairs", "Round Table (8-seater)", [180, 300], [15, 30]], ["Tables & Chairs", "Rectangular Banquet Table", [150, 250], [12, 24]],
    ["Tables & Chairs", "Kiddie Table and Chair Set", [250, 400], [8, 16]], ["Tents & Canopies", "Party Tent 3x3m", [1200, 2000], [3, 8]],
    ["Tents & Canopies", "Canopy 5x10m", [3000, 4500], [2, 4]], ["Lights & Sounds", "LED Par Light", [250, 400], [8, 20]],
    ["Lights & Sounds", "Fog Machine", [600, 900], [2, 5]], ["Lights & Sounds", "Sound System Set", [2500, 3500], [2, 4]],
    ["Lights & Sounds", "Wireless Microphone", [300, 500], [4, 10]], ["Backdrops & Stands", "Arch Backdrop Stand", [500, 800], [4, 8]],
    ["Backdrops & Stands", "Hexagon Backdrop Frame", [700, 1000], [3, 6]], ["Backdrops & Stands", "Photo Booth Frame", [900, 1500], [2, 4]],
    ["Backdrops & Stands", "Red Carpet Runner 10m", [500, 800], [3, 6]], ["Backdrops & Stands", "Stanchion Post Set", [400, 600], [4, 8]],
    ["Catering Equipment", "Chafing Dish", [250, 400], [10, 24]], ["Catering Equipment", "Beverage Dispenser", [200, 350], [6, 12]],
    ["Catering Equipment", "Cake Stand Set", [250, 450], [4, 10]], ["Catering Equipment", "Dessert Table Display", [600, 900], [3, 6]],
    ["Lights & Sounds", "Projector and Screen", [1500, 2500], [2, 3]], ["Catering Equipment", "Electric Stand Fan", [250, 350], [6, 14]],
    ["Lights & Sounds", "Generator Set 5kVA", [3000, 4500], [1, 2]], ["Tables & Chairs", "Cocktail High Table", [200, 350], [8, 16]],
];

const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

function buildCatalog({ ctx, ids, rng }) {
    return (async () => {
        const { store, branches, storeStart } = ctx;
        const created = dt(storeStart, 10, 0);
        const mainCode = branches[0].branch_code;
        const categories = [], products = [], variants = [], equipment = [];
        const productCategory = {}, equipmentCategory = {};
        for (const [name, perishable, bookable] of PRODUCT_CATEGORIES) {
            const id = await ids.take("categories");
            productCategory[name] = { id, perishable, bookable };
            categories.push({ id, store_id: store.id, category_name: name, category_type: V.CATEGORY_TYPE.PRODUCT, status: "active",
                created_at: created, updated_at: created });
        }
        for (const name of EQUIPMENT_CATEGORIES) {
            const id = await ids.take("categories");
            equipmentCategory[name] = id;
            categories.push({ id, store_id: store.id, category_name: name, category_type: V.CATEGORY_TYPE.EQUIPMENT, status: "active",
                created_at: created, updated_at: created });
        }

        // Products: the seasonal products first, then template × theme until the plan-sized count is reached.
        const sources = [...SEASONAL_TEMPLATES.map((t) => ["", t]), ...THEMES.flatMap((theme) => PRODUCT_TEMPLATES.map((t) => [theme, t]))];
        const wanted = Math.min(ctx.productCount, sources.length);
        let seq = 0;
        {
            for (const [theme, [category, base, unit, [lo, hi], dimension, demand, season = null, seasonLift = 0]] of sources) {
                if (products.length >= wanted) break;
                seq += 1;
                const id = await ids.take("products");
                const productNumber = `${store.store_code}-${mainCode}-PRD-${String(seq).padStart(4, "0")}`;
                const name = theme ? `${theme} ${base}` : base;
                const cat = productCategory[category];
                const hasVariants = Boolean(dimension) && rng.chance(0.45);
                const basePrice = round5(rng.int(lo, hi));
                const product = { id, store_id: store.id, category_id: cat.id, product_number: productNumber, product_name: name,
                    description: `${name} for parties and events.`, has_variants: hasVariants ? 1 : 0, next_variant_sequence: 1,
                    status: "active", created_at: created, updated_at: created, deleted_at: null,
                    // seeding-only metadata (not inserted)
                    _demand: demand, _perishable: cat.perishable, _bookable: cat.bookable, _category: category,
                    _season: season, _seasonLift: seasonLift };
                products.push(product);
                const makeVariant = async (variantName, attributes, number, isDefault, priceFactor) => {
                    const price = round5(basePrice * priceFactor);
                    const cost = Math.max(1, Math.round(price * (0.5 + rng.next() * 0.18)));
                    const markup = rng.chance(0.3);
                    const v = { id: await ids.take("product_variants"), store_id: store.id, product_id: id, variant_number: number,
                        variant_name: variantName, attributes: attributes ? JSON.stringify(attributes) : null, unit_of_measure: unit,
                        is_default: isDefault ? 1 : 0, selling_price: price, cost_price: cost,
                        pricing_method: markup ? "markup" : "manual",
                        markup_percentage: markup ? Math.round(((price / cost) - 1) * 10000) / 100 : null,
                        status: "active", created_at: created, updated_at: created, deleted_at: null,
                        _product: product };
                    variants.push(v);
                    return v;
                };
                if (hasVariants) {
                    const values = rng.sample(VARIANT_VALUES[dimension], rng.int(2, 4));
                    for (let i = 0; i < values.length; i += 1)
                        await makeVariant(values[i], { [dimension]: values[i] }, `${productNumber}-V${String(i + 1).padStart(2, "0")}`,
                            false, 1 + (rng.next() - 0.5) * 0.2);
                    product.next_variant_sequence = values.length + 1;
                } else {
                    // Every v2 product has a hidden default variant with the product's own name and number.
                    await makeVariant(name, null, productNumber, true, 1);
                }
            }
        }

        const equipmentWanted = Math.min(ctx.equipmentCount, EQUIPMENT_TEMPLATES.length * 3);
        const sizes = ["", "Premium ", "Deluxe "];
        let eseq = 0;
        for (const size of sizes) {
            for (const [category, base, [lo, hi], units] of EQUIPMENT_TEMPLATES) {
                if (equipment.length >= equipmentWanted) break;
                eseq += 1;
                const rate = round5(rng.int(lo, hi) * (size ? 1.4 : 1));
                equipment.push({ id: await ids.take("equipment"), store_id: store.id, category_id: equipmentCategory[category],
                    equipment_number: `${store.store_code}-${mainCode}-EQP-${String(eseq).padStart(4, "0")}`,
                    equipment_name: `${size}${base}`, description: `${size}${base} for event rental.`, rental_rate_per_day: rate,
                    cost_price: round5(rate * rng.int(8, 16)), status: "active", created_at: created, updated_at: created, deleted_at: null,
                    _units: units, _base: base });
            }
        }

        // One branch_inventory row per (branch, variant) and per (branch, equipment), as the unique keys require.
        const inventory = [];
        for (const branch of branches) {
            for (const v of variants) inventory.push({ id: await ids.take("branch_inventory"), branchId: branch.id, variant: v, equipment: null });
            for (const e of equipment) inventory.push({ id: await ids.take("branch_inventory"), branchId: branch.id, variant: null, equipment: e });
        }
        return { categories, products, variants, equipment, inventory };
    })();
}

/** Strip seeding-only fields (those starting with "_") before inserting. */
function dbRow(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) if (!k.startsWith("_")) out[k] = v;
    return out;
}

module.exports = { buildCatalog, dbRow };
