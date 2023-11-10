import { join, resolve, relative, basename, dirname } from "path";
import { readFile, readFileSync } from "node:fs";

import clone from "clone";
import { App } from "@tinyhttp/app";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { Request, Response, NextFunction } from "@tinyhttp/app";

import { getPublicUrl } from "./utils.js";

const httpTester = /^(http(s)?:)?\/\//;

const fixUrl = (
	req: Request,
	url: string,
	publicUrl: string,
	opt_nokey?: boolean,
) => {
	if (!url || typeof url !== "string" || url.indexOf("local://") !== 0) {
		return url;
	}
	const queryParams = [];
	if (!opt_nokey && req.query.key) {
		queryParams.unshift(`key=${encodeURIComponent(req.query.key)}`);
	}
	let query = "";
	if (queryParams.length) {
		query = `?${queryParams.join("&")}`;
	}
	return url.replace("local://", getPublicUrl(publicUrl, req)) + query;
};

export const serve_style = {
	init: (options, repo) => {
		const app = new App().disable("xPoweredBy");

		app.get(
			"/:id/style.json",
			(req: Request, res: Response, next: NextFunction) => {
				const item = repo[req.params.id];
				if (!item) {
					return res.sendStatus(404);
				}
				const styleJSON_ = clone(item.styleJSON);
				for (const name of Object.keys(styleJSON_.sources)) {
					const source = styleJSON_.sources[name];
					source.url = fixUrl(req, source.url, item.publicUrl);
				}
				// mapbox-gl-js viewer cannot handle sprite urls with query
				if (styleJSON_.sprite) {
					styleJSON_.sprite = fixUrl(
						req,
						styleJSON_.sprite,
						item.publicUrl,
						false,
					);
				}
				if (styleJSON_.glyphs) {
					styleJSON_.glyphs = fixUrl(
						req,
						styleJSON_.glyphs,
						item.publicUrl,
						false,
					);
				}
				return res.send(styleJSON_);
			},
		);

		app.get(
			"/:id/sprite:scale(@[23]x)?.:format([\\w]+)",
			(req: Request, res: Response, next: NextFunction) => {
				const item = repo[req.params.id];
				if (!item || !item.spritePath) {
					return res.sendStatus(404);
				}
				const scale = req.params.scale;
				const format = req.params.format;
				const filename = `${item.spritePath + (scale || "")}.${format}`;
				return readFile(filename, (err, data) => {
					if (err) {
						console.log("Sprite load error:", filename);
						return res.sendStatus(404);
					} else {
						if (format === "json")
							res.header("Content-type", "application/json");
						if (format === "png") res.header("Content-type", "image/png");
						return res.send(data);
					}
				});
			},
		);

		return app;
	},
	remove: (repo, id: string) => {
		delete repo[id];
	},
	add: (
		options,
		repo,
		params,
		id: string,
		publicUrl: string,
		reportTiles,
		reportFont,
	) => {
		const styleFile = resolve(options.paths.styles, params.style);

		const styleFileData = readFileSync(styleFile);

		const validationErrors = validateStyleMin(
			JSON.parse(styleFileData.toString()),
		);
		if (validationErrors.length > 0) {
			console.log(
				`The file "${params.style}" is not valid a valid style file:`,
			);
			for (const err of validationErrors) {
				console.log(`${err.line}: ${err.message}`);
			}
			return false;
		}
		const styleJSON = JSON.parse(styleFileData);

		for (const name of Object.keys(styleJSON.sources)) {
			const source = styleJSON.sources[name];
			let url = source.url;
			if (url && url.startsWith("pmtiles://")) {
				const protocol = url.split(":")[0];

				let dataId = url.replace("pmtiles://", "");
				if (dataId.startsWith("{") && dataId.endsWith("}")) {
					dataId = dataId.slice(1, -1);
				}

				const mapsTo = params.mappin[dataId];
				if (mapsTo) {
					dataId = mapsTo;
				}

				const identifier = reportTiles(dataId, protocol);
				if (!identifier) {
					return false;
				}
				source.url = `local://data/${identifier}.json`;
			}
		}

		for (const obj of styleJSON.layers) {
			if (obj["type"] === "symbol") {
				const fonts = obj["layout"]["text-font"];
				if (fonts && fonts.length) {
					fonts.forEach(reportFont);
				} else {
					reportFont("Open Sans Regular");
					reportFont("Arial Unicode MS Regular");
				}
			}
		}

		let spritePath;

		if (styleJSON.sprite && !httpTester.test(styleJSON.sprite)) {
			spritePath = join(
				options.paths.sprites,
				styleJSON.sprite
					.replace("{style}", basename(styleFile, ".json"))
					.replace(
						"{styleJsonFolder}",
						relative(options.paths.sprites, dirname(styleFile)),
					),
			);
			styleJSON.sprite = `local://styles/${id}/sprite`;
		}
		if (styleJSON.glyphs && !httpTester.test(styleJSON.glyphs)) {
			styleJSON.glyphs = "local://fonts/{fontstack}/{range}.pbf";
		}

		repo[id] = {
			styleJSON,
			spritePath,
			publicUrl,
			name: styleJSON.name,
		};

		return true;
	},
};
