import { cors } from "@tinyhttp/cors";
import { App } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";
import { TileServer } from "./index.js";

const tileServer = new TileServer();

new App()
  .use(logger())
  .use(
    cors({
      origin: "http://localhost:3000",
    }),
  )
  .use(tileServer.registerMiddleware.bind(tileServer))
  .listen(5000, async () => {
    console.log("🚀 Server listening on port 5000");
  });
