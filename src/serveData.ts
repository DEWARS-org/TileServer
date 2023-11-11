import { resolve } from "path";

import { TileJSON } from "./utils.js";
import { PMtilesOpen, GetPMtilesInfo } from "./pmtilesAdapter.js";
import { ServerConigOptions, ServingData } from "./index.js";

export const serve_data = {
	add: async (
		options: ServerConigOptions,
		repo: ServingData,
		params: {
			pmtiles: string;
		},
		id: string,
		publicUrl: string,
	) => {
		const inputFile = resolve(options.paths.pmtiles, params.pmtiles);
		const source = PMtilesOpen(inputFile);
		const metadata = await GetPMtilesInfo(source);

		const tileJSON: TileJSON = {
			tilejson: "3.0.0",
			tiles: [
				`http://localhost:5000/wmts/test-style/{z}/{x}/{y}.${metadata.tileInfo.fileExtension}`,
			],
			vector_layers: metadata.metadata.vector_layers,
			attribution: "© OpenStreetMap contributors",
			bounds: [
				metadata.header.minLon,
				metadata.header.minLat,
				metadata.header.maxLon,
				metadata.header.maxLat,
			],
			center: [
				metadata.header.centerLon,
				metadata.header.centerLat,
				metadata.header.centerZoom,
			],
			data: [],
			description: "",
			fillzoom: 14,
			grids: [],
			legend: "",
			maxzoom: metadata.header.maxZoom,
			minzoom: metadata.header.minZoom,
			name: id,
			scheme: "xyz",
			template: "",
			version: "1.0.0",
		};

		// fixTileJSONCenter(tileJSON); // @TODO: Investigate

		repo.set(id, {
			tileJSON,
			publicUrl,
			source,
		});
	},
};
