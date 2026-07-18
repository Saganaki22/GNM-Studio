# GNM Studio — Manual Smoke Test Checklist

Runtime validation for the structural refactor. This document is the release-acceptance
gate for the areas automated checks do not cover.

| Item | Value |
| --- | --- |
| Pre-refactor safety commit | `a6610a9620c3353c73dd98d9df7a985f83134d52` (branch `safety/pre-refactor`) |
| Refactor checkpoint under test | `2d49b1203a7e3d44d8d7c2bfc77ec40ec9d63d8c` (branch `safety/final-refactor`) |
| Tester | ____________________ |
| Date | ____________________ |
| Build tested | ☐ Desktop (`npm run tauri dev`) ☐ Web (`npm run dev`) |
| OS / WebView2 or browser version | ____________________ |

## How to run and observe

1. Start the desktop app with `npm run tauri dev` (or the web edition with `npm run dev`).
2. Open the WebView DevTools console before testing: `Ctrl+Shift+I` in dev builds
   (or right-click → Inspect). In the web edition use the browser DevTools.
3. Keep the **Console** tab visible during every test. Any red error, unhandled
   rejection, or React warning that appears during a step is a failure symptom even
   when the UI looks correct.
4. Connect a camera and microphone via **Connect capture devices** in the Capture
   panel before any recording, playback, or export test. Motion recording requires a
   detected face.
5. Mark exactly one result per test. **Blocked** means the test could not be executed
   (e.g. missing hardware); note why in the Notes line.

## Result summary

| # | Test | Result |
| --- | --- | --- |
| ST-01 | Motion recording | ☐ Pass ☐ Fail ☐ Blocked |
| ST-02 | Pause, resume and stop | ☐ Pass ☐ Fail ☐ Blocked |
| ST-03 | Playback and seeking | ☐ Pass ☐ Fail ☐ Blocked |
| ST-04 | Return to Live | ☐ Pass ☐ Fail ☐ Blocked |
| ST-05 | Output popout opening and focus | ☐ Pass ☐ Fail ☐ Blocked |
| ST-06 | Single-renderer ownership | ☐ Pass ☐ Fail ☐ Blocked |
| ST-07 | Normal popout closure | ☐ Pass ☐ Fail ☐ Blocked |
| ST-08 | Unexpected popout closure and recovery | ☐ Pass ☐ Fail ☐ Blocked |
| ST-09 | Fullscreen | ☐ Pass ☐ Fail ☐ Blocked |
| ST-10 | H control visibility toggle | ☐ Pass ☐ Fail ☐ Blocked |
| ST-11 | Escape from fullscreen | ☐ Pass ☐ Fail ☐ Blocked |
| ST-12 | PNG export | ☐ Pass ☐ Fail ☐ Blocked |
| ST-13 | Motion JSON export | ☐ Pass ☐ Fail ☐ Blocked |
| ST-14 | Animated GLB export | ☐ Pass ☐ Fail ☐ Blocked |
| ST-15 | WebM export | ☐ Pass ☐ Fail ☐ Blocked |
| ST-16 | MP4 export | ☐ Pass ☐ Fail ☐ Blocked |
| ST-17 | PNG-sequence export | ☐ Pass ☐ Fail ☐ Blocked |
| ST-18 | Camera and microphone release after app closure | ☐ Pass ☐ Fail ☐ Blocked |
| RG-01 | Regression: single Stage canvas / WebGL renderer | ☐ Pass ☐ Fail ☐ Blocked |
| RG-02 | Regression: no duplicate camera or microphone streams | ☐ Pass ☐ Fail ☐ Blocked |
| RG-03 | Regression: no duplicate tracking workers | ☐ Pass ☐ Fail ☐ Blocked |
| RG-04 | Regression: no repeated effect loops | ☐ Pass ☐ Fail ☐ Blocked |
| RG-05 | Regression: popout waiters clear after completion or disconnect | ☐ Pass ☐ Fail ☐ Blocked |
| RG-06 | Regression: camera and microphone indicators disappear after closure | ☐ Pass ☐ Fail ☐ Blocked |

---

## ST-01 — Motion recording

**Preconditions:** camera and microphone connected, face visible, tracking active.

**Steps**

1. In the Capture panel set **Record type** to **Motion**.
2. Click **Record** in the transport dock.
3. Move your head and change expressions for ~10 seconds.
4. Click **Stop** and wait for finalizing to finish.

**Expected result**

