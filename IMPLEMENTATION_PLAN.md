# Implementation Plan

## Objective

Establish a production-shaped Next.js web foundation for CLOTTIS Teams.

## Current Scope

- Next.js App Router, React, TypeScript and Tailwind CSS.
- Structured config -> service -> executor -> component data flow.
- Backend health status component and frontend health route.
- Container, environment example and placeholder CI.

## Non-Goals

- Authentication UI and session handling.
- Project, sprint, board or task interfaces.
- Product design system beyond the minimum semantic token foundation.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Container configuration validation.

## Next Approved Unit

Implement authentication only after its backend contract is reviewed.
