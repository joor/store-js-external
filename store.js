define(['./polyfill'], function() {

    'use strict';

    /*
     * This class implements the pattern Repository:
     * http://martinfowler.com/eaaCatalog/repository.html
     */
    function Store(pk, indexes, relations, backend) {
        this._oidCounter = 0;
        this.name = null;
        this.objectMapping = {};  // TODO: Use OrderedDict
        this.objectStateMapping = {};
        // TODO: dirty, added, deleted, revert, store object in list like in dojo.store.Memory,
        // so, you'll can add into collection new objects without id.
        this.pkIndex = {};
        this.indexes = {};
        if (indexes) {
            for (var i in indexes) {
                this.indexes[indexes[i]] = {};
            }
        }
        this._initRelations(relations);
        this.backend = backend ? backend : new AngularBackend();
        this.pk = pk ? pk : 'id';
        observable(this, 'getObservable', StoreObservable);
        var pkFields = toArray(this.pk);
        for (var i in pkFields) {
            if (!(pkFields[i] in this.indexes)) { this.indexes[pkFields[i]] = {}; }
        }
        for (var relationName in this.relations.foreignKey) {
            var fields = toArray(this.relations.foreignKey[relationName].field);
            for (var i in fields) {
                if (!(fields[i] in this.indexes)) { this.indexes[fields[i]] = {}; }
            }
        }
        return this;
    }
    Store.prototype = {
        operators: {
            '$and': function(store, operands) {
                var result;
                for (var i in operands) {
                    result = intersectMapping(result, store.findMapping(operands[i]));
                };
                return result;
            },
            '$or': function(store, operands) {
                var result;
                for (var i in operands) {
                    result = mergeMapping(result, store.findMapping(operands[i]));
                };
                return result;
            },
            '$in': function(store, operands) {
                var left = operands[0], right = operands[1], result;
                for (var i in right) {
                    var where = {};
                    where[left] = {'$eq': right[i]};
                    result = mergeMapping(result, store.findMapping(where));
                }
                return result;
            },
            '$eq': function(store, operands) {
                var result;
                result = new IndexFinder(store).eq(operands[0], operands[1]);
                if (typeof result !== "undefined") {
                    return result;
                }
                var where = {};
                where[operands[0]] = function(value) {
                    return value == operands[1];
                };
                return store.findMapping(where);
            },
            '$callable': function(store, operands) {
                var field = operands[0],
                    func = operands[1],
                    result = {};
                for (var id in store.objectMapping) {
                    var obj = store.objectMapping[id];
                    if (func(obj[field], field, obj)) {
                        result[id] = obj;
                    }
                }
                return result;
            },
            '$fk': function(store, operands) {
                var relationName = operands[0];
                var relatedWhere = operands[1];
                var relation = store.relations.foreignKey[relationName];
                var field = toArray(relation.field);
                var relatedStore = store.registry[relation.relatedStore];
                var relatedMapping = relatedStore.find(relatedWhere);
                var relatedObj, relatedValues = [];
                for (var relatedPk in relatedMapping) {
                    relatedObj = relatedMapping[relatedPk];
                    relatedValues.push(store.getValue(relatedObj, relation.relatedField));
                }
                var where = [];
                for (var i in relatedValues) {
                    var subWhere = {}, relatedValue = relatedValues[i];
                    for (var j in field) {
                        subWhere[field[j]] = {'$eq': relatedValue[j]};
                    }
                    where.push(subWhere);
                }
                where = {'$or': where};
                return store.findMapping(where);
            },
            '$o2m': function(store, operands) {
                var relationName = operands[0];
                var relatedWhere = operands[1];
                var relation = store.relations.oneToMany[relationName];
                var field = toArray(relation.field);
                var relatedStore = store.registry[relation.relatedStore];
                var relatedMapping = relatedStore.find(relatedWhere);
                var relatedObj, relatedValues = [];
                for (var relatedPk in relatedMapping) {
                    relatedObj = relatedMapping[relatedPk];
                    relatedValues.push(store.getValue(relatedObj, relation.relatedField));
                }
                var where = [];
                for (var i in relatedValues) {
                    var subWhere = {}, relatedValue = relatedValues[i];
                    for (var j in field) {
                        subWhere[field[j]] = {'$eq': relatedValue[j]};
                    }
                    where.push(subWhere);
                }
                where = {'$or': where};
                return store.findMapping(where);
            },
            '$m2m': function(store, operands) {
                var relationName = operands[0];
                var relatedWhere = operands[1];
                var m2mRelation = store.relations.manyToMany[relationName];
                var relatedStore = store.registry[m2mRelation.relatedStore];
                var relatedRelation = relatedStore.relations.oneToMany[m2mRelation.relatedRelation];
                var _where = {};
                _where[relatedRelation.relatedName] = {'$fk': relatedWhere};
                var where = {};
                where[m2mRelation.relation] = {'$o2m': _where};
                return store.findMapping(where);
            }
        },
        _initRelations: function(relations) {
            this.relations = relations ? relations : {};
            var classMapping = {
                foreignKey: ForeignKey,
                oneToMany: OneToMany,
                manyToMany: ManyToMany
            };
            for (var type in classMapping) {
                if (!(type in this.relations)) {
                    this.relations[type] = {};
                }
                for (var name in this.relations[type]) {
                    var params = this.relations[type][name];
                    params['name'] = name;
                    params['store'] = this;
                    this.relations[type][name] = new classMapping[type](params);
                }
            }
        },
        register: function(name, registry) {
            this.name = name;
            this.registry = registry;

            for (var relatedStoreName in registry) {
                if (!registry.isStore(relatedStoreName)) {
                    continue;
                }
                this._setupReverseRelations(registry[relatedStoreName]);
            }
        },
        _setupReverseRelations: function(store) {
            for (var relationName in store.relations.foreignKey) {
                var relation = store.relations.foreignKey[relationName];
                relation.setupReverseRelation();
            }
        },
        init: function() {
            for (var oid in this.objectMapping) {
                this.getObservable().notify('init', this.objectMapping[oid]);
            }
        },
        loadCollection: function(objectList) {
            for (var i = 0; i < objectList.length; i++) {
                this.load(objectList[i]);
            }
        },
        load: function(obj) {
            var pk = this.getPk(obj);
            var oid = this.getObjectId(obj);
            if (typeof pk === "undefined") {
                this.backend.setNextPk(obj);
                pk = this.getPk(obj);
                if (typeof pk === "undefined") {
                    throw new PkRequired();
                }
            } else if (pk in this.pkIndex) {
                if (this.pkIndex[pk] !== obj) {
                    throw new ObjectAlreadyLoaded();
                } else {
                    return;
                }
            }

            if (oid in this.objectMapping) {
                if (this.objectMapping[oid] !== obj) {
                    throw new ObjectAlreadyLoaded();
                } else {
                    return;
                }
            }
            this.objectMapping[oid] = obj;
            this.objectStateMapping[oid] = this._getObjState(obj);
            this._indexObj(obj);
            this.getObservable().notify('load', obj);
            return obj;
        },
        unload: function(obj) {
            this.getObservable().notify('unload', obj);
            var oid = this.getObjectId(obj);
            delete this.pkIndex[this.getPk(obj)];
            delete this.objectMapping[oid];
            delete this.objectStateMapping[oid];
            for (var field in this.indexes) {
                var value = obj[field];
                this.indexes[field][value] = arrayRemove(this.indexes[field][value], oid, toString);
            }
        },
        getObjectId: function(obj) {
            if (!('__oid' in obj)) {
                obj.__oid = this.getNextObjectId();
            }
            return obj.__oid;
        },
        getNextObjectId: function() {
            return ++this._oidCounter;
        },
        getPk: function(obj) {
            if (this.pk instanceof Array) {
                var pk = [];
                for (var i in this.pk) {
                    pk.push(obj[this.pk[i]]);
                }
                return pk;
            }
            return obj[this.pk];
        },
        setPk: function(obj, value) {
            if (this.pk instanceof Array) {
                for (var i in this.pk) {
                    obj[this.pk[i]] = value[i];
                }
                return;
            }
            obj[this.pk] = value;
        },
        getValue: function(obj, field) {
            field = toArray(field);
            var value = [];
            for (var i in field) {
                value.push(obj[field[i]]);
            }
            return value;
        },
        setValue: function(obj, field, value) {
            field = toArray(field);
            value = toArray(value);
            for (var i in field) {
                obj[field[i]] = value[i];
            }
        },
        get: function(pkOrWhere) {
            if ((typeof pkOrWhere !== "object") || (pkOrWhere instanceof Array)) {
                return this.pkIndex[pkOrWhere];
            }
            return this.find(pkOrWhere)[0];
        },
        add: function(obj, callback, state) {
            // TODO: implement pattern Unit Of Work
            // http://martinfowler.com/eaaCatalog/unitOfWork.html
            // bult update, create, delete
            var self = this;
            state = state || new State();
            return this.backend.add(obj, function(obj){
                self.load(obj);
                state.visit(self, obj);
                self._propagateBottomUpRelations('onAdd', obj, state);
                self.getObservable().notify('add', obj);
                if (callback) {
                    callback(obj);
                }
            });
        },
        update: function(obj, callback, state) {
            var self = this;
            state = state || new State();
            if (state.isVisited(this, obj)) { return;  };  // It's circular references. Skip it.
            state.visit(this, obj);
            return this.backend.update(obj, function(obj) {
                var oid = self.getObjectId(obj);
                var old = self.objectStateMapping[oid];
                self._reindexObj(old, obj);
                self.objectStateMapping[oid] = self._getObjState(obj);
                self._propagateTopDownRelations('onUpdate', obj, state);
                self.getObservable().notify('update', obj);
                if (callback) {
                    callback(obj);
                }
            });
        },
        delete: function(obj, callback, state) {
            var self = this;
            state = state || new State();
            if (state.isVisited(this, obj)) { return;  };  // It's circular references. Skip it.
            state.visit(this, obj);
            self._propagateTopDownRelations('onDelete', obj, state);
            return this.backend.delete(obj, function(obj) {
                self.getObservable().notify('delete', obj);
                self.unload(obj);
                if (obj.getObservable) {
                    delete obj.getObservable().getObj;
                    delete obj.getObservable;
                }
                if (callback) {
                    callback(obj);
                }
            });
        },
        _propagateTopDownRelations: function(onAction, obj, state) {
            for (var relationName in this.relations.oneToMany) {
                this._propagateByRelation(onAction, obj, relationName, this.relations.oneToMany[relationName], state);
            }
            for (var relationName in this.relations.manyToMany) {
                this._propagateByM2m(onAction, obj, relationName, this.relations.manyToMany[relationName], state);
            }
        },
        _propagateBottomUpRelations: function(onAction, obj, state) {
            for (var relationName in this.relations.foreignKey) {
                this._propagateByRelation(onAction, obj, relationName, this.relations.foreignKey[relationName], state);
            }
            for (var relationName in this.relations.manyToMany) {
                this._propagateByM2m(onAction, obj, relationName, this.relations.manyToMany[relationName], state);
            }
        },
        _propagateByRelation: function(onAction, obj, relationName, relation, state) {
            var where, field, relatedField, relatedStore, relatedObj, relatedMapping;
            if (!(onAction in relation)) {
                return;
            }
            field = toArray(relation.field);
            relatedField = toArray(relation.relatedField);
            where = {};
            for (var i in field) {
                where[relatedField[i]] = obj[field[i]];
            }
            relatedStore = this.registry[relation.relatedStore];
            relatedMapping = relatedStore.find(where);
            for (var relatedPk in relatedMapping) {
                relatedObj = relatedMapping[relatedPk];
                var actions = toArray(relation[onAction]);
                for (var i in actions) {
                    actions[i](relatedObj, obj, relatedStore, this, relationName, relation, state);
                }
            }
        },
        _propagateByM2m: function(onAction, obj, relationName, m2mRelation, state) {
            if (!(onAction in m2mRelation)) {
                return;
            }
            var relatedStore = this.registry[m2mRelation.relatedStore];
            var relation = this.relations.oneToMany[m2mRelation.relation];
            var field = toArray(relation.field);
            var value = this.getValue(obj, field);
            var where = {};
            for (var i in field) {
                where[m2mRelation.relatedRelation + '.' + relation.relatedName + '.' + field[i]] = value[i];
            }
            var relatedObjectList = relatedStore.find(where);
            for (var i in relatedObjectList) {
                var relatedObj = relatedObjectList[i];
                var actions = toArray(m2mRelation[onAction]);
                for (var i in actions) {
                    actions[i](relatedObj, obj, relatedStore, this, relationName, relation, state);
                }
            }
        },
        _resetIndexes: function() {
            this.pkIndex = {};
            for (var key in this.indexes) {
                this.indexes[key] = {};
            }
        },
        _reloadIndexes: function() {
            this._resetIndexes();
            for (var id in this.objectMapping) {
                this._indexObj(this.objectMapping[id]);
            }
        },
        _indexObj: function(obj) {
            this.pkIndex[this.getPk(obj)] = obj;
            var oid = this.getObjectId(obj);
            for (var field in this.indexes) {
                if (field in obj) {
                    var value = obj[field];
                    if (!(value in this.indexes[field])) {
                        this.indexes[field][value] = [];
                    };
                    this.indexes[field][value].push(oid);
                }
            }
        },
        _reindexObj: function(old, obj) {
            if (this.getPk(old) !== this.getPk(obj)) {
                delete this.pkIndex[this.getPk(old)];
                this.pkIndex[this.getPk(obj)] = obj;
            }
            var oid = this.getObjectId(obj);
            for (var field in this.indexes) {
                var oldValue = old[field],
                    value = obj[field],
                    index = this.indexes[field];
                if (oldValue !== value) {
                    index[oldValue] = arrayRemove(index[oldValue], oid, toString);
                    if (!(value in index)) {
                        index[value] = [];
                    };
                    index[value].push(oid);
                }
            }
        },
        _getObjState: function(obj) {
            return clone(obj, {});
        },
        /*
         * Implements pattern:
         * http://martinfowler.com/eaaCatalog/queryObject.html
         * Used MongoDB like syntax:
         * https://docs.mongodb.com/manual/reference/operator/query/
         */
        find: function(where, orderBy) {
            // We don't need the orderBy, because it's bossible to use Array.prototype.sort()
            // even to sort by relation if deal with related Store inside compareFunction.
            var mapping = this.findMapping(where);
            var objectList = [];
            for (var key in mapping) {
                objectList.push(mapping[key]);
            }
            return objectList;
        },
        findMapping: function(where) {
            var result, op, left, right, leftRight;
            if (!where) {
                return intersectMapping(result, this.objectMapping);
            }
            for (var key in where) {
                leftRight = this._normalizeLeftRight(key, where[key]);
                left = leftRight[0];
                right = this._normalizeRight(leftRight[1]);
                if (left in this.operators) {
                    op = this.operators[left];
                    result = intersectMapping(result, op(this, right));
                } else {
                    result = intersectMapping(result, this._findMappingRight(left, right));
                }
            }
            return result;
        },
        _normalizeLeftRight: function(left, right) {
            if (left.indexOf('.') > -1) {
                var leftParts = left.split('.');
                left = leftParts.shift();
                var rightPart = {};
                rightPart[leftParts.join('.')] = right;
                if (left in this.relations.foreignKey) {
                    right = {'$fk': rightPart};
                } else if (left in this.relations.oneToMany) {
                    right = {'$o2m': rightPart};
                } else if (left in this.relations.manyToMany) {
                    right = {'$m2m': rightPart};
                }
            }
            return [left, right];
        },
        _normalizeRight: function(right) {
            if (typeof right === "function") {
                return {'$callable': right};
            } else if (right && typeof right === "object") {
                return right;
            }
            return {'$eq': right};
        },
        _findMappingRight: function(left, right) {
            var result, op;
            for (var key in right) {
                op = this.operators[key];
                result = intersectMapping(result, op(this, [left, right[key]]));
            }
            return result;
        },
        /*
         * Returns composition of related objects.
         */
        compose: function(obj) {
            new Compose(this, obj).compute();
        },
        /*
         * Load related stores from composition of object.
         */
        decompose: function(obj) {
            return new Decompose(this, obj).compute();
        },
        clean: function() {
            this.objectMapping = {};
            this.objectStateMapping = {};
            this._resetIndexes();
        },
        destroy: function() {
            for (var oid in this.objectMapping) {
                this.getObservable().notify('destroy', this.objectMapping[oid]);
            }
        },
        relationUsedByM2m: function(relationName) {
            for (var m2mRelationName in this.relations.manyToMany) {
                if (this.relations.manyToMany[m2mRelationName].relation === relationName) { return true; }
            }
            return false;
        },
        getRelation: function(name) {
            for (var relationType in this.relations) {
                if (name in this.relations[relationType]) {
                    return this.relations[relationType][name];
                }
            }
        }
    };
    Store.prototype.constructor = Store;


    function AbstractRelation(params) {
        clone(params, this);
    }
    AbstractRelation.prototype = {
        constructor: AbstractRelation,
        getField: function() {
            return toArray(this.field);
        },
        getRelatedField: function() {
            return toArray(this.relatedField);
        },
        getValue: function(obj) {
            return this.store.getValue(obj, this.getField());
        },
        getRelatedValue: function(relatedObj) {
            return this.getRelatedStore().getValue(relatedObj, this.getRelatedField());
        },
        getWhere: function(relatedObj) {
            var where = {},
                field = this.getField(),
                relatedValue = this.getRelatedValue(relatedObj);
            for (var j in field) {
                where[field[j]] = {'$eq': relatedValue[j]};
            }
            return where;
        },
        getRelatedWhere: function(obj) {
            var where = {},
                relatedField = this.getRelatedField(),
                value = this.getValue(obj);
            for (var j in relatedField) {
                where[relatedField[j]] = {'$eq': value[j]};
            }
            return where;
        },
        setupReverseRelation: function() {},
        getRelatedStore: function() {
            return this.store.registry[this.relatedStore];
        },
        getRelatedRelation: function() {
            return this.getRelatedStore().getRelation(this.relatedName);
        }
    };


    function ForeignKey(params) {
        AbstractRelation.call(this, params);
        if (!this.relatedName) {
            this.relatedName = this.store.name + 'Set';
        }
    }
    ForeignKey.prototype = clone({
        constructor: ForeignKey,
        setupReverseRelation: function () {
            if (!(this.relatedStore in this.store.registry)) {
                return;
            }
            if (this.relatedName in this.getRelatedStore().relations.oneToMany) {
                return;
            }
            var relatedParams = {
                field: this.relatedField,
                relatedField: this.field,
                relatedStore: this.store.name,
                relatedName: this.name,
                name: this.relatedName,
                store: this.getRelatedStore()
            };
            if ('onUpdate' in this) {
                relatedParams['onUpdate'] = this['onUpdate'];
            };
            if ('onDelete' in this) {
                relatedParams['onDelete'] = this['onDelete'];
            };
            this.getRelatedStore().relations.oneToMany[relatedParams.name] = new OneToMany(relatedParams);
        }
    }, Object.create(AbstractRelation.prototype));


    function OneToMany(params) {
        AbstractRelation.call(this, params);
    }
    OneToMany.prototype = clone({
        constructor: OneToMany
    }, Object.create(AbstractRelation.prototype));


    function ManyToMany(params) {
        AbstractRelation.call(this, params);
    }
    ManyToMany.prototype = clone({
        constructor: ManyToMany,
        getField: function() {
            return this.store.relations.oneToMany[this.relation].field;
        },
        getRelatedField: function() {
            return this.getRelatedStore().relations.oneToMany[this.relatedRelation].field;
        },
        getWhere: function(relatedObj) {
            var where = {},
                subWhere = {},
                relatedField = this.getRelatedField(),
                relatedValue = this.getRelatedValue(relatedObj);
            for (var i in relatedField) {
                subWhere[relatedField[i]] = {'$eq': relatedValue[i]};
            }
            where[this.name] = {'$m2m': subWhere};
            return where;
        },
        getRelatedWhere: function(obj) {
            var where = {},
                subWhere = {},
                field = this.getField(),
                value = this.getValue(obj);
            for (var i in field) {
                subWhere[field[i]] = {'$eq': value[i]};
            }
            where[this.store.getRelation(this.relation).relatedName] = {'$fk': subWhere};
            subWhere = where;
            where = {};
            where[this.relatedRelation] = {'$o2m': subWhere};
            return where;
        },
        getRelatedRelation: function() {
            return;
        }
    }, Object.create(AbstractRelation.prototype));


    function PkRequired(message) {
        this.name = 'PkRequired';
        this.message = message || "Primary key is required!";
        this.stack = (new Error()).stack;
    }
    PkRequired.prototype = Object.create(Error.prototype);
    PkRequired.prototype.constructor = PkRequired;


    function ObjectAlreadyLoaded(message) {
        this.name = 'ObjectAlreadyLoaded';
        this.message = message || "Only single instance of object can be loaded!";
        this.stack = (new Error()).stack;
    }
    ObjectAlreadyLoaded.prototype = Object.create(Error.prototype);
    ObjectAlreadyLoaded.prototype.constructor = ObjectAlreadyLoaded;


    function IndexFinder(store) {
        this._store = store;
        return this;
    }
    IndexFinder.prototype = {
        eq: function(field, value) {
            if (!(field in this._store.indexes)) {
                return undefined;
            }
            var result = {};
            if (value in this._store.indexes[field]) {
                var index = this._store.indexes[field][value];
                for (var i in index) {
                    var id = index[i];
                    result[id] = this._store.objectMapping[id];
                }
            }
            return result;
        }
    };


    function Compose(store, obj, state) {
        this._store = store;
        this._obj = obj;
        this._state = state || new State();
        return this;

    }
    Compose.prototype = {
        constructor: Compose,
        compute: function() {
            if (this._state.isVisited(this._store, this._obj)) { return; }  // It's circular references. Skip it.
            this._state.visit(this._store, this._obj);
            this._handleOneToMany();
            this._handleManyToMany();

        },
        _handleOneToMany: function() {
            for (var relationName in this._store.relations.oneToMany) {
                if (this._store.relationUsedByM2m(relationName)) { continue; }
                var relation = this._store.relations.oneToMany[relationName];
                var relatedStore = relation.getRelatedStore();
                var relatedObjectList = this._obj[relationName] = relatedStore.find(relation.getRelatedWhere(this._obj));
                for (var i in relatedObjectList) {
                    this._handleRelatedObj(relatedStore, relatedObjectList[i]);
                }
            }
        },
        _handleRelatedObj: function(relatedStore, relatedObj) {
            new this.constructor(relatedStore, relatedObj, this._state).compute();

        },
        _handleManyToMany: function() {
            for (var relationName in this._store.relations.manyToMany) {
                var m2mRelation = this._store.relations.manyToMany[relationName];
                var relatedStore = m2mRelation.getRelatedStore();
                var relatedObjectList = this._obj[relationName] = relatedStore.find(m2mRelation.getRelatedWhere(this._obj));
                for (var i in relatedObjectList) {
                    this._handleRelatedObj(relatedStore, relatedObjectList[i]);
                }
            }
        }
    };


    function Decompose(store, obj) {
        this._store = store;
        this._obj = obj;
        return this;
    }
    Decompose.prototype = {
        constructor: Decompose,
        compute: function() {
            var obj = this._obj;
            this._handleOneToMany();
            this._handleManyToMany();
            return this._store.load(obj);
        },
        _handleOneToMany: function() {
            for (var relationName in this._store.relations.oneToMany) {
                if (this._store.relationUsedByM2m(relationName)) { continue; }
                var relation = this._store.relations.oneToMany[relationName];
                var relatedStore = this._store.registry[relation.relatedStore];
                var relatedObjectList = this._obj[relationName] || [];
                for (var i in relatedObjectList) {
                    var relatedObj = relatedObjectList[i];
                    this._setForeignKeyToRelatedObj(relation, relatedObj);
                    relatedObjectList[i] = this._handleRelatedObj(relatedStore, relatedObj);
                }
            }
        },
        _setForeignKeyToRelatedObj: function(relation, relatedObj) {
            var value = this._store.getValue(this._obj, relation.field);
            var relatedField = toArray(relation.relatedField);
            for (var i in relatedField) {
                if (typeof relatedObj[relatedField[i]] === "undefined") {
                    relatedObj[relatedField[i]] = value[i];
                } else if (relatedObj[relatedField[i]] !== value[i]) {
                    throw Error("Uncorrect value of Foreigh Key!");
                }
            }
        },
        _handleRelatedObj: function(relatedStore, relatedObj) {
            try {
                relatedObj = new this.constructor(relatedStore, relatedObj).compute();
            } catch (e) {
                if (e instanceof ObjectAlreadyLoaded) {
                    // Make object to be single instance;
                    return relatedStore.get(relatedStore.getPk(relatedObj));
                } else {
                    throw e;
                }
            }
            return relatedObj;
        },
        _handleManyToMany: function() {
            for (var relationName in this._store.relations.manyToMany) {
                var m2mRelation = this._store.relations.manyToMany[relationName];
                var relatedStore = this._store.registry[m2mRelation.relatedStore];
                var relatedObjectList = this._obj[relationName] || [];
                for (var i in relatedObjectList) {
                    var relatedObj = relatedObjectList[i];
                    relatedObjectList[i] = this._handleRelatedObj(relatedStore, relatedObj);
                    this._addManyToManyRelation(m2mRelation, relatedObj);
                }
            }
        },
        _addManyToManyRelation: function(m2mRelation, relatedObj) {
            var relation = this._store.relations.oneToMany[m2mRelation.relation];
            var m2mStore = this._store.registry[relation.relatedStore];
            var relatedStore = this._store.registry[m2mRelation.relatedStore];
            var relatedRelation = relatedStore.relations.oneToMany[m2mRelation.relatedRelation];
            var value = this._store.getValue(this._obj, relation.field);
            var relatedValue = relatedStore.getValue(relatedObj, relatedRelation.field);

            var m2mObject = {};
            var toRelatedField = toArray(relatedRelation.relatedField);
            for (var i in toRelatedField) {
                m2mObject[toRelatedField[i]] = relatedValue[i];
            }
            var fromRelatedField = toArray(relation.relatedField);
            for (var i in fromRelatedField) {
                m2mObject[fromRelatedField[i]] = value[i];
            }
            m2mStore.load(m2mObject);
        }
    };


    function State() {
        this._visited = {};
        return this;
    };
    State.prototype = {
        constructor: State,
        visit: function(store, obj) {
            this._visited[this.getObjUniqId(store, obj)] = obj;
        },
        isVisited: function(store, obj) {
            return this.getObjUniqId(store, obj) in this._visited;
        },
        getObjUniqId: function(store, obj) {
            return [store.name, store.getObjectId(obj)];
        }
    };


    function Result(store, objectList) {
        this._store = store;
        Array.apply(this, objectList);
        return this;
    }
    Result.prototype = Object.create(Array.prototype);
    Result.prototype.constructor = Result;
    Result.prototype.reduce = function(callback, initValue) {
        var accumValue;
        var objectList = this.slice();
        if (typeof initValue !== "undefined") {
            accumValue = initValue;
        } else {
            accumValue = objectList.unshift();
        }
        for (var i; i < objectList.length; i++) {
            accumValue = callback(accumValue, objectList[i]);
        }
        return accumValue;
    };

    function AbstractBackend(setter) {
        this.setter = setter || function(obj, attr, value) {
            if (typeof obj.getObservable === "function") {
                obj.getObservable().set(attr, value);
            } else {
                obj[attr] = value;
            }
        };
        return this;
    }
    AbstractBackend.prototype = {
        constructor: AbstractBackend,
        setNextPk: function(obj) {},
        add: function(obj, callback) {},
        update: function(obj, callback) {},
        delete: function(obj, callback) {}
    };


    function AngularBackend(resource, setter) {
        // By defualt we assume that the obj is an Angular Resource instance.
        // To use clean model (not ActiveRecord of Angular) you have to define the resource argument.
        this.resource = resource || clone;
        AbstractBackend.call(this, setter);
        return this;
    }
    AngularBackend.prototype = clone({
        constructor: AngularBackend,
        add: function(obj, callback) {  // TODO: support bulk create???
            var self = this;
            return this.resource(obj).$create().then(function(response) {
                callback(clone(response, obj, self.setter));
            });
        },
        update: function(obj, callback) {
            var self = this;
            return this.resource(obj).$update().then(function(response) {
                callback(clone(response, obj, self.setter));
            });
        },
        delete: function(obj, callback) {
            return this.resource(obj).$delete().then(function() {
                callback(obj);
            });
        }
    }, Object.create(AbstractBackend.prototype));


    function DummyBackend(setter) {
        AbstractBackend.call(this, setter);
        return this;
    }
    DummyBackend.prototype = clone({
        constructor: DummyBackend,
        add: function(obj, callback) {
            callback(obj);
        },
        update: function(obj, callback) {
            callback(obj);
        },
        delete: function(obj, callback) {
            callback(obj);
        }
    }, Object.create(AbstractBackend.prototype));


    function AutoIncrementBackend(pk, setter) {
        this.pk = pk || 'id';
        this.counter = 0;
        DummyBackend.call(this, setter);
        return this;
    }
    AutoIncrementBackend.prototype = clone({
        constructor: AutoIncrementBackend,
        setNextPk: function(obj) {
            this.setter(obj, this.pk, ++this.counter);
        },
        add: function(obj, callback) {
            this.setNextPk(obj);
            callback(obj);
        }
    }, Object.create(DummyBackend.prototype));


    function Registry() {
        observable(this, 'getObservable');
        return this;
    }
    Registry.prototype = {
        register: function(name, store) {
            this[name] = store;
            store.register(name, this);
            this.getObservable().notify('register', store);
        },
        ready: function() {
            this.getObservable().notify('ready');
        },
        init: function() {
            for (var storeName in this) {
                if (!this.isStore(storeName)) { continue };
                var store = this[storeName];
                this.getObservable().notify('init', store);
                store.init();
            }
        },
        destroy: function() {
            for (var storeName in this) {
                if (!this.isStore(storeName)) { continue };
                var store = this[storeName];
                this.getObservable().notify('destroy', store);
                store.destroy();
            }
        },
        clean: function() {
            for (var storeName in this) {
                if (!this.isStore(storeName)) { continue };
                var store = this[storeName];
                this.getObservable().notify('clean', store);
                store.clean();
            }
        },
        isStore: function(attr) {
            return this.hasOwnProperty(attr) && (this[attr] instanceof Store);
        }
    };


    function OrderedDict() {
        this._keys = [];
        this._vals = {};
        return this;
    }
    OrderedDict.prototype = {
        constructor: OrderedDict,
        push: function(k, v) {
            if (!this._vals[k]) { this._keys.push(k); }
            this._vals[k] = v;
        },
        insert: function(pos, k, v) {
            if (!this._vals[k]) {
                this._keys.splice(pos, 0 , k);
                this._vals[k] = v;
            }
        },
        remove: function(k) {
            delete this._vals[k];
            this._keys = arrayRemove(this._keys, k);
        },
        get: function(k) { return this._vals[k]; },
        at: function(i) { return this._vals[this._keys[i]]; },
        length: function() { return this._keys.length; },
        keys: function() { return this._keys; },
        values: function() {
            var result = [];
            for (var i in this._keys) {
                result[this._keys[i]] = this.values[this._keys[i]];
            }
            return result;
        },
        items: function() {
            var result = [];
            for (var i in this._keys) {
                result[this._keys[i]] = [[this._keys[i], this.values[this._keys[i]]]];
            }
            return result;
        }
    };


    /*
     * It's also possible use Mixin into object (for example by argument or by other factory),
     * if there is no conflict inside the single namespace.
     * That's why we use accessor instead of reference.
     * To prevent circular references.
     */
    function observable(obj, accessorName, constructor) {
        var observable = new (constructor || Observable)(obj);
        obj[accessorName || 'getObservable'] = function() { return observable; };
        return obj;
    }


    function Observable(obj) {
        this.getObj = function() { return obj; };
        return this;
    };
    Observable.prototype = {
        constructor: Observable,
        set: function(name, newValue) {
            var oldValue = this.getObj()[name];
            if (oldValue === newValue) { return; }
            this.getObj()[name] = newValue;
            this.notify(name, oldValue, newValue);
        },
        get: function(name) {
            return this.getObj()[name];
        },
        _getObserver: function(args) {
            return args.length === 1 ? args[0] : args[1];
        },
        _getAspect: function(args) {
            return args.length === 1 ? undefined : args[0];
        },
        attach: function(/* aspect, observer | observer */) {
            var observer = this._getObserver(arguments), aspects = toArray(this._getAspect(arguments));
            if (!this._observers) {
                this._observers = {};
            }
            for (var i in aspects) {
                var aspect = aspects[i];
                if (!this._observers[aspect]) {
                    this._observers[aspect] = [];
                }
                this._observers[aspect].push(observer);
            }
            return this;
        },
        detach: function(/* aspect, observer | observer */) {
            var observer = this._getObserver(arguments), aspects = toArray(this._getAspect(arguments));
            var observers = this._observers && this._observers[aspect];
            if (!observers) {
                return this;
            }
            for (var i in aspects) {
                var aspect = aspects[i];
                arrayRemove(observers, observer);
            }
            return this;
        },
        notify: function(aspect/*, ...*/) {
            var observers = this._observers && this._observers[aspect];
            if (!observers) {
                return this;
            }
            var globalObservers = this._observers && this._observers[undefined];
            if (globalObservers) {
                observers = observers.concat(globalObservers);
            }
            var ooArguments = [this.getObj()].concat(arguments);
            for (var i in observers) {
                var observer = observers[i];
                if (typeof observer === "function") {
                    observer.apply(this.getObj(), arguments);
                } else {
                    observer.update.apply(observer, ooArguments);
                }
            }
            return this;
        }
    };


    function StoreObservable(store) {
        return Observable.call(this, store);
    }
    StoreObservable.prototype = clone({
        constructor: StoreObservable,
        attachBidirectional: function(aspect, relationName, callback) {
            var store = this.getObj();
            store.registry.getObservable().attach('ready', function() {
                var relation = store.getRelation(relationName);
                var relatedStore = relation.getRelatedStore();
                store.getObservable().attach(aspect, function(aspect, obj) {
                    relatedStore.find(relation.getRelatedWhere(obj)).map(function(relatedObj) {
                        callback(aspect, obj, relatedObj);
                    });
                });
                relatedStore.getObservable().attach(aspect, function(aspect, relatedObj) {
                    store.find(relation.getWhere(relatedObj)).map(function(obj) {
                        callback(aspect, obj, relatedObj);
                    });
                });
            });
        }
    }, Object.create(Observable.prototype));

    /*
     * Only o2m
     */
    function cascade(relatedObj, obj, relatedStore, store, relationName, relation, state) {
        relatedStore.delete(relatedObj, undefined, state);
    }


    /*
     * Only o2m
     */
    function setNull(relatedObj, obj, relatedStore, store, relationName, relation, state) {
        if (!(typeof relation.relatedField === "string")) { throw Error("Unable set NULL to composite relation!"); }
        relatedObj[relation.relatedField] = null;  // It's not actual for composite relations.
        relatedStore.update(relatedObj, undefined, state);
    }


    /*
     * Only Fk, m2m
     */
    function compose(relatedObj, obj, relatedStore, store, relationName, relation, state) {
        if (!relatedObj[relation.relatedName]) {
            relatedObj[relation.relatedName] = [];
        }
        relatedObj[relation.relatedName].push(obj);
    }


    /*
     * Only o2m, m2m
     */
    function decompose(relatedObj, obj, relatedStore, store, relationName, relation, state) {
        if (relatedObj[relation.relatedName]) {
            arrayRemove(relatedObj[relation.relatedName], obj);
        }
    }


    function clone(source, destination, setter) {
        setter = setter || function(obj, attr, value) { obj[attr] = value; };
        if (source === null || typeof source !== "object") { return source; }
        destination = typeof destination !== "undefined" ? destination : new source.constructor();
        for (var i in source) {
            if (source.hasOwnProperty(i)) {
                setter(destination, i, source[i]);
            }
        }
        return destination;
    }


    function deepClone(source, destination, setter) {
        setter = setter || function(obj, attr, value) { obj[attr] = value; };
        if (source === null || typeof source !== "object") { return source; }
        destination = typeof destination !== "undefined" ? destination : new source.constructor();
        if (source instanceof Date) {
            destination.setTime(source.getTime());
            return destination;
        }
        for (var i in source) {
            if (source.hasOwnProperty(i)) {
                setter(destination, i, deepClone(source[i], destination[i]));
            }
        }
        return destination;
    }


    function toArray(value) {
        if (!(value instanceof Array)) {
            value = [value];
        }
        return value;
    }


    function arrayRemove(array, value, cast) {
        var i, newArray;
        newArray = array.slice();
        for(var i = newArray.length - 1; i >= 0; i--) {
            if(newArray[i] === value || cast && cast(newArray[i]) === cast(value)) {
                newArray.splice(i, 1);
            }
        }
        return newArray;
    };


    function toString(el) { return el.toString(); }


    function intersectMapping(left, right) {
        if (typeof left === "undefined") {
            left = right;
        } else if (typeof right === "undefined") {
            right = left;
        }
        var result = {};
        for (var key in left) {
            if (key in right) {
                result[key] = left[key];
            }
        }
        return result;
    }


    function mergeMapping(left, right) {
        if (typeof left === "undefined") {
            left = right;
        } else if (typeof right === "undefined") {
            right = left;
        }
        var result = {};
        for (var key in left) {
            result[key] = left[key];
        }
        for (var key in right) {
            result[key] = right[key];
        }
        return result;
    }

    return {
        Store: Store,
        PkRequired: PkRequired,
        ObjectAlreadyLoaded: ObjectAlreadyLoaded,
        Registry: Registry,
        DummyBackend: DummyBackend,
        AngularBackend: AngularBackend,
        AutoIncrementBackend: AutoIncrementBackend,
        Observable: Observable,
        observable: observable,
        cascade: cascade,
        setNull: setNull,
        arrayRemove: arrayRemove
    };
});
