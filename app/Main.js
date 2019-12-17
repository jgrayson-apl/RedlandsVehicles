/*
  Copyright 2017 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.​
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/_base/Color",
  "dojo/colors",
  "dojo/number",
  "dojo/date/locale",
  "dojo/on",
  "dojo/query",
  "dojo/dom",
  "dojo/dom-class",
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/layers/Layer",
  "esri/renderers/smartMapping/statistics/uniqueValues",
  "esri/geometry/Extent",
  "esri/Graphic",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/LayerList",
  "esri/widgets/Legend",
  "esri/widgets/BasemapGallery",
  "esri/widgets/Measurement",
  "esri/widgets/Expand"
], function(calcite, declare, ApplicationBase, i18n, itemUtils, domHelper,
            Color, colors, number, locale, on, query, dom, domClass, domConstruct,
            IdentityManager, Evented, watchUtils, promiseUtils, Portal, Layer, uniqueValues,
            Extent, Graphic, Home, Search, LayerList, Legend, BasemapGallery, Measurement, Expand){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      // BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      domHelper.setPageLocale(this.base.locale);
      domHelper.setPageDirection(this.base.direction);

      const webMapItems = this.base.results.webMapItems;
      const webSceneItems = this.base.results.webSceneItems;
      const validItems = webMapItems.concat(webSceneItems).map(response => {
        return response.value;
      });
      const firstItem = (validItems && validItems.length) ? validItems[0] : null;
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }

      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(this.base.config.title);

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-container";
      viewProperties.constraints = { snapToZoom: false };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(this.base.config, firstItem, view).then(() => {
              /* ... */
            });
          });
        });
      });
    },

    /**
     *
     * @param config
     * @param item
     * @param view
     */
    viewReady: function(config, item, view){

      // TITLE //
      dom.byId("app-title-node").innerHTML = config.title;

      // LOADING //
      const updating_node = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updating_node);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        domClass.toggle(updating_node, "is-active", updating);
      });

      // USER SIGN IN //
      return this.initializeUserSignIn(view).always(() => {

        // MAP DETAILS //
        this.displayMapDetails(item);

        // POPUP DOCKING OPTIONS //
        view.popup.dockEnabled = true;
        view.popup.dockOptions = {
          buttonEnabled: false,
          breakpoint: false,
          position: "top-center"
        };

        // SEARCH //
        const search = new Search({ view: view, searchTerm: this.base.config.search || "" });
        const searchExpand = new Expand({
          view: view,
          content: search,
          expandIconClass: "esri-icon-search",
          expandTooltip: "Search"
        });
        view.ui.add(searchExpand, { position: "top-left", index: 0 });

        // BASEMAPS //
        const basemapGalleryExpand = new Expand({
          view: view,
          content: new BasemapGallery({ view: view }),
          expandIconClass: "esri-icon-basemap",
          expandTooltip: "Basemap"
        });
        view.ui.add(basemapGalleryExpand, { position: "top-left", index: 1 });

        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 2 });

        // LAYER LIST //
        this.initializeLayerList(view);

        // APPLICATION READY //
        this.applicationReady(view);

      });

    },

    /**
     *
     * @param view
     */
    initializeLayerList: function(view){

      // CREATE OPACITY NODE //
      const createOpacityNode = (item, parent_node) => {
        const opacity_node = domConstruct.create("div", { className: "opacity-node esri-widget", title: "Layer Opacity" }, parent_node);
        // domConstruct.create("span", { className: "font-size--3", innerHTML: "Opacity:" }, opacity_node);
        const opacity_input = domConstruct.create("input", { className: "opacity-input", type: "range", min: 0, max: 1.0, value: item.layer.opacity, step: 0.01 }, opacity_node);
        on(opacity_input, "input", () => {
          item.layer.opacity = opacity_input.valueAsNumber;
        });
        item.layer.watch("opacity", (opacity) => {
          opacity_input.valueAsNumber = opacity;
        });
        opacity_input.valueAsNumber = item.layer.opacity;
        return opacity_node;
      };
      // CREATE TOOLS NODE //
      const createToolsNode = (item, parent_node) => {
        // TOOLS NODE //
        const tools_node = domConstruct.create("div", { className: "opacity-node esri-widget" }, parent_node);

        // REORDER //
        const reorder_node = domConstruct.create("div", { className: "inline-block" }, tools_node);
        const reorder_up_node = domConstruct.create("button", { className: "btn-link icon-ui-up", title: "Move layer up..." }, reorder_node);
        const reorder_down_node = domConstruct.create("button", { className: "btn-link icon-ui-down", title: "Move layer down..." }, reorder_node);
        on(reorder_up_node, "click", () => {
          view.map.reorder(item.layer, view.map.layers.indexOf(item.layer) + 1);
        });
        on(reorder_down_node, "click", () => {
          view.map.reorder(item.layer, view.map.layers.indexOf(item.layer) - 1);
        });

        // REMOVE LAYER //
        const remove_layer_node = domConstruct.create("button", { className: "btn-link icon-ui-close right", title: "Remove layer from map..." }, tools_node);
        on.once(remove_layer_node, "click", () => {
          view.map.remove(item.layer);
          this.emit("layer-removed", item.layer);
        });

        // ZOOM TO //
        const zoom_to_node = domConstruct.create("button", { className: "btn-link icon-ui-zoom-in-magnifying-glass right", title: "Zoom to Layer" }, tools_node);
        on(zoom_to_node, "click", () => {
          view.goTo(item.layer.fullExtent);
        });

        // LAYER DETAILS //
        const itemDetailsPageUrl = `${this.base.portal.url}/home/item.html?id=${item.layer.portalItem.id}`;
        domConstruct.create("a", { className: "btn-link icon-ui-description icon-ui-blue right", title: "View details...", target: "_blank", href: itemDetailsPageUrl }, tools_node);

        return tools_node;
      };
      // LAYER LIST //
      const layerList = new LayerList({
        container: "layer-list-container",
        view: view,
        listItemCreatedFunction: (evt) => {
          const item = evt.item;
          if(item.layer && item.layer.portalItem){

            // CREATE ITEM PANEL //
            const panel_node = domConstruct.create("div", { className: "esri-widget" });

            // LAYER TOOLS //
            createToolsNode(item, panel_node);

            // OPACITY //
            createOpacityNode(item, panel_node);

            // if(item.layer.type === "imagery") {
            //   this.configureImageryLayer(view, item.layer, panel_node);
            // }

            // LEGEND //
            if(item.layer.legendEnabled){
              const legend = new Legend({ container: panel_node, view: view, layerInfos: [{ layer: item.layer }] })
            }

            // SET ITEM PANEL //
            item.panel = {
              title: "Settings",
              className: "esri-icon-settings",
              content: panel_node
            };
          }
        }
      });

    },

    /**
     * DISPLAY MAP DETAILS
     *
     * @param portalItem
     */
    displayMapDetails: function(portalItem){

      const portalUrl = this.base.portal ? (this.base.portal.urlKey ? `https://${this.base.portal.urlKey}.${this.base.portal.customBaseUrl}` : this.base.portal.url) : "https://www.arcgis.com";

      dom.byId("current-map-card-thumb").src = portalItem.thumbnailUrl;
      dom.byId("current-map-card-thumb").alt = portalItem.title;
      dom.byId("current-map-card-caption").innerHTML = `A map by ${portalItem.owner}`;
      dom.byId("current-map-card-caption").title = "Last modified on " + (new Date(portalItem.modified)).toLocaleString();
      dom.byId("current-map-card-title").innerHTML = portalItem.title;
      dom.byId("current-map-card-title").href = `${portalUrl}/home/item.html?id=${portalItem.id}`;
      dom.byId("current-map-card-description").innerHTML = portalItem.description;

    },

    /**
     *
     * @returns {*}
     */
    initializeUserSignIn: function(view){

      const checkSignInStatus = () => {
        return IdentityManager.checkSignInStatus(this.base.portal.url).then(userSignIn);
      };
      IdentityManager.on("credential-create", checkSignInStatus);
      IdentityManager.on("credential-destroy", checkSignInStatus);

      // SIGN IN NODE //
      const signInNode = dom.byId("sign-in-node");
      const userNode = dom.byId("user-node");

      // UPDATE UI //
      const updateSignInUI = () => {
        if(this.base.portal.user){
          dom.byId("user-firstname-node").innerHTML = this.base.portal.user.fullName.split(" ")[0];
          dom.byId("user-fullname-node").innerHTML = this.base.portal.user.fullName;
          dom.byId("username-node").innerHTML = this.base.portal.user.username;
          dom.byId("user-thumb-node").src = this.base.portal.user.thumbnailUrl;
          domClass.add(signInNode, "hide");
          domClass.remove(userNode, "hide");
        } else {
          domClass.remove(signInNode, "hide");
          domClass.add(userNode, "hide");
        }
        return promiseUtils.resolve();
      };

      // SIGN IN //
      const userSignIn = () => {
        this.base.portal = new Portal({ url: this.base.config.portalUrl, authMode: "immediate" });
        return this.base.portal.load().then(() => {
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).otherwise(console.warn);
      };

      // SIGN OUT //
      const userSignOut = () => {
        IdentityManager.destroyCredentials();
        this.base.portal = new Portal({});
        this.base.portal.load().then(() => {
          this.base.portal.user = null;
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).otherwise(console.warn);

      };

      // USER SIGN IN //
      on(signInNode, "click", userSignIn);

      // SIGN OUT NODE //
      const signOutNode = dom.byId("sign-out-node");
      if(signOutNode){
        on(signOutNode, "click", userSignOut);
      }

      return checkSignInStatus();
    },

    /**
     * APPLICATION READY
     *
     * @param view
     */
    applicationReady: function(view){

      /*
      const measurement = new Measurement({
        view: view,
        linearUnit: "meters",
        activeTool: "direct-line"
      });
      view.ui.add(measurement, "top-right");
      */

      /*
      const carModelByType = {
        "Sedan": [
          "Audi_A6",
          "BMW_3-Series",
          "Ford_Fiesta",
          "Ford_Focus_Hatchback",
          "Ford_Fusion",
          "Ford_Mustang",
          "Ford_Taurus",
          "Mercedes_S-Classv",
          "Porsche_Boxter",
          "Porsche_Carrera",
          "Tesla_P7",
          "Toyota_Prius",
          "Volkswagen_Jetta_Wagon"
        ],
        "Pickup": [
          "Ford_F-150",
          "Pickup_Truck_Ford_F250",
          "Pickup_Truck_Toyota_Hilux"
        ],
        "Van/SUV": [
          "Ford_Edge",
          "Ford_Expedition",
          "Ford_Transit_Commercial_Van",
          "Ford_Transit_Connect",
        ]
      };
      */

      const carsLayer = view.map.layers.find(layer => {
        return (layer.title === "Redlands Vehicles");
      });
      carsLayer.load().then(() => {
        //console.info(carsLayer.renderer.visualVariables);

        // DEFAULT SYMBOL //
        const defaultSymbol = carsLayer.renderer.symbol;

        /**
         * UPDATE THE RENDERER
         */
        const updateRenderer = () => {

          //
          // GET LIST OF MODEL NAMES FROM THE LAYER //
          //
          uniqueValues({ layer: carsLayer, field: "model_name" }).then(({ uniqueValueInfos }) => {

            //
            // GET UNIQUEVALUEINFOS USING SYMBOLS BASED ON MODEL NAMES //
            //  - https://developers.arcgis.com/javascript/latest/api-reference/esri-symbols-WebStyleSymbol.html
            //  - https://developers.arcgis.com/javascript/latest/guide/esri-web-style-symbols-3d/index.html
            //
            const symbolsByCarModel = uniqueValueInfos.map(uvInfo => {
              return {
                symbol: {
                  type: "web-style",
                  styleName: "EsriRealisticTransportationStyle",
                  name: uvInfo.value
                },
                value: uvInfo.value
              };
            });

            //
            // UPDATE LAYER RENDERER //
            //
            carsLayer.renderer = {
              type: "unique-value",
              field: "model_name",
              defaultSymbol: defaultSymbol,
              uniqueValueInfos: symbolsByCarModel,
              visualVariables: carsLayer.renderer.visualVariables
            };

          });
        };

        //
        // ADD UPDATE AND SAVE BUTTONS TO VIEW UI //
        //
        view.whenLayerView(carsLayer).then(carsLayerView => {
          watchUtils.whenFalseOnce(carsLayerView, "updating", () => {

            // TOOLS PANEL //
            const toolsPanel = domConstruct.create("div", { className: "panel panel-dark-blue" });
            view.ui.add(toolsPanel, "top-right");

            // UPDATE BUTTON //
            const updateBtn = domConstruct.create("button", { className: "btn btn-grouped btn-large icon-ui-refresh", innerHTML: "update" }, toolsPanel);
            on(updateBtn, "click", () => {
              //
              // UPDATE THE LAYER RENDERER
              //
              updateRenderer();
            });

            // SAVE BUTTON //
            const saveBtn = domConstruct.create("button", { className: "btn btn-grouped btn-large icon-ui-save", innerHTML: "save" }, toolsPanel);
            on(saveBtn, "click", () => {
              //
              // SAVE WEB SCENE //
              //
              view.map.save();
            });

          });
        });

      });

    }

  });
});
