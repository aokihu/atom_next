import { Core } from "@/core";
import { ServiceManager } from "@/libs/service-manage";

export type AppContext = {
  core: Core;
  serviceManager: ServiceManager;
};
