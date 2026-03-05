// Core configuration & assumptions

const DEFAULT_MEETING_DURATION_MIN = 30;

const DAY_NAME_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const PERIOD_DEFINITIONS = {
  morning: { startHour: 9, endHour: 12 },
  "early afternoon": { startHour: 13, endHour: 15 },
  afternoon: { startHour: 13, endHour: 17 },
  "late afternoon": { startHour: 16, endHour: 18 },
  evening: { startHour: 18, endHour: 21 },
};

// Utility helpers

function parseJsonInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error("Could not parse transcripts JSON. Please check the format.");
  }
}

function normaliseText(text) {
  return text
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCallInfoDate(callInfo) {
  if (!callInfo) return null;
  const parts = callInfo.split("–");
  const datePart = parts[parts.length - 1].trim();
  const d = new Date(datePart);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

function startOfWeek(date) {
  const d = new Date(date.getTime());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function cloneWithTime(baseDate, hours, minutes) {
  const d = new Date(baseDate.getTime());
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function formatDateTimeRange(start, end) {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateFormatter.format(start)} • ${timeFormatter.format(
    start,
  )}–${timeFormatter.format(end)}`;
}

function minutesBetween(start, end) {
  return (end.getTime() - start.getTime()) / 60000;
}

// Interval helpers

function intersectIntervals(a, b) {
  const start = new Date(Math.max(a.start.getTime(), b.start.getTime()));
  const end = new Date(Math.min(a.end.getTime(), b.end.getTime()));
  if (end <= start) return null;
  return { start, end };
}

// Extraction logic

function getNextWeekReference(callDate) {
  const currentWeekStart = startOfWeek(callDate);
  const nextWeekStart = addDays(currentWeekStart, 7);
  return nextWeekStart;
}

function getWeekReference(callDate, modifier) {
  if (modifier === "next") {
    return getNextWeekReference(callDate);
  }
  if (modifier === "this") {
    return startOfWeek(callDate);
  }
  return startOfWeek(callDate);
}

function getDateForNamedDay(weekStart, dayName) {
  const idx = DAY_NAME_TO_INDEX[dayName.toLowerCase()];
  if (idx == null) return null;
  const mondayIndex = 1;
  const diff = idx - mondayIndex;
  return addDays(weekStart, diff);
}

function parseTimeToken(token) {
  const m = token
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];

  if (ampm) {
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }
  return { hour, minute };
}

function parseExplicitTimeRange(text, baseDate) {
  const rangeRegex =
    /(between|from)\s+([\d:apm\s]+)\s*(and|-|to)\s*([\d:apm\s]+)(?!\s*(am|pm))/i;
  const m = text.match(rangeRegex);
  if (!m) return null;

  const startToken = m[2];
  const endToken = m[4];
  const startTime = parseTimeToken(startToken);
  const endTime = parseTimeToken(endToken);
  if (!startTime || !endTime) return null;

  const start = cloneWithTime(baseDate, startTime.hour, startTime.minute);
  const end = cloneWithTime(baseDate, endTime.hour, endTime.minute);
  if (end <= start) return null;
  return { start, end };
}

function getPeriodRange(periodKey, baseDate) {
  const def = PERIOD_DEFINITIONS[periodKey];
  if (!def) return null;
  return {
    start: cloneWithTime(baseDate, def.startHour, 0),
    end: cloneWithTime(baseDate, def.endHour, 0),
  };
}

function inferPeriodFromText(text, baseDate) {
  const t = text.toLowerCase();
  if (t.includes("late afternoon")) return getPeriodRange("late afternoon", baseDate);
  if (t.includes("early afternoon")) return getPeriodRange("early afternoon", baseDate);
  if (t.includes("afternoon")) return getPeriodRange("afternoon", baseDate);
  if (t.includes("morning")) return getPeriodRange("morning", baseDate);
  if (t.includes("evening")) return getPeriodRange("evening", baseDate);
  return null;
}

function containsNegative(text) {
  const t = text.toLowerCase();
  return (
    t.includes("doesn't work") ||
    t.includes("doesnt work") ||
    t.includes("not free") ||
    t.includes("can't") ||
    t.includes("cannot") ||
    t.includes("is out") ||
    t.includes("is out completely")
  );
}

function extractDayMentions(text) {
  const days = Object.keys(DAY_NAME_TO_INDEX);
  const lower = text.toLowerCase();
  const found = [];
  for (const day of days) {
    if (lower.includes(day)) {
      found.push(day);
    }
  }
  return found;
}

function extractWeekModifier(text) {
  const t = text.toLowerCase();
  if (t.includes("next week")) return "next";
  if (t.includes("this week")) return "this";
  return null;
}

function extractAvailabilityIntervalsFromUtterance(text, callDate) {
  const normalized = normaliseText(text);
  const weekModifier = extractWeekModifier(normalized);
  const weekRef = getWeekReference(callDate, weekModifier);
  const dayNames = extractDayMentions(normalized);

  const explicitRange = parseExplicitTimeRange(normalized, weekRef);
  const periodRange = inferPeriodFromText(normalized, weekRef);

  const intervals = [];

  if (containsNegative(normalized)) {
    return intervals;
  }

  const pickRange = () => {
    if (explicitRange) return explicitRange;
    if (periodRange) return periodRange;
    return {
      start: cloneWithTime(weekRef, 9, 0),
      end: cloneWithTime(weekRef, 18, 0),
    };
  };

  if (dayNames.length > 0) {
    for (const dayName of dayNames) {
      const dateForDay = getDateForNamedDay(weekRef, dayName);
      if (!dateForDay) continue;
      const baseRange = pickRange();
      const start = cloneWithTime(
        dateForDay,
        baseRange.start.getHours(),
        baseRange.start.getMinutes(),
      );
      const end = cloneWithTime(
        dateForDay,
        baseRange.end.getHours(),
        baseRange.end.getMinutes(),
      );
      intervals.push({
        start,
        end,
        meta: {
          dayName,
          weekModifier: weekModifier || "this/unspecified",
          sourceText: text,
        },
      });
    }
  } else if (weekModifier) {
    const baseRange = pickRange();
    const start = cloneWithTime(
      weekRef,
      baseRange.start.getHours(),
      baseRange.start.getMinutes(),
    );
    const end = cloneWithTime(
      weekRef,
      baseRange.end.getHours(),
      baseRange.end.getMinutes(),
    );
    intervals.push({
      start,
      end,
      meta: {
        dayName: "week-level",
        weekModifier,
        sourceText: text,
      },
    });
  }

  return intervals;
}

function buildParticipantAvailabilities(transcript) {
  const callDate = parseCallInfoDate(transcript.call_info) || new Date();
  const perParticipant = new Map();

  for (const turn of transcript.dialogue || []) {
    const speaker = turn.speaker || "Unknown";
    const text = turn.text || "";
    const intervals = extractAvailabilityIntervalsFromUtterance(text, callDate);
    if (!intervals.length) continue;

    const arr = perParticipant.get(speaker) || [];
    for (const iv of intervals) {
      const sourceText = iv.meta && iv.meta.sourceText ? iv.meta.sourceText : text;
      arr.push({
        start: iv.start,
        end: iv.end,
        sourceText: sourceText,
      });
    }
    perParticipant.set(speaker, arr);
  }

  return perParticipant;
}

function computeCommonSlots(perParticipant, meetingDurationMin = DEFAULT_MEETING_DURATION_MIN) {
  const participants = Array.from(perParticipant.keys());
  if (participants.length < 2) return [];

  const intervalsByParticipant = participants.map((p) =>
    (perParticipant.get(p) || []).slice().sort((a, b) => a.start - b.start),
  );

  let common = intervalsByParticipant[0].map((iv) => ({
    start: new Date(iv.start),
    end: new Date(iv.end),
  }));

  for (let i = 1; i < intervalsByParticipant.length; i++) {
    const nextIntervals = intervalsByParticipant[i];
    const newCommon = [];
    for (const c of common) {
      for (const n of nextIntervals) {
        const inter = intersectIntervals(c, n);
        if (!inter) continue;
        if (minutesBetween(inter.start, inter.end) >= meetingDurationMin) {
          newCommon.push(inter);
        }
      }
    }
    common = newCommon;
    if (!common.length) break;
  }

  common.sort((a, b) => a.start - b.start);
  return common;
}

// ICS generation

function formatDateToICS(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function generateIcsForSlot(slot, summary, description) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@mova-local`;
  const dtStart = formatDateToICS(slot.start);
  const dtEnd = formatDateToICS(slot.end);
  const dtStamp = formatDateToICS(new Date());

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MOVA//Availability Assistant//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

