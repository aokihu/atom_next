import { describe, expect, test } from "bun:test";

// FormalConversation elements
import { transformTransportOutputToConversationOutputElement } from "@/core/pipeline/definitions/formal-conversation/elements/transform-transport-output-to-conversation-output.element";
import { handleLengthBoundaryElement } from "@/core/pipeline/definitions/formal-conversation/elements/handle-length-boundary.element";
import { handleToolBoundaryElement } from "@/core/pipeline/definitions/formal-conversation/elements/handle-tool-boundary.element";
import { parseIntentRequestsElement } from "@/core/pipeline/definitions/formal-conversation/elements/parse-intent-requests.element";
import { executeIntentRequestsElement } from "@/core/pipeline/definitions/formal-conversation/elements/execute-intent-requests.element";
import { applyIntentRequestExecutionElement } from "@/core/pipeline/definitions/formal-conversation/elements/apply-intent-request-execution.element";
import { finalizeConversationElement } from "@/core/pipeline/definitions/formal-conversation/elements/finalize-conversation.element";

// UserIntentPrediction elements
import { preparePredictionRequestElement } from "@/core/pipeline/definitions/user-intent-prediction/elements/prepare-prediction-request.element";
import { executePredictionRequestElement } from "@/core/pipeline/definitions/user-intent-prediction/elements/execute-prediction-request.element";
import { applyPredictionExecutionElement } from "@/core/pipeline/definitions/user-intent-prediction/elements/apply-prediction-execution.element";
import { finalizeUserIntentPredictionElement } from "@/core/pipeline/definitions/user-intent-prediction/elements/finalize-user-intent-prediction.element";

// PostFollowUp elements
import { prepareContinuationElement } from "@/core/pipeline/definitions/post-follow-up/elements/prepare-continuation.element";
import { applyPostFollowUpContinuationElement } from "@/core/pipeline/definitions/post-follow-up/elements/apply-post-follow-up-continuation.element";
import { finalizePostFollowUpElement } from "@/core/pipeline/definitions/post-follow-up/elements/finalize-post-follow-up.element";

describe("Pipeline element kind semantics", () => {
  test("formal conversation element kinds are semantically aligned", () => {
    expect(transformTransportOutputToConversationOutputElement.kind).toBe("transform");
    expect(handleLengthBoundaryElement.kind).toBe("boundary");
    expect(handleToolBoundaryElement.kind).toBe("boundary");
    expect(parseIntentRequestsElement.kind).toBe("transform");
    expect(executeIntentRequestsElement.kind).toBe("transform");
    expect(applyIntentRequestExecutionElement.kind).toBe("boundary");
    expect(finalizeConversationElement.kind).toBe("sink");
  });

  test("user intent prediction element kinds are semantically aligned", () => {
    expect(preparePredictionRequestElement.kind).toBe("source");
    expect(executePredictionRequestElement.kind).toBe("transform");
    expect(applyPredictionExecutionElement.kind).toBe("boundary");
    expect(finalizeUserIntentPredictionElement.kind).toBe("sink");
  });

  test("post follow-up element kinds are semantically aligned", () => {
    expect(prepareContinuationElement.kind).toBe("transform");
    expect(applyPostFollowUpContinuationElement.kind).toBe("boundary");
    expect(finalizePostFollowUpElement.kind).toBe("sink");
  });
});
