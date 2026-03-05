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
  // Normalise curly apostrophes to plain ones before matching.
  const t = text.toLowerCase().replace(/’/g, "'");
  return (
    t.includes("doesn't work") ||
    t.includes("doesnt work") ||
    t.includes("not free") ||
    t.includes("can't") ||
    t.includes("cannot") ||
    t.includes("is out") ||
    t.includes("is out completely") ||
    t.includes("fully booked") ||
    t.includes("booked until")
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

function splitIntoClauses(normalized) {
  return normalized
    .split(/[.!?]/)
    .map(function (part) {
      return part.trim();
    })
    .filter(function (part) {
      return part.length > 0;
    });
}

function clauseHasFlexibilityPhrase(text) {
  const t = text.toLowerCase();
  return t.includes("flexible on times") || t.includes("fairly open");
}

// Detect constraints like "nothing before 10am" / "not before 10am"
function extractEarliestTimeConstraint(normalized) {
  const t = normalized.replace(/’/g, "'");
  const re =
    /(?:nothing|not|wouldn'?t|won't|wont)\s+(?:be\s+)?(?:free\s+)?before\s+([\d:apm\s]+)/i;
  const m = t.match(re);
  if (!m) return null;
  const token = m[1];
  const parsed = parseTimeToken(token);
  if (!parsed) return null;
  return parsed; // { hour, minute }
}

// Detect "from 11:30 onwards" style constraints
function extractFromOnwardsConstraint(text) {
  const re = /from\s+([\d:apm\s]+)\s+onwards/i;
  const m = text.match(re);
  if (!m) return null;
  const token = m[1];
  const parsed = parseTimeToken(token);
  if (!parsed) return null;
  return parsed;
}

function extractAvailabilityIntervalsFromUtterance(text, callDate, defaultWeekRef) {
  const normalized = normaliseText(text);
  const globalWeekModifier = extractWeekModifier(normalized);
  const baseWeekRef = globalWeekModifier
    ? getWeekReference(callDate, globalWeekModifier)
    : defaultWeekRef || startOfWeek(callDate);

  const clauses = splitIntoClauses(normalized);
  const intervals = [];
  const earliestConstraintGlobal = extractEarliestTimeConstraint(normalized);

  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];

    if (containsNegative(clause)) {
      // Treat purely negative clauses as exclusions; don't create availability from them.
      continue;
    }

    const dayNames = extractDayMentions(clause);
    const explicitRange = parseExplicitTimeRange(clause, baseWeekRef);
    const periodRange = inferPeriodFromText(clause, baseWeekRef);
    const fromOnwards = extractFromOnwardsConstraint(clause);
    const earliestConstraintLocal = extractEarliestTimeConstraint(clause);

    // In clauses that explicitly say the person is broadly flexible
    // (e.g. "I'm flexible on times", "I'm fairly open"), and where there
    // is also a "nothing before X" type constraint at the utterance level,
    // we treat the period word ("morning") as a soft hint rather than as a
    // hard upper bound. In those cases we ignore the period window so the
    // person is considered free from X onwards for the rest of the day.
    let effectivePeriodRange = periodRange;
    if (earliestConstraintGlobal && clauseHasFlexibilityPhrase(clause)) {
      effectivePeriodRange = null;
    }

    const pickRange = function () {
      if (explicitRange) return explicitRange;
      if (fromOnwards) {
        return {
          start: cloneWithTime(baseWeekRef, fromOnwards.hour, fromOnwards.minute),
          end: cloneWithTime(baseWeekRef, 18, 0),
        };
      }
      // If we have a coarse period (e.g. "morning"), always start from that
      // period’s window; any earliest-time constraint will then raise the
      // start time inside this window (e.g. "morning" 09:00–12:00 combined
      // with "nothing before 10am" becomes 10:00–12:00).
      if (effectivePeriodRange) return effectivePeriodRange;
      return {
        start: cloneWithTime(baseWeekRef, 9, 0),
        end: cloneWithTime(baseWeekRef, 18, 0),
      };
    };

    if (dayNames.length > 0) {
      for (let j = 0; j < dayNames.length; j++) {
        const dayName = dayNames[j];
        const dateForDay = getDateForNamedDay(baseWeekRef, dayName);
        if (!dateForDay) continue;
        const baseRange = pickRange();
        let start = cloneWithTime(
          dateForDay,
          baseRange.start.getHours(),
          baseRange.start.getMinutes(),
        );
        // Decide which earliest constraint to apply:
        // - Prefer clause-local ("this clause says not before X")
        // - Otherwise, if this clause has no specific time-of-day info,
        //   fall back to a message-level earliest constraint.
        const hasLocalTimeInfo = !!explicitRange || !!effectivePeriodRange || !!fromOnwards;
        const earliestConstraint =
          earliestConstraintLocal || (!hasLocalTimeInfo ? earliestConstraintGlobal : null);

        let end = cloneWithTime(
          dateForDay,
          baseRange.end.getHours(),
          baseRange.end.getMinutes(),
        );

        if (earliestConstraint) {
          const earliestDate = cloneWithTime(
            dateForDay,
            earliestConstraint.hour,
            earliestConstraint.minute,
          );
          if (earliestDate.getTime() >= end.getTime()) {
            // If the "not before" time is after the original end of the
            // window (e.g. "morning" plus "not before 2pm"), interpret this
            // as availability from that time until the end of the work day.
            start = earliestDate;
            end = cloneWithTime(dateForDay, 18, 0);
          } else if (earliestDate.getTime() > start.getTime()) {
            start = earliestDate;
          }
        }
        intervals.push({
          start: start,
          end: end,
          meta: {
            dayName: dayName,
            weekModifier: globalWeekModifier || "this/unspecified",
            sourceText: clause,
          },
        });
      }
    }
  }

  return intervals;
}

