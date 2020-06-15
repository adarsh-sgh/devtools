/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

// Harness for use by automated tests. Adapted from various test devtools
// test harnesses.

const { ThreadFront } = require("protocol/thread");
const { setRandomLogpoint } = require("protocol/logpoint");
const { assert } = require("protocol/utils");

const dbg = gToolbox.getPanel("debugger").getVarsForTests();

const dbgSelectors = {};
for (const [name, method] of Object.entries(dbg.selectors)) {
  dbgSelectors[name] = (...args) => method(dbg.store.getState(), ...args);
}

function waitForTime(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForElapsedTime(time, ms) {
  const wait = time + ms - Date.now();
  if (wait > 0) {
    return waitForTime(wait);
  }
}

async function waitUntil(fn) {
  while (true) {
    const rv = fn();
    if (rv) {
      return rv;
    }
    await waitForTime(50);
  }
}

function finish() {
  console.log("TestFinished");

  // This is pretty goofy but this is recognized during automated tests and sent
  // to the UI process to indicate the test has finished.
  dump(`WebReplaySendAsyncMessage TestFinished`);
}

function selectConsole() {
  return gToolbox.selectTool("console");
}

function selectDebugger() {
  return gToolbox.selectTool("debugger");
}

function selectInspector() {
  return gToolbox.selectTool("inspector");
}

function getContext() {
  return dbgSelectors.getContext();
}

function getThreadContext() {
  return dbgSelectors.getThreadContext();
}

function findSource(url) {
  if (typeof url !== "string") {
    // Support passing in a source object itelf all APIs that use this
    // function support both styles
    const source = url;
    return source;
  }

  const sources = dbgSelectors.getSourceList();
  return sources.find((s) => (s.url || "").includes(url));
}

function waitForSource(url) {
  return waitUntil(() => findSource(url));
}

async function selectSource(url) {
  const source = findSource(url);
  await dbg.actions.selectLocation(
    getContext(),
    { sourceId: source.id },
    { keepContext: false }
  );
  return waitForSelectedSource(url);
}

async function addBreakpoint(url, line, column, options) {
  const source = await waitForSource(url);
  const sourceId = source.id;
  const bpCount = dbgSelectors.getBreakpointCount();
  await dbg.actions.addBreakpoint(
    getContext(),
    { sourceId, line, column },
    options
  );
  await waitUntil(() => {
    return dbgSelectors.getBreakpointCount() == bpCount + 1;
  });
}

async function setBreakpointOptions(url, line, column, options) {
  const source = await waitForSource(url);
  const sourceId = source.id;
  column = column || getFirstBreakpointColumn(line, sourceId);
  await dbg.actions.addBreakpoint(
    getContext(),
    { sourceId, line, column },
    options
  );
}

async function disableBreakpoint(url, line, column) {
  const source = await waitForSource(url);
  const sourceId = source.id;
  column = column || getFirstBreakpointColumn(line, sourceId);
  const location = { sourceId, sourceUrl: source.url, line, column };
  const bp = dbgSelectors.getBreakpointForLocation(location);
  await dbg.actions.disableBreakpoint(getContext(), bp);
}

function getFirstBreakpointColumn(line, sourceId) {
  const source = dbgSelectors.getSource(sourceId);
  const position = dbgSelectors.getFirstBreakpointPosition({ line, sourceId });
  return position.column;
}

function removeAllBreakpoints() {
  return dbg.actions.removeAllBreakpoints(getContext());
}

function isPaused() {
  return dbgSelectors.getIsPaused(dbgSelectors.getCurrentThread());
}

async function waitForLoadedScopes() {
  const scopes = await waitUntil(() => document.querySelector(".scopes-list"));
  // Since scopes auto-expand, we can assume they are loaded when there is a tree node
  // with the aria-level attribute equal to "2".
  await waitUntil(() => scopes.querySelector('.tree-node[aria-level="2"]'));
}

async function waitForInlinePreviews() {
  await waitUntil(() => dbgSelectors.getSelectedInlinePreviews());
}

function waitForSelectedSource(url) {
  const {
    getSelectedSourceWithContent,
    hasSymbols,
    getBreakableLines,
  } = dbgSelectors;

  return waitUntil(() => {
    const source = getSelectedSourceWithContent() || {};
    if (!source.content) {
      return false;
    }

    if (!url) {
      return true;
    }

    const newSource = findSource(url);
    if (newSource.id != source.id) {
      return false;
    }

    return hasSymbols(source) && getBreakableLines(source.id);
  });
}

async function waitForPaused(url) {
  const {
    getSelectedScope,
    getCurrentThread,
    getCurrentThreadFrames,
  } = dbgSelectors;

  await waitUntil(() => {
    return isPaused() && !!getSelectedScope(getCurrentThread());
  });

  await waitUntil(() => getCurrentThreadFrames());
  await waitForLoadedScopes();
  await waitForSelectedSource(url);
}

async function waitForPausedNoSource() {
  await waitUntil(() => isPaused());
}

function hasFrames() {
  const frames = dbgSelectors.getCurrentThreadFrames();
  return frames.length > 0;
}

function getVisibleSelectedFrameLine() {
  const frame = dbgSelectors.getVisibleSelectedFrame();
  return frame && frame.location.line;
}

function resumeThenPauseAtLineFunctionFactory(method) {
  return async function (lineno, waitForLine) {
    console.log(`Starting ${method} to ${lineno}...`);
    await dbg.actions[method](getThreadContext());
    if (lineno !== undefined) {
      await waitForPaused();
    } else {
      await waitForPausedNoSource();
    }
    if (waitForLine) {
      await waitUntil(() => lineno == getVisibleSelectedFrameLine());
    } else {
      const pauseLine = getVisibleSelectedFrameLine();
      assert(pauseLine == lineno, `Expected line ${lineno} got ${pauseLine}`);
    }
    console.log(`Finished ${method} to ${lineno}!`);
  };
}

// Define various methods that resume a thread in a specific way and ensure it
// pauses at a specified line.
const rewindToLine = resumeThenPauseAtLineFunctionFactory("rewind");
const resumeToLine = resumeThenPauseAtLineFunctionFactory("resume");
const reverseStepOverToLine = resumeThenPauseAtLineFunctionFactory("reverseStepOver");
const stepOverToLine = resumeThenPauseAtLineFunctionFactory("stepOver");
const stepInToLine = resumeThenPauseAtLineFunctionFactory("stepIn");
const stepOutToLine = resumeThenPauseAtLineFunctionFactory("stepOut");

function resumeAndPauseFunctionFactory(method) {
  return async function (lineno, waitForLine) {
    await dbg.actions[method](getThreadContext());
    await waitForPausedNoSource();
  };
}

const reverseStepOverAndPause = resumeAndPauseFunctionFactory("reverseStepOver");
const stepOverAndPause = resumeAndPauseFunctionFactory("stepOver");
const stepInAndPause = resumeAndPauseFunctionFactory("stepIn");
const stepOutAndPause = resumeAndPauseFunctionFactory("stepOut");

async function ensureWatchpointsExpanded() {
  const header = document.querySelector(".watch-expressions-pane ._header");
  if (!header.querySelector(".expanded")) {
    header.click();
    await waitUntil(() => header.querySelector(".expanded"));
  }
}

async function checkEvaluateInTopFrame(text, expected) {
  await ensureWatchpointsExpanded();
  await dbg.actions.addExpression(getThreadContext(), text);
  await waitUntil(() => {
    const node = document.querySelector(".watch-expressions-pane .object-node");
    return node && node.innerText == `${text}: ${expected}`;
  });
  await dbg.actions.deleteExpression({ input: text });
}

async function waitForScopeValue(name, value) {
  return waitUntil(() => {
    const nodes = document.querySelectorAll(".scopes-pane .object-node");
    return [...nodes].some((node) => node.innerText == `${name}\n: \n${value}`);
  });
}

async function toggleBlackboxSelectedSource() {
  const { getSelectedSource } = dbgSelectors;
  const blackboxed = getSelectedSource().isBlackBoxed;
  document.querySelector(".black-box").click();
  await waitUntil(() => getSelectedSource().isBlackBoxed != blackboxed);
}

function findMessages(text, extraSelector = "") {
  const messages = document.querySelectorAll(
    `.webconsole-output .message${extraSelector}`
  );
  return [...messages].filter((msg) => msg.innerText.includes(text));
}

function waitForMessage(text, extraSelector) {
  return waitUntil(() => {
    const messages = findMessages(text, extraSelector);
    return messages.length ? messages[0] : null;
  });
}

async function warpToMessage(text) {
  const msg = await waitForMessage(text);
  const warpButton = msg.querySelector(".rewindable");
  warpButton.click();
  await waitForPaused();
}

function checkPausedMessage(text) {
  return waitForMessage(text, ".paused");
}

function waitForMessageCount(text, count) {
  return waitUntil(() => {
    const messages = findMessages(text);
    return messages.length == count ? messages : null;
  });
}

async function checkMessageStack(text, expectedFrameLines, expand) {
  const msgNode = await waitForMessage(text);
  assert(!msgNode.classList.contains("open"));

  if (expand) {
    const button = await waitUntil(() =>
      msgNode.querySelector(".collapse-button")
    );
    button.click();
  }

  const framesNode = await waitUntil(() => msgNode.querySelector(".frames"));
  const frameNodes = Array.from(framesNode.querySelectorAll(".frame"));
  assert(frameNodes.length == expectedFrameLines.length);

  for (let i = 0; i < frameNodes.length; i++) {
    const frameNode = frameNodes[i];
    const line = frameNode.querySelector(".line").textContent;
    assert(line == expectedFrameLines[i].toString());
  }
}

function checkJumpIcon(msg) {
  const jumpIcon = msg.querySelector(".jump-definition");
  assert(jumpIcon);
}

function findObjectInspectorNode(oi, nodeLabel) {
  return [...oi.querySelectorAll(".tree-node")].find((node) => {
    return node.innerText.includes(nodeLabel);
  });
}

async function findMessageExpandableObjectInspector(msg) {
  return waitUntil(() => {
    const inspectors = msg.querySelectorAll(".object-inspector");
    return [...inspectors].find((oi) => oi.querySelector(".arrow"));
  });
}

async function toggleObjectInspectorNode(node) {
  const arrow = await waitUntil(() => node.querySelector(".arrow"));
  arrow.click();
}

async function checkMessageObjectContents(msg, expected, expandList = []) {
  const oi = await findMessageExpandableObjectInspector(msg);
  await toggleObjectInspectorNode(oi);

  for (const label of expandList) {
    const labelNode = await waitUntil(() => findObjectInspectorNode(oi, label));
    await toggleObjectInspectorNode(labelNode);
  }

  await waitUntil(() => {
    const nodes = oi.querySelectorAll(".tree-node");
    if (nodes && nodes.length > 1) {
      const properties = [...nodes].map((n) => n.textContent);
      return expected.every((s) => properties.find((v) => v.includes(s)));
    }
    return null;
  });
}

function findScopeNode(text) {
  return waitUntil(() => {
    const nodes = document.querySelectorAll(".scopes-list .node");
    return [...nodes].find((node) => node.innerText.includes(text));
  });
}

async function toggleScopeNode(text) {
  const node = await findScopeNode(text);
  return toggleObjectInspectorNode(node);
}

async function executeInConsole(text) {
  gToolbox.getPanel("console").hud.evaluateInput(text);
}

async function checkInlinePreview(name, text) {
  await waitUntil(() => {
    const previews = document.querySelectorAll(".inline-preview-outer");
    return [...previews].some((p) => {
      const label = p.querySelector(".inline-preview-label");
      const value = p.querySelector(".inline-preview-value");
      return label.innerText.includes(name) && value.innerText.includes(text);
    });
  });
}

function waitForFrameTimeline(width) {
  return waitUntil(() => {
    const elem = document.querySelector(".frame-timeline-progress");
    return elem && elem.style.width == width;
  });
}

function checkFrames(count) {
  const frames = dbgSelectors.getFrames(dbgSelectors.getCurrentThread());
  assert(frames.length == count);
}

async function selectFrame(index) {
  const frames = dbgSelectors.getFrames(dbgSelectors.getCurrentThread());
  await dbg.actions.selectFrame(getThreadContext(), frames[index]);
}

function togglePrettyPrint() {
  const sourceId = dbgSelectors.getSelectedSourceId();
  return dbg.actions.togglePrettyPrint(getContext(), sourceId);
}

function addEventListenerLogpoints(logpoints) {
  return dbg.actions.addEventListenerBreakpoints(logpoints);
}

async function toggleExceptionLogging() {
  const elem = await waitUntil(() => document.querySelector(".breakpoints-exceptions input"));
  elem.click();
}

async function playbackRecording() {
  const timeline = await waitUntil(() => gToolbox.timeline);
  timeline.startPlayback();
  await waitUntil(() => !timeline.state.playback);
}

async function randomLog(numLogs) {
  const messages = await setRandomLogpoint(numLogs);
  await Promise.all(messages.map(text => waitForMessage(text)));
  return messages;
}

async function findMarkupNode(text) {
  return waitUntil(() => {
    const nodes = document.querySelectorAll("#markup-box .editor");
    return [...nodes].find(n => n.innerText.includes(text));
  });
}

async function toggleMarkupNode(node) {
  const parent = node.closest(".expandable");
  const expander = parent.querySelector(".expander");
  expander.click();
}

async function searchMarkup(text) {
  const box = document.getElementById("inspector-searchbox");
  box.dispatchEvent(new FocusEvent("focus"));
  if (text !== undefined) {
    // Undefined is used to continue the previous search.
    box.value = text;
  }
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

async function waitForSelectedMarkupNode(text) {
  return waitUntil(() => {
    const node = document.querySelector(".theme-selected");
    const editor = node.parentNode.querySelector(".editor");
    return editor.innerText.includes(text);
  });
}

module.exports = {
  selectConsole,
  selectDebugger,
  selectInspector,
  dbg,
  assert,
  finish,
  waitForTime,
  waitForElapsedTime,
  waitUntil,
  selectSource,
  addBreakpoint,
  setBreakpointOptions,
  disableBreakpoint,
  removeAllBreakpoints,
  rewindToLine,
  resumeToLine,
  reverseStepOverToLine,
  stepOverToLine,
  stepInToLine,
  stepOutToLine,
  reverseStepOverAndPause,
  stepOverAndPause,
  stepInAndPause,
  stepOutAndPause,
  hasFrames,
  waitForLoadedScopes,
  waitForInlinePreviews,
  checkEvaluateInTopFrame,
  waitForScopeValue,
  toggleBlackboxSelectedSource,
  findMessages,
  waitForMessage,
  warpToMessage,
  checkPausedMessage,
  waitForMessageCount,
  checkMessageStack,
  checkJumpIcon,
  checkMessageObjectContents,
  toggleObjectInspectorNode,
  findScopeNode,
  toggleScopeNode,
  executeInConsole,
  checkInlinePreview,
  waitForFrameTimeline,
  checkFrames,
  selectFrame,
  togglePrettyPrint,
  addEventListenerLogpoints,
  toggleExceptionLogging,
  playbackRecording,
  randomLog,
  findMarkupNode,
  toggleMarkupNode,
  searchMarkup,
  waitForSelectedMarkupNode,
};
