# Clinical Precision Framework - DESIGN SYSTEM

This document defines the visual and interaction standards for the "APP CONTROL DE GUACHERAS".

## Core Principles
- **Clinical Precision**: Every element must feel clean, purpose-driven, and high-quality.
- **Offline Reliability**: Visual feedback for connectivity and sync status is paramount.
- **Tactile Comfort**: Large touch targets for outdoor/field use.
- **Regla de No-Líneas**: No 1px borders. Use tonal shadows and glassmorphism for depth and separation.

## Design Tokens

### Colors
- **Primary**: `#1a237e` (Deep Indigo) - Headers, Primary Buttons, Active States.
- **Secondary**: `#2e7d32` (Forest Green) - Success, Save Buttons, Good Status.
- **Tertiary**: `#502400` (Rich Earth) - Warm accents, specific warnings.
- **Neutral High**: `#f5f6fa` (Background)
- **Neutral Surface**: `rgba(255, 255, 255, 0.8)` (Glassmorphism Base)

### Typography
- **Font**: Inter, Roboto, or system-ui sans-serif.
- **Scales**:
  - H1: 1.5rem / 700
  - H2: 1.2rem / 600
  - Body: 1rem / 400
  - Label: 0.85rem / 500 (Uppercase in many headers)

### Spacing & Borders
- **Border Radius**: `1.5rem` (xl) for cards and main containers.
- **Shadows**: 
  - Subte: `0 4px 12px rgba(0, 0, 0, 0.05)`
  - Elevated: `0 8px 24px rgba(0, 0, 0, 0.12)`
- **Glassmorphism**: `backdrop-filter: blur(12px)` for overlay surfaces.

### Components
- **Sync-Bar**: Fixed position, indicating Online/Offline/Pending count.
- **Navigation**: Bottom Bar with persistent icons.
- **Inputs**: High contrast, 48px+ touch area.
