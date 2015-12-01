/*global define*/
define([
        '../Core/appendForwardSlash',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/Event',
        '../Core/loadJson',
        '../Core/Math',
        '../ThirdParty/Uri',
        '../ThirdParty/when',
        './Cesium3DTile',
        './Cesium3DTileRefine',
        './Cesium3DTileContentState',
        './CullingVolume',
        './SceneMode'
    ], function(
        appendForwardSlash,
        defaultValue,
        defined,
        defineProperties,
        destroyObject,
        DeveloperError,
        Event,
        loadJson,
        CesiumMath,
        Uri,
        when,
        Cesium3DTile,
        Cesium3DTileRefine,
        Cesium3DTileContentState,
        CullingVolume,
        SceneMode) {
    "use strict";

    /**
     * DOC_TBA
     *
     * @param {Object} options Object with the following properties:
     * @param {String} options.url TODO
     * @param {Boolean} [options.show=true] TODO
     * @param {Boolean} [options.maximumScreenSpaceError=16] TODO
     * @param {Boolean} [options.debugShowStatistics=false] TODO
     * @param {Boolean} [options.debugFreezeFrame=false] TODO
     * @param {Boolean} [options.debugColorizeTiles=false] TODO
     * @param {Boolean} [options.debugShowBox=false] TODO
     * @param {Boolean} [options.debugShowcontentBox=false] TODO
     * @param {Boolean} [options.debugShowBoundingVolume=false] TODO
     * @param {Boolean} [options.debugShowContentsBoundingVolume=false] TODO
     *
     * @alias Cesium3DTileset
     * @constructor
     */
    var Cesium3DTileset = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        var url = options.url;

        //>>includeStart('debug', pragmas.debug);
        if (!defined(url)) {
            throw new DeveloperError('options.url is required.');
        }
        //>>includeEnd('debug');

        url = appendForwardSlash(url);

        this._url = url;
        this._root = undefined;
        this._properties = undefined; // // Metadata for per-model/point/etc properties
        this._geometricError = undefined; // Geometric error when the tree is not rendered at all
        this._processingQueue = [];
        this._selectedTiles = [];

        /**
         * DOC_TBA
         */
        this.show = defaultValue(options.show, true);

        /**
         * DOC_TBA
         */
        this.maximumScreenSpaceError = defaultValue(options.maximumScreenSpaceError, 16);

        /**
         * DOC_TBA
         */
        this.debugShowStatistics = defaultValue(options.debugShowStatistics, false);
        this._statistics = {
            // Rendering stats
            visited : 0,
            numberOfCommands : 0,
            // Loading stats
            numberOfPendingRequests : 0,
            numberProcessing : 0,

            lastSelected : -1,
            lastVisited : -1,
            lastNumberOfCommands : -1,
            lastNumberOfPendingRequests : -1,
            lastNumberProcessing : -1
        };

        /**
         * DOC_TBA
         */
        this.debugFreezeFrame = defaultValue(options.debugFreezeFrame, false);

        /**
         * DOC_TBA
         */
        this.debugColorizeTiles = defaultValue(options.debugColorizeTiles, false);

        /**
         * DOC_TBA
         */
        this.debugShowBox = defaultValue(options.debugShowBox, false);

        /**
         * DOC_TBA
         */
        this.debugShowcontentBox = defaultValue(options.debugShowcontentBox, false);

        /**
         * DOC_TBA
         */
        this.debugShowBoundingVolume = defaultValue(options.debugShowBoundingVolume, false);

        /**
         * DOC_TBA
         */
        this.debugShowContentsBoundingVolume = defaultValue(options.debugShowContentsBoundingVolume, false);

        /**
         * DOC_TBA
         */
        this.loadProgress = new Event();
        this._loadProgressEventsToRaise = [];

        /**
         * DOC_TBA
         */
// TODO:
// * This event fires inside update; the others are painfully deferred until the end of the frame,
// which also means they are one tick behind for time-dynamic updates.
        this.tileVisible = new Event();

        this._readyPromise = when.defer();

        var that = this;

        var tilesJson = url + 'tiles.json';
        loadTilesJson(this, tilesJson, undefined, function(data) {
            var tree = data.tree;
            that._properties = tree.properties;
            that._geometricError = tree.geometricError;
            that._root = data.root;
            that._readyPromise.resolve(that);
        });
    };

    function loadTilesJson(tileset, tilesJson, parentTile, done) {
        loadJson(tilesJson).then(function(tree) {
            var baseUrl = tileset.url;
            var rootTile = new Cesium3DTile(tileset, baseUrl, tree.root, parentTile);

            // If there is a parentTile, add the root of the currently loading
            // tileset to parentTile's children, and increment its numberOfChildrenWithoutContent
            // with 1
            if (defined(parentTile)) {
                parentTile.children.push(rootTile);
                parentTile.numberOfChildrenWithoutContent += 1;
            }

            var stack = [];
            stack.push({
                header : tree.root,
                cesium3DTile : rootTile
            });

            while (stack.length > 0) {
                var t = stack.pop();
                var children = t.header.children;
                if (defined(children)) {
                    var length = children.length;
                    for (var k = 0; k < length; ++k) {
                        var childHeader = children[k];
                        var childTile = new Cesium3DTile(tileset, baseUrl, childHeader, t.cesium3DTile);
                        t.cesium3DTile.children.push(childTile);

                        stack.push({
                            header : childHeader,
                            cesium3DTile : childTile
                        });
                    }
                }
            }

            done({
                tree : tree,
                root : rootTile
            });
        }).otherwise(function(error) {
            tileset._readyPromise.reject(error);
        });
    }

    defineProperties(Cesium3DTileset.prototype, {
        /**
         * DOC_TBA
         *
         * @memberof Cesium3DTileset.prototype
         *
         * @type {Object}
         * @readonly
         */
        properties : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this.ready) {
                    throw new DeveloperError('The tileset is not loaded.  Use Cesium3DTileset.readyPromise or wait for Cesium3DTileset.ready to be true.');
                }
                //>>includeEnd('debug');

                return this._properties;
            }
        },

        /**
         * DOC_TBA
         *
         * @memberof Cesium3DTileset.prototype
         *
         * @type {Boolean}
         * @readonly
         *
         * @default false
         */
        ready : {
            get : function() {
                return defined(this._root);
            }
        },

        /**
         * DOC_TBA
         *
         * @memberof Cesium3DTileset.prototype
         *
         * @type {Promise}
         * @readonly
         */
        readyPromise : {
            get : function() {
                return this._readyPromise;
            }
        },

        /**
         * DOC_TBA
         *
         * @memberof Cesium3DTileset.prototype
         *
         * @type {String}
         * @readonly
         */
        url : {
            get : function() {
                return this._url;
            }
        }
    });

    function getScreenSpaceError(geometricError, tile, frameState) {
        // TODO: screenSpaceError2D like QuadtreePrimitive.js
        if (geometricError === 0.0) {
            // Leaf nodes do not have any error so save the computation
            return 0.0;
        }

        // Avoid divide by zero when viewer is inside the tile
        var distance = Math.max(tile.distanceToCamera, CesiumMath.EPSILON7);
        var height = frameState.context.drawingBufferHeight;
        var sseDenominator = frameState.camera.frustum.sseDenominator;

        return (geometricError * height) / (distance * sseDenominator);
    }

    function computeDistanceToCamera(children, frameState) {
        var length = children.length;
        for (var i = 0; i < length; ++i) {
            var child = children[i];
            child.distanceToCamera = child.distanceToTile(frameState);
        }
    }

