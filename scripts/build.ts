const BUILD_ENTRYPOINTS = [
  "./src/main.ts",
  "./src/services/watchman/monitor.worker.ts",
];
const BUILD_OUTFILE = "./dist/atom";

/**
 * 构建单文件可执行程序
 * @description
 * Bun 的 standalone executable 在包含 Worker 时，需要把 worker 入口一并交给 bundler。
 * 这里统一通过 Bun.build() 显式声明 entrypoints，避免把复杂参数直接堆在 package.json 里。
 */
const buildExecutable = async () => {
  const result = await Bun.build({
    entrypoints: BUILD_ENTRYPOINTS,
    compile: {
      outfile: BUILD_OUTFILE,
      autoloadPackageJson: true,
      autoloadTsconfig: true,
    },
  });

  if (!result.success) {
    result.logs.forEach((log) => {
      console.error(log);
    });
    process.exit(1);
  }

  console.log(`Executable built at ${BUILD_OUTFILE}`);
};

await buildExecutable();
