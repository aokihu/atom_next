/**
 * Atom Agent System
 * @version 1.0.0
 */

import { parseArguments } from "./bootstrap/cli";

const args = parseArguments(Bun.argv.slice(2));
console.log(args);
