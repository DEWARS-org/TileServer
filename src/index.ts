import { TileJSON } from "./utils.js";
import { Request, Response, NextFunction } from "@tinyhttp/app";
import { GetPMtilesTile, GetPmtilesTileInfo } from "./pmtilesAdapter.js";
import { PMTiles } from "@dewars/pmtiles";
import type {
  LayerSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import theme from "protomaps-themes-base";
import { resolve } from "path";
import { PMtilesOpen } from "./pmtilesAdapter.js";
import { opendir } from "fs";

export class TileServer {
  private dataDirectory: string;
  private publicURL: string;
  private styles: Map<string, StyleSpecification>;
  private pmTilesSources: Map<
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
    this.pmTilesSources = new Map();

    this.addStyle("protomaps-dark", theme.default("protomaps-dark", "dark"));
    this.addStyle("protomaps-light", theme.default("protomaps-light", "light"));
    this.addStyle("labels", theme.labels("labels", "dark"));
    this.addStyle("raster", [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#d3d3d3",
        },
      },
      {
        id: "simple-tiles",
        type: "raster",
        source: "testData",
        minzoom: 10,
        maxzoom: 20,
      },
    ]);
    this.addPmTileSource("protomaps");
    this.addPmTileSource("testData");
    this.addPmTileSource("ESRI-Imagery");
  }

  private loadData() {}

  private addStyle(id: string, layers: LayerSpecification[]) {
    const styleJson: StyleSpecification = {
      version: 8,
      glyphs:
        "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sources: {},
      layers,
    };

    this.styles.set(id, styleJson);
  }

  getStyles() {
    return this.styles;
  }

  private async addPmTileSource(id: string) {
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

    this.pmTilesSources.set(id, {
      tileJSON,
      source,
    });
  }

  public getPmTileSources() {
    return this.pmTilesSources;
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
      const style = this.styles.get(styleJsonMatch?.styleId);
      const pmTiles = this.pmTilesSources.get(styleJsonMatch?.tileSource);

      if (!(style && pmTiles)) {
        return res.sendStatus(404);
      }

      const { tileType } = await pmTiles.source.getHeader();

      const pmTilesInfo = GetPmtilesTileInfo(tileType);

      style.sources[styleJsonMatch?.styleId] = {
        type: pmTilesInfo.styleType ?? "raster",
        url: `${this.publicURL}/tiles/${styleJsonMatch?.tileSource}.json`,
      };

      res.json(style);
      return next();
    }

    const tileJsonRegex = /^\/tiles\/(?<id>.*)\.json$/g;
    const tileJsonMatch = tileJsonRegex.exec(req.path);

    if (tileJsonMatch?.groups?.id) {
      const data = this.pmTilesSources.get(tileJsonMatch?.groups?.id);

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

    const pathGroups = pathGroupsMatch?.groups as PathGroups | undefined;

    if (pathGroups) {
      const data = this.pmTilesSources.get(pathGroups.tileSource);

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
