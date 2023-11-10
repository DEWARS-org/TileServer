import { start } from "./server.js";

const config = {
	options: {
		paths: {
			root: "./data",
			styles: "./styles",
			fonts: "./fonts",
			sprites: "./sprites",
			pmtiles: "./pmtiles",
			icons: "./icons",
		},
	},
	styles: {
		"test-style": {
			style: "1.json",
			tilejson: {
				type: "overlay",
				bounds: [8.529446, 47.364758, 8.55232, 47.380539],
			},
		},
	},
	data: {
		openmaptiles: {
			pmtiles: "20230913.pmtiles",
		},
	},
};

start({
	publicUrl: "/",
	config,
});
