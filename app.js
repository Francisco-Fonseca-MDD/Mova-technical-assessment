// React entry point and top-level layout

function App() {
  const [rawInput, setRawInput] = React.useState("");
  const [error, setError] = React.useState("");
  const [parsedTranscripts, setParsedTranscripts] = React.useState(null);
  const [isLoadingSample, setIsLoadingSample] = React.useState(false);
  const [sampleTranscripts, setSampleTranscripts] = React.useState(null);
  const [selectedSampleKey, setSelectedSampleKey] = React.useState(null);
  const [activeButton, setActiveButton] = React.useState("process");

  const handleLoadSample = async () => {
    setError("");
    setActiveButton("load");

    setIsLoadingSample(true);
    try {
      const res = await fetch("transciptSamples.JSON");
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      const json = await res.json();
      setSampleTranscripts(json);
      setSelectedSampleKey(null);
    } catch (e) {
      console.error(e);
      setError(
        "Could not load local sample file. You can still paste its JSON content manually.",
      );
    } finally {
      setIsLoadingSample(false);
    }
  };

  const handleSelectSample = function (key) {
    if (!sampleTranscripts || !sampleTranscripts[key]) {
      return;
    }
    setSelectedSampleKey(key);
    const subset = {};
    subset[key] = sampleTranscripts[key];
    setRawInput(JSON.stringify(subset, null, 2));
    setError("");
  };

  const handleProcess = () => {
    setError("");
    setParsedTranscripts(null);
    setActiveButton("process");

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
          Paste JSON similar to <code>transciptSamples.JSON</code>, or load selected
          samples from the local file.
        </p>
        <div className="controls-row">
          <button
            type="button"
            onClick={handleLoadSample}
            disabled={isLoadingSample}
            className={activeButton === "load" ? "primary" : ""}
          >
            {isLoadingSample ? "Loading…" : "Load sample transcripts"}
          </button>
          <button
            type="button"
            className={activeButton === "process" ? "primary" : ""}
            onClick={handleProcess}
          >
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
          onChange={function (e) {
            setRawInput(e.target.value);
          }}
        />
        {sampleTranscripts && (
          <div className="sample-selector">
            <div className="hint">
              Loaded samples from <code>transciptSamples.JSON</code>. Tap a transcript to
              load it into the editor:
            </div>
            <div className="sample-list">
              {Object.keys(sampleTranscripts).map(function (key) {
                const transcript = sampleTranscripts[key];
                return (
                  <button
                    type="button"
                    key={key}
                    className={
                      "sample-item" + (selectedSampleKey === key ? " sample-item-selected" : "")
                    }
                    onClick={function () {
                      handleSelectSample(key);
                    }}
                  >
                    <span className="sample-label">
                      {key} – {transcript.call_info || "Untitled call"}
                    </span>
                    {transcript.participants && transcript.participants.length > 0 && (
                      <span className="sample-participants">
                        {transcript.participants
                          .map(function (p) {
                            return p.name;
                          })
                          .join(", ")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="error-message" aria-live="polite">
          {error}
        </div>
      </section>

      <section className="panel">
        <h2>2. Extracted availabilities</h2>
        <div className="results">
          {!hasResults && <div className="hint">Run an analysis to see results here.</div>}
          {hasResults &&
            Object.entries(parsedTranscripts).map(function (entry) {
              var key = entry[0];
              var transcript = entry[1];
              return (
                <TranscriptAvailabilities
                  key={key}
                  transcriptKey={key}
                  transcript={transcript}
                />
              );
            })}
        </div>
      </section>

      <section className="panel">
        <h2>3. Common time slots & suggestions</h2>
        <div className="results">
          {!hasResults && <div className="hint">Run an analysis to see results here.</div>}
          {hasResults &&
            Object.entries(parsedTranscripts).map(function (entry) {
              var key = entry[0];
              var transcript = entry[1];
              return (
                <TranscriptSlots
                  key={key}
                  transcriptKey={key}
                  transcript={transcript}
                />
              );
            })}
        </div>
      </section>

      <AssumptionsPanel />
    </main>
  );
}

var rootEl = document.getElementById("root");
if (rootEl) {
  var root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}