- Record button switches to **Stop**; the shell shows the recording state; the elapsed
  timer and frame count increase continuously while recording.
- After Stop, **Finalizing…** appears briefly, then the take is retained: frame count
  stays non-zero, the timeline becomes seekable, and the JSON/GLB/MP4 export buttons
  become enabled.

**Failure symptoms**

- Record button stays disabled with the *Motion mode needs a detected face* tooltip
  even though a face is visible and tracked.
- Frame count stays at 0 or the elapsed timer freezes while recording.
- **Finalizing…** never completes, or frame count resets to 0 after Stop.
- Console errors or unhandled rejections during start, recording, or finalizing.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-02 — Pause, resume and stop

**Preconditions:** ST-01 setup; Record type **Motion**.

**Steps**

1. Click **Record**.
2. After ~3 seconds click the pause/resume toggle in the transport dock (pause icon).
3. Wait ~3 seconds, then click the toggle again to resume.
4. Record ~3 more seconds, then click **Stop**.

**Expected result**

- While paused, the elapsed timer and frame count stop increasing; the toggle shows
  the resume state.
- Resuming continues the same take; timer and frame count increase again.
- Stop finalizes the full take, including frames recorded before and after the pause.

**Failure symptoms**

- Frames keep accumulating while paused, or the timer keeps running.
- Resume starts a new/empty take, throws a console error, or the recorded timeline
  shows a jump or gap that does not match the pause duration.
- Stop while paused (or immediately after resume) hangs in **Finalizing…** or errors.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-03 — Playback and seeking

**Preconditions:** a finalized motion take exists (from ST-01/ST-02), recorder idle.

**Steps**

1. Click the play toggle in the transport dock.
2. Let it play ~2 seconds, then drag the timeline slider to roughly the middle.
3. Drag the slider back near the start and resume playback.

**Expected result**

- Playback starts: the avatar replays the recorded motion, the playhead advances, and
  the elapsed label matches the timeline position.
- Dragging the slider immediately moves the playhead and snaps the avatar to the pose
  at that position.
- Seeking back and replaying works repeatedly without errors.

**Failure symptoms**

- Play does nothing, the avatar stays on the live camera feed, or the playhead does
  not move.
- The timeline slider is disabled although a take exists and the recorder is idle.
- Seeking throws console errors, shows a frozen/wrong pose, or the elapsed time no
  longer matches the slider position.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-04 — Return to Live

**Preconditions:** playback active from ST-03; live camera tracking available.

**Steps**

1. During playback (or while paused on a playback frame), locate the **Return to
   Live** button in the transport dock.
2. Click it.

**Expected result**

- Playback stops immediately; the avatar returns to following the live camera feed.
- The **Return to Live** button disappears; the playhead resets.

**Failure symptoms**

- The avatar stays frozen on the last playback frame.
- Live tracking does not resume (avatar unresponsive to head movement).
- Console errors, or the button remains visible after the return.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-05 — Output popout opening and focus

**Preconditions:** app idle, no recording in progress.

**Steps**

1. Click the popout button in the viewport toolbar (tooltip: *Open a clean canvas-only
   output window*).
2. Wait for the popout to connect.
3. In the studio placeholder, click **Focus popout**.

**Expected result**

- A separate clean output window opens and shows the live avatar.
- A success toast *Output popout connected* appears exactly once.
- The studio viewport shows the placeholder *Canvas is live in the popout*.
- **Focus popout** raises/focuses the popout window.

**Failure symptoms**

- Error toast *Output popout did not connect within 10 seconds…* or *Open output
  popout: …*; in the web edition, a blocked-popup warning.
- Placeholder stuck on *Opening output canvas…*.
- Console errors mentioning `BroadcastChannel`, channel handshake, or heartbeat.
- The toast appears more than once (duplicate subscription symptom — see RG-04).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-06 — Single-renderer ownership

**Preconditions:** popout active (ST-05).

**Steps**

1. With the popout live, look at the studio viewport.
2. In the studio window DevTools console run:
   `document.querySelectorAll("canvas").length`
   and confirm no 3D stage canvas remains mounted in the studio (the placeholder
   replaces it). The hidden tracking `<video>` element is expected and is not a canvas.
3. In the popout window DevTools console run the same query and confirm exactly one
   stage canvas there.
4. Watch the avatar in both windows for ~30 seconds.

**Expected result**

- Exactly one 3D renderer exists at any moment: in the popout while it is active, in
  the studio otherwise. The studio shows only the placeholder.
