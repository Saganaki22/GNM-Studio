# Refactor cleanup inventory

This inventory records the owner and disposal path for long-lived browser resources after the `App.tsx` refactor.

| Resource | Owner | Cleanup path |
| --- | --- | --- |
| Camera and microphone streams/tracks | `useCaptureDevices` | Replaced streams are stopped before reassignment; all tracks are stopped on effect cleanup/unmount. |
| Audio meter `AudioContext` and RAF | `useAudioMonitor` | The RAF is cancelled and the context is closed by the owning effect cleanup. |
| Face-tracking worker, capture RAF and health timeout | `useFaceTracker` | Reload/unmount terminates the worker, cancels the RAF and clears the pending health check. |
| Calibration delays/countdown waiters | `useNeutralCalibration` | Cancellation/unmount clears every timeout, resolves private delay waiters and invalidates the active session. |
| Playback RAF | `usePlayback` | Stop, seek/reset and unmount cancel the owned animation frame. |
| Recording `MediaRecorder`, cloned streams/tracks and ticker | `useRecordingSession` | Finalization/error/unmount stops the recorder and tracks and clears the interval; recorded appearance object URLs are revoked when released. |
| Background image object URLs | `useBackgroundImage` | Replacement/clear/unmount revokes URLs unless the current recorded appearance still retains them. |
| Output `BroadcastChannel`, popout window, heartbeat/connect/shutdown timers, restore RAF and pending waiters | `useOutputPopout` | Shutdown/unmount closes the channel/window, clears timers/RAF and privately rejects and removes every recording/PNG waiter. |
| Fullscreen controls timeout/listeners | `useFullscreenControls` | Fullscreen exit/unmount clears the hide timeout and removes keyboard/fullscreen listeners. |
| Workspace highlight timeout and RAF | `useStudioControls` | A later navigation cancels the prior work; unmount clears both handles. |
| FFmpeg probe timeout | `useFfmpegEncoder` | Dependency change/unmount cancels the delayed probe and ignores stale completion. |
| Offline export recorder, canvas stream, tracks, audio source/context and RAF | `motionVideoRenderer` | Every render path uses `finally` to cancel/stop/close its temporary resources and restore playback/view state. |
| GNM identity/expression evaluators and debounce timers | `useGnmRuntime` | Evaluator hooks own their workers/evaluators; each debounce effect clears its timeout on replacement/unmount. |

`useCaptureTrackingPipeline` and `useTakePipeline` only compose public hook APIs through narrow adapters. They do not take ownership of or expose private resource refs.
