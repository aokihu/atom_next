/**
 * Atom Agent System
 * @version 1.0.0
 */

import type { AppContext } from "./types/app";
import { bootstrap } from "@/bootstrap";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";

const serviceManager = new ServiceManager();
const appContext: AppContext = {
  serviceManager,
};

const runtimeService = new RuntimeService(appContext);
serviceManager.register(runtimeService);

bootstrap(appContext);
