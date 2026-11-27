/** Date helpers. Dates are 'YYYY-MM-DD' strings in Philippine local time (no time-zone shifts). */
const DAY_MS = 86400000;

const toUtc = (d) => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

function addDays(date, days) { return fromUtc(toUtc(date) + days * DAY_MS); }
function diffDays(from, to) { return Math.round((toUtc(to) - toUtc(from)) / DAY_MS); }
function dayOfWeek(date) { return new Date(toUtc(date)).getUTCDay(); } // 0 = Sunday
function monthKey(date) { return date.slice(0, 7); }
function monthStart(date) { return `${date.slice(0, 7)}-01`; }
function addMonths(date, months) {
    const d = new Date(toUtc(monthStart(date)));
    d.setUTCMonth(d.getUTCMonth() + months);
    return fromUtc(d.getTime());
}
function daysInMonth(date) {
    const d = new Date(toUtc(monthStart(date)));
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}
function lastDayOfMonth(date) { return `${date.slice(0, 8)}${String(daysInMonth(date)).padStart(2, "0")}`; }

const pad = (n) => String(n).padStart(2, "0");
/** 'YYYY-MM-DD HH:MM:SS' */
function dt(date, hour = 9, minute = 0, second = 0) {
    return `${date} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}
function minutesToTime(totalMinutes) {
    const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
    return [Math.floor(m / 60), m % 60];
}
function eachDay(from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
}

module.exports = { addDays, diffDays, dayOfWeek, monthKey, monthStart, addMonths, daysInMonth, lastDayOfMonth,
    dt, minutesToTime, eachDay, pad };
