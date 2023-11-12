import { TileJSON } from "./utils.js";
import { Request, Response, NextFunction } from "@tinyhttp/app";
import { GetPMtilesTile, GetPmtilesTileInfo } from "./pmtilesAdapter.js";
import { PMTiles } from "@dewars/pmtiles";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import theme from "protomaps-themes-base";
import { resolve } from "path";
import { PMtilesOpen } from "./pmtilesAdapter.js";

export class TileServer {
	private dataDirectory: string;
	private publicURL: string;
	private styles: Map<string, StyleSpecification>;
	private pmTileSources: Map<
		string,
		{
			tileJSON: TileJSON;
			source: PMTiles;
		}
	>;

	constructor() {
		this.dataDirectory = "./data";
		this.publicURL = "http://localhost:4000";
		this.styles = new Map();
		this.pmTileSources = new Map();

		this.addStyle("protomaps-dark", "dark");
		this.addStyle("protomaps-light", "light");
		this.addPMTileSource("protomaps");
	}

	private addStyle(id: string, themeColor: "light" | "dark") {
		const styleJSON: StyleSpecification = {
			version: 8,
			glyphs:
				"https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
			sources: {},
			layers: theme.default("protomaps", themeColor),
		};

		this.styles.set(id, styleJSON);
	}

	getStyles() {
		return this.styles;
	}

	private async addPMTileSource(id: string) {
		const inputFile = resolve(this.dataDirectory, "pmtiles", `${id}.pmtiles`);
		const source = PMtilesOpen(inputFile);
		const metadata = await source.getMetadata();
		const {
			minLon,
			minLat,
			maxLon,
			maxLat,
			centerLon,
			centerLat,
			centerZoom,
			maxZoom,
			minZoom,
			tileType,
		} = await source.getHeader();
		const { fileExtension } = GetPmtilesTileInfo(tileType);

		const tileJSON: TileJSON = {
			tilejson: "3.0.0",
			tiles: [`${this.publicURL}/tiles/${id}/{z}/{x}/{y}.${fileExtension}`],
			vector_layers: metadata.vector_layers,
			attribution: "",
			bounds: [minLon, minLat, maxLon, maxLat],
			center: [centerLon, centerLat, centerZoom],
			data: [],
			description: "",
			fillzoom: 14,
			grids: [],
			legend: "",
			maxzoom: maxZoom,
			minzoom: minZoom,
			name: id,
			scheme: "xyz",
			template: "",
			version: "1.0.0",
		};

		this.pmTileSources.set(id, {
			tileJSON,
			source,
		});
	}

	public getPMTileSources() {
		return this.pmTileSources;
	}

	public async registerMiddleware(
		req: Request,
		res: Response,
		next: NextFunction,
	) {
		interface StyleJsonGroups {
			styleId: string;
			tileSource: string;
		}

		const styleJsonRegex =
			/^\/style\/(?<styleId>.*)\/(?<tileSource>.*)\.json$/g;
		const styleJsonMatch = styleJsonRegex.exec(req.path)
			?.groups as unknown as StyleJsonGroups;

		if (styleJsonMatch) {
			const style = this.styles.get(styleJsonMatch.styleId);
			const pmTiles = this.pmTileSources.get(styleJsonMatch.tileSource);

			if (!style || !pmTiles) {
				return res.sendStatus(404);
			}

			style.sources.protomaps = {
				type: "vector",
				url: `${this.publicURL}/tiles/${styleJsonMatch.tileSource}.json`,
			};

			res.json(style);
			return next();
		}

		const tileJsonRegex = /^\/tiles\/(?<id>.*)\.json$/g;
		const tileJsonMatch = tileJsonRegex.exec(req.path);

		if (tileJsonMatch?.groups?.id) {
			const data = this.pmTileSources.get(tileJsonMatch?.groups?.id);

			if (!data) {
				return res.sendStatus(404);
			}
			res.json(data.tileJSON);
			return next();
		}

		const pathRegex =
			/^\/tiles\/(?<tileSource>.*)\/(?<z>\d+)\/(?<x>\d+)\/(?<y>\d+).(?<format>[\w.]+)$/g;

		interface PathGroups {
			tileSource: string;
			z: string;
			x: string;
			y: string;
			format: string;
		}

		const pathGroupsMatch = pathRegex.exec(req.path);

		const pathGroups = pathGroupsMatch?.groups as unknown as PathGroups;

		if (pathGroups.tileSource) {
			const data = this.pmTileSources.get(pathGroups.tileSource);

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

		return next();
	}
}
