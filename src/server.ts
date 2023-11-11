import { cors } from "@tinyhttp/cors";
import { App } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";
import { RegisterTileServer } from "./index.js";

new App()
	.use(logger())
	.use(
		cors({
			credentials: true,
			allowedHeaders: [
				"Content-Type",
				"Authorization",
				"X-Custom-Header",
				"Connect-Protocol-Version",
			],
			origin: "http://localhost:3000",
		}),
	)
	.use(RegisterTileServer)
	.listen(5000, async () => {
		console.log("🚀 Server listening on port 5000");
	});
