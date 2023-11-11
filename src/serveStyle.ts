import { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import theme from "protomaps-themes-base";
import { ServingStyle } from "./index.js";

export const serve_style = {
	add: (repo: ServingStyle, id: string, publicUrl: string) => {
		const styleJSON: StyleSpecification = {
			version: 8,
			glyphs:
				"https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
			sources: {
				protomaps: {
					type: "vector",
					url: "http://localhost:5000/protomaps.json",
				},
			},
			layers: theme.default("protomaps", "dark"),
		};

		repo.set(id, {
			styleJSON: styleJSON,
			spritePath: "",
			publicUrl,
			name: styleJSON.name ?? "Untitled",
		});

		return true;
	},
};
