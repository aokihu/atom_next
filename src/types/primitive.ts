/**
 * 基础原语类型
 * @description
 * 放置可被多个领域复用的简单类型别名。
 */

export type UUID = string;

export type ISOTimeString =
  `${string}-${string}-${string}T${string}:${string}:${string}.${string}Z`;

export type EmptyString = "";
