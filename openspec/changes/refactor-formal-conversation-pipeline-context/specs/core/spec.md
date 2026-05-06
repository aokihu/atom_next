## ADDED Requirements

### Requirement: Pipeline Context Boundary

The system SHALL allow each pipeline to execute through an explicit pipeline context and pipeline state boundary instead of directly depending on the full Runtime object shape.

#### Scenario: Formal conversation input is context-based
- **WHEN** `formal_conversation` pipeline input is created
- **THEN** it contains a dedicated pipeline context and pipeline state
- **AND** it does not require the legacy `{ env, state }` shape

#### Scenario: Post follow-up input is context-based
- **WHEN** `post_follow_up` pipeline input is created
- **THEN** it contains a dedicated pipeline context and pipeline state
- **AND** it does not require the legacy `{ env, state }` shape

#### Scenario: User intent prediction input is context-based
- **WHEN** `user_intent_prediction` pipeline input is created
- **THEN** it contains a dedicated pipeline context and pipeline state
- **AND** it does not require the legacy `{ env, state }` shape

#### Scenario: Pipeline elements use explicit context actions
- **WHEN** a pipeline element needs runtime-backed behavior
- **THEN** it reads that behavior from explicit actions exposed by the pipeline context
- **AND** it does not directly reach through to a full Runtime instance

#### Scenario: Sync runtime task uses context action
- **WHEN** the shared `sync-runtime-task` element runs
- **THEN** it binds the current task through `context.syncCurrentTask()`
- **AND** it does not assume a legacy `env.runtime.currentTask` shape
