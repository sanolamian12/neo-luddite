# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Experts who want to configure and reuse their own multi-stage AI agent.

## Product Purpose

Prototype an editable workflow of LLM stages, beginning with fact collection, answer generation, and evaluation of whether to recommend a human expert.

## Operating Context

An independent frontend fork allows exploration while the original backend changes. Experts edit stage instructions and connections, then inspect a simulated conversation and stage outputs.

## Capabilities and Constraints

- Editable stages, instructions, connections, conditional routing, and a named reusable agent configuration.
- Confidence indicators in this prototype are explicitly illustrative, distinct from fact completeness.
- Execution is simulated. No actual LLM calls or model training occur.
- Local browser storage provides demo persistence per expert identity, not a production privacy boundary.
- Real model providers, hosting, private access controls, publishing, and client sharing remain open decisions.

## Evidence on Hand

Existing Korean-language expert workspace, local demo accounts, and synthetic conversation data. No measured model accuracy or confidence data.
