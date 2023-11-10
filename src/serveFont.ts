import { stat, readdir, existsSync } from "node:fs";
import { join } from "path";

import { getFontsPbf } from "./utils.js";
import { App } from "@tinyhttp/app";
import { ServerConfig } from "./server.js";

export const serve_font = (options: ServerConfig, allowedFonts: string[]) => {
	const app = new App().disable("xPoweredBy");

	const lastModified = new Date().toUTCString();

	const fontPath = options.paths.fonts;

	const existingFonts = {};
	const fontListingPromise = new Promise((resolve, reject) => {
		readdir(options.paths.fonts, (err, files) => {
			if (err) {
				reject(err);
				return;
			}
			for (const file of files) {
				stat(join(fontPath, file), (err, stats) => {
					if (err) {
						reject(err);
						return;
					}
					if (
						stats.isDirectory() &&
						existsSync(join(fontPath, file, "0-255.pbf"))
					) {
						existingFonts[path.basename(file)] = true;
					}
				});
			}
			resolve();
		});
	});

	app.get("/fonts/:fontstack/:range([\\d]+-[\\d]+).pbf", (req, res, next) => {
		const fontstack = decodeURI(req.params.fontstack);
		const range = req.params.range;

		getFontsPbf(
			options.serveAllFonts ? null : allowedFonts,
			fontPath,
			fontstack,
			range,
			existingFonts,
		).then(
			(concated) => {
				res.header("Content-type", "application/x-protobuf");
				res.header("Last-Modified", lastModified);
				return res.send(concated);
			},
			(err) => res.status(400).header("Content-Type", "text/plain").send(err),
		);
	});

	app.get("/fonts.json", (req, res, next) => {
		res.header("Content-type", "application/json");
		return res.send(
			Object.keys(options.serveAllFonts ? existingFonts : allowedFonts).sort(),
		);
	});

	return fontListingPromise.then(() => app);
};
