## ADDED Requirements

### Requirement: Formal Conversation Pipeline Context Boundary

The system SHALL allow the `formal_conversation` pipeline to execute through an explicit pipeline context and pipeline state boundary instead of directly depending on the full Runtime object shape.

#### Scenario: Formal conversation input is context-based
- **WHEN** `formal_conversation` pipeline input is created
- **THEN** it contains a dedicated pipeline context and pipeline state
- **AND** it does not require the legacy `{ env, state }` shape for this pipeline

#### Scenario: Formal conversation elements use explicit context actions
- **WHEN** a `formal_conversation` element needs runtime-backed behavior
- **THEN** it reads that behavior from explicit actions exposed by the pipeline context
- **AND** it does not directly reach through to a full Runtime instance

#### Scenario: Other pipelines remain on legacy env shape
- **WHEN** `post_follow_up` or `user_intent_prediction` run in this iteration
- **THEN** they continue to use the existing legacy pipeline env shape
- **AND** their external behavior remains unchanged
