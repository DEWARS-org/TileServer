import { readFile, promises, readdir, Dirent } from "node:fs";
import { dirname, resolve, extname, basename, join, sep } from "path";
import chokidar from "chokidar";
import clone from "clone";
import handlebars, { log } from "handlebars";
import { serve_data } from "./serveData.js";
import { serve_style } from "./serveStyle.js";
import { serve_font } from "./serveFont.js";
import { getTileUrls, getPublicUrl, TileJSON } from "./utils.js";
import { readPackageSync } from "read-pkg";

import { fileURLToPath } from "url";
import { App, Request, Response } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
	config: ServerConfig;
	configPath?: string;
	publicUrl: string;
}

export interface ServerConigOptions {
	paths: {
		root: string;
		styles: string;
		fonts: string;
		sprites: string;
		pmtiles: string;
		icons: string;
	};
	serveAllStyles: boolean;
	frontPage: boolean | string;
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

export function start(opts: ServerOptions) {
	const app = new App().disable("xPoweredBy").use(logger());

	const serving = {
		styles: new Map<string, any>(),
		rendered: new Map<
			string,
			{
				name: string;
			}
		>(),
		data: new Map<
			string,
			{
				tileJSON: TileJSON;
			}
		>(),
		fonts: new Map<string, boolean>(),
	};

	const options = opts.config.options;
	const paths = options.paths;
	options.paths = paths;
	paths.root = resolve(process.cwd(), paths.root);
	paths.styles = resolve(paths.root, paths.styles);
	paths.fonts = resolve(paths.root, paths.fonts);
	paths.sprites = resolve(paths.root, paths.sprites);
	paths.pmtiles = resolve(paths.root, paths.pmtiles);
	paths.icons = resolve(paths.root, paths.icons);

	const startupPromises = [];

	const getFiles = async (directory: string): Promise<string[]> => {
		// Fetch all entries of the directory and attach type information
		const dirEntries: Dirent[] = await promises.readdir(directory, {
			withFileTypes: true,
		});

		// Iterate through entries and return the relative file-path to the icon directory if it is not a directory
		// otherwise initiate a recursive call
		const files = await Promise.all(
			dirEntries.map(async (dirEntry) => {
				const entryPath = resolve(directory, dirEntry.name);
				return dirEntry.isDirectory()
					? await getFiles(entryPath)
					: entryPath.replace(paths.icons + sep, "");
			}),
		);

		// Flatten the list of files to a single array
		return files.flat();
	};

	// Load all available icons into a settings object
	startupPromises.push(
		new Promise((resolve) => {
			getFiles(paths.icons).then((files) => {
				paths.availableIcons = files;
				resolve();
			});
		}),
	);

	const data = clone(opts.config.data);

	app.use("/data/", serve_data.init(options, serving.data));
	app.use("/styles/", serve_style.init(options, serving.styles));

	const addStyle = (id: string, item, allowMoreData, reportFonts) => {
		let success = true;
		if (item.serve_data !== false) {
			success = serve_style.add(
				options,
				serving.styles,
				item,
				id,
				opts.publicUrl,
				(StyleSourceId: string, protocol: string) => {
					let dataItemId;
					for (const id of Object.keys(data)) {
						if (id === StyleSourceId) {
							// Style id was found in data ids, return that id
							dataItemId = id;
						} else {
							const fileType = Object.keys(data[id])[0];
							if (data[id][fileType] === StyleSourceId) {
								// Style id was found in data filename, return the id that filename belong to
								dataItemId = id;
							}
						}
					}
					if (dataItemId) {
						// input files exists in the data config, return found id
						return dataItemId;
					} else {
						if (!allowMoreData) {
							console.log(
								`ERROR: style "${item.style}" using unknown file "${StyleSourceId}"! Skipping...`,
							);
							return undefined;
						} else {
							let id =
								StyleSourceId.substr(0, StyleSourceId.lastIndexOf(".")) ||
								StyleSourceId;

							while (data[id]) id += "_"; //if the data source id already exists, add a "_" untill it doesn't
							//Add the new data source to the data array.
							data[id] = {
								[protocol]: StyleSourceId,
							};

							return id;
						}
					}
				},
				(font) => {
					if (reportFonts) {
						serving.fonts.set(font, true);
					}
				},
			);
		}
		if (success && item.serve_rendered !== false) {
			item.serve_rendered = false;
		}
	};

	for (const id of Object.keys(opts.config.styles)) {
		const item = opts.config.styles[id];
		if (!item.style || item.style.length === 0) {
			console.log(`Missing "style" property for ${id}`);
			continue;
		}

		addStyle(id, item, true, true);
	}

	for (const id of Object.keys(data)) {
		const item = data[id];
		const fileType = Object.keys(data[id])[0];
		if (!fileType || !(fileType === "pmtiles")) {
			console.log(`Missing "pmtiles" property for ${id} data source`);
			continue;
		}

		startupPromises.push(
			serve_data.add(options, serving.data, item, id, opts.publicUrl),
		);
	}

	if (options.serveAllStyles) {
		readdir(options.paths.styles, { withFileTypes: true }, (err, files) => {
			if (err) {
				return;
			}
			for (const file of files) {
				if (file.isFile() && extname(file.name).toLowerCase() == ".json") {
					const id = basename(file.name, ".json");
					const item = {
						style: file.name,
					};
					addStyle(id, item, false, false);
				}
			}
		});

		const watcher = chokidar.watch(join(options.paths.styles, "*.json"), {});
		watcher.on("all", (eventType, filename: string) => {
			if (filename) {
				const id = basename(filename, ".json");
				console.log(`Style "${id}" changed, updating...`);

				serve_style.remove(serving.styles, id);

				if (eventType == "add" || eventType == "change") {
					const item = {
						style: filename,
					};
					addStyle(id, item, false, false);
				}
			}
		});
	}

	app.get("/styles.json", (req, res) => {
		const result = [];

		for (const id of serving.styles.keys()) {
			const styleJSON = serving.styles.get(id).styleJSON;
			result.push({
				version: styleJSON.version,
				name: styleJSON.name,
				id: id,
				url: `${getPublicUrl(opts.publicUrl, req)}styles/${id}/style.json`,
			});
		}
		res.send(result);
	});

	const addTileJSONs = (arr: TileJSON[], req: Request, type) => {
		for (const id of serving[type].keys()) {
			const info = clone(serving[type].get(id).tileJSON);
			let path = "";
			if (type === "rendered") {
				path = `styles/${id}`;
			} else {
				path = `${type}/${id}`;
			}
			info.tiles = getTileUrls(
				req,
				info.tiles,
				path,
				info.format,
				opts.publicUrl,
			);
			arr.push(info);
		}
		return arr;
	};

	app.get("/rendered.json", (req, res) => {
		res.send(addTileJSONs([], req, "rendered"));
	});
	app.get("/data.json", (req, res) => {
		res.send(addTileJSONs([], req, "data"));
	});
	app.get("/index.json", (req, res, next) => {
		res.send(addTileJSONs(addTileJSONs([], req, "rendered"), req, "data"));
	});

	const templates = join(__dirname, "../public/templates");

	const serveTemplate = (
		urlPath: string,
		template: string,
		dataGetter: (req: Request) => any,
	) => {
		console.log("\n\n\nserveTemplate", urlPath, template);

		const templateFile = `${templates}/${template}.tmpl`;

		console.log("templateFile", templateFile);

		const serveTemplate = async () => {
			const content = await promises.readFile(templateFile);
			const compiled = handlebars.compile(content.toString());

			app.use(urlPath, async (req, res) => {
				let data = {};

				if (dataGetter) {
					data = dataGetter(req);

					console.log("dataGetter", data);
				}

				const packageJsonData = readPackageSync();
				data.server_version = `${packageJsonData.name} v${packageJsonData.version}`;
				data.public_url = opts.publicUrl;
				// data["is_light"] = isLight;
				data.key_query_part = req.query.key
					? `key=${encodeURIComponent(req.query.key)}&amp;`
					: "";
				data.key_query = req.query.key
					? `?key=${encodeURIComponent(req.query.key)}`
					: "";

				if (template === "wmts") res.set("Content-Type", "text/xml");

				return res.status(200).send(compiled(data));
			});
		};

		startupPromises.push(serveTemplate());
	};

	serveTemplate("/styles/:id/$", "viewer", (req: Request) => {
		const { id } = req.params;
		const style = clone(serving.styles.get(id).styleJSON);

		if (!style) {
			return null;
		}

		return {
			...style,
			id,
			name: (serving.styles.get(id) || serving.rendered.get(id)).name,
			serving_data: serving.styles.get(id),
			serving_rendered: serving.rendered.get(id),
		};
	});

	serveTemplate("/styles/:id/wmts.xml", "wmts", (req: Request) => {
		const { id } = req.params;
		console.log("wmts", id);

		const wmts = clone(serving.styles.get(id));

		if (!wmts) {
			return null;
		}

		if (wmts.hasOwnProperty("serve_rendered") && !wmts.serve_rendered) {
			return null;
		}

		let baseUrl;
		if (opts.publicUrl) {
			baseUrl = opts.publicUrl;
		} else {
			baseUrl = `${
				req.get("X-Forwarded-Protocol")
					? req.get("X-Forwarded-Protocol")
					: req.protocol
			}://${req.get("host")}/`;
		}

		return {
			...wmts,
			id,
			name: (serving.styles.get(id) || serving.rendered.get(id)).name,
			baseUrl,
		};
	});

	serveTemplate("/data/:id/$", "data", (req: Request) => {
		const { id } = req.params;
		const data = serving.data.get(id);

		if (!data) {
			return null;
		}

		return {
			...data,
			id,
			is_vector: data.tileJSON.format === "pbf",
		};
	});

	let startupComplete = false;
	const startupPromise = Promise.all(startupPromises).then(() => {
		console.log("Startup complete");
		startupComplete = true;
	});

	const server = app.listen(parseInt(process.env.PORT ?? "5000"), async () => {
		console.log(`🚀 Server listening on port ${process.env.PORT ?? "5000"}`);
	});

	return {
		app: app,
		server: server,
		startupPromise: startupPromise,
	};
}
