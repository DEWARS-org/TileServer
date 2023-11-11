export interface TileJSON {
	/**
	 * A semver.org style version number as a string. Describes the version of the TileJSON spec that is implemented by this JSON object.
	 */
	tilejson: string;

	/**
	 * An array of tile endpoints. {z}, {x} and {y}, if present, are replaced with the corresponding integers. If multiple endpoints are specified, clients may use any combination of endpoints. All endpoint urls MUST be absolute. All endpoints MUST return the same content for the same URL. The array MUST contain at least one endpoint. The tile extension is NOT limited to any particular format. Some of the more popular are: mvt, vector.pbf, png, webp, and jpg.
	 */
	tiles: string[];

	/**
	 * An array of objects. Each object describes one layer of vector tile data. A vector_layer object MUST contain the id and fields keys, and MAY contain the description, minzoom, or maxzoom keys. An implemenntation MAY include arbitrary keys in the object outside of those defined in this specification.
	 *
	 * Note: When describinng a set of raster tiles or other tile format that does not have a "layers" concept (i.e. "format": "jpeg"), the vector_layers key is not required.
	 */
	vector_layers: {
		/**
		 * A string value representing the the layer id. For added context, this is referred to as the name of the layer in the Mapbox Vector Tile spec.
		 */
		id: string;

		/**
		 * An object whose keys and values are the names and descriptions of attributes available in this layer. Each value (description) MUST be a string that describes the underlying data. I
		 */
		fields: {
			[k: string]: string;
		};

		/**
		 * A string representing a human-readable description of the entire layer's contents.
		 */
		description?: string;

		/**
		 * An integer representing the lowest/highest zoom level whose tiles this layer appears in. minzoom MUST be greater than or equal to the set of tiles' minzoom. maxzoom MUST be less than or equal to the set of tiles' maxzoom.
		 *
		 * These keys are used to describe the situation where different sets of vector layers appear in different zoom levels of the same set of tiles, for example in a case where a "minor roads" layer is only present at high zoom levels.
		 */
		maxzoom?: number;

		/**
		 * An integer representing the lowest/highest zoom level whose tiles this layer appears in. minzoom MUST be greater than or equal to the set of tiles' minzoom. maxzoom MUST be less than or equal to the set of tiles' maxzoom.
		 *
		 * These keys are used to describe the situation where different sets of vector layers appear in different zoom levels of the same set of tiles, for example in a case where a "minor roads" layer is only present at high zoom levels.
		 */
		minzoom?: number;

		[k: string]: unknown;
	}[];

	/**
	 * Contains an attribution to be displayed when the map is shown to a user. Implementations MAY decide to treat this as HTML or literal text. For security reasons, make absolutely sure that this content can't be abused as a vector for XSS or beacon tracking.
	 */
	attribution?: string;

	/**
	 * The maximum extent of available map tiles. Bounds MUST define an area covered by all zoom levels. The bounds are represented in WGS 84 latitude and longitude values, in the order left, bottom, right, top. Values may be integers or floating point numbers. The minimum/maximum values for longitude and latitude are -180/180 and -90/90 respectively. Bounds MUST NOT "wrap" around the ante-meridian. If bounds are not present, the default value MAY assume the set of tiles is globally distributed.
	 */
	bounds?: number[];

	/**
	 * The first value is the longitude, the second is latitude (both in WGS:84 values), the third value is the zoom level as an integer. Longitude and latitude MUST be within the specified bounds. The zoom level MUST be between minzoom and maxzoom. Implementations MAY use this center value to set the default location. If the value is null, implementations MAY use their own algorithm for determining a default location.
	 */
	center?: number[];

	/**
	 * An array of data files in GeoJSON format. {z}, {x} and {y}, if present, are replaced with the corresponding integers. If multiple endpoints are specified, clients may use any combination of endpoints. All endpoints MUST return the same content for the same URL. If the array doesn't contain any entries, then no data is present in the map. This field is for overlaying GeoJSON data on tiled raster maps and is generally no longer used for GL-based maps.
	 */
	data?: string[];

	/**
	 * A text description of the set of tiles. The description can contain any valid unicode character as described by the JSON specification RFC 8259.
	 */
	description?: string;

	/**
	 * An integer specifying the zoom level from which to generate overzoomed tiles. Implementations MAY generate overzoomed tiles from parent tiles if the requested zoom level does not exist. In most cases, overzoomed tiles are generated from the maximum zoom level of the set of tiles. If fillzoom is specified, the overzoomed tile MAY be generated from the fillzoom level.
	 *
	 * For example, in a set of tiles with maxzoom 10 and no fillzoom specified, a request for a z11 tile will use the z10 parent tiles to generate the new, overzoomed z11 tile. If the same TileJSON object had fillzoom specified at z7, a request for a z11 tile would use the z7 tile instead of z10.
	 *
	 * While TileJSON may specify rules for overzooming tiles, it is ultimately up to the tile serving client or renderer to implement overzooming.
	 */
	fillzoom?: number;

	/**
	 * An array of interactivity endpoints. {z}, {x} and {y}, if present, are replaced with the corresponding integers. If multiple endpoints are specified, clients may use any combination of endpoints. All endpoints MUST return the same content for the same URL. If the array doesn't contain any entries, UTF-Grid interactivity is not supported for this set of tiles. See https://github.com/mapbox/utfgrid-spec/tree/master/1.2 for the interactivity specification.
	 *
	 * Note: UTF-Grid interactivity predates GL-based map rendering and interaction. Map interactivity is now generally defined outside of the TileJSON specification and is dependent on the tile rendering library's features.
	 */
	grids?: string[];

	/**
	 * Contains a legend to be displayed with the map. Implementations MAY decide to treat this as HTML or literal text. For security reasons, make absolutely sure that this field can't be abused as a vector for XSS or beacon tracking.
	 */
	legend?: string;

	/**
	 * An integer specifying the maximum zoom level. MUST be in range: 0 <= minzoom <= maxzoom <= 30. A client or server MAY request tiles outside of the zoom range, but the availability of these tiles is dependent on how the the tile server or renderer handles the request (such as overzooming tiles).
	 */
	maxzoom?: number;

	/**
	 * An integer specifying the minimum zoom level. MUST be in range: 0 <= minzoom <= maxzoom <= 30.
	 */
	minzoom?: number;

	/**
	 * A name describing the set of tiles. The name can contain any legal character. Implementations SHOULD NOT interpret the name as HTML.
	 */
	name?: string;

	/**
	 * Either "xyz" or "tms". Influences the y direction of the tile coordinates. The global-mercator (aka Spherical Mercator) profile is assumed.
	 */
	scheme?: "xyz" | "tms";

	/**
	 * Contains a mustache template to be used to format data from grids for interaction. See https://github.com/mapbox/utfgrid-spec/tree/master/1.2 for the interactivity specification.
	 */
	template?: string;

	/**
	 * A semver.org style version number of the tiles. When changes across tiles are introduced the minor version MUST change. This may lead to cut off labels. Therefore, implementors can decide to clean their cache when the minor version changes. Changes to the patch level MUST only have changes to tiles that are contained within one tile. When tiles change significantly, such as updating a vector tile layer name, the major version MUST be increased. Implementations MUST NOT use tiles with different major versions.
	 */
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
