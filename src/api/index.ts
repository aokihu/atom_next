/**
 * HTTP API接口
 */

export class APIPort {
  #server: ReturnType<typeof Bun.serve>;

  constructor(port: number) {
    this.#server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      routes: {
        "/api/v2/health": {
          GET: this.handleHealthRequest,
        },
      },
    });
  }

  private handleHealthRequest() {
    return new Response("Health OK\n");
  }
}
