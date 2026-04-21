/**
 * intent-request/safety/load-skill.ts
 * @description
 * 校验 LOAD_SKILL 请求中的技能名是否合法，防止路径逃逸或非法字符。
 */
import type { LoadSkillIntentRequest, RejectedIntentRequest } from "@/types";
import { IntentRequestSafetyIssueCode } from "@/types";
import {
  createRejectedIntentRequest,
  MAX_SKILL_NAME_LENGTH,
  SKILL_NAME_PATTERN,
} from "./shared";

/* ==================== */
/* LOAD_SKILL Safety    */
/* ==================== */

export const checkLoadSkillIntentRequestSafety = (
  request: LoadSkillIntentRequest,
): RejectedIntentRequest | null => {
  const skillName = request.params.skill;

  if (
    skillName.length > MAX_SKILL_NAME_LENGTH ||
    !SKILL_NAME_PATTERN.test(skillName) ||
    skillName.startsWith("/") ||
    skillName.includes("..")
  ) {
    return createRejectedIntentRequest(
      request,
      IntentRequestSafetyIssueCode.SKILL_NAME_INVALID,
      "LOAD_SKILL.skill contains unsupported characters or unsafe path markers",
    );
  }

  return null;
};
