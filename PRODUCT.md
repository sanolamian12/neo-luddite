# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Experts who want to teach, govern, and oversee their own AI service, and engage directly with clients at critical moments.

## Product Purpose

Prototype an approachable, visual workspace for transferring expert know-how through cases, shaping question and answer knowledge, setting boundaries, rehearsing conversations, and taking over when human engagement is needed.

## Operating Context

An independent frontend fork allows exploration while the original backend changes. The primary experience uses professional concepts and guided teaching. Advanced LLM stages and connections remain available. See `design/agent-customization-prd.md` and `design/agent-customization-flows.md` for first-pass decisions and scope.

## Capabilities and Constraints

- Named reusable configurations with editable question and answer collections, case teaching, operating principles, rehearsals, and a simulated human review inbox.
- Advanced stages, instructions, connections, and conditional routing remain available separately.
- Confidence indicators in this prototype are explicitly illustrative, distinct from fact completeness.
- Execution is simulated. No actual LLM calls or model training occur.
- Local browser storage provides demo persistence per expert identity, not a production privacy boundary.
- Real model providers, hosting, private access controls, publishing, and client sharing remain open decisions.

## Evidence on Hand

Existing Korean-language expert workspace, local demo accounts, and synthetic conversation data. No measured model accuracy or confidence data.