function detectConversationWeekRef(dialogue, callDate) {
  for (let i = 0; i < dialogue.length; i++) {
    const turn = dialogue[i];
    const text = turn && turn.text ? turn.text : "";
    const normalized = normaliseText(text);
    const modifier = extractWeekModifier(normalized);
    if (modifier) {
      return getWeekReference(callDate, modifier);
    }
  }
  return null;
}

function buildParticipantAvailabilities(transcript) {
  const callDate = parseCallInfoDate(transcript.call_info) || new Date();
  const perParticipant = new Map();
  const dialogue = transcript.dialogue || [];
  const conversationWeekRef = detectConversationWeekRef(dialogue, callDate);

  for (const turn of dialogue) {
    const speaker = turn.speaker || "Unknown";
    const text = turn.text || "";
    const intervals = extractAvailabilityIntervalsFromUtterance(
      text,
      callDate,
      conversationWeekRef,
    );
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

// Try to refine a broad common slot (e.g. 09:00–12:00) using an explicit
// single time mention (e.g. "shall we say 10am?") that appears near the end
// of the dialogue for the same calendar day.
function refineFirstSlotWithTranscript(transcript, slot, meetingDurationMin) {
  if (!slot || !transcript || !transcript.dialogue) {
    return null;
  }

  const dialogue = transcript.dialogue || [];
  if (!dialogue.length) return null;

  const dayStart = new Date(slot.start.getFullYear(), slot.start.getMonth(), slot.start.getDate());

  const searchWindowMs = 24 * 60 * 60 * 1000;

  const len = dialogue.length;

  // Search backwards so that later explicit times (e.g. "shall we say 10am?")
  // take precedence over earlier, more generic windows ("between 9am and 12pm").
  for (let i = len - 1; i >= 0; i--) {
    const turn = dialogue[i];
    const text = (turn && turn.text) || "";
    const normalized = normaliseText(text);

    // Create a fresh regex per turn so lastIndex state from previous
    // iterations cannot cause us to skip matches at the start.
    const timeRegex = /(\d{1,2}(?::\d{2})?\s*(am|pm))/gi;

    let match;
    while ((match = timeRegex.exec(normalized)) !== null) {
      const token = match[1];
      const parsed = parseTimeToken(token);
      if (!parsed) {
        continue;
      }
      const candidateStart = cloneWithTime(dayStart, parsed.hour, parsed.minute);
      if (
        candidateStart.getTime() >= slot.start.getTime() &&
        candidateStart.getTime() < slot.end.getTime() &&
        candidateStart.getTime() < dayStart.getTime() + searchWindowMs
      ) {
        const candidateEnd = new Date(
          Math.min(
            candidateStart.getTime() + meetingDurationMin * 60000,
            slot.end.getTime(),
          ),
        );
        return {
          start: candidateStart,
          end: candidateEnd,
        };
      }
    }
  }

  return null;
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