- The avatar animates smoothly in the popout; nothing renders in the studio.

**Failure symptoms**

- The avatar renders in both windows simultaneously (double GPU work, doubled GPU
  usage in Task Manager).
- Console warnings about multiple WebGL contexts or context loss.
- The studio canvas re-mounts while the popout still owns the output.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-07 — Normal popout closure

**Preconditions:** popout active (ST-05), no recording or encoding in progress.

**Steps**

1. In the studio placeholder click **Bring canvas back**.
2. Wait for the handoff to complete.
3. Confirm the avatar is live in the studio viewport again.

**Expected result**

- The popout window closes; the studio placeholder is replaced by the live Stage.
- No error or warning toasts; the avatar keeps tracking without a restart.

**Failure symptoms**

- Warning toast *Output is busy* although nothing is recording.
- Warning toast *Output handoff timed out…*.
- The studio viewport stays on the placeholder, shows a black canvas, or tracking
  freezes after the renderer returns.
- Console errors during the shutdown acknowledgement.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-08 — Unexpected popout closure and recovery

**Preconditions:** popout active (reopen via ST-05), a motion take already recorded
and retained.

**Steps**

1. Close the popout window directly via its OS window close button (X) — do **not**
   use **Bring canvas back**.
2. Observe the studio for ~5 seconds.
3. Confirm the previously recorded take is still available (frame count and timeline).

**Expected result**

- A warning toast *Output popout closed* (or *Output popout disconnected*) appears
  exactly once, stating the studio renderer was recovered.
- The studio viewport automatically restores the live Stage without a restart.
- Recorded motion frames remain available.

**Failure symptoms**

- The studio stays on the placeholder indefinitely or the app crashes/freezes.
- No recovery toast, or the toast repeats.
- The restored canvas is black or tracking is dead.
- Console unhandled rejections or handshake errors after the close.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-09 — Fullscreen

**Preconditions:** studio viewport visible (popout closed).

**Steps**

1. Click the fullscreen toggle in the viewport toolbar (maximize icon).
2. Observe the layout for ~5 seconds without moving the pointer.
3. Move the pointer.
4. Click the toggle again (minimize icon) to exit.

**Expected result**

- The viewport enters fullscreen and the Stage resizes correctly.
- Controls behave per the fullscreen settings (auto-hide after the configured delay
  when enabled); moving the pointer reveals them again.
- Toggling exits fullscreen and restores the normal layout.

**Failure symptoms**

- Error toast *Enter fullscreen: …* or *Exit fullscreen: …*.
- The Stage does not resize, shows black, or the layout is clipped/overlapping.
- Controls never hide when auto-hide is enabled, or never reappear on pointer move.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-10 — H control visibility toggle

**Preconditions:** fullscreen active (ST-09).

**Steps**

1. While in fullscreen, press **H**.
2. Press **H** again.
3. Click into any text input, type `h`, then click out and press **H** once more.

**Expected result**

- First **H** hides the fullscreen controls; second **H** shows them again.
- Typing `h` inside an input does **not** toggle the controls.
- After clicking out, **H** toggles again.

**Failure symptoms**

- **H** does nothing in fullscreen.
- Controls get stuck hidden (pointer move does not reveal them afterwards unless
  *Always clean* is enabled).
- **H** fires while typing in an input, or triggers outside fullscreen.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-11 — Escape from fullscreen

**Preconditions:** fullscreen active (ST-09), settings popover and backend menus
closed.

**Steps**

1. Press **Esc**.
2. Re-enter fullscreen and press **Esc** a second time.

**Expected result**

- Each **Esc** exits fullscreen and returns to the normal studio layout.

**Failure symptoms**

- **Esc** does nothing; the app stays in fullscreen.
- Exiting throws a console error or leaves the layout in the `viewport-focus` state
  (controls/layout still in fullscreen styling).
- **Esc** is swallowed by another handler (settings popover, backend menu) when those
  are closed.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-12 — PNG export

**Preconditions:** studio viewport live; then repeat once with the popout active.

**Steps**

1. Click the camera icon in the viewport toolbar (*Save a PNG photo of the exact
   canvas*).
2. Choose a location in the save dialog and save.
3. Open the saved PNG and compare it with the canvas.
4. Open the popout (ST-05) and repeat steps 1–3 while the popout owns the renderer.

**Expected result**

- A save dialog appears, the file is written, and the PNG matches the visible canvas
  content (correct pose, background, and enabled layers) in both ownership states.

