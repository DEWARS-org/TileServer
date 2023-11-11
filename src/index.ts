import { serve_data } from "./serveData.js";
import { serve_style } from "./serveStyle.js";
import { TileJSON } from "./utils.js";
import { Request, Response, NextFunction } from "@tinyhttp/app";
import { GetPMtilesTile } from "./pmtilesAdapter.js";
import { PMTiles } from "pmtiles";
import { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

export interface ServerOptions {
	config: ServerConfig;
	configPath?: string;
	publicUrl: string;
}

export interface ServerConigOptions {
	paths: {
		pmtiles: string;
	};
}

export interface ServerConfig {
	options: ServerConigOptions;

	styles: {
		[key: string]: {
			style: string;
			tilejson: TileJSON;
		};
	};
	data: {
		[key: string]: {
			pmtiles: string;
		};
	};
}

export type ServingStyle = Map<
	string,
	{
		styleJSON: StyleSpecification;
		spritePath: string;
		publicUrl: string;
		name: string;
	}
>;

export type ServingData = Map<
	string,
	{
		tileJSON: TileJSON;
		publicUrl: string;
		source: PMTiles;
	}
>;

export async function RegisterTileServer(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	const config = {
		options: {
			paths: {
				pmtiles: "./data/pmtiles",
			},
		},
		data: {
			protomaps: {
				pmtiles: "20230913.pmtiles",
			},
		},
	};

	const serving = {
		styles: new Map() as ServingStyle,
		data: new Map() as ServingData,
	};

	serve_style.add(serving.styles, "test-style", "");

	const options = config.options;
	const opts = {
		config: config,
		publicUrl: "",
	};

	await serve_data.add(
		options,
		serving.data,
		opts.config.data.protomaps,
		"protomaps",
		opts.publicUrl,
	);

	const styleJsonRegex = /^\/style\/(?<id>.*)\.json$/g;
	const styleJsonMatch = styleJsonRegex.exec(req.path);

	if (styleJsonMatch?.groups?.id) {
		const data = serving.styles.get(styleJsonMatch?.groups?.id);

		if (!data) {
			return res.sendStatus(404);
		}
		res.json(data.styleJSON);
		return next();
	}

	const tileJsonRegex = /^\/(?<id>.*)\.json$/g;
	const tileJsonMatch = tileJsonRegex.exec(req.path);

	if (tileJsonMatch?.groups?.id) {
		const data = serving.data.get(tileJsonMatch?.groups?.id);

		if (!data) {
			return res.sendStatus(404);
		}
		res.json(data.tileJSON);
		return next();
	}

	const pathRegex =
		/^\/wmts\/(?<style>.*)\/((?<wmts>wmts\.xml)|(?<z>\d+)\/(?<x>\d+)\/(?<y>\d+).(?<format>[\w.]+))$/g;

	interface PathGroups {
		style: string;
		wmts?: string;
		z?: string;
		x?: string;
		y?: string;
		format?: string;
	}

	const pathGroupsMatch = pathRegex.exec(req.path);

	const pathGroups = pathGroupsMatch?.groups as unknown as PathGroups;

	if (pathGroups.style) {
		const style = serving.styles.get(pathGroups.style);
		const data = serving.data.get("protomaps");
		if (pathGroups.wmts) {
			res.sendStatus(200);
		} else if (
			pathGroups.z &&
			pathGroups.x &&
			pathGroups.y &&
			pathGroups.format
		) {
			if (data) {
				const tile = await GetPMtilesTile(
					data.source,
					parseInt(pathGroups.z),
					parseInt(pathGroups.x),
					parseInt(pathGroups.y),
				);

				res.setHeader("Content-Type", "application/x-protobuf");
				res.end(tile.data);
			}
		}
	}

	return next();
}
