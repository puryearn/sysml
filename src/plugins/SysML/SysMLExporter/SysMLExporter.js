/*globals define*/
/*jshint node:true, browser:true*/

/**
 * Author: Dana Zhang
 * Created on: October 23, 2015
 */

define(['plugin/PluginConfig',
    'plugin/PluginBase',
    './UseCaseDiagramExporter',
    './RequirementDiagramExporter',
    './InternalBlockDiagramExporter',
    './SequenceDiagramExporter',
    './ParametricDiagramExporter'
    ], function (PluginConfig, PluginBase, UseCaseExporter, RequirementExporter, InternalBlockDiagramExporter, SequenceDiagramExporter, ParametricExporter) {

    'use strict';

    var SysMLExporterPlugin = function () {
        PluginBase.call(this);
        this.modelID = 0;
        this.diagrams = [];
        this.diagram = {};
        this.outputFiles = {};
        this.idLUT = {};
        this.portLUT = {};
        this.reversePortLUT = {};
        this.reverseIdLUT = {};
        this.error = '';
        this.requirementDiagrams = {};
        this.usecaseDiagrams = {};
        this.internalBlockDiagrams = {};
        this.sequenceDiagrams = {};
        this.parametricDiagrams = {};
    };

    SysMLExporterPlugin.prototype = Object.create(PluginBase.prototype);
    SysMLExporterPlugin.prototype.constructor = SysMLExporterPlugin;

    SysMLExporterPlugin.prototype.getName = function () {
        return 'SysMLExporter';
    };

    SysMLExporterPlugin.prototype.main = function (callback) {

        var self = this,
            selectedNode = self.activeNode,
            afterAllVisited;

        if (!selectedNode) {
            callback('selectedNode is not defined', self.result);
            return;
        }
        afterAllVisited = function (err) {
            if (err) {
                callback(err, self.result);
                return;
            }
            self.saveResults(callback);
        };
        self.visitFromNode(selectedNode, afterAllVisited);
    };

    SysMLExporterPlugin.prototype.visitFromNode = function (node, callback) {
        var self = this,
            afterLoading;
        afterLoading = function (err, children) {
            var counter,
                i,
                itrCallback,
                error = '';
            if (err) {
                callback('failed to load children, error: ' + err);
                return;
            }
            counter = {visits: children.length};
            itrCallback = function (err) {
                error = err ? error += err : error;
                counter.visits -= 1;
                if (counter.visits <= 0) {
                    callback(error);
                }
            };

            if (children.length === 0) {
                itrCallback(null);
            } else {
                for (i = 0; i < children.length; i += 1) {
                    self.visitObject(children[i], function (err, node) {
                        self.visitChildrenRec(node, counter, itrCallback);
                    });
                }
            }
        };
        self.core.loadChildren(node, afterLoading);
    };

    SysMLExporterPlugin.prototype.visitChildrenRec = function (node, counter, callback) {
        var self = this,
            core = self.core,
            afterLoading;

        afterLoading = function (err, children) {
            var i;
            if (err) {
                callback('failed to load children, error: ' + err);
                return;
            }
            counter.visits += children.length;
            if (children.length === 0) {
                callback(null);
            } else {
                counter.visits -= 1;
                for (i = 0; i < children.length; i += 1) {
                    self.visitObject(children[i], function (err, node) {
                        self.visitChildrenRec(node, counter, callback);
                    });
                }
            }
        };
        core.loadChildren(node, afterLoading);
    };

    SysMLExporterPlugin.prototype.visitObject = function (node, callback) {
        var self = this,
            core = self.core,
            gmeID = core.getPath(node),
            baseClass = self.getMetaType(node),
            parentBaseClass = self.getMetaType(node.parent),
            isPackage = self.isMetaTypeOf(parentBaseClass, self.META.Package),
            /** use case diagram **/
            isActor = self.isMetaTypeOf(baseClass, self.META.Actor),
            isUseCase = self.isMetaTypeOf(baseClass, self.META.UseCase),
            //isSubject = self.isMetaTypeOf(baseClass, self.META.Subject),
            isUseCaseLink = self.isMetaTypeOf(baseClass, self.META.UseCaseLinks),
            isUseCaseParent = isPackage || self.isMetaTypeOf(parentBaseClass, self.META.Block) ||
                            self.isMetaTypeOf(parentBaseClass, self.META.UseCaseDiagram),
            isUseCaseDiagram = isUseCaseParent && (isActor || isUseCase || isUseCaseLink),

            /** requirement diagram **/
            isRequirement = self.isMetaTypeOf(parentBaseClass, self.META.RequirementDiagram),
            isRqtParent = isPackage || self.isMetaTypeOf(parentBaseClass, self.META.RequirementDiagram),
            isRqtDiagram = isRqtParent && (isRequirement),
            isReq2Req = self.isMetaTypeOf(baseClass, self.META.Req2Req),
            isCommentLink = self.isMetaTypeOf(baseClass, self.META.CommentLink),

            /** internal block diagram **/
            isIBDParent = self.isMetaTypeOf(parentBaseClass, self.META.InternalBlockDiagram),
            isFlowPort = self.isMetaTypeOf(baseClass, self.META.FlowPort),
            isIBDConnection = isIBDParent && self.isMetaTypeOf(baseClass, self.META.Connector), // edges
            isIBDiagram = isIBDParent && (self.isMetaTypeOf(baseClass, self.META.Block) ||
                self.isMetaTypeOf(baseClass, self.META.Property) || isFlowPort) || isIBDConnection,
            isFlowPortParent = self.isMetaTypeOf(parentBaseClass, self.META.Block),

            /** sequence diagram **/
            isExecSpecParent = self.isMetaTypeOf(parentBaseClass, self.META.LifeLine),
            isSequenceDiagram = self.isMetaTypeOf(parentBaseClass, self.META.SequenceDiagram) || isExecSpecParent,
            isLifeLine = self.isMetaTypeOf(baseClass, self.META.LifeLine),
            isLostMessage = self.isMetaTypeOf(baseClass, self.META.LostMessage),
            isExecutionSpecification = self.isMetaTypeOf(baseClass, self.META.ExecutionSpecification),
            isMessage = self.isMetaTypeOf(baseClass, self.META.Message),


            // Parametric Diagram
            isParametricParent = self.isMetaTypeOf(parentBaseClass, self.META.ParametricDiagram),
            isValue = self.isMetaTypeOf(baseClass, self.META.Value),
            isConstraintParam = self.isMetaTypeOf(baseClass, self.META.ConstraintParameter),
            isConstraintBlock = self.isMetaTypeOf(baseClass, self.META.ConstraintBlock),
            isConnector = isParametricParent && self.isMetaTypeOf(baseClass, self.META.Connector),
            isPrmDiagram = isParametricParent && (isValue || isConstraintBlock || isConnector),

            afterConnAdded;


        afterConnAdded = function (err) {
            if (err) {
                self.error += err;
                callback(err, node);
                return;
            }
            callback(null, node);
        };

        if (isUseCaseDiagram) {
            _.extend(self, new UseCaseExporter());
            if (isUseCaseLink) {
                self.addConnection(node, afterConnAdded);
            } else {
                // if key not exist already, add key; otherwise ignore
                if (!self.idLUT.hasOwnProperty(gmeID)) {
                    self.addComponent(node);
                }
                callback(null, node);
            }
        } else if (isRqtDiagram) {
            _.extend(self, new RequirementExporter());
            if (isReq2Req || isCommentLink) {
                self.addConnection(node, afterConnAdded);
            } else {
                // if key not exist already, add key; otherwise ignore
                if (!self.idLUT.hasOwnProperty(gmeID)) {
                    self.addComponent(node);
                }
                callback(null, node);
            }
        } else if (isIBDiagram) {
            _.extend(self, new InternalBlockDiagramExporter());
            if (isIBDConnection) {
                self.addConnection(node, afterConnAdded);
            } else {
                if (!self.idLUT.hasOwnProperty(gmeID)) {
                    self.addComponent(node);
                }
                callback(null, node);
            }
        } else if (isSequenceDiagram) {
            _.extend(self, new SequenceDiagramExporter());
            if (isMessage) {
                self.addConnection(node, afterConnAdded);
            } else {
                if (!self.idLUT.hasOwnProperty(gmeID)) {
                    self.addComponent(node);
                }
                callback(null, node);
            }
        } else if (isPrmDiagram){
            _.extend(self, new ParametricExporter());
            if (isConnector) {
                self.addConnection(node, afterConnAdded);
            } else {
                if (!self.idLUT.hasOwnProperty(gmeID)) {
                    self.addComponent(node);
                }
                callback(null, node);
            }
        } else if (isFlowPort) {
            if (!self.idLUT.hasOwnProperty(gmeID)) {
                self.addChildPort(node, isFlowPortParent);
            }
            callback(null, node);
        } else if (isConstraintParam) {
            if (!self.idLUT.hasOwnProperty(gmeID)) {
                self.addChildPort(node, true);
            }
            callback(null, node);
        } else {
            callback(null, node);
        }
    };

    SysMLExporterPlugin.prototype.saveResults = function (callback) {

    };

    SysMLExporterPlugin.prototype.addComponent = function (nodeObj) {

    };

    SysMLExporterPlugin.prototype.addConnection = function (nodeObj, callback) {

    };

    SysMLExporterPlugin.prototype.addChildPort = function (nodeObj, isValidParent) {
        var self = this,
            core = self.core;

        if (isValidParent) {
            var parentPath = core.getPath(nodeObj.parent),
                port,
                portGmeId = core.getPath(nodeObj);

            if (!self.portLUT.hasOwnProperty(parentPath)) {
                self.portLUT[parentPath] = {ports: []};
            }
            port = {
                id: self.modelID,
                name: core.getAttribute(nodeObj, 'name'),
                type: core.getAttribute(self.getMetaType(nodeObj), 'name'),
                x: core.getRegistry(nodeObj, 'position').x,
                y: core.getRegistry(nodeObj, 'position').y
            };
            self.idLUT[portGmeId] = {id: self.modelID};
            self.reverseIdLUT[self.modelID] = portGmeId;
            self.modelID += 1;

            self.portLUT[parentPath].ports.push(port);

            if (!self.reversePortLUT.hasOwnProperty(portGmeId)) {
                self.reversePortLUT[portGmeId] = parentPath;
            }

        }

    };

    return SysMLExporterPlugin;
});