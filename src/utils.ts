import { join } from "path";
import { readFile } from "node:fs";
import clone from "clone";
import glyphCompose from "@mapbox/glyph-pbf-composite";
import {} from "pmtiles";
import type { Request, Response } from "@tinyhttp/app";

/**
 * Generate new URL object
 * @param req
 * @params {object} req - Express request
 * @returns {URL} object
 */
const getUrlObject = (req: Request) => {
	const urlObject = new URL(`${req.protocol}://${req.headers.host}/`);
	// support overriding hostname by sending X-Forwarded-Host http header
	urlObject.hostname = req.hostname;
	return urlObject;
};

export const getPublicUrl = (publicUrl, req: Request) => {
	if (publicUrl) {
		return publicUrl;
	}
	return getUrlObject(req).toString();
};

export const getTileUrls = (
	req: Request,
	domains: string,
	path: string,
	format: string,
	publicUrl: string,
) => {
	const urlObject = getUrlObject(req);
	if (domains) {
		if (domains.constructor === String && domains.length > 0) {
			domains = domains.split(",");
		}
		const hostParts = urlObject.host.split(".");
		const relativeSubdomainsUsable =
			hostParts.length > 1 &&
			!/^([0-9]{1,3}\.){3}[0-9]{1,3}(\:[0-9]+)?$/.test(urlObject.host);
		const newDomains = [];
		for (const domain of domains) {
			if (domain.indexOf("*") !== -1) {
				if (relativeSubdomainsUsable) {
					const newParts = hostParts.slice(1);
					newParts.unshift(domain.replace("*", hostParts[0]));
					newDomains.push(newParts.join("."));
				}
			} else {
				newDomains.push(domain);
			}
		}
		domains = newDomains;
	}
	if (!domains || domains.length == 0) {
		domains = [urlObject.host];
	}

	const queryParams = [];
	if (req.query.key) {
		queryParams.push(`key=${encodeURIComponent(req.query.key)}`);
	}
	if (req.query.style) {
		queryParams.push(`style=${encodeURIComponent(req.query.style)}`);
	}
	const query = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";

	const uris = [];
	if (!publicUrl) {
		for (const domain of domains) {
			uris.push(
				`${req.protocol}://${domain}/${path}/{z}/{x}/{y}.${format}${query}`,
			);
		}
	} else {
		uris.push(`${publicUrl}${path}/{z}/{x}/{y}.${format}${query}`);
	}

	return uris;
};

export interface TileJSON {
	tilejson: string;
	tiles: string[];
	vector_layers: {
		id: string;
		fields: {
			[k: string]: string;
		};
		description?: string;
		maxzoom?: number;
		minzoom?: number;
		[k: string]: unknown;
	}[];
	attribution?: string;
	bounds?: number[];
	center?: number[];
	data?: string[];
	description?: string;
	fillzoom?: number;
	grids?: string[];
	legend?: string;
	maxzoom?: number;
	minzoom?: number;
	name?: string;
	scheme?: string;
	template?: string;
	version?: string;
	[k: string]: unknown;
}

export const fixTileJSONCenter = (tileJSON: TileJSON) => {
	if (tileJSON.bounds && !tileJSON.center) {
		const fitWidth = 1024;
		const tiles = fitWidth / 256;
		tileJSON.center = [
			(tileJSON.bounds[0] + tileJSON.bounds[2]) / 2,
			(tileJSON.bounds[1] + tileJSON.bounds[3]) / 2,
			Math.round(
				-Math.log((tileJSON.bounds[2] - tileJSON.bounds[0]) / 360 / tiles) /
					Math.LN2,
			),
		];
	}
};

const getFontPbf = (
	allowedFonts,
	fontPath: string,
	name: string,
	range: string,
	fallbacks,
) =>
	new Promise((resolve, reject) => {
		if (!allowedFonts || (allowedFonts[name] && fallbacks)) {
			const filename = join(fontPath, name, `${range}.pbf`);
			if (!fallbacks) {
				fallbacks = clone(allowedFonts);
			}
			delete fallbacks[name];
			readFile(filename, (err, data) => {
				if (err) {
					console.error(`ERROR: Font not found: ${name}`);
					if (fallbacks && Object.keys(fallbacks).length) {
						let fallbackName;

						let fontStyle = name.split(" ").pop();
						if (["Regular", "Bold", "Italic"].indexOf(fontStyle) < 0) {
							fontStyle = "Regular";
						}
						fallbackName = `Noto Sans ${fontStyle}`;
						if (!fallbacks[fallbackName]) {
							fallbackName = `Open Sans ${fontStyle}`;
							if (!fallbacks[fallbackName]) {
								fallbackName = Object.keys(fallbacks)[0];
							}
						}

						console.error(`ERROR: Trying to use ${fallbackName} as a fallback`);
						delete fallbacks[fallbackName];
						getFontPbf(null, fontPath, fallbackName, range, fallbacks).then(
							resolve,
							reject,
						);
					} else {
						reject(`Font load error: ${name}`);
					}
				} else {
					resolve(data);
				}
			});
		} else {
			reject(`Font not allowed: ${name}`);
		}
	});

export const getFontsPbf = (
	allowedFonts,
	fontPath: string,
	names: string,
	range: string,
	fallbacks,
) => {
	const fonts = names.split(",");
	const queue = [];
	for (const font of fonts) {
		queue.push(
			getFontPbf(
				allowedFonts,
				fontPath,
				font,
				range,
				clone(allowedFonts || fallbacks),
			),
		);
	}

	return Promise.all(queue).then((values) => glyphCompose.combine(values));
};
