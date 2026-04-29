## MODIFIED Requirements

### Requirement: Core Workflow Dispatch

Core SHALL dispatch tasks to the correct workflow runner based on `TaskWorkflow` type.

#### Scenario: Dispatch to PREDICT_USER_INTENT
- **WHEN** a task has workflow `PREDICT_USER_INTENT`
- **THEN** the corresponding workflow runner is invoked

#### Scenario: Dispatch to POST_FOLLOW_UP
- **WHEN** a task has workflow `POST_FOLLOW_UP`
- **THEN** the corresponding workflow runner is invoked

#### Scenario: Dispatch to FORMAL_CONVERSATION
- **WHEN** a task has workflow `FORMAL_CONVERSATION`
- **THEN** the corresponding workflow runner is invoked

#### Scenario: Unknown workflow throws
- **WHEN** a task has an unrecognized workflow type
- **THEN** the error is caught and the task is marked as FAILED

### Requirement: Workflow Error Handling

Core SHALL handle all workflow errors uniformly.

#### Scenario: Any workflow failure is handled identically
- **WHEN** any workflow runner throws or returns an error
- **THEN** Core logs the error, updates the task state to FAILED, and emits CHAT_FAILED event

#### Scenario: Naked exception is caught
- **WHEN** an exception occurs outside `toResult` (e.g., in `#parseTaskWorkflow`)
- **THEN** the same error handler is invoked

### Requirement: No Dead Code

Core SHALL NOT retain unused fields.

#### Scenario: No activeTimer field
- **WHEN** inspecting the Core class
- **THEN** there is no `#activeTimer` field
