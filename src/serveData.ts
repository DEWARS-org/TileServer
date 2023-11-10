import { statSync } from "node:fs";
import { resolve } from "path";
import { unzipSync, gzipSync } from "zlib";

import clone from "clone";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { App, type Request, Response } from "@tinyhttp/app";

import { getTileUrls, fixTileJSONCenter, TileJSON } from "./utils.js";
import {
	PMtilesOpen,
	GetPMtilesInfo,
	GetPMtilesTile,
} from "./pmtilesAdapter.js";
import { ServerConfig, ServerConigOptions } from "./server.js";

export const serve_data = {
	init: (options: ServerConigOptions, repo: Map<string, any>) => {
		const app = new App().disable("xPoweredBy");

		app.get(
			"/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w.]+)",
			async (req, res) => {
				const item = repo.get(req.params.id);
				if (!item) {
					return res.sendStatus(404);
				}
				const tileJSONFormat = item.tileJSON.format;
				const z = req.params.z | 0;
				const x = req.params.x | 0;
				const y = req.params.y | 0;
				let format = req.params.format;
				if (
					format !== tileJSONFormat &&
					!(format === "geojson" && tileJSONFormat === "pbf")
				) {
					return res.status(404).send("Invalid format");
				}
				if (
					z < item.tileJSON.minzoom ||
					0 ||
					x < 0 ||
					y < 0 ||
					z > item.tileJSON.maxzoom ||
					x >= 2 ** z ||
					y >= 2 ** z
				) {
					return res.status(404).send("Out of bounds");
				}
				if (item.source_type === "pmtiles") {
					let tileinfo = await GetPMtilesTile(item.source, z, x, y);
					if (tileinfo === undefined || tileinfo.data === undefined) {
						return res.status(404).send("Not found");
					} else {
						let data = tileinfo.data;
						const headers = tileinfo.header;
						if (tileJSONFormat === "pbf") {
							if (options.dataDecoratorFunc) {
								data = options.dataDecoratorFunc(id, "data", data, z, x, y);
							}
						}
						if (format === "pbf") {
							headers["Content-Type"] = "application/x-protobuf";
						} else if (format === "geojson") {
							headers["Content-Type"] = "application/json";

							if (isGzipped) {
								data = unzipSync(data);
								isGzipped = false;
							}

							const tile = new VectorTile(new Pbf(data));
							const geojson = {
								type: "FeatureCollection",
								features: [],
							};
							for (const layerName in tile.layers) {
								const layer = tile.layers[layerName];
								for (let i = 0; i < layer.length; i++) {
									const feature = layer.feature(i);
									const featureGeoJSON = feature.toGeoJSON(x, y, z);
									featureGeoJSON.properties.layer = layerName;
									geojson.features.push(featureGeoJSON);
								}
							}
							data = JSON.stringify(geojson);
						}
						delete headers["ETag"]; // do not trust the tile ETag -- regenerate
						headers["Content-Encoding"] = "gzip";
						res.set(headers);

						data = gzipSync(data);

						return res.status(200).send(data);
					}
				}
			},
		);

		app.get("/:id.json", (req, res) => {
			const item = repo.get(req.params.id);
			if (!item) {
				return res.sendStatus(404);
			}
			const info = clone(item.tileJSON);
			info.tiles = getTileUrls(
				req,
				info.tiles,
				`data/${req.params.id}`,
				info.format,
				item.publicUrl,
			);
			return res.send(info);
		});

		return app;
	},
	add: async (
		options: ServerConigOptions,
		repo: Map<string, any>,
		params,
		id: string,
		publicUrl: string,
	) => {
		let inputFile;
		let inputType;
		if (params.pmtiles) {
			inputType = "pmtiles";
			inputFile = resolve(options.paths.pmtiles, params.pmtiles);
		}

		let tileJSON: TileJSON = {
			tiles: params.domains || options.domains,
		};

		const inputFileStats = statSync(inputFile);
		if (!inputFileStats.isFile() || inputFileStats.size === 0) {
			throw Error(`Not valid input file: "${inputFile}"`);
		}

		let source;
		let source_type;
		if (inputType === "pmtiles") {
			source = PMtilesOpen(inputFile);
			source_type = "pmtiles";
			const metadata = await GetPMtilesInfo(source);

			tileJSON.name = id;
			tileJSON.format = "pbf";
			Object.assign(tileJSON, metadata);

			tileJSON.tilejson = "2.0.0";
			tileJSON.filesize = undefined;
			tileJSON.mtime = undefined;
			tileJSON.scheme = undefined;

			Object.assign(tileJSON, params.tilejson);
			fixTileJSONCenter(tileJSON);

			if (options.dataDecoratorFunc) {
				tileJSON = options.dataDecoratorFunc(id, "tilejson", tileJSON);
			}
		}

		repo.set(id, {
			tileJSON,
			publicUrl,
			source,
			source_type,
		});
	},
};
