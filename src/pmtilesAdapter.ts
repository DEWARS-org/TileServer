import { read, openSync } from "node:fs";
import { PMTiles, FetchSource, TileType } from "pmtiles";

class PMTilesFileSource {
	fd: number;

	constructor(fd: number) {
		this.fd = fd;
	}
	getKey() {
		return this.fd;
	}
	async getBytes(offset: number, length: number) {
		const buffer = Buffer.alloc(length);
		await ReadFileBytes(this.fd, buffer, offset);
		const ab = buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength,
		);
		return { data: ab };
	}
}

async function ReadFileBytes(fd: number, buffer: Uint8Array, offset: number) {
	return new Promise((resolve, reject) => {
		read(fd, buffer, 0, buffer.length, offset, (err) => {
			if (err) {
				return reject(err);
			}
			resolve();
		});
	});
}

export function PMtilesOpen(FilePath: string) {
	const fd = openSync(FilePath, "r");
	const source = new PMTilesFileSource(fd);
	return new PMTiles(source);
}

export async function GetPMtilesInfo(pmtiles: PMTiles) {
	const header = await pmtiles.getHeader();

	const metadata = await pmtiles.getMetadata();

	//Add missing metadata from header
	metadata["format"] = GetPmtilesTileType(header.tileType).type;
	metadata["minzoom"] = header.minZoom;
	metadata["maxzoom"] = header.maxZoom;

	if (header.minLon && header.minLat && header.maxLon && header.maxLat) {
		metadata["bounds"] = [
			header.minLon,
			header.minLat,
			header.maxLon,
			header.maxLat,
		];
	} else {
		metadata["bounds"] = [-180, -85.05112877980659, 180, 85.0511287798066];
	}

	if (header.centerZoom) {
		metadata["center"] = [
			header.centerLon,
			header.centerLat,
			header.centerZoom,
		];
	} else {
		metadata["center"] = [
			header.centerLon,
			header.centerLat,
			parseInt(metadata["maxzoom"]) / 2,
		];
	}

	return metadata;
}

export async function GetPMtilesTile(
	pmtiles: PMTiles,
	z: number,
	x: number,
	y: number,
) {
	const header = await pmtiles.getHeader();
	const TileType = GetPmtilesTileType(header.tileType);
	let zxyTile = await pmtiles.getZxy(z, x, y);
	if (zxyTile?.data) {
		zxyTile = Buffer.from(zxyTile.data);
	} else {
		zxyTile = undefined;
	}
	return { data: zxyTile, header: TileType.header };
}

function GetPmtilesTileType(typenum: TileType) {
	let head = {};
	let tileType;
	switch (typenum) {
		case TileType.Unknown:
			tileType = "Unknown";
			break;
		case TileType.Mvt:
			tileType = "pbf";
			head["Content-Type"] = "application/x-protobuf";
			break;
		case TileType.Png:
			tileType = "png";
			head["Content-Type"] = "image/png";
			break;
		case TileType.Jpeg:
			tileType = "jpeg";
			head["Content-Type"] = "image/jpeg";
			break;
		case TileType.Webp:
			tileType = "webp";
			head["Content-Type"] = "image/webp";
			break;
		case TileType.Avif:
			tileType = "avif";
			head["Content-Type"] = "image/avif";
			break;
	}
	return { type: tileType, header: head };
}
