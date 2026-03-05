// MOVA – Meeting Availability Assistant (React version)
// React + Babel in-browser prototype for extracting availabilities
// from transcripts, computing common slots, and generating .ics content.

// --- Core configuration & assumptions ---------------------------------------

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

// --- Utility functions -------------------------------------------------------

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

// Intersection of two [start, end] intervals.
function intersectIntervals(a, b) {
  const start = new Date(Math.max(a.start.getTime(), b.start.getTime()));
  const end = new Date(Math.min(a.end.getTime(), b.end.getTime()));
  if (end <= start) return null;
  return { start, end };
}

// --- Extraction logic --------------------------------------------------------

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
      arr.push({
        start: iv.start,
        end: iv.end,
        sourceText: iv.meta?.sourceText || text,
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

// --- ICS generation ----------------------------------------------------------

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

// --- React components --------------------------------------------------------

function TranscriptAvailabilities({ transcriptKey, transcript }) {
  const perParticipant = buildParticipantAvailabilities(transcript);

  return (
    <article className="transcript-card">
      <div className="transcript-header">
        <div className="transcript-title">{transcript.call_info || transcriptKey}</div>
        <div className="transcript-meta">
          Transcript {transcript.id != null ? transcript.id : transcriptKey}
        </div>
      </div>

      <div className="participants">
        {(transcript.participants || []).map((p) => (
          <span key={p.name} className="participant-pill">
            <strong>{p.name}</strong> · {p.role}
          </span>
        ))}
      </div>

      <ul className="availability-list">
        {perParticipant.size === 0 ? (
          <li>No explicit availability constraints detected in this transcript.</li>
        ) : (
          Array.from(perParticipant.entries()).map(([speaker, intervals]) => (
            <li key={speaker}>
              <span className="label">{speaker}: </span>
              {intervals.length === 0 ? (
                "no clear availabilities extracted."
              ) : (
                <ul style={{ margin: "3px 0 0 14px", paddingLeft: 0, listStyle: "disc" }}>
                  {intervals.map((iv, idx) => (
                    <li key={idx}>{formatDateTimeRange(iv.start, iv.end)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))
        )}
      </ul>
    </article>
  );
}

function TranscriptSlots({ transcriptKey, transcript }) {
  const perParticipant = buildParticipantAvailabilities(transcript);
  const commonSlots = computeCommonSlots(perParticipant);
  const [copyStatus, setCopyStatus] = React.useState("");

  const bestSlot = commonSlots[0];
  const summary =
    "Viewing – " + (transcript.call_info || "Apartment viewing appointment");
  const description =
    "Generated by MOVA – simple heuristic assistant based on transcript availabilities.";
  const icsContent = bestSlot ? generateIcsForSlot(bestSlot, summary, description) : "";

  const handleCopy = async () => {
    if (!icsContent) return;
    try {
      await navigator.clipboard.writeText(icsContent);
      setCopyStatus("Copied to clipboard");
      setTimeout(() => setCopyStatus(""), 1800);
    } catch {
      setCopyStatus("Copy failed – select text manually.");
    }
  };

  return (
    <article className="transcript-card">
      <div className="transcript-header">
        <div className="transcript-title">{transcript.call_info || transcriptKey}</div>
        <span className="badge">Computed slots</span>
      </div>

      <ul className="slot-list">
        {commonSlots.length === 0 ? (
          <li>
            No common slot satisfying the default duration was found based on the extracted
            windows.
          </li>
        ) : (
          commonSlots.map((slot, idx) => (
            <li key={idx}>
              <span className="label">{idx === 0 ? "Suggested:" : "Alternative:"}</span>{" "}
              <span className={idx === 0 ? "badge good" : "badge low-priority"}>
                {idx === 0 ? "Earliest feasible" : "Also feasible"}
              </span>{" "}
              {formatDateTimeRange(slot.start, slot.end)}
            </li>
          ))
        )}
      </ul>

      {bestSlot && (
        <div className="ics-block">
          <div className="ics-header">
            <div className="ics-header-title">
              Meeting invite (.ics content, copy into a file to import):
            </div>
            <button type="button" onClick={handleCopy}>
              Copy .ics
            </button>
            <div className="copy-status">{copyStatus}</div>
          </div>
          <textarea
            className="ics-textarea"
            readOnly
            value={icsContent}
            spellCheck="false"
          />
        </div>
      )}
    </article>
  );
}

function AssumptionsPanel() {
  return (
    <section className="panel">
      <h2>4. Technical choices & assumptions</h2>
      <div className="assumptions">
        <section>
          <h3>Time & language assumptions</h3>
          <ul>
            <li>
              All participants are assumed to be in the same timezone (your browser's local
              timezone is used when rendering dates).
            </li>
            <li>
              "Next week" is interpreted as the calendar week starting on the Monday after
              the call date.
            </li>
            <li>
              Generic periods are mapped to fixed windows: "morning" ≈ 09:00–12:00,
              "afternoon" ≈ 13:00–17:00, "late afternoon" ≈ 16:00–18:00, "evening" ≈
              18:00–21:00.
            </li>
            <li>
              The default meeting duration is {DEFAULT_MEETING_DURATION_MIN} minutes;
              overlaps shorter than this are discarded.
            </li>
          </ul>
        </section>
        <section>
          <h3>Extraction heuristics & limitations</h3>
          <ul>
            <li>
              The current version uses simple pattern matching (no external LLM at runtime)
              to detect days of week, relative expressions ("next week") and coarse
              periods ("morning").
            </li>
            <li>
              Negative statements such as "doesn't work" are treated as exclusions and are
              not added as availability.
            </li>
            <li>
              Ambiguous or very vague phrases may be ignored rather than misinterpreted;
              the UI surfaces only windows it can parse confidently.
            </li>
            <li>
              For brevity, the implementation focuses on typical scheduling phrases;
              extending the grammar to more edge cases is possible but not yet implemented.
            </li>
          </ul>
        </section>
        <section>
          <h3>Evolution ideas</h3>
          <ul>
            <li>
              Introduce an LLM-backed extraction layer with explicit, auditable prompts to
              handle more varied natural language while keeping this heuristic layer as a
              safety net.
            </li>
            <li>
              Add a notion of preference/priority (e.g. "last resort") and scoring, not
              just binary feasibility.
            </li>
            <li>
              Support multi-party scheduling across multiple transcripts and direct export
              to providers (Google Calendar links, email templates).
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}

function App() {
  const [rawInput, setRawInput] = React.useState("");
  const [error, setError] = React.useState("");
  const [parsedTranscripts, setParsedTranscripts] = React.useState(null);
  const [isLoadingSample, setIsLoadingSample] = React.useState(false);

  const handleLoadSample = async () => {
    setError("");
    setIsLoadingSample(true);
    try {
      const res = await fetch("transciptSamples.JSON");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setRawInput(JSON.stringify(json, null, 2));
    } catch (e) {
      console.error(e);
      setError(
        "Could not load local sample file. You can still paste its JSON content manually.",
      );
    } finally {
      setIsLoadingSample(false);
    }
  };

  const handleProcess = () => {
    setError("");
    setParsedTranscripts(null);

    let parsed;
    try {
      parsed = parseJsonInput(rawInput);
      if (!parsed) {
        setError("Please paste at least one transcript in JSON format.");
        return;
      }
    } catch (e) {
      setError(e.message);
      return;
    }

    setParsedTranscripts(parsed);
  };

  const hasResults = parsedTranscripts && Object.keys(parsedTranscripts).length > 0;

  return (
    <main className="page">
      <header className="page-header">
        <h1>MOVA – Meeting Availability Assistant</h1>
        <p className="subtitle">
          Paste one or more conversation transcripts, extract availabilities, find common
          slots, and generate a meeting invite.
        </p>
      </header>

      <section className="panel">
        <h2>1. Input transcripts</h2>
        <p className="hint">
          Paste JSON similar to <code>transciptSamples.JSON</code>, or load the local
          sample file.
        </p>
        <div className="controls-row">
          <button type="button" onClick={handleLoadSample} disabled={isLoadingSample}>
            {isLoadingSample ? "Loading…" : "Load sample transcripts"}
          </button>
          <button type="button" className="primary" onClick={handleProcess}>
            Process transcripts
          </button>
        </div>
        <textarea
          rows={14}
          spellCheck="false"
          placeholder={`{
  "transcript1": { ... },
  "transcript2": { ... }
}`}
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
        />
        <div className="error-message" aria-live="polite">
          {error}
        </div>
      </section>

      <section className="panel">
        <h2>2. Extracted availabilities</h2>
        <div className="results">
          {!hasResults && <div className="hint">Run an analysis to see results here.</div>}
          {hasResults &&
            Object.entries(parsedTranscripts).map(([key, transcript]) => (
              <TranscriptAvailabilities
                key={key}
                transcriptKey={key}
                transcript={transcript}
              />
            ))}
        </div>
      </section>

      <section className="panel">
        <h2>3. Common time slots & suggestions</h2>
        <div className="results">
          {!hasResults && <div className="hint">Run an analysis to see results here.</div>}
          {hasResults &&
            Object.entries(parsedTranscripts).map(([key, transcript]) => (
              <TranscriptSlots key={key} transcriptKey={key} transcript={transcript} />
            ))}
        </div>
      </section>

      <AssumptionsPanel />
    </main>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}

// MOVA – Meeting Availability Assistant
// Minimal, heuristic-based extraction of availabilities and common slots.

const loadSampleBtn = document.getElementById("loadSampleBtn");
const processBtn = document.getElementById("processBtn");
const transcriptInput = document.getElementById("transcriptInput");
const inputErrorEl = document.getElementById("inputError");
const availabilitiesContainer = document.getElementById("availabilitiesContainer");
const slotsContainer = document.getElementById("slotsContainer");
const assumptionsContainer = document.getElementById("assumptionsContainer");

// --- Core configuration & assumptions ---------------------------------------

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

// --- Utility functions -------------------------------------------------------

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

// Intersection of two [start, end] intervals.
function intersectIntervals(a, b) {
  const start = new Date(Math.max(a.start.getTime(), b.start.getTime()));
  const end = new Date(Math.min(a.end.getTime(), b.end.getTime()));
  if (end <= start) return null;
  return { start, end };
}

// --- Extraction logic --------------------------------------------------------

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
      arr.push({
        start: iv.start,
        end: iv.end,
        sourceText: iv.meta?.sourceText || text,
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

// --- ICS generation ----------------------------------------------------------

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

// --- Rendering ---------------------------------------------------------------

function renderAvailabilities(transcripts) {
  availabilitiesContainer.innerHTML = "";

  Object.entries(transcripts).forEach(([key, transcript]) => {
    const card = document.createElement("article");
    card.className = "transcript-card";

    const header = document.createElement("div");
    header.className = "transcript-header";

    const title = document.createElement("div");
    title.className = "transcript-title";
    title.textContent = transcript.call_info || key;

    const meta = document.createElement("div");
    meta.className = "transcript-meta";
    meta.textContent = `Transcript ${transcript.id ?? key}`;

    header.appendChild(title);
    header.appendChild(meta);

    const participantsRow = document.createElement("div");
    participantsRow.className = "participants";
    (transcript.participants || []).forEach((p) => {
      const pill = document.createElement("span");
      pill.className = "participant-pill";
      pill.innerHTML = `<strong>${p.name}</strong> · ${p.role}`;
      participantsRow.appendChild(pill);
    });

    const availabilityList = document.createElement("ul");
    availabilityList.className = "availability-list";

    const perParticipant = buildParticipantAvailabilities(transcript);
    if (!perParticipant.size) {
      const li = document.createElement("li");
      li.textContent = "No explicit availability constraints detected in this transcript.";
      availabilityList.appendChild(li);
    } else {
      for (const [speaker, intervals] of perParticipant.entries()) {
        const li = document.createElement("li");
        const labelSpan = document.createElement("span");
        labelSpan.className = "label";
        labelSpan.textContent = `${speaker}: `;
        li.appendChild(labelSpan);

        if (!intervals.length) {
          li.appendChild(document.createTextNode("no clear availabilities extracted."));
        } else {
          const innerList = document.createElement("ul");
          innerList.style.margin = "3px 0 0 14px";
          innerList.style.paddingLeft = "0";
          innerList.style.listStyle = "disc";
          intervals.forEach((iv) => {
            const ivLi = document.createElement("li");
            ivLi.textContent = formatDateTimeRange(iv.start, iv.end);
            innerList.appendChild(ivLi);
          });
          li.appendChild(innerList);
        }

        availabilityList.appendChild(li);
      }
    }

    card.appendChild(header);
    card.appendChild(participantsRow);
    card.appendChild(availabilityList);
    availabilitiesContainer.appendChild(card);
  });
}

function renderSlots(transcripts) {
  slotsContainer.innerHTML = "";

  Object.entries(transcripts).forEach(([key, transcript]) => {
    const card = document.createElement("article");
    card.className = "transcript-card";

    const header = document.createElement("div");
    header.className = "transcript-header";

    const title = document.createElement("div");
    title.className = "transcript-title";
    title.textContent = transcript.call_info || key;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Computed slots";

    header.appendChild(title);
    header.appendChild(badge);

    const perParticipant = buildParticipantAvailabilities(transcript);
    const commonSlots = computeCommonSlots(perParticipant);

    const slotList = document.createElement("ul");
    slotList.className = "slot-list";

    if (!commonSlots.length) {
      const li = document.createElement("li");
      li.textContent =
        "No common slot satisfying the default duration was found based on the extracted windows.";
      slotList.appendChild(li);
    } else {
      commonSlots.forEach((slot, idx) => {
        const li = document.createElement("li");
        const labelSpan = document.createElement("span");
        labelSpan.className = "label";
        labelSpan.textContent = idx === 0 ? "Suggested:" : "Alternative:";
        const priorityBadge = document.createElement("span");
        priorityBadge.className = idx === 0 ? "badge good" : "badge low-priority";
        priorityBadge.textContent = idx === 0 ? "Earliest feasible" : "Also feasible";

        li.appendChild(labelSpan);
        li.appendChild(document.createTextNode(" "));
        li.appendChild(priorityBadge);
        li.appendChild(
          document.createTextNode(" " + formatDateTimeRange(slot.start, slot.end)),
        );
        slotList.appendChild(li);
      });
    }

    card.appendChild(header);
    card.appendChild(slotList);

    if (commonSlots.length) {
      const bestSlot = commonSlots[0];
      const summary =
        `Viewing – ` + (transcript.call_info || "Apartment viewing appointment");
      const description =
        "Generated by MOVA – simple heuristic assistant based on transcript availabilities.";
      const icsContent = generateIcsForSlot(bestSlot, summary, description);

      const icsBlock = document.createElement("div");
      icsBlock.className = "ics-block";

      const icsHeader = document.createElement("div");
      icsHeader.className = "ics-header";
      const icsTitle = document.createElement("div");
      icsTitle.className = "ics-header-title";
      icsTitle.textContent = "Meeting invite (.ics content, copy into a file to import):";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy .ics";
      copyBtn.type = "button";

      const copyStatus = document.createElement("div");
      copyStatus.className = "copy-status";
      copyStatus.textContent = "";

      icsHeader.appendChild(icsTitle);
      icsHeader.appendChild(copyBtn);
      icsHeader.appendChild(copyStatus);

      const icsTextarea = document.createElement("textarea");
      icsTextarea.className = "ics-textarea";
      icsTextarea.readOnly = true;
      icsTextarea.value = icsContent;

      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(icsContent);
          copyStatus.textContent = "Copied to clipboard";
          setTimeout(() => {
            copyStatus.textContent = "";
          }, 1800);
        } catch {
          copyStatus.textContent = "Copy failed – select text manually.";
        }
      });

      icsBlock.appendChild(icsHeader);
      icsBlock.appendChild(icsTextarea);
      card.appendChild(icsBlock);
    }

    slotsContainer.appendChild(card);
  });
}

function renderAssumptions() {
  const container = assumptionsContainer;
  container.innerHTML = "";

  const section1 = document.createElement("section");
  const h1 = document.createElement("h3");
  h1.textContent = "Time & language assumptions";
  const ul1 = document.createElement("ul");
  ul1.innerHTML = `
    <li>All participants are assumed to be in the same timezone (your browser's local timezone is used when rendering dates).</li>
    <li>"Next week" is interpreted as the calendar week starting on the Monday after the call date.</li>
    <li>Generic periods are mapped to fixed windows: "morning" ≈ 09:00–12:00, "afternoon" ≈ 13:00–17:00, "late afternoon" ≈ 16:00–18:00, "evening" ≈ 18:00–21:00.</li>
    <li>The default meeting duration is ${DEFAULT_MEETING_DURATION_MIN} minutes; overlaps shorter than this are discarded.</li>
  `;
  section1.appendChild(h1);
  section1.appendChild(ul1);

  const section2 = document.createElement("section");
  const h2 = document.createElement("h3");
  h2.textContent = "Extraction heuristics & limitations";
  const ul2 = document.createElement("ul");
  ul2.innerHTML = `
    <li>The current version uses simple pattern matching (no external LLM at runtime) to detect days of week, relative expressions ("next week") and coarse periods ("morning").</li>
    <li>Negative statements such as "doesn't work" are treated as exclusions and are not added as availability.</li>
    <li>Ambiguous or very vague phrases may be ignored rather than misinterpreted; the UI surfaces only windows it can parse confidently.</li>
    <li>For brevity, the implementation focuses on typical scheduling phrases; extending the grammar to more edge cases is possible but not yet implemented.</li>
  `;
  section2.appendChild(h2);
  section2.appendChild(ul2);

  const section3 = document.createElement("section");
  const h3 = document.createElement("h3");
  h3.textContent = "Evolution ideas";
  const ul3 = document.createElement("ul");
  ul3.innerHTML = `
    <li>Introduce an LLM-backed extraction layer with explicit, auditable prompts to handle more varied natural language while keeping this heuristic layer as a safety net.</li>
    <li>Add a notion of preference/priority (e.g. "last resort") and scoring, not just binary feasibility.</li>
    <li>Support multi-party scheduling across multiple transcripts and direct export to providers (Google Calendar links, email templates).</li>
  `;
  section3.appendChild(h3);
  section3.appendChild(ul3);

  container.appendChild(section1);
  container.appendChild(section2);
  container.appendChild(section3);
}

// --- Wiring ------------------------------------------------------------------

async function loadSampleTranscripts() {
  inputErrorEl.textContent = "";
  try {
    const res = await fetch("transciptSamples.JSON");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    transcriptInput.value = JSON.stringify(json, null, 2);
  } catch (e) {
    inputErrorEl.textContent =
      "Could not load local sample file. You can still paste its JSON content manually.";
    console.error(e);
  }
}

function handleProcess() {
  inputErrorEl.textContent = "";
  availabilitiesContainer.innerHTML = "";
  slotsContainer.innerHTML = "";

  let parsed;
  try {
    parsed = parseJsonInput(transcriptInput.value);
    if (!parsed) {
      inputErrorEl.textContent = "Please paste at least one transcript in JSON format.";
      return;
    }
  } catch (e) {
    inputErrorEl.textContent = e.message;
    return;
  }

  renderAvailabilities(parsed);
  renderSlots(parsed);
  renderAssumptions();
}

if (loadSampleBtn) {
  loadSampleBtn.addEventListener("click", () => {
    loadSampleTranscripts();
  });
}

if (processBtn) {
  processBtn.addEventListener("click", () => {
    handleProcess();
  });
}

renderAssumptions();

