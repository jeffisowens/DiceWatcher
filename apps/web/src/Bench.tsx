import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { type D6RecognitionResult, recognizeD6FromDataUrl } from "./vision";

type CameraState = "idle" | "requesting" | "ready" | "blocked" | "error";
type AnalysisState = "idle" | "running" | "done" | "error";
type CaptureSource = "camera" | "upload" | null;
type FixtureRun = {
  id: string;
  label: string;
  source: Exclude<CaptureSource, null>;
  expectedValue: number;
  detectedValue: number | null;
  confirmedValue: number;
  confidence: number;
  pipCount: number;
  matched: boolean;
  notes: string[];
  debugImageUrl?: string;
};

type BatchFixtureRow = {
  id: string;
  label: string;
  expectedValue: number;
  analysisState: AnalysisState;
  detectedValue: number | null;
  confidence: number;
  pipCount: number;
  notes: string[];
  debugImageUrl?: string;
  error?: string;
};

const D6_VALUES = [1, 2, 3, 4, 5, 6];

const EMPTY_RESULT: D6RecognitionResult = {
  value: null,
  confidence: 0,
  pipCount: 0,
  inspectedRegion: {
    width: 0,
    height: 0
  },
  notes: []
};

// Recognition lab: capture or upload d6 images and score the prototype
// recognizer. Moves to the fixture harness in M2.
export function Bench() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [captureSource, setCaptureSource] = useState<CaptureSource>(null);
  const [captureLabel, setCaptureLabel] = useState<string>("No image loaded");
  const [expectedFixtureValue, setExpectedFixtureValue] = useState(1);
  const [selectedValue, setSelectedValue] = useState(4);
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [recognitionResult, setRecognitionResult] =
    useState<D6RecognitionResult>(EMPTY_RESULT);
  const [fixtureRuns, setFixtureRuns] = useState<FixtureRun[]>([]);
  const [batchRows, setBatchRows] = useState<BatchFixtureRow[]>([]);
  const [batchExpectedValue, setBatchExpectedValue] = useState(1);

  useEffect(() => {
    return () => {
      if (!streamRef.current) {
        return;
      }

      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!capturedImage) {
      setAnalysisState("idle");
      setAnalysisError(null);
      setRecognitionResult(EMPTY_RESULT);
      return;
    }

    const imageToAnalyze = capturedImage;
    let cancelled = false;

    async function runRecognition() {
      setAnalysisState("running");
      setAnalysisError(null);

      try {
        const result = await recognizeD6FromDataUrl(imageToAnalyze);

        if (cancelled) {
          return;
        }

        setRecognitionResult(result);
        setAnalysisState("done");

        if (result.value) {
          setSelectedValue(result.value);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setAnalysisState("error");
        setAnalysisError(
          error instanceof Error
            ? error.message
            : "Image analysis failed for this capture."
        );
        setRecognitionResult(EMPTY_RESULT);
      }
    }

    void runRecognition();

    return () => {
      cancelled = true;
    };
  }, [capturedImage]);

  async function startCamera() {
    setCameraState("requesting");
    setCameraError(null);

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: "environment"
          }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setCameraState("blocked");
        setCameraError(
          "Camera access was blocked. Allow camera permissions and try again."
        );
        return;
      }

      setCameraState("error");
      setCameraError(
        "The camera could not be started on this device or browser."
      );
    }
  }

  function captureFrame() {
    if (!videoRef.current) {
      return;
    }

    const video = videoRef.current;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError(
        "The camera preview is not ready yet. Give it a moment and try again."
      );
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      setCameraError("The browser could not create a capture canvas.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedImage(canvas.toDataURL("image/jpeg", 0.92));
    setCaptureSource("camera");
    setCaptureLabel(`Camera capture ${new Date().toLocaleTimeString()}`);
    setCameraError(null);
  }

  async function loadFixtureFile(file: File) {
    const imageUrl = await readFileAsDataUrl(file);
    setCapturedImage(imageUrl);
    setCaptureSource("upload");
    setCaptureLabel(file.name);
    setCameraError(null);
  }

  async function analyzeBatchFiles(files: File[]) {
    const analyzedRows = await Promise.all(
      files.map(async (file, index) => {
        const id = `${Date.now()}-${index}-${file.name}`;

        try {
          const imageUrl = await readFileAsDataUrl(file);
          const result = await recognizeD6FromDataUrl(imageUrl);

          return {
            id,
            label: file.name,
            expectedValue: 1,
            analysisState: "done" as const,
            detectedValue: result.value,
            confidence: result.confidence,
            pipCount: result.pipCount,
            notes: result.notes,
            debugImageUrl: result.debugImageUrl
          };
        } catch (error) {
          return {
            id,
            label: file.name,
            expectedValue: 1,
            analysisState: "error" as const,
            detectedValue: null,
            confidence: 0,
            pipCount: 0,
            notes: [],
            error:
              error instanceof Error
                ? error.message
                : "Batch analysis failed for this image."
          };
        }
      })
    );

    setBatchRows(analyzedRows);
  }

  function handleFixtureSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    void loadFixtureFile(file);
    event.target.value = "";
  }

  function handleBatchSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    void analyzeBatchFiles(files);
    event.target.value = "";
  }

  function resetCapture() {
    setCapturedImage(null);
    setCaptureSource(null);
    setCaptureLabel("No image loaded");
    setAnalysisState("idle");
    setAnalysisError(null);
  }

  function recordFixtureResult() {
    if (!captureSource || !capturedImage || analysisState !== "done") {
      return;
    }

    setFixtureRuns((currentRuns) => [
      {
        id: `${Date.now()}-${currentRuns.length}`,
        label: captureLabel,
        source: captureSource,
        expectedValue: expectedFixtureValue,
        detectedValue: recognitionResult.value,
        confirmedValue: selectedValue,
        confidence: recognitionResult.confidence,
        pipCount: recognitionResult.pipCount,
        matched: recognitionResult.value === expectedFixtureValue,
        notes: recognitionResult.notes,
        debugImageUrl: recognitionResult.debugImageUrl
      },
      ...currentRuns
    ]);
  }

  function exportFixtureResults() {
    if (fixtureRuns.length === 0) {
      return;
    }

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      runs: fixtureRuns
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json"
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dicewatcher-fixture-results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  function exportBatchResults() {
    if (batchRows.length === 0) {
      return;
    }

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      rows: batchRows.map((row) => ({
        ...row,
        matched:
          row.analysisState === "done" &&
          row.detectedValue !== null &&
          row.detectedValue === row.expectedValue
      }))
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json"
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dicewatcher-batch-results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  function applyBatchExpectedValue() {
    setBatchRows((currentRows) =>
      currentRows.map((row) => ({
        ...row,
        expectedValue: batchExpectedValue
      }))
    );
  }

  const analyzedBatchRows = batchRows.filter(
    (row) => row.analysisState === "done"
  );
  const matchedBatchRows = analyzedBatchRows.filter(
    (row) =>
      row.detectedValue !== null && row.detectedValue === row.expectedValue
  );
  const perFaceSummary = D6_VALUES.map((value) => {
    const rows = analyzedBatchRows.filter((row) => row.expectedValue === value);
    const matched = rows.filter((row) => row.detectedValue === value).length;

    return {
      value,
      total: rows.length,
      matched
    };
  });

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">DiceWatcher recognition bench</p>
        <h1>Capture one d6 and check what the recognizer sees.</h1>
        <p className="lede">
          This first recognition prototype assumes one die in the center of the
          frame and counts likely dark pips from a saved image crop. Manual
          correction stays available for every result.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Camera capture</h2>
            <p>
              Start the camera, place one d6 near the center of the frame, then
              capture a still image for recognition.
            </p>
          </div>
          <span className={`chip chip-${cameraState}`}>{cameraState}</span>
        </div>

        <div className="camera-stage">
          {capturedImage ? (
            <img
              alt="Captured dice frame"
              className="capture-preview"
              src={capturedImage}
            />
          ) : (
            <div className="video-shell">
              <video
                autoPlay
                className="camera-feed"
                muted
                playsInline
                ref={videoRef}
              />
              {cameraState !== "ready" ? (
                <div className="video-overlay">
                  <p>Start the camera to preview the capture area.</p>
                </div>
              ) : (
                <div className="capture-guide" aria-hidden="true">
                  <div className="guide-frame" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="action-row">
          <button className="action" onClick={startCamera} type="button">
            {cameraState === "ready" ? "Restart camera" : "Start camera"}
          </button>
          <button
            className="action action-secondary"
            disabled={cameraState !== "ready"}
            onClick={captureFrame}
            type="button"
          >
            Capture frame
          </button>
          <button
            className="action action-ghost"
            disabled={!capturedImage}
            onClick={resetCapture}
            type="button"
          >
            Retake
          </button>
          <button
            className="action action-secondary"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            type="button"
          >
            Upload test image
          </button>
          <input
            accept="image/*"
            className="hidden-input"
            onChange={handleFixtureSelection}
            ref={fileInputRef}
            type="file"
          />
        </div>

        {cameraError ? <p className="status warning">{cameraError}</p> : null}
        <p className="status">
          Source:{" "}
          {captureSource === "camera"
            ? "Live camera"
            : captureSource === "upload"
              ? "Uploaded fixture"
              : "None"}
          . Active image: {captureLabel}
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Recognition review</h2>
            <p>
              The prototype analyzes a center crop, counts pip-like dark
              components, and suggests a `d6` result with confidence.
            </p>
          </div>
          <span className={`chip chip-${analysisState}`}>
            {analysisState === "done"
              ? `${Math.round(recognitionResult.confidence * 100)}%`
              : analysisState}
          </span>
        </div>

        <div className="analysis-grid">
          <div className="analysis-card">
            <div className="analysis-label">Detected face</div>
            <div className="analysis-value">
              {analysisState === "running"
                ? "Analyzing..."
                : (recognitionResult.value ?? "No confident result")}
            </div>
          </div>
          <div className="analysis-card">
            <div className="analysis-label">Pip candidates</div>
            <div className="analysis-value">{recognitionResult.pipCount}</div>
          </div>
          <div className="analysis-card">
            <div className="analysis-label">Inspected crop</div>
            <div className="analysis-value">
              {recognitionResult.inspectedRegion.width > 0
                ? `${recognitionResult.inspectedRegion.width}x${recognitionResult.inspectedRegion.height}`
                : "Waiting"}
            </div>
          </div>
        </div>

        {analysisError ? (
          <p className="status warning">{analysisError}</p>
        ) : null}
        {recognitionResult.notes.length > 0 ? (
          <div className="analysis-notes">
            {recognitionResult.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
        {recognitionResult.debugImageUrl ? (
          <div className="debug-panel">
            <div className="analysis-label">Recognizer debug view</div>
            <img
              alt="Recognizer debug overlay"
              className="debug-image"
              src={recognitionResult.debugImageUrl}
            />
          </div>
        ) : null}

        <div className="fixture-controls">
          <div>
            <label className="value-picker" htmlFor="expected-fixture-value">
              Expected face for this image
            </label>
            <select
              className="select"
              id="expected-fixture-value"
              onChange={(event) => {
                setExpectedFixtureValue(Number(event.target.value));
              }}
              value={expectedFixtureValue}
            >
              {D6_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <button
            className="action action-secondary"
            disabled={!capturedImage || analysisState !== "done"}
            onClick={recordFixtureResult}
            type="button"
          >
            Record result
          </button>
        </div>

        <label className="value-picker" htmlFor="confirmed-roll-value">
          Confirmed d6 value
        </label>
        <select
          className="select"
          id="confirmed-roll-value"
          onChange={(event) => {
            setSelectedValue(Number(event.target.value));
          }}
          value={selectedValue}
        >
          {D6_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </section>

      <section className="panel">
        <h2>Prototype assumptions</h2>
        <ol>
          <li>One d6 only</li>
          <li>Die centered in the capture guide</li>
          <li>Dark pips on a lighter face</li>
          <li>Controlled tray and lighting</li>
          <li>Manual confirmation before send</li>
        </ol>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Batch evaluator</h2>
            <p>
              Upload a set of fixture images, let DiceWatcher analyze them all
              at once, then label expected faces and review the batch summary.
            </p>
          </div>
          <div className="results-actions">
            <label className="batch-set-all" htmlFor="batch-expected-value">
              <span>Set all expected</span>
              <select
                className="select select-compact"
                id="batch-expected-value"
                onChange={(event) => {
                  setBatchExpectedValue(Number(event.target.value));
                }}
                value={batchExpectedValue}
              >
                {D6_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="action action-secondary"
              disabled={batchRows.length === 0}
              onClick={applyBatchExpectedValue}
              type="button"
            >
              Apply to all
            </button>
            <button
              className="action action-secondary"
              onClick={() => {
                batchFileInputRef.current?.click();
              }}
              type="button"
            >
              Upload batch
            </button>
            <button
              className="action action-ghost"
              disabled={batchRows.length === 0}
              onClick={() => {
                setBatchRows([]);
              }}
              type="button"
            >
              Clear batch
            </button>
            <button
              className="action action-secondary"
              disabled={batchRows.length === 0}
              onClick={exportBatchResults}
              type="button"
            >
              Export batch
            </button>
          </div>
          <input
            accept="image/*"
            className="hidden-input"
            multiple
            onChange={handleBatchSelection}
            ref={batchFileInputRef}
            type="file"
          />
        </div>

        {batchRows.length === 0 ? (
          <p>No batch loaded yet.</p>
        ) : (
          <>
            <div className="analysis-grid">
              <div className="analysis-card">
                <div className="analysis-label">Analyzed</div>
                <div className="analysis-value">{analyzedBatchRows.length}</div>
              </div>
              <div className="analysis-card">
                <div className="analysis-label">Matched</div>
                <div className="analysis-value">{matchedBatchRows.length}</div>
              </div>
              <div className="analysis-card">
                <div className="analysis-label">Accuracy</div>
                <div className="analysis-value">
                  {analyzedBatchRows.length === 0
                    ? "0%"
                    : `${Math.round((matchedBatchRows.length / analyzedBatchRows.length) * 100)}%`}
                </div>
              </div>
            </div>

            <div className="per-face-grid">
              {perFaceSummary.map((item) => (
                <div className="per-face-card" key={item.value}>
                  <div className="analysis-label">Face {item.value}</div>
                  <div className="analysis-value">
                    {item.total === 0 ? "0/0" : `${item.matched}/${item.total}`}
                  </div>
                </div>
              ))}
            </div>

            <div className="table-shell">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Expected</th>
                    <th>Detected</th>
                    <th>Confidence</th>
                    <th>Pips</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row) => {
                    const matched =
                      row.analysisState === "done" &&
                      row.detectedValue !== null &&
                      row.detectedValue === row.expectedValue;

                    return (
                      <tr key={row.id}>
                        <td>{row.label}</td>
                        <td>
                          <select
                            className="select select-compact"
                            onChange={(event) => {
                              const expectedValue = Number(event.target.value);
                              setBatchRows((currentRows) =>
                                currentRows.map((currentRow) =>
                                  currentRow.id === row.id
                                    ? {
                                        ...currentRow,
                                        expectedValue
                                      }
                                    : currentRow
                                )
                              );
                            }}
                            value={row.expectedValue}
                          >
                            {D6_VALUES.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{row.detectedValue ?? "none"}</td>
                        <td>{Math.round(row.confidence * 100)}%</td>
                        <td>{row.pipCount}</td>
                        <td
                          className={
                            row.analysisState === "error"
                              ? "result-miss"
                              : matched
                                ? "result-match"
                                : "result-miss"
                          }
                        >
                          {row.analysisState === "error"
                            ? "error"
                            : matched
                              ? "match"
                              : "miss"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="batch-notes">
              {batchRows.map((row) => (
                <details key={`${row.id}-notes`}>
                  <summary>{row.label}</summary>
                  {row.error ? <p>{row.error}</p> : null}
                  {row.debugImageUrl ? (
                    <img
                      alt={`Recognizer debug overlay for ${row.label}`}
                      className="debug-image"
                      src={row.debugImageUrl}
                    />
                  ) : null}
                  {row.notes.map((note) => (
                    <p key={`${row.id}-${note}`}>{note}</p>
                  ))}
                </details>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Fixture results</h2>
            <p>
              Record uploaded or captured test runs here to compare expected and
              detected outcomes while tuning the recognizer.
            </p>
          </div>
          <div className="results-actions">
            <span className="chip chip-idle">{fixtureRuns.length} runs</span>
            <button
              className="action action-secondary"
              disabled={fixtureRuns.length === 0}
              onClick={exportFixtureResults}
              type="button"
            >
              Export log
            </button>
          </div>
        </div>
        {fixtureRuns.length === 0 ? (
          <p>No fixture results recorded yet.</p>
        ) : (
          <div className="table-shell">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Source</th>
                  <th>Expected</th>
                  <th>Detected</th>
                  <th>Confirmed</th>
                  <th>Confidence</th>
                  <th>Pips</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {fixtureRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{run.label}</td>
                    <td>{run.source}</td>
                    <td>{run.expectedValue}</td>
                    <td>{run.detectedValue ?? "none"}</td>
                    <td>{run.confirmedValue}</td>
                    <td>{Math.round(run.confidence * 100)}%</td>
                    <td>{run.pipCount}</td>
                    <td
                      className={run.matched ? "result-match" : "result-miss"}
                    >
                      {run.matched ? "match" : "miss"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The selected file could not be read as an image."));
    };

    reader.onerror = () => {
      reject(new Error("The selected file could not be loaded."));
    };

    reader.readAsDataURL(file);
  });
}
