import {
	readFileSync,
	createWriteStream,
	existsSync,
	readFile,
	promises,
	readdir,
} from "node:fs";
import { dirname, resolve, extname, basename, join, sep } from "path";
import fnv1a from "@sindresorhus/fnv1a";
import chokidar from "chokidar";
import clone from "clone";
import handlebars from "handlebars";
import SphericalMercator from "@mapbox/sphericalmercator";
const mercator = new SphericalMercator();
import { serve_data } from "./serveData.js";
import { serve_style } from "./serveStyle.js";
import { serve_font } from "./serveFont.js";
import { getTileUrls, getPublicUrl, isValidHttpUrl } from "./utils.js";
import { readPackageSync } from "read-pkg";

import { fileURLToPath } from "url";
import { App, Request } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ServerOptions {
	config: ServerConfig;
	configPath?: string;
	publicUrl: string;
}

interface ServerConfig {
	options: {
		paths: {
			root: string;
			styles: string;
			fonts: string;
			sprites: string;
			mbtiles: string;
			pmtiles: string;
			icons: string;
		};
		serveAllStyles: boolean;
		frontPage: boolean | string;
		pbfAlias: string;
	};
}

export function start(opts: ServerOptions) {
	console.log("Starting server");

	const app = new App().disable("xPoweredBy");
	app.use(logger());
	const serving = {
		styles: {},
		rendered: {},
		data: {},
		fonts: {},
	};

	const options = opts.config.options;
	const paths = options.paths;
	options.paths = paths;
	paths.root = resolve(process.cwd(), paths.root);
	paths.styles = resolve(paths.root, paths.styles || "");
	paths.fonts = resolve(paths.root, paths.fonts || "");
	paths.sprites = resolve(paths.root, paths.sprites || "");
	paths.mbtiles = resolve(paths.root, paths.mbtiles || "");
	paths.pmtiles = resolve(paths.root, paths.pmtiles || "");
	paths.icons = resolve(paths.root, paths.icons || "");

	const startupPromises = [];

	const checkPath = (type: string) => {
		if (!existsSync(paths[type])) {
			console.error(
				`The specified path for "${type}" does not exist (${paths[type]}).`,
			);
			process.exit(1);
		}
	};
	checkPath("styles");
	checkPath("fonts");
	checkPath("sprites");
	checkPath("mbtiles");
	checkPath("pmtiles");
	checkPath("icons");

	/**
	 * Recursively get all files within a directory.
	 * Inspired by https://stackoverflow.com/a/45130990/10133863
	 * @param {string} directory Absolute path to a directory to get files from.
	 */
	const getFiles = async (directory: string) => {
		// Fetch all entries of the directory and attach type information
		const dirEntries = await promises.readdir(directory, {
			withFileTypes: true,
		});

		// Iterate through entries and return the relative file-path to the icon directory if it is not a directory
		// otherwise initiate a recursive call
		const files = await Promise.all(
			dirEntries.map((dirEntry) => {
				const entryPath = resolve(directory, dirEntry.name);
				return dirEntry.isDirectory()
					? getFiles(entryPath)
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

	if (options.dataDecorator) {
		try {
			options.dataDecoratorFunc = require(resolve(
				paths.root,
				options.dataDecorator,
			));
		} catch (e) {}
	}

	const data = clone(opts.config.data || {});

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
				(StyleSourceId, protocol) => {
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
							if (isValidHttpUrl(StyleSourceId)) {
								id =
									fnv1a(StyleSourceId) + "_" + id.replace(/^.*\/(.*)$/, "$1");
							}
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
						serving.fonts[font] = true;
					}
				},
			);
		}
		if (success && item.serve_rendered !== false) {
			item.serve_rendered = false;
		}
	};

	for (const id of Object.keys(opts.config.styles || {})) {
		const item = opts.config.styles[id];
		if (!item.style || item.style.length === 0) {
			console.log(`Missing "style" property for ${id}`);
			continue;
		}

		addStyle(id, item, true, true);
	}

	startupPromises.push(
		serve_font(options, serving.fonts).then((sub) => {
			app.use("/", sub);
		}),
	);

	for (const id of Object.keys(data)) {
		const item = data[id];
		const fileType = Object.keys(data[id])[0];
		if (!fileType || !(fileType === "pmtiles" || fileType === "mbtiles")) {
			console.log(
				`Missing "pmtiles" or "mbtiles" property for ${id} data source`,
			);
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
		const query = req.query.key
			? `?key=${encodeURIComponent(req.query.key)}`
			: "";
		for (const id of Object.keys(serving.styles)) {
			const styleJSON = serving.styles[id].styleJSON;
			result.push({
				version: styleJSON.version,
				name: styleJSON.name,
				id: id,
				url: `${getPublicUrl(
					opts.publicUrl,
					req,
				)}styles/${id}/style.json${query}`,
			});
		}
		res.send(result);
	});

	const addTileJSONs = (arr, req: Request, type) => {
		for (const id of Object.keys(serving[type])) {
			const info = clone(serving[type][id].tileJSON);
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
				{
					pbf: options.pbfAlias,
				},
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

	// ------------------------------------
	// serve web presentations
	// app.use("/", express.static(join(__dirname, "../public/resources")));

	const templates = join(__dirname, "../public/templates");
	const serveTemplate = (urlPath: string, template: string, dataGetter) => {
		console.log("serveTemplate", urlPath, template, dataGetter);

		let templateFile = `${templates}/${template}.tmpl`;
		if (template === "index") {
			if (options.frontPage === false) {
				return;
			} else if (
				options.frontPage &&
				options.frontPage.constructor === String
			) {
				templateFile = resolve(paths.root, options.frontPage);
			}
		}
		startupPromises.push(
			new Promise((resolve, reject) => {
				readFile(templateFile, (err, content) => {
					if (err) {
						err = new Error(`Template not found: ${err.message}`);
						reject(err);
						return;
					}
					const compiled = handlebars.compile(content.toString());

					app.use(urlPath, (req, res, next) => {
						let data = {};
						if (dataGetter) {
							data = dataGetter(req);
							if (!data) {
								return res.status(404).send("Not found");
							}
						}
						const packageJsonData = readPackageSync();
						data[
							"server_version"
						] = `${packageJsonData.name} v${packageJsonData.version}`;
						data["public_url"] = opts.publicUrl || "/";
						// data["is_light"] = isLight;
						data["key_query_part"] = req.query.key
							? `key=${encodeURIComponent(req.query.key)}&amp;`
							: "";
						data["key_query"] = req.query.key
							? `?key=${encodeURIComponent(req.query.key)}`
							: "";
						if (template === "wmts") res.set("Content-Type", "text/xml");
						return res.status(200).send(compiled(data));
					});
					resolve();
				});
			}),
		);
	};

	serveTemplate("/$", "index", (req: Request) => {
		let styles = {};
		for (const id of Object.keys(serving.styles || {})) {
			let style = {
				...serving.styles[id],
				serving_data: serving.styles[id],
				serving_rendered: serving.rendered[id],
			};

			if (style.serving_rendered) {
				const { center } = style.serving_rendered.tileJSON;
				if (center) {
					style.viewer_hash = `#${center[2]}/${center[1].toFixed(
						5,
					)}/${center[0].toFixed(5)}`;

					const centerPx = mercator.px([center[0], center[1]], center[2]);
					style.thumbnail = `${center[2]}/${Math.floor(
						centerPx[0] / 256,
					)}/${Math.floor(centerPx[1] / 256)}.png`;
				}

				style.xyz_link = getTileUrls(
					req,
					style.serving_rendered.tileJSON.tiles,
					`styles/${id}`,
					style.serving_rendered.tileJSON.format,
					opts.publicUrl,
				)[0];
			}

			styles[id] = style;
		}

		let datas = {};
		for (const id of Object.keys(serving.data || {})) {
			let data = Object.assign({}, serving.data[id]);

			const { tileJSON } = serving.data[id];
			const { center } = tileJSON;

			if (center) {
				data.viewer_hash = `#${center[2]}/${center[1].toFixed(
					5,
				)}/${center[0].toFixed(5)}`;
			}

			data.is_vector = tileJSON.format === "pbf";
			if (!data.is_vector) {
				if (center) {
					const centerPx = mercator.px([center[0], center[1]], center[2]);
					data.thumbnail = `${center[2]}/${Math.floor(
						centerPx[0] / 256,
					)}/${Math.floor(centerPx[1] / 256)}.${tileJSON.format}`;
				}

				data.xyz_link = getTileUrls(
					req,
					tileJSON.tiles,
					`data/${id}`,
					tileJSON.format,
					opts.publicUrl,
					{
						pbf: options.pbfAlias,
					},
				)[0];
			}
			if (data.filesize) {
				let suffix = "kB";
				let size = parseInt(tileJSON.filesize, 10) / 1024;
				if (size > 1024) {
					suffix = "MB";
					size /= 1024;
				}
				if (size > 1024) {
					suffix = "GB";
					size /= 1024;
				}
				data.formatted_filesize = `${size.toFixed(2)} ${suffix}`;
			}

			datas[id] = data;
		}

		return {
			styles: Object.keys(styles).length ? styles : null,
			data: Object.keys(datas).length ? datas : null,
		};
	});

	serveTemplate("/styles/:id/$", "viewer", (req) => {
		const { id } = req.params;
		const style = clone(((serving.styles || {})[id] || {}).styleJSON);

		if (!style) {
			return null;
		}

		return {
			...style,
			id,
			name: (serving.styles[id] || serving.rendered[id]).name,
			serving_data: serving.styles[id],
			serving_rendered: serving.rendered[id],
		};
	});

	/*
  app.use('/rendered/:id/$', function(req, res, next) {
    return res.redirect(301, '/styles/' + req.params.id + '/');
  });
  */
	serveTemplate("/styles/:id/wmts.xml", "wmts", (req: Request) => {
		const { id } = req.params;
		console.log("wmts", id);

		const wmts = clone((serving.styles || {})[id]);

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
			name: (serving.styles[id] || serving.rendered[id]).name,
			baseUrl,
		};
	});

	serveTemplate("/data/:id/$", "data", (req: Request) => {
		const { id } = req.params;
		const data = serving.data[id];

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

	app.get("/health", (_, res) => {
		if (startupComplete) {
			return res.status(200).send("OK");
		} else {
			return res.status(503).send("Starting");
		}
	});

	const server = app.listen(parseInt(process.env.PORT ?? "5000"), async () => {
		console.log(`🚀 Server listening on port ${process.env.PORT}`);
	});

	return {
		app: app,
		server: server,
		startupPromise: startupPromise,
	};
}