// TODO: is it worth exploiting frame-to-frame coherence in the sort?
    function sortChildrenByDistanceToCamera(a, b) {
        // Sort by farthest child first since this is going on a stack
        return b.distanceToCamera - a.distanceToCamera;
    }

    ///////////////////////////////////////////////////////////////////////////
    // TODO: make this real and system-wide
    var RequestScheduler = function() {
        this.numberOfPendingRequests = 0;
        /**
         * @readonly
         */
        this.maximumNumberOfPendingRequests = 6;
    };
    RequestScheduler.prototype.hasAvailableRequests = function() {
        return this.numberOfPendingRequests < this.maximumNumberOfPendingRequests;
    };
    var requestScheduler = new RequestScheduler();
    ///////////////////////////////////////////////////////////////////////////

    function requestContent(tiles3D, tile) {
        if (!requestScheduler.hasAvailableRequests()) {
            return;
        }
        ++requestScheduler.numberOfPendingRequests;

        var stats = tiles3D._statistics;
        ++stats.numberOfPendingRequests;
        addLoadProgressEvent(tiles3D);

        tile.requestContent();
        var removeFunction = removeFromProcessingQueue(tiles3D, tile);
        when(tile.processingPromise).then(addToProcessingQueue(tiles3D, tile)).otherwise(endRequest(tiles3D, tile));
        when(tile.readyPromise).then(removeFunction).otherwise(removeFunction);
    }

    function selectTileWithTilesetContent(tiles3D, selectedTiles, tile, fullyVisible, frameState, replace) {
        // 1) If its children are not loaded, load the subtree it points to and then select its root child
        // 2) If its children are already loaded, select its (root) child since the geometric error of it is
        //    same as this tile's
        var contentUrl = tile._header.content.url;
        var root;

        // If the subtree has already been added and child
        // content requested, select the child (= the root) and continue
        if ((tile.isReady()) &&
            (tile.numberOfChildrenWithoutContent === 0)) {
            // A tiles.json must specify at least one tile, ie a root
            // and the root will always be appended to a parent tile's children
            // list.
            root = tile.children[tile.children.length - 1];
            if (root.hasTilesetContent) {
                selectTileWithTilesetContent(tiles3D, selectedTiles, root, fullyVisible, frameState, replace);
            } else {
                if (root.isContentUnloaded()) {
                    requestContent(tiles3D, root);
                } else if (root.isReady()){
                    selectTile(selectedTiles, root, fullyVisible, frameState);
                }
            }
            return;
        } else if (replace) {
            // Otherwise, select the parent tile, to avoid showing an empty space
            // while waiting for tile to load
            if (defined(tile.parent)) {
                selectTile(selectedTiles, tile.parent, fullyVisible, frameState);
            }
        }

        // Request the tile's tileset if it's unloaded.
        if (tile.isContentUnloaded()) {
            tile.content.state = Cesium3DTileContentState.LOADING;
            var tilesUrl = (new Uri(contentUrl).isAbsolute()) ? contentUrl : tiles3D._url + contentUrl;
            loadTilesJson(tiles3D, tilesUrl, tile, function() {
                tile.content.state = Cesium3DTileContentState.READY;
            });
        }
    }

    function selectTile(selectedTiles, tile, fullyVisible, frameState) {
        // There may also be a tight box around just the tile's contents, e.g., for a city, we may be
        // zoomed into a neighborhood and can cull the skyscrapers in the root node.
        if (tile.isReady() &&
                (fullyVisible || (tile.contentsVisibility(frameState.cullingVolume) !== CullingVolume.MASK_OUTSIDE))) {
            selectedTiles.push(tile);
        }
    }

    var scratchStack = [];

    function selectTiles(tiles3D, frameState, outOfCore) {
        if (tiles3D.debugFreezeFrame) {
            return;
        }

        var maximumScreenSpaceError = tiles3D.maximumScreenSpaceError;
        var cullingVolume = frameState.cullingVolume;

        var selectedTiles = tiles3D._selectedTiles;
        selectedTiles.length = 0;

        var root = tiles3D._root;
        root.distanceToCamera = root.distanceToTile(frameState);
        root.parentPlaneMask = CullingVolume.MASK_INDETERMINATE;

        if (getScreenSpaceError(tiles3D._geometricError, root, frameState) <= maximumScreenSpaceError) {
            // The SSE of not rendering the tree is small enough that the tree does not need to be rendered
            return;
        }

        if (root.isContentUnloaded()) {
            if (root.hasTilesetContent) {
                selectTileWithTilesetContent(tiles3D, selectedTiles, root, fullyVisible, frameState, true);
            } else if (outOfCore) {
                requestContent(tiles3D, root);
            }
            return;
        }

        var stats = tiles3D._statistics;

        var stack = scratchStack;
        stack.push(root);
        while (stack.length > 0) {
            // Depth first.  We want the high detail tiles first.
            var t = stack.pop();
            ++stats.visited;

            var planeMask = t.visibility(cullingVolume);
            if (planeMask === CullingVolume.MASK_OUTSIDE) {
                // Tile is completely outside of the view frustum; therefore
                // so are all of its children.
                continue;
            }
            var fullyVisible = (planeMask === CullingVolume.MASK_INSIDE);

            // Tile is inside/intersects the view frustum.  How many pixels is its geometric error?
            var sse = getScreenSpaceError(t.geometricError, t, frameState);
// TODO: refine also based on (1) occlusion/VMSSE and/or (2) center of viewport

            var children = t.children;
            var childrenLength = children.length;
            var child;
            var k;

            if (t.refine === Cesium3DTileRefine.ADD) {
                // With additive refinement, the tile is rendered
                // regardless of if its SSE is sufficient.

                if (!t.hasTilesetContent) {
                    selectTile(selectedTiles, t, fullyVisible, frameState);
                } else {
                    // Check if the tile contains another tileset. If so:
                    //   1) If its children are not loaded, load the tileset it points to
                    //      and concatenate with this tileset.
                    //   2) If its children are already loaded, select its (root) child
                    //      since the geometric error of it is same as this tile's.
                    if (sse <= maximumScreenSpaceError) {
                        selectTileWithTilesetContent(tiles3D, selectedTiles, t, fullyVisible, frameState, false);
                    }
                }

// TODO: experiment with prefetching children
                if (sse > maximumScreenSpaceError) {
                    // Tile does not meet SSE. Refine to them in front-to-back order.

                    // Only sort and refine (render or request children) if any
                    // children are loaded or request slots are available.
                    var anyChildrenLoaded = (t.numberOfChildrenWithoutContent < childrenLength);
                    if (anyChildrenLoaded || requestScheduler.hasAvailableRequests()) {
                        // Distance is used for sorting now and for computing SSE when the tile comes off the stack.
                        computeDistanceToCamera(children, frameState);

                        // Sort children by distance for (1) request ordering, and (2) early-z
                        children.sort(sortChildrenByDistanceToCamera);
// TODO: is pixel size better?
// TODO: consider priority queue instead of explicit sort, which would no longer be DFS.

                        // With additive refinement, we only request children that are visible, compared
                        // to replacement refinement where we need all children.
                        for (k = 0; k < childrenLength; ++k) {
                            child = children[k];
                            // Store the plane mask so that the child can optimize based on its parent's returned mask
                            child.parentPlaneMask = planeMask;

                            // Use parent's geometric error with child's box to see if we already meet the SSE
                            if (getScreenSpaceError(t.geometricError, child, frameState) > maximumScreenSpaceError) {
                                if (child.isContentUnloaded() && (child.visibility(cullingVolume) !== CullingVolume.MASK_OUTSIDE) && outOfCore) {
                                    requestContent(tiles3D, child);
                                } else {
                                    stack.push(child);
                                }
                            }
                        }
                    }
                }
            } else {
                // t.refine === Cesium3DTileRefine.REPLACE
                //
                // With replacement refinement, if the tile's SSE
                // is not sufficient, its children (or ancestors) are
                // rendered instead

                if ((sse <= maximumScreenSpaceError) || (childrenLength === 0)) {
                    // This tile meets the SSE so add its commands.
                    //
                    // Select tile if it's a leaf (childrenLength === 0) and
                    // does not have tileset content.
                    // If the tile has tileset content, handle that tile separately.
                    if (!t.hasTilesetContent) {
                        selectTile(selectedTiles, t, fullyVisible, frameState);
                    } else {
                        selectTileWithTilesetContent(tiles3D, selectedTiles, t, fullyVisible, frameState, true);
                    }
                } else {
                    // Tile does not meet SSE.

                    // Only sort children by distance if we are going to refine to them
                    // or slots are available to request them.  If we are just rendering the
                    // tile (and can't make child requests because no slots are available)
                    // then the children do not need to be sorted.
                    var allChildrenLoaded = t.numberOfChildrenWithoutContent === 0;
                    if (allChildrenLoaded || requestScheduler.hasAvailableRequests()) {
                        // Distance is used for sorting now and for computing SSE when the tile comes off the stack.
                        computeDistanceToCamera(children, frameState);

                        // Sort children by distance for (1) request ordering, and (2) early-z
                        children.sort(sortChildrenByDistanceToCamera);
// TODO: same TODO as above.
                    }

                    if (!allChildrenLoaded) {
                        // Tile does not meet SSE.  Add its commands since it is the best we have and request its children.
                        if (!t.hasTilesetContent) {
                            selectTile(selectedTiles, t, fullyVisible, frameState);
                        } else {
                            selectTileWithTilesetContent(tiles3D, selectedTiles, t, fullyVisible, frameState, true);
                        }

                        if (outOfCore) {
                            for (k = 0; (k < childrenLength) && requestScheduler.hasAvailableRequests(); ++k) {
                                child = children[k];
// TODO: we could spin a bit less CPU here and probably above by keeping separate lists for unloaded/ready children.
                                if (child.isContentUnloaded()) {
                                    requestContent(tiles3D, child);
                                }
                            }
                        }
                    } else {
                        // Tile does not meet SEE and its children are loaded.  Refine to them in front-to-back order.
                        for (k = 0; k < childrenLength; ++k) {
                            child = children[k];
                            // Store the plane mask so that the child can optimize based on its parent's returned mask
                            child.parentPlaneMask = planeMask;
                            stack.push(child);
                        }
                    }
                }
            }
        }
    }

    ///////////////////////////////////////////////////////////////////////////

    function addToProcessingQueue(tiles3D, tile) {
        return function() {
            tiles3D._processingQueue.push(tile);

            var stats = tiles3D._statistics;
            --stats.numberOfPendingRequests;
            ++stats.numberProcessing;
            addLoadProgressEvent(tiles3D);
        };
    }

    function removeFromProcessingQueue(tiles3D, tile) {
        return function() {
            var index = tiles3D._processingQueue.indexOf(tile);
            tiles3D._processingQueue.splice(index, 1);

            --requestScheduler.numberOfPendingRequests;
            --tiles3D._statistics.numberProcessing;
            addLoadProgressEvent(tiles3D);
        };
    }

    function endRequest(tiles3D, tile) {
        return function() {
            --requestScheduler.numberOfPendingRequests;
            --tiles3D._statistics.numberProcessing;
            addLoadProgressEvent(tiles3D);
        };
    }

    function processTiles(tiles3D, frameState) {
        var tiles = tiles3D._processingQueue;
        var length = tiles.length;

        // Process tiles in the PROCESSING state so they will eventually move to the READY state.
        // Traverse backwards in case a tile is removed as a result of calling process()
        for (var i = length - 1; i >= 0; --i) {
            tiles[i].process(tiles3D, frameState);
        }
    }

    ///////////////////////////////////////////////////////////////////////////

    function clearStats(tiles3D) {
        var stats = tiles3D._statistics;
        stats.visited = 0;
        stats.numberOfCommands = 0;
    }

    function showStats(tiles3D, isPick) {
        var stats = tiles3D._statistics;

        if (tiles3D.debugShowStatistics && (
            stats.lastVisited !== stats.visited ||
            stats.lastNumberOfCommands !== stats.numberOfCommands ||
            stats.lastSelected !== tiles3D._selectedTiles.length ||
            stats.lastNumberOfPendingRequests !== stats.numberOfPendingRequests ||
            stats.lastNumberProcessing !== stats.numberProcessing)) {

            stats.lastVisited = stats.visited;
            stats.lastNumberOfCommands = stats.numberOfCommands;
            stats.lastSelected = tiles3D._selectedTiles.length;
            stats.lastNumberOfPendingRequests = stats.numberOfPendingRequests;
            stats.lastNumberProcessing = stats.numberProcessing;

            // Since the pick pass uses a smaller frustum around the pixel of interest,
            // the stats will be different than the normal render pass.
            var s = isPick ? '[Pick ]: ' : '[Color]: ';
            s +=
                'Visited: ' + stats.visited +
                // Number of commands returned is likely to be higher than the number of tiles selected
                // because of tiles that create multiple commands.
                ', Selected: ' + tiles3D._selectedTiles.length +
                // Number of commands executed is likely to be higher because of commands overlapping
                // multiple frustums.
                ', Commands: ' + stats.numberOfCommands +
                ', Requests: ' + stats.numberOfPendingRequests +
                ', Processing: ' + stats.numberProcessing;

            /*global console*/
            console.log(s);
        }
    }

    function updateTiles(tiles3D, frameState) {
        var commandList = frameState.commandList;
        var numberOfCommands = commandList.length;
        var selectedTiles = tiles3D._selectedTiles;
        var length = selectedTiles.length;
        var tileVisible = tiles3D.tileVisible;
        for (var i = 0; i < length; ++i) {
            var tile = selectedTiles[i];
            tileVisible.raiseEvent(tile);
            tile.update(tiles3D, frameState);
        }

        tiles3D._statistics.numberOfCommands = (commandList.length - numberOfCommands);
    }

    ///////////////////////////////////////////////////////////////////////////

    function addLoadProgressEvent(tiles3D) {
        if (tiles3D.loadProgress.numberOfListeners > 0) {
            var stats = tiles3D._statistics;
            tiles3D._loadProgressEventsToRaise.push({
                numberOfPendingRequests : stats.numberOfPendingRequests,
                numberProcessing : stats.numberProcessing
            });
        }
    }

    function evenMoreComplicated(tiles3D, numberOfPendingRequests, numberProcessing) {
        return function() {
            tiles3D.loadProgress.raiseEvent(numberOfPendingRequests, numberProcessing);
        };
    }

    function raiseLoadProgressEvents(tiles3D, frameState) {
        var eventsToRaise = tiles3D._loadProgressEventsToRaise;
        var length = eventsToRaise.length;
        for (var i = 0; i < length; ++i) {
            var numberOfPendingRequests = eventsToRaise[i].numberOfPendingRequests;
            var numberProcessing = eventsToRaise[i].numberProcessing;

            frameState.afterRender.push(evenMoreComplicated(tiles3D, numberOfPendingRequests, numberProcessing));
        }
        eventsToRaise.length = 0;
    }

    ///////////////////////////////////////////////////////////////////////////

    /**
     * DOC_TBA
     */
    Cesium3DTileset.prototype.update = function(frameState) {
        // TODO: Support 2D and CV
        if (!this.show || !defined(this._root) || (frameState.mode !== SceneMode.SCENE3D)) {
            return;
        }

        // Do not do out-of-core operations (new content requests, cache removal,
        // process new tiles) during the pick pass.
        var passes = frameState.passes;
        var isPick = (passes.pick && !passes.render);
        var outOfCore = !isPick;

        clearStats(this);

        if (outOfCore) {
            processTiles(this, frameState);
        }
        selectTiles(this, frameState, outOfCore);
        updateTiles(this, frameState);

        // Events are raised (added to the afterRender queue) here since promises
        // may resolve outside of the update loop that then raise events, e.g.,
        // model's readyPromise.
        raiseLoadProgressEvents(this, frameState);

        showStats(this, isPick);
    };

    /**
     * DOC_TBA
     */
    Cesium3DTileset.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * DOC_TBA
     */
    Cesium3DTileset.prototype.destroy = function() {
// TODO: traverse and destroy...careful of pending loads/processing
        return destroyObject(this);
    };

    return Cesium3DTileset;
});
