/**
 * Deterministic random numbers: the same SEED_RUN_TAG always produces the same data,
 * which makes bugs reproducible for the whole team.
 */
function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function createRng(seedText) {
    let a = hashString(String(seedText)) || 1;
    const next = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = {
        next,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        chance: (p) => next() < p,
        pick: (list) => list[Math.floor(next() * list.length)],
        weighted(pairs) { // [[value, weight], ...]
            const total = pairs.reduce((s, [, w]) => s + w, 0);
            let roll = next() * total;
            for (const [value, weight] of pairs) { roll -= weight; if (roll <= 0) return value; }
            return pairs[pairs.length - 1][0];
        },
        poisson(lambda) {
            if (lambda <= 0) return 0;
            if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (next() + next() + next() - 1.5) * 2));
            const limit = Math.exp(-lambda);
            let k = 0, p = 1;
            do { k += 1; p *= next(); } while (p > limit);
            return k - 1;
        },
        sample(list, count) {
            const copy = list.slice();
            for (let i = copy.length - 1; i > 0; i -= 1) {
                const j = Math.floor(next() * (i + 1));
                [copy[i], copy[j]] = [copy[j], copy[i]];
            }
            return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
        },
        token(length) {
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            let s = "";
            for (let i = 0; i < length; i += 1) s += chars[Math.floor(next() * chars.length)];
            return s;
        },
    };
    return rng;
}

const FIRST_NAMES = ["Maria", "Jose", "Juan", "Ana", "Mark", "Angelica", "John Paul", "Kristine", "Michael", "Camille",
    "Christian", "Patricia", "Joshua", "Nicole", "Carlo", "Bea", "Miguel", "Jasmine", "Rafael", "Andrea", "Paolo", "Trisha",
    "Gabriel", "Danica", "Vincent", "Hannah", "Kevin", "Erica", "Ramon", "Liza", "Joaquin", "Sofia", "Daniel", "Isabel",
    "Francis", "Katrina", "Noel", "Rowena", "Emmanuel", "Charmaine", "Jerome", "Grace", "Adrian", "Melissa", "Ivan", "Shiela"];
const LAST_NAMES = ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Tomas", "Andrada",
    "Castillo", "Flores", "Villanueva", "Ramos", "Castro", "Rivera", "Aquino", "Navarro", "Salazar", "Mercado", "Dela Cruz",
    "Gonzales", "Lopez", "Fernandez", "Domingo", "Pascual", "Soriano", "Valdez", "Manalo", "Gutierrez", "Aguilar", "Lim",
    "Tan", "Sy", "Dizon", "Panganiban", "Del Rosario", "Agustin", "Marquez", "Samonte"];

function personName(rng) {
    return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function phMobile(rng) {
    const prefixes = ["0917", "0918", "0919", "0920", "0921", "0927", "0928", "0939", "0945", "0956", "0966", "0977", "0995", "0998"];
    let tail = "";
    for (let i = 0; i < 7; i += 1) tail += String(rng.int(0, 9));
    return `${rng.pick(prefixes)}${tail}`;
}

module.exports = { createRng, hashString, personName, phMobile };
