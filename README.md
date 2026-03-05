## MOVA – Meeting Availability Assistant

MOVA is a small, React-based, browser-only prototype that takes one or more conversation transcripts and:

- **Extracts per-participant availability windows** from natural language
- **Computes common feasible slots** given a target meeting duration
- **Suggests a concrete meeting time** (earliest feasible slot) and
- **Generates a basic `.ics` invitation** that can be imported into most calendar tools

The goal is to demonstrate reasoning around extracting temporal constraints from noisy, natural language transcripts while being explicit about assumptions and limitations.

### Architecture overview

- **Frontend only, no backend**: a single-page React app (`index.html` + `app.js` + `styles.css`). React and ReactDOM are loaded via CDN and JSX is compiled in the browser using Babel; everything runs client-side with no external services or databases.
- **Input format**: the app expects JSON similar to `transciptSamples.JSON` (an object keyed by transcript id, each with `call_info`, `participants`, and `dialogue`).
- **Extraction engine (heuristic)**:
  - Parses the `call_info` to obtain a reference date/time for the call.
  - Scans each dialogue turn and, using pattern matching, looks for:
    - Day names (`Monday`, `Tuesday`, …)
    - Relative expressions (`this week`, `next week`)
    - Coarse periods (`morning`, `afternoon`, `late afternoon`, `evening`)
    - Simple explicit time ranges (`between 9am and 12pm`, `from 11:30 to 14:00`)
  - For each utterance that appears to express availability, constructs one or more **time intervals** (JavaScript `Date` ranges) for that speaker.
- **Common slot computation**:
  - For each transcript, merges the availability intervals of all participants and intersects them pairwise to find time windows where everyone is free.
  - Filters out overlaps shorter than a configurable duration (default **30 minutes**).
  - Sorts the remaining windows and selects the **earliest** one as the primary suggestion, exposing the rest as alternatives.
- **Invitation generation**:
  - For the primary suggested slot, builds a minimal `VCALENDAR` / `VEVENT` payload as a string.
  - This `.ics` text can be copied from the UI and saved to a file for import into calendar tools.

### Key assumptions & edge cases

- **Timezone**:
  - All participants are assumed to share the same timezone.
  - The browser’s local timezone is used to render and serialize times; ICS fields are generated without explicit timezone (floating time).
- **Relative weeks**:
  - `"next week"` is interpreted as the calendar week starting on the Monday after the call date in `call_info`.
  - `"this week"` is interpreted as the week containing the call date, starting on Monday.
- **Coarse periods**:
  - `"morning"` → 09:00–12:00
  - `"afternoon"` → 13:00–17:00
  - `"late afternoon"` → 16:00–18:00
  - `"evening"` → 18:00–21:00
  - These are deliberately simple; the mapping is surfaced in the UI so users can judge whether the assumptions are acceptable.
- **Duration and overlap**:
  - The default meeting duration is **30 minutes**. Any overlap shorter than this is discarded as not viable.
  - Future work could make the duration user-configurable.
- **Negations and exclusions**:
  - Simple negative phrases like `"doesn't work"`, `"is out completely"`, `"not free"` are treated as **exclusions**, so those windows are not stored as availability.
  - The prototype does not model “soft” preferences like `"last resort"` beyond comments in the text; it only considers hard feasibility.
- **Ambiguity handling**:
  - When the text is too vague (e.g. `"sometime later"`, `"maybe end of the month"`), the system currently **does not create an interval** instead of guessing.
  - The UI reflects only windows that could be mapped to a specific day/week and time range using the simple grammar above.

### How to run

Requirements: a recent Node.js is only needed if you want to use the tiny dev script; otherwise, you can open `index.html` directly in a browser.

1. **Install dependencies** (none are required, but this step sets up the local dev server command):
   ```bash
   npm install
   ```
2. **Serve the app** (optional but recommended to avoid browser file URL restrictions):
   ```bash
   npm run start
   ```
   This uses `npx serve .` to serve the current folder. Open the printed URL in your browser.

3. **Use the interface**:
   - Open the app in a modern browser (React 18 UMD build + Babel are pulled from CDNs).
   - Click **“Load sample transcripts”** to fetch `transciptSamples.JSON` from the project root, or paste its content into the input area.
   - Click **“Process transcripts”**.
   - Inspect:
     - **Extracted availabilities per participant**
     - **Common time slots & suggestions**
     - The suggested **`.ics` invitation** text you can copy and save.

### LLM usage

- The **runtime assistant logic is purely heuristic** and does not call any external LLMs or APIs.
- An LLM (such as ChatGPT in a development environment) was used to help design and implement the heuristics and code, but:
  - No model calls are embedded in the production pipeline.
  - There are therefore no runtime prompts to document.
- If this project were extended with an LLM-based extraction layer, a likely pipeline would be:
  - Provide the raw transcript (or a windowed chunk) plus a schema describing desired fields (participants, explicit/implicit availability windows, preferences, constraints).
  - Ask the model to emit a **structured JSON** with time expressions plus their spans and interpretations (e.g. ISO dates, confidence scores).
  - Combine that with the current deterministic overlap logic, using confidence and explicit constraints to prioritise slots.

### Evolution perspectives

If this prototype were to be taken further, a few natural directions are:

- **Richer natural language coverage**:
  - Use an LLM-based extractor (with carefully designed prompts and unit tests) to handle more varied phrasing, partial availability, recurring events, and multi-week horizons.
  - Keep the current heuristic layer as a sanity check and fallback when the model is uncertain.
- **Preference modelling and ranking**:
  - Introduce explicit weights for preferences such as `"last resort"`, `"prefer mornings"`, `"not too early"`, etc.
  - Surface not just feasible slots but a ranked list with explanations (why a slot is suggested and what it satisfies or violates).
- **Multi-transcript and multi-party scheduling**:
  - Combine constraints across several calls/emails to schedule group meetings.
  - Integrate with real calendars (e.g. Google Calendar API) to validate suggestions against live data.
- **Robustness & safety**:
  - Add confidence scores, uncertainty flags (e.g. “interpretation of ‘late afternoon’ may be off by ±1h”), and logs that make every transformation auditable.
  - Provide an explicit “review and edit” step for the suggested slot before generating or sending an invite.

