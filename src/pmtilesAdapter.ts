import { openSync, read } from "node:fs";
import { promisify } from "node:util";
import { PMTiles, TileType, Source, RangeResponse } from "@dewars/pmtiles";

class PMTilesFileSource implements Source {
  fd: number;

  constructor(path: string) {
    this.fd = openSync(path, "r");
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buffer = new Uint8Array(length);
    await promisify(read)(this.fd, buffer, 0, buffer.length, offset);

    return { data: buffer.buffer };
  }

  getKey() {
    return this.fd.toString();
  }
}

export function PMtilesOpen(path: string) {
  const source = new PMTilesFileSource(path);
  return new PMTiles(source);
}

export async function GetPMtilesTile(
  pmtiles: PMTiles,
  z: number,
  x: number,
  y: number,
) {
  const header = await pmtiles.getHeader();
  const tileInfo = GetPmtilesTileInfo(header.tileType);
  const zxyTile = await pmtiles.getZxy(z, x, y);

  if (!zxyTile) {
    throw new Error("Tile not found");
  }

  const data = new Uint8Array(zxyTile.data);

  return { data, tileInfo };
}

type StyleType =
  // | "geojson"
  // | "image"
  | "raster"
  // | "raster-dem"
  | "vector";
// | "video";

export function GetPmtilesTileInfo(typenum: TileType) {
  const tileTypeData = new Map<TileType, [string, string, StyleType]>();

  tileTypeData.set(TileType.Unknown, ["Unknown", "", "raster"]);
  tileTypeData.set(TileType.Mvt, ["application/x-protobuf", "mvt", "vector"]);
  tileTypeData.set(TileType.Png, ["image/png", "png", "raster"]);
  tileTypeData.set(TileType.Jpeg, ["image/jpeg", "jpg", "raster"]);
  tileTypeData.set(TileType.Webp, ["image/webp", "webp", "raster"]);
  tileTypeData.set(TileType.Avif, ["image/avif", "avif", "raster"]);

  const [contentType, fileExtension, styleType] = tileTypeData.get(typenum) ?? [
    "Unknown",
    "",
  ];

  return { contentType, fileExtension, styleType };
}