**Failure symptoms**

- Error toast or console error (popout path: *Popout PNG capture* or *The popout did
  not return the PNG within 15 seconds*).
- The PNG is black, empty, stale, or shows the wrong layer composition.
- No save dialog appears.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-13 — Motion JSON export

**Preconditions:** a finalized motion take exists.

**Steps**

1. In the transport dock click **JSON** (*Export motion JSON*) and save the file.
2. Open the file in a text editor and confirm it parses as JSON and contains frame
   data.
3. Click **Import JSON**, select the exported file, and confirm the take loads.

**Expected result**

- The file saves, parses as valid JSON, and contains the recorded frames (and audio
  reference when the microphone was enabled).
- Re-importing the file restores the take without errors.

**Failure symptoms**

- The **JSON** button stays disabled although a take exists.
- The file is empty, truncated, or invalid JSON.
- Import throws an error/toast or loads a take with the wrong duration.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-14 — Animated GLB export

**Preconditions:** a finalized motion take exists.

**Steps**

1. In the transport dock click **GLB** (*Export animated GLB for Blender*) and save.
2. Open the file in Blender (File → Import → glTF 2.0) or a glTF viewer.
3. Play the animation.

**Expected result**

- The GLB imports without errors and contains the animated avatar motion matching the
  take.

**Failure symptoms**

- Export button disabled, error toast, or console exception during export.
- Blender/viewer reports a corrupt or invalid file.
- The model imports but has no animation, or the motion does not match the take.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-15 — WebM export

**Preconditions:** a recorded take with microphone audio exists (avatar or composite
recording, or a motion take for rendered export).

**Steps**

1. Open the **Export** workspace and select the **WEBM** tab (for a direct browser
   recording, the *WebM source* button in the transport dock may also be available).
2. Start the export and wait for it to finish.
3. Play the file in a browser or media player with sound on.

**Expected result**

- The export completes and the WebM plays with the recorded visuals and the retained
  microphone audio.

**Failure symptoms**

- Warning/error toast about the microphone track (*The selected recorder codec
  omitted the microphone track…* or *Could not verify recorded microphone audio…*).
- Zero-byte or unplayable file; missing audio.
- Console encoder errors, or the export never completes.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-16 — MP4 export

**Preconditions:** a recorded take exists; desktop build with the MP4 backend set to
**Auto** (or explicitly test both **System FFmpeg** and **Portable WebCodecs**).

**Steps**

1. Click **MP4** in the transport dock (or use the Export workspace **MP4** tab).
2. Wait through the *Rendering …%* / *FFmpeg rendering…* progress.
3. Play the exported MP4 with sound on.

**Expected result**

- The export progresses to 100%, completes, and the MP4 plays as H.264 video with AAC
  microphone audio when the take contains it.

**Failure symptoms**

- The button stays in **Rendering …%** / *FFmpeg rendering…* forever, or an error
  toast/console error appears (including backend fallback failures).
- The MP4 is unplayable, has no audio, or shows frozen/black frames.
- Error stating the output renderer is changing owners and never clears (see RG-05).

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-17 — PNG-sequence export

**Preconditions:** a finalized motion take exists.

**Steps**

1. Open the **Export** workspace and select the **PNG SEQUENCE** tab.
2. Start the export and wait for completion.
3. Open the saved ZIP, extract it, and inspect the numbered frames.

**Expected result**

- A single ZIP is saved containing one numbered PNG per sampled frame
  (count ≈ duration × FPS); frames match the take and are not black.
- Works both with the studio renderer and while the popout owns the renderer
  (repeat once in each state if time permits).

**Failure symptoms**

- The export hangs, errors, or the ZIP is missing/empty.
- Frames are black, duplicated, or the count is clearly wrong.
- Console errors about the popout frame transfer surface (*Could not create the
  popout frame transfer surface*) when the popout is active.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## ST-18 — Camera and microphone release after app closure

**Preconditions:** camera and microphone connected and active in the app; note the OS
camera/microphone indicators (Windows system tray icons and the camera LED).

**Steps**

1. Confirm both indicators are active while the app runs.
2. Close the app window normally.
3. Watch the indicators and camera LED for ~10 seconds.
4. Optionally open Task Manager and confirm no app/WebView processes remain.

**Expected result**

- The camera and microphone indicators (and camera LED) turn off shortly after the
  window closes; no orphaned app processes keep the devices busy.

**Failure symptoms**

