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

    // {
    // 	format: 'png',
    // 	maxzoom: '20',
    // 	minzoom: '10',
    // 	name: 'testData',
    // 	type: 'overlay',
    // 	version: '1.1'
    //   }
    //   {
    // 	vector_layers: [
    // 	  { id: 'boundaries', fields: [Object], minzoom: 0, maxzoom: 15 },
    // 	  { id: 'buildings', fields: [Object], minzoom: 11, maxzoom: 15 },
    // 	  { id: 'earth', fields: [Object], minzoom: 0, maxzoom: 15 },
    // 	  { id: 'landuse', fields: [Object], minzoom: 2, maxzoom: 15 },
    // 	  { id: 'natural', fields: [Object], minzoom: 2, maxzoom: 15 },
    // 	  { id: 'physical_line', fields: [Object], minzoom: 9, maxzoom: 15 },
    // 	  { id: 'physical_point', fields: [Object], minzoom: 0, maxzoom: 15 },
    // 	  { id: 'places', fields: [Object], minzoom: 0, maxzoom: 15 },
    // 	  { id: 'pois', fields: [Object], minzoom: 5, maxzoom: 15 },
    // 	  { id: 'roads', fields: [Object], minzoom: 3, maxzoom: 15 },
    // 	  { id: 'transit', fields: [Object], minzoom: 9, maxzoom: 15 },
    // 	  { id: 'water', fields: [Object], minzoom: 0, maxzoom: 15 }
    // 	],
    // 	name: 'Basemap',
    // 	description: 'Basemap layers derived from OpenStreetMap and Natural Earth',
    // 	attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
    // 	type: 'baselayer',
    // 	'planetiler:version': '0.6-SNAPSHOT',
    // 	'planetiler:githash': 'e473c429c442d8a044f11e59e4990e2a8dbbdd14',
    // 	'planetiler:buildtime': '2023-09-13T09:20:59.877Z',
    // 	'planetiler:osm:osmosisreplicationtime': '2023-08-06T23:59:53Z',
    // 	'planetiler:osm:osmosisreplicationseq': '0',
    // 	'planetiler:osm:osmosisreplicationurl': ''
    //   }

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
    this.addPMTileSource("protomaps");
    this.addPMTileSource("testData");
    this.addPMTileSource("ESRI-Imagery");
  }

  private loadData() {}

  private addStyle(id: string, layers: LayerSpecification[]) {
    const styleJSON: StyleSpecification = {
      version: 8,
      glyphs:
        "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sources: {},
      layers,
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

    this.pmTilesSources.set(id, {
      tileJSON,
      source,
    });
  }

  public getPMTileSources() {
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
      const style = this.styles.get(styleJsonMatch.styleId);
      const pmTiles = this.pmTilesSources.get(styleJsonMatch.tileSource);

      if (!style || !pmTiles) {
        return res.sendStatus(404);
      }

      const { tileType } = await pmTiles.source.getHeader();

      const PMTilesInfo = GetPmtilesTileInfo(tileType);

      style.sources[styleJsonMatch.styleId] = {
        type: PMTilesInfo.styleType ?? "raster",
        url: `${this.publicURL}/tiles/${styleJsonMatch.tileSource}.json`,
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

    const pathGroups = pathGroupsMatch?.groups as unknown as PathGroups;

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
