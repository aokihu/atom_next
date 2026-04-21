/**
 * 内核工作流
 * @author aokihu <aokihu@gmail.com>
 * @description 这里存放内核中的处理流程相关的方法
 *              处理流程将会由函数式管道组成,因为这样的定义方式会非常的直观
 *              每一个工作流只聚焦于一个任务
 *              复杂的任务应该细分为简单的工作流组合而成,不应该在一个工作流中实现复杂的逻辑工作
 */
export { runUserIntentPredictionWorkflow } from "./run-user-intent-prediction";
export { runFormalConversationWorkflow } from "./run-formal-conversation";
