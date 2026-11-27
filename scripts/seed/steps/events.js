/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * store_events: the store's calendar of events that change demand. Forecasting compares an
 * upcoming event with the same event in past years (for example the next election with the last one).
 *
 * Seeded for every store (all branches):
 *   - elections from SEED_ELECTIONS (the 90-day campaign up to election day) and the next one
 *     (same day three years later), matching the campaign sales in lib/demand.js
 *   - Christmas Season (Dec 1–24), Halloween (Oct 15–31), Graduation Season (Mar 15–May 15)
 *     and Town Fiesta Season (May) for each year of history, plus the next one of each
 */
const { CONFIG } = require("../lib/config");
const V = require("../lib/vocab");
const { addDays, addMonths, dt } = require("../lib/dates");
const { ELECTIONS } = require("../lib/demand");

// The second Monday of May (Philippine national and local elections), three years later.
function nextElection(date) {
    const year = Number(date.slice(0, 4)) + 3;
    const first = new Date(Date.UTC(year, 4, 1)).getUTCDay(); // 0 = Sunday
    const firstMonday = 1 + ((8 - first) % 7);
    return `${year}-05-${String(firstMonday + 7).padStart(2, "0")}`;
}

const YEARLY = [
    { name: "Christmas Season", type: "holiday", start: "12-01", end: "12-24", notes: "Christmas parties and gift giveaways." },
    { name: "Halloween", type: "holiday", start: "10-15", end: "10-31", notes: "Costumes, decorations and trick-or-treat parties." },
    { name: "Graduation Season", type: "school", start: "03-15", end: "05-15", notes: "Graduation and moving-up parties." },
    { name: "Town Fiesta Season", type: "local_event", start: "05-01", end: "05-31", notes: "Barangay and town fiestas." },
];

function buildEvents({ ctx, ids, rng }) {
    return (async () => {
        const today = CONFIG.today;
        const historyStart = addMonths(today, -CONFIG.historyMonths);
        const owner = ctx.users.find((u) => u.role === V.ROLE.OWNER);
        const events = [];
        const add = async (name, type, start, end, notes) => {
            const created = start <= today ? addDays(start, -rng.int(5, 20)) : addDays(today, -rng.int(1, 20));
            const createdDate = created < ctx.storeStart ? ctx.storeStart : created > today ? today : created;
            events.push({ id: await ids.take("store_events"), store_id: ctx.store.id, branch_id: null, event_name: name,
                event_type: type, start_date: start, end_date: end, notes, created_by: owner ? owner.id : null,
                created_at: dt(createdDate, 9, rng.int(0, 59)), updated_at: dt(createdDate, 9, 59), deleted_at: null });
        };

        // Elections: the campaign period (90 days) up to election day, plus the next election.
        const electionDays = [...ELECTIONS];
        const last = electionDays[electionDays.length - 1];
        if (last) {
            let next = nextElection(last);
            while (next <= today) next = nextElection(next);
            electionDays.push(next);
        }
        for (const day of electionDays) {
            const start = addDays(day, -90);
            if (start < historyStart) continue;
            await add(`${day.slice(0, 4)} National and Local Elections`, "election", start, day,
                "Campaign period up to election day: rallies, buntings, balloons, sound systems, tents and chairs.");
        }

        // Yearly seasons for every year of history, plus the next one of each.
        for (const e of YEARLY) {
            for (let year = Number(historyStart.slice(0, 4)); year <= Number(today.slice(0, 4)) + 1; year += 1) {
                const start = `${year}-${e.start}`, end = `${year}-${e.end}`;
                if (start < historyStart) continue;
                if (start > today && events.some((x) => x.event_name === e.name && x.start_date > today)) continue;
                await add(e.name, e.type, start, end, e.notes);
            }
        }
        events.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
        return events;
    })();
}

module.exports = { buildEvents, nextElection };
