# Implementation Plan - Optimize User Idle Check for Post Engagement Tracking

## Proposed Changes

### `src/utils/postEngagement.ts`
- Update `idleThresholdMs` from 60000ms to 45000ms (45 seconds) as requested.
- Expand user activity listeners in `setupUserActivityListeners()` to include `wheel`, `pointermove`, `touchmove`, and visibility/focus handlers so engagement tracking pauses promptly when the user is inactive.

## Verification Plan
- Verify app compiles successfully (`compile_applet`).
- Verify linter passes without errors (`lint_applet`).
