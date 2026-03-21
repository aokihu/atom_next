/**
 * Atom Agent System
 * @version 1.0.0
 */

import type { AppContext } from "./types/app";
import { APIPort } from "./api";
import { tryBootstrap } from "@/bootstrap";
import { ServiceManager } from "@/libs/service-manage";
import { RuntimeService } from "@/services/runtime";

const serviceManager = new ServiceManager();
const appContext: AppContext = {
  serviceManager,
};

// 注册服务
serviceManager.register(new RuntimeService(appContext));

// 等待Bootstrap启动
console.log("booting...");
const [err, _] = await tryBootstrap(appContext);

// 启动服务
await serviceManager.startAllServices((name: string) => {
  console.log(`Service ${name} started`);
});

console.log("boot success");

new APIPort(8787);
