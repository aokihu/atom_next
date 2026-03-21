/**
 * 启动器
 * @version 1.0.0
 */

import { tryit } from "radashi";
import { bootstrap } from "./bootstrap";
import { parseConfigFile } from "./config";

export const tryBootstrap = tryit(bootstrap);
export const tryParseConfigFile = tryit(parseConfigFile);
