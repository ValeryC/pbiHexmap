/*
 *  Power BI Visual CLI
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */

module powerbi.extensibility.visual {
    "use strict";

    declare let d3: any;

    import DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup;
    import DataRoleHelper = powerbi.extensibility.utils.dataview.DataRoleHelper;

    // powerbi.extensibility.utils.tooltip
    import tooltip = powerbi.extensibility.utils.tooltip;
    import TooltipEnabledDataPoint = powerbi.extensibility.utils.tooltip.TooltipEnabledDataPoint;
    import TooltipEventArgs = powerbi.extensibility.utils.tooltip.TooltipEventArgs;

    // powerbi.extensibility.utils.formatting
    import ValueFormatter = powerbi.extensibility.utils.formatting.valueFormatter;
    import IValueFormatter = powerbi.extensibility.utils.formatting.IValueFormatter;

    interface Hexes {
        x: any;
        y: any;
        key: any;
        points: any;
    }

    interface HexData {
        layout: string;
        hexes: any;
    }

    interface HexMapDataPoint {
        category: string;
        measureValue: number;
        tooltips: VisualTooltipDataItem[];
        selectionId: powerbi.visuals.ISelectionId;
    }

    interface HexMapMetaData {
        measureIndex: number;
    }

    interface HexMapViewModel {
        hexmapDataPoints: HexMapDataPoint[];
        hexmapMetaData: HexMapMetaData[];
    }

    function visualTransform(options: VisualUpdateOptions, host: IVisualHost): any {
        let dataViews = options.dataViews;
        // console.log('visualTransform', dataViews);

        let viewModel: HexMapViewModel = {
            hexmapDataPoints: [],
            hexmapMetaData: []
        };

        if (!dataViews
            || !dataViews[0]
            || !dataViews[0].categorical
            || !dataViews[0].categorical.categories
            || !dataViews[0].categorical.categories[0].source)
            return viewModel;

        let categorical = dataViews[0].categorical;
        let category = categorical.categories[0];
        let dataValue = categorical.values != null ? categorical.values[0] : [];
        let dataValues: DataViewValueColumns = categorical.values != null ? categorical.values : null;
        let grouped: DataViewValueColumnGroup[] = dataValues != null ? dataValues.grouped() : null;

        let categoryIndex = DataRoleHelper.getCategoryIndexOfRole(dataViews[0].categorical.categories, "category");
        let measureIndex = DataRoleHelper.getMeasureIndexOfRole(grouped, "measure");

        let metadata = dataViews[0].metadata;
        let categoryColumnName = metadata.columns.filter(c => c.roles["category"])[0].displayName;
        let valueColumnName = measureIndex === -1 ? "" : metadata.columns.filter(c => c.roles["measure"])[0].displayName;

        let hmDataPoints: HexMapDataPoint[] = [];
        let hmMetaData: HexMapMetaData[] = [];

        let valueFormatterForCategories: IValueFormatter;
        let valueFormatterForMeasure: IValueFormatter;

        let measureValues = [];

        valueFormatterForCategories = ValueFormatter.create({
            format: ValueFormatter.getFormatStringByColumn(metadata.columns.filter(c => c.roles["category"])[0]),
            value: categorical.categories[categoryIndex]
        });

        // validate Measure, nulls to 0
        if (measureIndex !== -1) {
            measureValues = categorical.values[measureIndex].values.map(function(x) {
                if (x == null) {
                    return 0;
                }
                return x;
            });

            valueFormatterForMeasure = ValueFormatter.create({
                format: ValueFormatter.getFormatStringByColumn(metadata.columns.filter(c => c.roles["measure"])[0]),
                value: categorical.values[measureIndex]
            });
        }

        for (let i = 0, len = category.values.length; i < len; i++) {

            let cat = <string>categorical.categories[0].values[i];

            hmDataPoints.push({
                category: cat,
                measureValue: measureIndex === -1 ? 0 : measureValues[i],
                tooltips: [{
                        displayName: categoryColumnName,
                        value: cat != null ? valueFormatterForCategories.format(cat).toString() : "(BLANK)"
                        // header: "Point Values"
                    },
                    {
                        displayName: valueColumnName,
                        value: measureIndex === -1 ? "" : valueFormatterForMeasure.format(measureValues[i]).toString()
                    }],
                selectionId: host.createSelectionIdBuilder().withCategory(category, i).createSelectionId()
            });

        }

        hmMetaData.push({
            measureIndex: measureIndex
        });

        return {
            hexmapDataPoints: hmDataPoints,
            hexmapMetaData: hmMetaData
        };
    }