- Indicators or the camera LED stay on after closure.
- The devices remain reported as in use, or orphaned `gnm-studio` / WebView2
  processes survive in Task Manager.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

# Regression checks (refactor-specific)

Run these after the functional tests above, in the same session where possible.
They target the failure modes the structural refactor was meant to eliminate.

## RG-01 — Only one `Stage` canvas/WebGL renderer exists

**Steps**

1. In the studio console run `document.querySelectorAll("canvas").length` with the
   popout closed — exactly one stage canvas.
2. Open the popout; confirm the studio has no stage canvas (placeholder only) and the
   popout document has exactly one.
3. Repeat open → close (X) → reopen → **Bring canvas back** five times; re-check the
   canvas count in both windows after each cycle.

**Expected:** exactly one WebGL stage canvas across the whole app at every moment;
canvas count never grows across cycles.

**Fail if:** canvas count increases per cycle, both windows render simultaneously, or
the console logs WebGL context creation/loss warnings per cycle.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

## RG-02 — No duplicate camera or microphone streams

**Steps**

1. In the studio console run:
   `[...document.querySelectorAll("video")].flatMap(v => v.srcObject ? v.srcObject.getTracks() : []).map(t => t.kind + ":" + t.readyState)`
2. Open and close the popout twice, start and stop a short recording, then re-run the
   query.
3. Watch for repeated OS permission prompts or camera LED flicker during popout
   handoffs.

**Expected:** at most one active video track and one active audio track at all times;
no re-prompts for device access during popout open/close or recording start/stop.

**Fail if:** duplicate live tracks appear, track count grows after handoffs, or the OS
re-prompts for camera/microphone access mid-session.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

## RG-03 — No duplicate tracking workers

**Steps**

1. Open DevTools → **Sources** → **Workers** (web edition: **Application** →
   **Workers**) and count the face-tracking workers while idle.
2. Start/stop a recording, open/close the popout, then check the worker list again.

**Expected:** a single tracking worker for the whole session; starting/stopping
recordings and popout handoffs do not spawn additional workers.

**Fail if:** worker count increases after recordings or popout cycles, or terminated
workers accumulate.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

## RG-04 — No repeated effect loops

**Steps**

1. Clear the console, then open the popout once: the *Output popout connected* toast
   must appear exactly once.
2. Start and stop one recording: each status toast (start, finalize) appears once.
3. Leave the app running with live tracking for 5 minutes; watch the console and the
   frame rate.

**Expected:** every toast/log appears once per event; no repeating log spam, no
mount/unmount cycling, and no visible frame-rate decay over time.

**Fail if:** toasts or logs duplicate (a sign of duplicated effect subscriptions), the
console shows repeating interval/timer spam, or performance degrades over the 5-minute
idle period.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

## RG-05 — Popout waiters clear after completion or disconnect

**Steps**

1. Open the popout, then run a PNG export (ST-12, popout path) — it must succeed.
2. Close the popout via X mid-session (ST-08), then run a studio PNG export — it must
   also succeed.
3. Attempt an MP4/PNG-sequence export while opening the popout, then retry it after
   the handoff finishes.

**Expected:** completed or disconnected popout operations leave no pending waiters;
later operations are never rejected with stale *did not acknowledge* / *did not
return* / *changing owners* errors once the handoff or recovery has finished.

**Fail if:** a successful operation is followed by a late timeout rejection (e.g. *The
popout did not return the PNG within 15 seconds*), unhandled promise rejections appear
after recovery, or exports stay blocked by a stale owner state.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

## RG-06 — Camera and microphone indicators disappear after closure

**Steps**

1. Use the camera and microphone, open and close the popout, and complete one
   recording.
2. Close the app and watch the OS camera/microphone indicators and camera LED
   (extends ST-18 to a session that exercised the popout and recording paths).
3. Confirm in Task Manager that no app/WebView processes survive.

**Expected:** indicators and LED turn off within a few seconds of closure; no orphaned
processes hold the devices.

**Fail if:** indicators/LED persist, devices stay busy, or processes survive after
closure.

**Result:** ☐ Pass ☐ Fail ☐ Blocked — Notes: ______________________________

---

## Sign-off

- All ST-01…ST-18 and RG-01…RG-06 marked Pass (or Blocked with an accepted reason):
  ☐ Yes ☐ No
- Release acceptance for `2d49b1203a7e3d44d8d7c2bfc77ec40ec9d63d8c`:
  ☐ Approved ☐ Rejected
- Tester signature: ____________________  Date: ____________________