    export class Visual implements IVisual {
        private target: HTMLElement;
        private host: IVisualHost;
        private svg: d3.Selection<SVGAElement>;
        private hexGroup: d3.Selection<SVGAElement>;
        private settings: VisualSettings;
        private selectionManager: ISelectionManager;

        constructor(options: VisualConstructorOptions) {
            // console.log('Visual constructor', options);
            this.target = options.element;
            this.host = options.host;
            this.selectionManager = options.host.createSelectionManager();

            let svg = this.svg = d3.select(this.target).append("svg")
                .attr("class", "hexmap");

            let hexGroup = this.hexGroup = svg.append("g")
                .attr("class", "hexGroup");

        }

        public update(options: VisualUpdateOptions) {
            this.settings = Visual.parseSettings(options && options.dataViews && options.dataViews[0]);
            // console.log('Visual update', options);

            let optionHighColor = this.settings.dataPoint.highColor;
            let optionLowColor = this.settings.dataPoint.lowColor;
            let optionOutlineColor = this.settings.dataPoint.outlineColor;
            let optionShowTextLabels = this.settings.dataPoint.showTextLabels;
            let optionFontColor = this.settings.dataPoint.fontColor;
            let optionFontSize = this.settings.dataPoint.fontSize;

            // q = column, r = row
            let usaHexJson: HexData = {
                "layout": "odd-r",
                "hexes": {
                    "Alaska": {"n": "Alaska", "q": 1, "r": 8, "a": "AK", "p": 24},
                    "Alabama": {"n": "Alabama", "q": 9, "r": 2, "a": "AL", "p": 24},
                    "Arkansas": {"n": "Arkansas", "q": 7, "r": 3, "a": "AR", "p": 24},
                    "Arizona": {"n": "Arizona", "q": 4, "r": 3, "a": "AZ", "p": 24},
                    "California": {"n": "California", "q": 3, "r": 3, "a": "CA", "p": 24},
                    "Colorado": {"n": "Colorado", "q": 5, "r": 4, "a": "CO", "p": 24},
                    "Connecticut": {"n": "Connecticut", "q": 12, "r": 5, "a": "CT", "p": 24},
                    "District of Columbia": {"n": "District of Columbia", "q": 13, "r": 3, "a": "DC", "p": 24},
                    "Delaware": {"n": "Delaware", "q": 11, "r": 4, "a": "DE", "p": 24},
                    "Florida": {"n": "Florida", "q": 10, "r": 0, "a": "FL", "p": 24},
                    "Georgia": {"n": "Georgia", "q": 9, "r": 1, "a": "GA", "p": 24},
                    "Hawaii": {"n": "Hawaii", "q": 1, "r": 0, "a": "HI", "p": 24},
                    "Iowa": {"n": "Iowa", "q": 6, "r": 5, "a": "IA", "p": 24},
                    "Idaho": {"n": "Idaho", "q": 3, "r": 5, "a": "ID", "p": 24},
                    "Illinois": {"n": "Illinois", "q": 7, "r": 5, "a": "IL", "p": 24},
                    "Indiana": {"n": "Indiana", "q": 8, "r": 5, "a": "IN", "p": 24},
                    "Kansas": {"n": "Kansas", "q": 6, "r": 3, "a": "KS", "p": 24},
                    "Kentucky": {"n": "Kentucky", "q": 8, "r": 4, "a": "KY", "p": 24},
                    "Louisiana": {"n": "Louisiana", "q": 7, "r": 2, "a": "LA", "p": 24},
                    "Massachusetts": {"n": "Massachusetts", "q": 13, "r": 6, "a": "MA", "p": 24},
                    "Maryland": {"n": "Maryland", "q": 10, "r": 4, "a": "MD", "p": 24},
                    "Maine": {"n": "Maine", "q": 13, "r": 8, "a": "ME", "p": 24},
                    "Michigan": {"n": "Michigan", "q": 9, "r": 6, "a": "MI", "p": 24},
                    "Minnesota": {"n": "Minnesota", "q": 6, "r": 6, "a": "MN", "p": 24},
                    "Missouri": {"n": "Missouri", "q": 7, "r": 4, "a": "MO", "p": 24},
                    "Mississippi": {"n": "Mississippi", "q": 8, "r": 2, "a": "MS", "p": 24},
                    "Montana": {"n": "Montana", "q": 4, "r": 6, "a": "MT", "p": 24},
                    "North Carolina": {"n": "North Carolina", "q": 10, "r": 3, "a": "NC", "p": 24},
                    "North Dakota": {"n": "North Dakota", "q": 5, "r": 6, "a": "ND", "p": 24},
                    "Nebraska": {"n": "Nebraska", "q": 6, "r": 4, "a": "NE", "p": 24},
                    "New Hampshire": {"n": "New Hampshire", "q": 12, "r": 7, "a": "NH", "p": 24},
                    "New Jersey": {"n": "New Jersey", "q": 11, "r": 5, "a": "NJ", "p": 24},
                    "New Mexico": {"n": "New Mexico", "q": 5, "r": 2, "a": "NM", "p": 24},
                    "Nevada": {"n": "Nevada", "q": 4, "r": 4, "a": "NV", "p": 24},
                    "New York": {"n": "New York", "q": 11, "r": 6, "a": "NY", "p": 24},
                    "Ohio": {"n": "Ohio", "q": 9, "r": 5, "a": "OH", "p": 24},
                    "Oklahoma": {"n": "Oklahoma", "q": 6, "r": 2, "a": "OK", "p": 24},
                    "Oregon": {"n": "Oregon", "q": 3, "r": 4, "a": "OR", "p": 24},
                    "Pennsylvania": {"n": "Pennsylvania", "q": 10, "r": 5, "a": "PA", "p": 24},
                    "Rhode Island": {"n": "Rhode Island", "q": 12, "r": 6, "a": "RI", "p": 24},
                    "South Carolina": {"n": "South Carolina", "q": 10, "r": 2, "a": "SC", "p": 24},
                    "South Dakota": {"n": "South Dakota", "q": 5, "r": 5, "a": "SD", "p": 24},
                    "Tennessee": {"n": "Tennessee", "q": 8, "r": 3, "a": "TN", "p": 24},
                    "Texas": {"n": "Texas", "q": 5, "r": 1, "a": "TX", "p": 24},
                    "Utah": {"n": "Utah", "q": 5, "r": 3, "a": "UT", "p": 24},
                    "Virginia": {"n": "Virginia", "q": 9, "r": 3, "a": "VA", "p": 24},
                    "Vermont": {"n": "Vermont", "q": 11, "r": 7, "a": "VT", "p": 24},
                    "Washington": {"n": "Washington", "q": 3, "r": 6, "a": "WA", "p": 24},
                    "Wisconsin": {"n": "Wisconsin", "q": 7, "r": 6, "a": "WI", "p": 24},
                    "West Virginia": {"n": "West Virginia", "q": 9, "r": 4, "a": "WV", "p": 24},
                    "Wyoming": {"n": "Wyoming", "q": 4, "r": 5, "a": "WY", "p": 24}
                }
            };

            let hexjson = usaHexJson;

            let selectionManager = this.selectionManager;
            let host = this.host;

            let viewModel: HexMapViewModel = visualTransform(options, this.host);
            // console.log("viewModel: ", viewModel);

            let margin = {top: 10, right: 10, bottom: 10, left: 10};
            let width = options.viewport.width - margin.left - margin.right;
            let height = options.viewport.height - margin.top - margin.bottom;

            let data = viewModel.hexmapDataPoints;

            for (let i in hexjson.hexes) {
                for (let j in data) {
                    // console.log(hexjson.hexes[i].a);
                    // console.log(data[j].category);
                    if (data[j].category === hexjson.hexes[i].a || data[j].category === hexjson.hexes[i].n) {
                        // console.log("match");
                        hexjson.hexes[i].measureValue = data[j].measureValue;
                        hexjson.hexes[i].tooltips = data[j].tooltips;
                        hexjson.hexes[i].selectionId = data[j].selectionId;
                    }
                }
            }

            // console.log(hexjson);

            /*hexjson.hexes.forEach(element => {
                data.forEach(element => {
                    console.log(element);
                });
            });*/

            let hexes = d3.renderHexJSON(hexjson, width, height);
            console.log("hexes: ", hexes);

            let measureRange = viewModel.hexmapMetaData[0].measureIndex > -1 ? d3.extent(hexes, function(d){ return d.measureValue; }) : [0, 1];
             console.log("measureRange: ", measureRange);
             console.log(data);
             console.log(hexjson);

            // remove any existing hexagons on update
            d3.selectAll(".hexagons").remove();

            let colorScale = d3.scale.linear()
                .domain([measureRange[0], measureRange[1]])
                .range([optionLowColor, optionHighColor])
                .interpolate(d3.interpolateLab);

            let svg = this.svg;

            svg
                .attr("viewbox", "0 0 100 100")
                .attr("width", width + margin.left + margin.right)
                .attr("height", height + margin.top + margin.bottom);

            let hexGroup = this.hexGroup;

            hexGroup
                .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

            let hexmap = hexGroup.selectAll("g")
                .data(hexes)
                .enter()
                .append("g")
                .attr("class", "hexagons")
                .attr("transform", function(d) {
                    return "translate(" + (d as any).x + "," + (d as any).y + ")";
                });

            hexmap
                .append("polygon")
                .attr("points", function(d) { return (d as any).points; })
                .attr("stroke", optionOutlineColor)
                .attr("stroke-width", "2")
                .attr("fill", function(d) { return viewModel.hexmapMetaData[0].measureIndex > -1 ? colorScale((d as any).measureValue) : optionHighColor; });

            if (optionShowTextLabels) {
                hexmap
                    .append("text")
                    .append("tspan")
                    .attr("text-anchor", "middle")
                    .attr("font-size", optionFontSize + "px")
                    .attr("fill", optionFontColor)
                    .text(function(d) {return (d as any).a; });
            }

            hexmap.on('click', function(d) {
                selectionManager.select((d as any).selectionId, false).then((ids: ISelectionId[]) => {
                    hexmap.attr({
                        'opacity': ids.length > 0 ? 0.2 : 1,
                    });
                });

                d3.select(this).attr({
                    'opacity': 1,
                });

                (<Event>d3.event).stopPropagation();
            });

            hexmap.on('mouseover', function(d) {
                let mouse = d3.mouse(svg.node());
                let x = mouse[0];
                let y = mouse[1];

                host.tooltipService.show({
                    dataItems: (d as any).tooltips,
                    identities: [(d as any).selectionId],
                    coordinates: [x, y],
                    isTouchEvent: false
                });
            });

            hexmap.on('mouseout', function(d) {
                host.tooltipService.hide({
                    immediately: true,
                    isTouchEvent: false
                });
            });

            hexmap.on("mousemove", (d) => {
                let mouse = d3.mouse(svg.node());
                let x = mouse[0];
                let y = mouse[1];

                host.tooltipService.move({
                    dataItems: (d as  any).tooltips,
                    identities: [(d as any).selectionId],
                    coordinates: [x, y],
                    isTouchEvent: false
                });
            });
        }

        private static parseSettings(dataView: DataView): VisualSettings {
            return VisualSettings.parse(dataView) as VisualSettings;
        }

        /**
         * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
         * objects and properties you want to expose to the users in the property pane.
         *
         */
        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
            return VisualSettings.enumerateObjectInstances(this.settings || VisualSettings.getDefault(), options);
        }
    }
}