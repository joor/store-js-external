define(['./polyfill'], function() {

    'use strict';

    var Promise = window.Promise;


    function IStore() {
    }
    IStore.prototype = {
        constructor: IStore,
        register: function(name, registry) {
            throw Error("Not Implemented Error");
        },
        getRegistry: function() {
            throw Error("Not Implemented Error");
        },
        getName: function() {
            throw Error("Not Implemented Error");
        },
        setNextPk: function(obj) {
            throw Error("Not Implemented Error");
        },
        getObjectAccessor: function() {
            throw Error("Not Implemented Error");
        },
        restoreInstance: function(record) {
            throw Error("Not Implemented Error");
        },
        getInitObjectState: function(obj) {
            throw Error("Not Implemented Error");
        },
        getQueryEngine: function() {
            throw Error("Not Implemented Error");
        },
        syncDependencies: function(obj, old) {
            throw Error("Not Implemented Error");
        },
        get: function(pk) {
            throw Error("Not Implemented Error");
        },
        find: function(query, options) {
            throw Error("Not Implemented Error");
        },
        findList: function(query, options) {
            throw Error("Not Implemented Error");
        },
        add: function(obj, state) {
            throw Error("Not Implemented Error");
        },
        update: function(obj, state) {
            throw Error("Not Implemented Error");
        },
        delete: function(obj, state) {
            throw Error("Not Implemented Error");
        },
        compose: function(obj, state) {
            throw Error("Not Implemented Error");
        },
        decompose: function(record) {
            throw Error("Not Implemented Error");
        },
        clean: function() {
            throw Error("Not Implemented Error");
        }
    };


    function AbstractStore() {
        this._name = null;
    }
    AbstractStore.prototype = clone({
        constructor: AbstractStore,
        register: function(name, registry) {
            this._name = name;
            this._registry = registry;
        },
        getRegistry: function() {
            return this._registry;
        },
        getName: function() {
            return this._name;
        },
        compose: function(obj, state) {},
        destroy: function() {}
    }, Object.create(IStore.prototype));


    function CompositeStore(pkOrObjectAccessor, indexesOrLocalStore, remoteStore, modelOrMapper) {
        AbstractStore.call(this);
        pkOrObjectAccessor = pkOrObjectAccessor || 'id';
        var objectAccessor = pkOrObjectAccessor instanceof ObjectAccessor ? pkOrObjectAccessor : new ObjectAccessor(pkOrObjectAccessor);

        var remoteStore = remoteStore ? remoteStore : (objectAccessor.pk instanceof Array ? new DummyStore(objectAccessor) : new AutoIncrementStore(objectAccessor));
        this._remoteStore = withAspect(ObservableStoreAspect, remoteStore).init();

        this._localStore = indexesOrLocalStore instanceof IStore ? indexesOrLocalStore : withAspect(ObservableStoreAspect, new MemoryStore(objectAccessor, indexesOrLocalStore, modelOrMapper)).init();
    }
    CompositeStore.prototype = clone({
        constructor: CompositeStore,
        getLocalStore: function () {
            return this._localStore;
        },
        getRemoteStore: function() {
            return this._remoteStore;
        },
        getObjectAccessor: function() {
            return this._localStore.getObjectAccessor();
        },
        getDependencies: function() {
            return [this];
        },
        setNextPk: function(obj) {
            return this._remoteStore.setNextPk(obj);
        },
        getInitObjectState: function(obj) {
            return this._localStore.getInitObjectState(obj);
        },
        restoreInstance: function(record) {
            return this._remoteStore.restoreInstance(record);
        },
        getQueryEngine: function() {
            return this._localStore.getQueryEngine();
        },
        syncDependencies: function(obj, old) {
        },
        decompose: function(record) {
            record = this.restoreInstance(record);
            return this._localStore.add(record);
        },
        fill: function(options, callback) {  // TODO: Deprecated. Remove me.
            window.console && window.console.warn("Store.prototype.fill() is deprecated! Use Store.prototype.pull() instead!");
            options = options || {};
            var query = options.query;
            if (query) { delete options.query; }
            return this.pull(query, options, callback);
        },
        pull: function(query, options) {  // fill, populate, pull (from remoteStore), fetch...
            typeof options === "undefined" && (options = {});
            typeof query === "undefined" && (query = {});
            var self = this;
            return when(this._prepareQuery(this._remoteStore.getQueryEngine(), query), function(query) {
                return when(this._remoteStore.find(query, options), function(objectList) {
                    return whenIter(objectList, function(obj, i) {
                        return when(options.decompose ? self.decompose(obj) : self._localStore.add(obj), function(obj) {
                            objectList[i] = obj;
                        });
                    });
                });
            });
        },
        get: function(pkOrQuery) {
            return this._localStore.get(pkOrQuery);
        },
        save: function(obj) {
            return this.getObjectAccessor().pkExists(obj) ? this.update(obj) : this.add(obj);
        },
        add: function(obj, state) {
            return this._getTransaction().add(this, obj, function() {  // onCommit
                var dirty = this;
                var old = this.store.getObjectAccessor().getObjectState(dirty.obj);
                dirty.store.getObjectAccessor().delTmpPk(dirty.obj);
                return this.store.getRemoteStore().add(dirty.obj).then(function(obj) {
                    return when(dirty.store._localStore.update(obj), function(obj) {
                        return when(dirty.store.syncDependencies(obj, old), function() {
                            return obj;
                        });
                    });
                });
            }, function() {  // onRollback
                return when(this.store._localStore.delete(this.obj));
            }, function () {  // onPending
                var dirty = this;
                this.store.getObjectAccessor().setTmpPk(dirty.obj);
                return when(dirty.store._localStore.add(dirty.obj), function(obj) {
                    dirty.obj = obj;
                    return when(obj);
                });
            }, function () {  // onAutocommit
                var dirty = this;
                return when(dirty.store.getRemoteStore().add(dirty.obj), function(obj) {
                    return when(dirty.store._localStore.add(dirty.obj), function(obj) {
                        dirty.obj = obj;
                        return when(obj);
                    });
                });
            });
        },
        update: function(obj, state) {
            var self = this;
            var old = self.getInitObjectState(obj);
            return this._getTransaction().update(this, obj, old, function() {
                var dirty = this;
                return this.store.getRemoteStore().update(dirty.obj).then(function(obj) {
                    return dirty.store._localStore.update(obj);
                });
            }, function() {
                var dirty = this;
                return when(this.store._localStore.update(clone(dirty.old, dirty.obj, function(obj, attr, value) {
                    return dirty.store.getObjectAccessor().setValue(obj, attr, value);
                })));
            });
        },
        delete: function(obj, state, remoteCascade) {
            var self = this;
            return self._getTransaction().delete(self, obj, function() {
                var dirty = this;
                if (remoteCascade) {
                    return when(dirty.obj);
                }
                return dirty.store.getRemoteStore().delete(dirty.obj);
            }, function() {
                var dirty = this;
                return when(dirty.store._localStore.add(dirty.obj));
            }).then(function(obj) {
                return when(self._localStore.delete(obj), function(obj) {
                    if (obj.observed) {
                        delete obj.observed().getObj;
                        delete obj.observed;
                    }
                    return obj;
                });
            });
        },
        /*
         * Implements pattern:
         * http://martinfowler.com/eaaCatalog/queryObject.html
         * Used MongoDB like syntax:
         * https://docs.mongodb.com/manual/reference/operator/query/
         */
        find: function(query, options) {
            // Signature similar to dojo.store.query();
            // Alternative: https://docs.mongodb.com/manual/reference/operator/meta/orderby/
            // store.find({$query: {}, $orderby: [{ age : -1 }]})
            var self = this;
            typeof query === "undefined" && (query = {});
            return when(this._prepareQuery(this._localStore.getQueryEngine(), query), function(query) {
                return self._localStore.find(query);
            });
        },
        _makeResult: function(reproducer, filter, objectList, subjects) {
            return new Result(this._localStore, reproducer, filter, objectList, subjects);
        },
        findList: function(query, options) {
            var self = this;
            typeof query === "undefined" && (query = {});
            return when(this._prepareQuery(this._localStore.getQueryEngine(), query), function(query) {
                return self._localStore.findList(query);
            });
        },
        _prepareQuery: function(queryEngine, query) {
            return query;
        },
        clean: function() {
            this._localStore.clean();
        },
        _getTransaction: function() {
            return this._registry.transaction;
        }
        /*
        bind: function(registry) {
            var BoundStore = function(registry) {
                this._registry = registry;
            };
            // TODO: use descriptors (or new interface) to delegate any setting (except registry) to prototype.
            BoundStore.prototype = this;
            return new BoundStore(registry);
        } */
    }, Object.create(AbstractStore.prototype));


    var ObservableStoreAspect = {
        init: function() {
            observe(this, 'observed', StoreObservable);
        },
        add:  function(obj, state) {
            var self = this;
            return when(__super__(ObservableStoreAspect, self).add.call(this, obj), function(obj) {
                self.observed().notify('add', obj);
                return obj;
            });
        },
        update:  function(obj, state) {
            var self = this;
            var old = this.getInitObjectState(obj);
            return when(__super__(ObservableStoreAspect, self).update.call(this, obj), function(obj) {
                self.observed().notify('update', obj, old);
                return obj;
            });
        },
        delete:  function(obj, state, remoteCascade) {
            var self = this;
            return when(__super__(ObservableStoreAspect, self).delete.call(this, obj, state, remoteCascade), function(obj) {
                self.observed().notify('delete', obj);
                return obj;
            });
        },
        destroy: function() {
            var self = this;
            this.findList().forEach(function(obj) {
                self.observed().notify('destroy', obj);
            });
            __super__(ObservableStoreAspect, this).destroy.call(this);
        }
    };


    var PreObservableStoreAspect = {
        init: function() {
            observe(this, 'observed', StoreObservable);
        },
        add:  function(obj, state) {
            this.observed().notify('preAdd', obj);
            return __super__(PreObservableStoreAspect, this).add.call(this, obj);
        },
        update:  function(obj, state) {
            var old = this.getInitObjectState(obj);
            this.observed().notify('preUpdate', obj, old);
            return __super__(PreObservableStoreAspect, this).update.call(this, obj);
        },
        delete:  function(obj, state, remoteCascade) {
            this.observed().notify('preDelete', obj);
            return __super__(PreObservableStoreAspect, this).delete.call(this, obj, state, remoteCascade);
        }
    };


    var CircularReferencesStoreAspect = {
        add: function(obj, state) {
            state = state || new State();
            if (state.isVisited(this, obj)) { return  when(obj);  };  // It's circular references. Skip it.
            return __super__(CircularReferencesStoreAspect, this).add.call(this, obj, state);
        },
        update: function(obj, state) {
            state = state || new State();
            if (state.isVisited(this, obj)) { return  when(obj);  };  // It's circular references. Skip it.
            return __super__(CircularReferencesStoreAspect, this).update.call(this, obj, state);
        },
        delete: function(obj, state, remoteCascad) {
            state = state || new State();
            if (state.isVisited(this, obj)) { return  when(obj);  };  // It's circular references. Skip it.
            return __super__(CircularReferencesStoreAspect, this).delete.call(this, obj, state, remoteCascad);
        }
    };


    var CheckReferentialIntegrityStoreAspect = {
        init: function() {
        },
        add:  function(obj, state) {
            var self = this;
            return when(this._checkReferentialIntegrity(obj), function() {
                return __super__(PreObservableStoreAspect, self).add.call(self, obj);
            });
        },
        update:  function(obj, state) {
            var self = this;
            return when(this._checkReferentialIntegrity(obj), function() {
                return __super__(PreObservableStoreAspect, self).update.call(self, obj);
            });
        },
        delete:  function(obj, state, remoteCascade) {
            var self = this;
            return when(this._checkRelatedReferentialIntegrity(obj), function() {
                return __super__(PreObservableStoreAspect, self).delete.call(self, obj, state, remoteCascade);
            });
        },
        _checkReferentialIntegrity: function(obj) {
            var self = this;
            return whenIter(keys(this.relations.foreignKey), function(relationName) {
                var relation = self.relations.foreignKey[relationName];
                var relatedStore = relation.getRelatedStore();
                var value = relation.getValue(obj);
                var checkValue = value.filter(function(val) { return !!val; });
                if (!checkValue.length) { return; }
                return when(relatedStore.findList(relation.getRelatedQuery(obj)), function(relatedObjectList) {
                    var relatedObj = relatedObjectList[0];
                    if (typeof relatedObj === "undefined") {
                        throw Error("Referential Integrity Error! Trying to add object with non-added relations!");
                    }
                    return obj;
                });
            });
        },
        _checkRelatedReferentialIntegrity: function(obj) {
            var self = this;
            return whenIter(keys(this.relations.oneToMany), function(relationName) {
                var relation = self.relations.oneToMany[relationName];
                var relatedStore = relation.getRelatedStore();
                var value = relation.getValue(obj);
                var checkValue = value.filter(function(val) { return !!val; });
                if (!checkValue.length) { return; }
                return when(relatedStore.findList(relation.getRelatedQuery(obj)), function(relatedObjectList) {
                    if (relatedObjectList.length) {
                        throw Error("Referential Integrity Error! Trying to delete object with non-deleted relations!");
                    }
                    return obj;
                });
            });
        }
    };


    var RelationalStoreAspect = {
        init: function(relations, indexesOrLocalStore) {
            typeof relations === "undefined" && (relations = {});
            typeof indexesOrLocalStore === "undefined" && (indexesOrLocalStore = []);
            this._initRelations(relations);
            if (indexesOrLocalStore instanceof Array) {
                var indexes = indexesOrLocalStore;
                for (var relationName in this.relations.foreignKey) {  // TODO: Remove this side-effect?
                    var fields = this.relations.foreignKey[relationName].getField();
                    for (var i = 0; i < fields.length; i++) {
                        if (!(fields[i] in indexes)) { indexes[fields[i]] = {}; }
                    }
                }
            }
        },
        register: function(name, registry) {
            var self = this;
            __super__(RelationalStoreAspect, self).register.call(self, name, registry);
            self._registry.keys().forEach(function(relatedStoreName) {
                self._setupReverseRelations(self._registry.get(relatedStoreName));
            });
        },
        add: function(obj, state) {
            var self = this;
            return when(__super__(RelationalStoreAspect, self).add.call(self, obj, state), function(obj) {
                return self._propagateBottomUpRelations('onAdd', obj, obj, state).then(function() {
                    return obj;
                });
            });
        },
        update: function(obj, state) {
            var self = this;
            var old = self.getInitObjectState(obj);
            return when(__super__(RelationalStoreAspect, self).update.call(self, obj, state), function(obj) {
                return self._propagateTopDownRelations('onUpdate', obj, old, state).then(function() {
                    return obj;
                });
            });
        },
        delete: function(obj, state, remoteCascade) {
            var self = this;
            return when(self._propagateTopDownRelations('onDelete', obj, obj, state), function() {
                return __super__(RelationalStoreAspect, self).delete.call(self, obj, state, remoteCascade);
            });
        },
        getDependencies: function() {
            var queue = [this];
            for (var i = 0; i < queue.length; i++) {
                var store = queue[i];
                for (var relationName in store.relations.foreignKey) {
                    var relation = store.relations.foreignKey[relationName];
                    var relatedStore = relation.getRelatedStore();
                    if (queue.indexOf(relatedStore) === -1) {
                        queue.push(relatedStore);
                    }
                }
            }
            return queue;
        },
        /*
         * Returns composition of related objects.
         */
        compose: function(obj, state) {
            new Compose(this, obj, state).compute();
        },
        /*
         * Load related stores from composition of object.
         */
        decompose: function(record) {
            record = this.restoreInstance(record);
            return new Decompose(this, record).compute();
        },
        _prepareQuery: function(queryEngine, query) {
            var self = this;
            return when(new PrepareRelationalQuery(queryEngine, query, this).compute(), function(queryRelational) {
                return __super__(RelationalStoreAspect, self)._prepareQuery.call(self, queryEngine, queryRelational);
            });
        },
        getRelation: function(name) {
            for (var relationType in this.relations) {
                if (name in this.relations[relationType]) {
                    return this.relations[relationType][name];
                }
            }
        },
        relationIsUsedByM2m: function(relationName) {
            for (var m2mRelationName in this.relations.manyToMany) {
                if (this.relations.manyToMany[m2mRelationName].relation === relationName) { return true; }
            }
            return false;
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
        syncDependencies: function(obj, old) {
            var self = this;
            return when(this._syncRelations(obj, old), function() {
                return __super__(RelationalStoreAspect, self).syncDependencies.call(obj, old);
            });
        },
        _syncRelations: function(obj, old) {
            var self = this;
            return new Iterator(keys(this.relations.oneToMany)).onEach(function(relationName, resolve, reject) {
                var relation = self.relations.oneToMany[relationName];
                var value = relation.getValue(obj);
                var oldValue = relation.getValue(old);
                if (!arrayEqual(value, oldValue)) {
                    var relatedStore = relation.getRelatedStore();
                    when(relatedStore.findList(relation.getRelatedQuery(old)), function(relatedObjectList) {
                        new Iterator(relatedObjectList).onEach(function(relatedObj, resolve, reject) {
                            relatedStore.getObjectAccessor().setValue(relatedObj, relation.getRelatedField(), value);
                            when(relatedStore._localStore.update(relatedObj), resolve, reject);
                        }).iterate().then(resolve, reject);
                    });
                }
            }).iterate();
        },
        _setupReverseRelations: function(store) {
            for (var relationName in store.relations.foreignKey) {
                var relation = store.relations.foreignKey[relationName];
                relation.setupReverseRelation();
            }
        },
        _propagateTopDownRelations: function(onAction, obj, old, state) {
            var self = this;
            return new Iterator(keys(self.relations.oneToMany)).onEach(function(relationName, resolve, reject) {
                self._propagateByRelation(onAction, obj, old, self.relations.oneToMany[relationName], state).then(resolve, reject);
            }).iterate().then(function() {
                return new Iterator(keys(self.relations.manyToMany)).onEach(function(relationName, resolve, reject) {
                    self._propagateByM2m(onAction, obj, old, self.relations.manyToMany[relationName], state).then(resolve, reject);
                }).iterate();
            });
        },
        _propagateBottomUpRelations: function(onAction, obj, old, state) {
            var self = this;
            return new Iterator(keys(self.relations.foreignKey)).onEach(function(relationName, resolve, reject) {
                self._propagateByRelation(onAction, obj, old, self.relations.foreignKey[relationName], state).then(resolve, reject);
            }).iterate().then(function() {
                return new Iterator(keys(self.relations.manyToMany)).onEach(function(relationName, resolve, reject) {
                    self._propagateByM2m(onAction, obj, old, self.relations.manyToMany[relationName], state).then(resolve, reject);
                }).iterate();
            });
        },
        _propagateByRelation: function(onAction, obj, old, relation, state) {
            if (!(onAction in relation)) {
                return Promise.resolve();
            }
            var relatedStore = relation.getRelatedStore();
            var query = relation.getRelatedQuery(obj);
            return when(relatedStore.findList(query), function(relatedObjectList) {
                return new Iterator(relatedObjectList).onEach(function(relatedObj, resolve, reject) {
                    return new Iterator(toArray(relation[onAction])).onEach(function(action, resolve, reject) {
                        action(relatedObj, obj, old, relation, state).then(resolve, reject);
                    }).iterate().then(
                        resolve, reject
                    );
                }).iterate();
            });
        },
        _propagateByM2m: function(onAction, obj, old, m2mRelation, state) {
            if (!(onAction in m2mRelation)) {
                return;
            }
            var relatedStore = m2mRelation.getRelatedStore();
            var relation = this.relations.oneToMany[m2mRelation.relation];
            var query = m2mRelation.getRelatedQuery(obj);
            return when(relatedStore.findList(query), function(relatedObjectList) {
                return new Iterator(relatedObjectList).onEach(function(relatedObj, resolve, reject) {
                    return new Iterator(toArray(m2mRelation[onAction])).onEach(function(action, resolve, reject) {
                        action(relatedObj, obj, old, relation, state).then(resolve, reject);
                    }).iterate().then(
                        resolve, reject
                    );
                }).iterate();
            });
        }
    };


    /*
     * This class implements the pattern Repository:
     * http://martinfowler.com/eaaCatalog/repository.html
     */
    function Store(pkOrObjectAccessor, indexesOrLocalStore, relations, remoteStore, model) {
        indexesOrLocalStore || (indexesOrLocalStore = []);
        ObservableStoreAspect.init.call(this);
        RelationalStoreAspect.init.call(this, relations, indexesOrLocalStore);
        CompositeStore.call(this, pkOrObjectAccessor, indexesOrLocalStore, remoteStore, model);
    }
    Store.prototype = clone({
        constructor: Store
    }, withMixins(CircularReferencesStoreAspect, ObservableStoreAspect, RelationalStoreAspect, CompositeStore.prototype));


    function AbstractRelation(params) {
        if (params.field) { params.field = toArray(params.field); }
        if (params.relatedField) { params.relatedField = toArray(params.relatedField); }
        clone(params, this);
    }
    AbstractRelation.prototype = {
        constructor: AbstractRelation,
        getField: function() {
            return this.field;
        },
        getRelatedField: function() {
            return this.relatedField;
        },
        getValue: function(obj) {
            return this.store.getObjectAccessor().getValue(obj, this.getField());
        },
        getRelatedValue: function(relatedObj) {
            return this.getRelatedStore().getObjectAccessor().getValue(relatedObj, this.getRelatedField());
        },
        getQuery: function(relatedObj) {
            var query = {},
                field = this.getField(),
                relatedValue = this.getRelatedValue(relatedObj);
            for (var i = 0; i < field.length; i++) {
                query[field[i]] = {'$eq': relatedValue[i]};
            }
            return query;
        },
        getRelatedQuery: function(obj) {
            var query = {},
                relatedField = this.getRelatedField(),
                value = this.getValue(obj);
            for (var i = 0; i < relatedField.length; i++) {
                query[relatedField[i]] = {'$eq': value[i]};
            }
            return query;
        },
        setupReverseRelation: function() {},
        getRelatedStore: function() {
            return this.store.getRegistry().get(this.relatedStore);
        },
        getRelatedRelation: function() {
            return this.getRelatedStore().getRelation(this.relatedName);
        }
    };


    function ForeignKey(params) {
        AbstractRelation.call(this, params);
        if (!this.relatedName) {
            this.relatedName = this.store.getName() + 'Set';
        }
    }
    ForeignKey.prototype = clone({
        constructor: ForeignKey,
        setupReverseRelation: function () {
            if (!this.store.getRegistry().has(this.relatedStore)) {
                return;
            }
            if (this.relatedName in this.getRelatedStore().relations.oneToMany) {
                return;
            }
            var relatedParams = {
                field: this.relatedField,
                relatedField: this.field,
                relatedStore: this.store.getName(),
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
            return this.store.relations.oneToMany[this.relation].getField();
        },
        getRelatedField: function() {
            return this.getRelatedStore().relations.oneToMany[this.relatedRelation].getField();
        },
        getQuery: function(relatedObj) {
            var query = {},
                subQuery = {},
                relatedField = this.getRelatedField(),
                relatedValue = this.getRelatedValue(relatedObj);
            for (var i = 0; i < relatedField.length; i++) {
                subQuery[relatedField[i]] = {'$eq': relatedValue[i]};
            }
            query[this.name] = {'$rel': subQuery};
            return query;
        },
        getRelatedQuery: function(obj) {
            var query = {},
                subQuery = {},
                field = this.getField(),
                value = this.getValue(obj);
            for (var i = 0; i < field.length; i++) {
                subQuery[field[i]] = {'$eq': value[i]};
            }
            query[this.store.getRelation(this.relation).relatedName] = {'$rel': subQuery};
            subQuery = query;
            query = {};
            query[this.relatedRelation] = {'$rel': subQuery};
            return query;
        },
        getRelatedRelation: function() {
            return;
        }
    }, Object.create(AbstractRelation.prototype));


    function AbstractQueryEngine() {
        this._operators = {};
        this._compoundOperatorNames = [];
    }
    AbstractQueryEngine.prototype = {
        constructor: AbstractQueryEngine,
        register: function(operatorName, operatorCallable, isCompound) {
            this._operators[operatorName] = operatorCallable;
            if (isCompound) {
                this._compoundOperatorNames.push(operatorName);
            }
            return operatorCallable;
        },
        get: function(operatorName) {
            return this._operators[operatorName];
        },
        has: function(operatorName) {
            return operatorName in this._operators;
        },
        isCompound: function(operatorName) {
            return this._compoundOperatorNames.indexOf(operatorName) !== -1;
        },
        execute: function(query, objectAccessor, context) {
            throw Error("Not Implemented Error!");
        }
    };


    function SimpleQueryEngine() {
        AbstractQueryEngine.call(this);
    }
    SimpleQueryEngine.prototype = clone({
        constructor: SimpleQueryEngine,
        execute: function(query, objectAccessor, context) {
            var result = true;
            for (var left in query) {
                var right = query[left];
                if (this.has(left)) {
                    result = result && this.get(left).call(this, right, objectAccessor, context);
                } else {
                    result = result && this._executeRight(left, right, objectAccessor, context);
                }
                if (!result) {
                    return result;
                }
            }
            return result;
        },
        _executeRight: function(left, right, objectAccessor, context) {
            var result = true;
            for (var key in right) {
                result = result && this.get(key).call(this, [left, right[key]], objectAccessor, context);
                if (!result) {
                    return result;
                }
            }
            return result;
        }
    }, Object.create(AbstractQueryEngine.prototype));


    var simpleQueryEngine = new SimpleQueryEngine();

    simpleQueryEngine.register('$query', function(operands, objectAccessor, obj) {
        return this.execute(operands, objectAccessor, obj);
    });
    simpleQueryEngine.register('$subjects', function(operands, objectAccessor, obj) {
        return true;
    });
    simpleQueryEngine.register('$orderby', function(operands, objectAccessor, obj) {
        return true;
    }, true);
    simpleQueryEngine.register('$limit', function(operands, objectAccessor, obj) {
        return true;
    });
    simpleQueryEngine.register('$offset', function(operands, objectAccessor, obj) {
        return true;
    });
    simpleQueryEngine.register('$and', function(operands, objectAccessor, obj) {
        var result = true;
        for (var i in operands) {
            result = result && this.execute(operands[i], objectAccessor, obj);
            if (!result) {
                return result;
            }
        };
        return result;
    }, true);
    simpleQueryEngine.register('$or', function(operands, objectAccessor, obj) {
        var result = false;
        for (var i in operands) {
            result = result || this.execute(operands[i], objectAccessor, obj);
            if (result) {
                return result;
            }
        };
        return result;
    }, true);
    simpleQueryEngine.register('$in', function(operands, objectAccessor, obj) {
        var result = false,
            field = operands[0],
            values = operands[1];
        for (var i = 0; i < values.length; i++) {
            result = result || this.get('$eq').call(this, [field, values[i]], objectAccessor, obj);
            if (result) {
                return result;
            }
        }
        return result;
    });
    simpleQueryEngine.register('$eq', function(operands, objectAccessor, obj) {
        var field = operands[0],
            value = operands[1];
        return objectAccessor.getValue(obj, field) == value;
    });
    simpleQueryEngine.register('$ne', function(operands, objectAccessor, obj) {
        var field = operands[0],
            value = operands[1];
        return objectAccessor.getValue(obj, field) != value;
    });
    simpleQueryEngine.register('$callable', function(operands, objectAccessor, obj) {
        if (typeof operands === "function") {
            var func = operands;
            return func(obj);
        }
        var field = operands[0],
            func = operands[1];
        return func(objectAccessor.getValue(obj, field), obj, field);
    });


    function DjangoFilterQueryEngine() {
        AbstractQueryEngine.call(this);
    }
    DjangoFilterQueryEngine.prototype = clone({
        constructor: DjangoFilterQueryEngine,
        execute: function(query, objectAccessor, context) {
            var result = {};
            for (var left in query) {
                var right = query[left];
                if (this.has(left)) {
                    clone(this.get(left).call(this, right, objectAccessor, context), result);
                } else {
                    clone(this._executeRight(left, right, objectAccessor, context), result);
                }
            }
            return result;
        },
        _executeRight: function(left, right, objectAccessor, context) {
            var result = {};
            for (var key in right) {
                clone(this.get(key).call(this, [left, right[key]], objectAccessor, context), result);
            }
            return result;
        }
    }, Object.create(AbstractQueryEngine.prototype));


    var djangoFilterQueryEngine = new DjangoFilterQueryEngine();


    djangoFilterQueryEngine.register('$query', function(operands, objectAccessor, obj) {
        return this.execute(operands, objectAccessor, obj);
    });
    djangoFilterQueryEngine.register('$subjects', function(operands, objectAccessor, obj) {
        return {};
    });
    djangoFilterQueryEngine.register('$orderby', function(operands, objectAccessor, obj) {
        return {};
    }, true);
    djangoFilterQueryEngine.register('$limit', function(operands, objectAccessor, obj) {
        return {};
    });
    djangoFilterQueryEngine.register('$offset', function(operands, objectAccessor, obj) {
        return {};
    });
    djangoFilterQueryEngine.register('$and', function(operands, objectAccessor, context) {
        var result = {};
        for (var i in operands) {
            clone(this.execute(operands[i], objectAccessor, context), result);
        };
        return result;
    }, true);
    djangoFilterQueryEngine.register('$or', function(operands, objectAccessor, context) {
        throw Error("Not Supported!");
    }, true);
    djangoFilterQueryEngine.register('$callable', function(operands, objectAccessor, context) {
        throw Error("Not Supported!");
    });
    djangoFilterQueryEngine.register('$eq', function(operands, objectAccessor, context) {
        var result = {},
            field = operands[0],
            value = operands[1];
        if (typeof value === "undefined" || value === null) {
            field += '__isnull';
            value = true;
        }
        result[field] = value;
        return result;
    });
    djangoFilterQueryEngine.register('$ne', function(operands, objectAccessor, context) {
        var result = {},
            field = operands[0],
            value = operands[1];
        if (typeof value === "undefined" || value === null) {
            field += '__isnull';
            value = false;
        } else {
            field += '__ne';
        }
        result[field] = value;
        return result;
    });
    djangoFilterQueryEngine.register('$rel', function(operands, objectAccessor, context) {
        var result = {},
            prefix = operands[0],
            subQuery = operands[1];
        var subResult = this.execute(subQuery, objectAccessor, context);
        for (i in subResult) {
            result[prefix + '__' + i] = subResult[i];
        }
        return result;
    });


    function ObjectAccessor(pk, setter, getter, deleter) {
        this.pk = pk;
        this.setter = setter || function(obj, attr, value) {
            if (typeof obj.observed === "function") {
                obj.observed().set(attr, value);
            } else {
                obj[attr] = value;
            }
        };
        this.getter = getter || function(obj, attr) {
            if (typeof obj.observed === "function") {
                var value = obj.observed().get(attr);
            } else {
                var value = obj[attr];
            }
            if (typeof value === "function") {
                value = value.call(obj);
            }
            return value;
        };
        this.deleter = deleter || function(obj, attr) {
            if (typeof obj.observed === "function") {
                obj.observed().del(attr);
            } else {
                delete obj[attr];
            }
        };
    }
    ObjectAccessor.prototype = {
        constructor: ObjectAccessor,
        _tmpPkPrefix: '__tmp_',
        getPk: function(obj) {
            return this.getValue(obj, this.pk);
        },
        setPk: function(obj, value) {
            this.setValue(obj, this.pk, value);
        },
        delPk: function(obj) {
            this.delValue(obj, this.pk);
        },
        getValue: function(obj, field) {
            if (field instanceof Array) {
                var value = [];
                for (var i = 0; i < field.length; i++) {
                    value.push(this.getter(obj, field[i]));
                }
                return value;
            } else {
                return this.getter(obj, field);
            }
        },
        setValue: function(obj, field, value) {
            if (field instanceof Array) {
                for (var i = 0; i < field.length; i++) {
                    this.setter(obj, field[i], value[i]);
                }
            } else {
                this.setter(obj, field, value);
            }
        },
        delValue: function(obj, field) {
            if (field instanceof Array) {
                for (var i = 0; i < field.length; i++) {
                    this.deleter(obj, field[i]);
                }
            } else {
                this.deleter(obj, field);
            }
        },
        getObjectState: function(obj) {
            return clone(obj, {});
        },
        pkExists: function(obj) {
            return !!toArray(this.getPk(obj)).filter(function(val) {
                return val !== null && typeof val !== "undefined";
            }).length;
        },
        setTmpPk: function(obj) {
            var pkValue = this.getPk(obj);
            if (pkValue instanceof Array) {
                for (var i = 0; i < pkValue.length; i++) {
                    if (typeof pkValue[i] === "undefined") {
                        pkValue[i] = this._makeTmpId();
                    }
                }
            } else {
                if (typeof pkValue === "undefined") {
                    pkValue = this._makeTmpId();
                }
            }
            this.setPk(obj, pkValue);
        },
        delTmpPk: function(obj) {
            var pk = toArray(this.pk);
            for (var i = 0; i < pk.length; i++) {
                var field = pk[i];
                if (this._isTmpId(this.getValue(obj, field))) {
                    this.delValue(obj, field);
                }
            }
        },
        _makeTmpId: function() {
            ObjectAccessor._counter || (ObjectAccessor._counter = 0);
            return this._tmpPkPrefix + (++ObjectAccessor._counter);
        },
        _isTmpId: function(value) {
            return typeof value === "string" && value.indexOf(this._tmpPkPrefix) === 0;
        }
    };


    function IndexFinder(memoryStore) {
        this._memoryStore = memoryStore;
    }
    IndexFinder.prototype = {
        constructor: IndexFinder,
        '$eq': function(field, value) {
            if (this._memoryStore.indexes[field] && value in this._memoryStore.indexes[field]) {
                return this._memoryStore.indexes[field][value].slice();
            }
            return undefined;
        }
    };


    function AbstractQueryWalker(queryEngine, query) {
        if (!('$query' in query)) {
            // Don't clone query into itself if you want to keep all references to the root.
            // We have to keep all references to the same logical level.
            // A component of the query can be changeable by event.
            // See emulatedRelation._emulateRelation() for more info.
            query = {'$query': query};
        }
        this._query = query;
        this._promises = [];
        this._queryEngine = queryEngine;
    }
    AbstractQueryWalker.prototype = {
        constructor: AbstractQueryWalker,
        _visitors: {
            compoundOperator: {
                accept: function(owner, left, right) {
                    return right instanceof Array && owner._queryEngine.isCompound(left);
                },
                visit: function(owner, left, right, query) {
                    query[left] = right.map(function(el) {
                        return owner._walkQuery(el);
                    });
                }
            },
            nestedQuery: {
                accept: function(owner, left, right) {
                    return isPlainObject(right) && !(right instanceof Array);
                },
                visit: function(owner, left, right, query) {
                    query[left] = owner._walkQuery(right);
                }
            },
            promisedOperand: {
                accept: function(owner, left, right) {
                    return right && typeof right.then === "function";
                },
                visit: function(owner, left, right, query) {
                    owner._promises.push(right);
                    when(right, function(right) {
                        query[left] = right;
                    });
                }
            }
        },
        _activeVisitors: [
            'compoundOperator',
            'nestedQuery'
            // 'promisedOperand'
        ],
        compute: function() {
            throw Error("Not Implemented Error!");
        },
        _walkQuery: function(query) {
            for (var i = 0; i < this._activeVisitors.length; i++) {
                var visitor = this._visitors[this._activeVisitors[i]];
                for (var left in clone(query, {})) {
                    var right = query[left];
                    if (visitor.accept(this, left, right)) {
                        visitor.visit(this, left, right, query);
                    }
                }
            }
            return query;
        },
        _walkQueryPromisable: function(query) {
            query = this._walkQuery(query);
            if (this._promises.length) {
                return Promise.all(this._promises).then(function() {
                    // Handle the query again?
                    return query;
                });
            } else {
                return query;
            }
        }
    };


    function PrepareQuery(queryEngine, query) {
        AbstractQueryWalker.call(this, queryEngine, query);
    }
    PrepareQuery.prototype = clone({
        constructor: PrepareQuery,
        _visitors: clone(AbstractQueryWalker.prototype._visitors, {
            operatorInShortForm: {
                accept: function(owner, left, right) {
                    return !owner._queryEngine.has(left);
                },
                visit: function(owner, left, right, query) {
                    if (typeof right === "function") {
                        query[left] = {'$callable': right};
                    } else if (!isPlainObject(right)) {
                        query[left] = {'$eq': right};
                    }
                }
            }
        }),
        _activeVisitors: [
            'operatorInShortForm',
            'compoundOperator',
            'nestedQuery',
            'promisedOperand'
        ],
        compute: function() {
            return this._walkQueryPromisable(this._query);
        }
    }, Object.create(AbstractQueryWalker.prototype));


    function PrepareRelationalQuery(queryEngine, query, store) {
        AbstractQueryWalker.call(this, queryEngine, query);
        this._store = store;
        this._subjects = [];
    }
    PrepareRelationalQuery.prototype = clone({
        constructor: PrepareRelationalQuery,
        _visitors: clone(AbstractQueryWalker.prototype._visitors, {
            relationInShorForm: {
                accept: function(owner, left, right) {  // relation by dot
                    return left.indexOf('.') > -1 && owner._store.getRelation(left.split('.')[0]);
                },
                visit: function(owner, left, right, query) {
                    delete query[left];
                    var leftParts = left.split('.');
                    left = leftParts.shift();
                    var rightPart = {};
                    rightPart[leftParts.join('.')] = right;
                    right = {'$rel': rightPart};
                    query[left] = right;
                }
            },
            valueIsModelInstance: {
                accept: function(owner, left, right) {  // relation by instance of model
                    return isModelInstance(right) && owner._store.getRelation(left);
                },
                visit: function(owner, left, right, query) {
                    delete query[left];
                    var relation = owner._store.getRelation(left);
                    clone(relation.getQuery(right), query);
                    /*
                    var relatedField = relation.getRelatedField();
                    var relatedValue = relation.getRelatedValue(right);
                    var rightPart = {};
                    for (var i = 0; i < relatedField.length; i++) {
                        rightPart[relatedField[i]] = relatedValue[i];
                    }
                    right = {'$rel': rightPart};
                    query[left] = right;
                    */
                }
            },
            emulatedRelation: {
                accept: function(owner, left, right) {
                    return isPlainObject(right) && '$rel' in right && !owner._queryEngine.has('$rel');
                },
                visit: function(owner, left, right, query) {
                    delete query[left];
                    var andClause = [];
                    for (var opName in right) {
                        var relatedQuery = right[opName];
                        var relationName = left;
                        if (relationName in owner._store.relations.foreignKey) {
                            andClause.push(this._emulateRelation(owner, relationName, relatedQuery));
                        } else if (relationName in owner._store.relations.oneToMany) {
                            andClause.push(this._emulateRelation(owner, relationName, relatedQuery));
                        } else if (relationName in owner._store.relations.manyToMany) {
                            andClause.push(this._emulateM2mRelation(owner, relationName, relatedQuery));
                        } else {
                            throw Error('Unknown relation: ' + relationName);
                        }
                    }
                    query['$and'] = andClause;
                },
                _emulateM2mRelation: function(owner, relationName, relatedQuery) {
                    var m2mRelation = owner._store.relations.manyToMany[relationName];
                    var relatedStore = m2mRelation.getRelatedStore();
                    var relatedRelation = relatedStore.relations.oneToMany[m2mRelation.relatedRelation];
                    var query = {};
                    query[relatedRelation.relatedName] = {'$rel': relatedQuery};
                    return this._emulateRelation(owner, m2mRelation.relation, query);  // 'o2m'
                },
                _emulateRelation: function(owner, relationName, relatedQuery) {
                    var relation = owner._store.getRelation(relationName);
                    var relatedStore = relation.getRelatedStore();
                    var relatedQueryResult = relatedStore.find(relatedQuery);
                    return when(relatedQueryResult, function(relatedQueryResult) {
                        owner._subjects.push(relatedQueryResult);

                        var makeOrClause = function () {
                            var orQuery = [];
                            for (var i = 0; i < relatedQueryResult.length; i++) {
                                orQuery.push(relation.getQuery(relatedQueryResult[i]));
                            }
                            // TODO: remove duplicates from orQuery for case of o2m
                            return orQuery;
                        };
                        var disposable;
                        var query = {'$or': makeOrClause()};

                        var deco = function(func) {
                            return function(enable) {
                                var result = func.call(this, enable);
                                if (enable === false) {
                                    disposable.dispose();
                                } else {
                                    disposable = this.observed().attach(['add', 'update', 'delete'], function(aspect, obj) {
                                        query['$or'] = makeOrClause(); // Immutable query and functional walker are impossible!
                                    });
                                }
                                return result;
                            };
                        };
                        relatedQueryResult.observe = deco(relatedQueryResult.observe);
                        return query;
                    });
                }
            }
        }),
        _activeVisitors: [
            'relationInShorForm',
            'valueIsModelInstance',
            'emulatedRelation',
            'compoundOperator',
            'nestedQuery',
            'promisedOperand'
        ],
        compute: function() {
            var self = this;
            return when(this._walkQueryPromisable(this._query), function(query) {
                if (!('$subjects' in query)) {
                    query['$subjects'] = [];
                }
                Array.prototype.push.apply(query['$subjects'], self._subjects);
                return query;
            });
        }
    }, Object.create(AbstractQueryWalker.prototype));


    function GetInitObjectList(queryEngine, query, memoryStore) {
        AbstractQueryWalker.call(this, queryEngine, query);
        this._memoryStore = memoryStore;
        this._indexes = [];
        this._indexIsPossible = true;
    }
    GetInitObjectList.prototype = clone({
        constructor: GetInitObjectList,
        _visitors: clone(AbstractQueryWalker.prototype._visitors, {
            possibilityOfIndexUsage: {
                accept: function(owner, left, right) {
                    return owner._queryEngine.has(left) && ['$eq', '$and'].indexOf(left) === -1;
                },
                visit: function(owner, left, right, query) {
                    owner._indexIsPossible = false;
                }
            },
            index: {
                accept: function(owner, left, right) {
                    // Index can't to work with $or, $in and $callable.
                    // TODO: It's possible to optimize and check only first level of query object.
                    return isPlainObject(right) && '$eq' in right && left in owner._memoryStore.indexes;
                },
                visit: function(owner, left, right, query) {
                    owner._indexes.push([left, '$eq', right['$eq']]);
                }
            }
        }),
        _activeVisitors: [
            'compoundOperator',
            'nestedQuery',
            'possibilityOfIndexUsage',
            'index'
        ],
        compute: function() {
            this._walkQuery(this._query);
            return this._getObjectList();
        },
        _walkQuery: function(query) {
            for (var i = 0; i < this._activeVisitors.length; i++) {
                var visitor = this._visitors[this._activeVisitors[i]];
                for (var left in query) {  // Don't need to clone
                    var right = query[left];
                    if (visitor.accept(this, left, right)) {
                        visitor.visit(this, left, right, query);
                    }
                }
            }
            return query;
        },
        _findBestIndex: function() {
            var indexes = [];
            for (var i = 0; i < this._indexes.length; i++) {
                var field = this._indexes[i][0],
                    opName = this._indexes[i][1],
                    value = this._indexes[i][2];
                var indexValue = new IndexFinder(this._memoryStore)[opName](field, value);
                if (typeof indexValue !== "undefined") {
                    indexes.push(indexValue);
                }
            }
            if (!indexes.length) {
                return null;
            }
            indexes.sort(function(a, b) { return a.length - b.length; });
            return indexes[0];
        },
        _getObjectList: function() {
            // console.debug(this._indexIsPossible, this._indexes, this._query, this._memoryStore.indexes);
            if (this._indexIsPossible) {
                var bestIndex = this._findBestIndex();
                if (bestIndex !== null) {
                    // console.debug('!!!!!', bestIndex);
                    if (bestIndex.length && (bestIndex.length / bestIndex.length) < 2) {
                        return bestIndex;
                    }
                }
            }
            return this._memoryStore.objectList;
        }
    }, Object.create(AbstractQueryWalker.prototype));


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


    function Compose(store, obj, state) {
        this._store = store;
        this._obj = obj;
        this._state = state || new State();

    }
    Compose.prototype = {
        constructor: Compose,
        compute: function() {
            var self = this;
            if (this._state.isVisited(this._store, this._obj)) { return; }  // It's circular references. Skip it.
            this._state.visit(this._store, this._obj);
            return when(this._handleOneToMany(), function() {
                return self._handleManyToMany();
            });
        },
        _handleOneToMany: function() {
            var self = this;
            return whenIter(keys(this._store.relations.oneToMany), function(relationName) {
                if (self._store.relationIsUsedByM2m(relationName)) {
                    return;
                }
                var relation = self._store.relations.oneToMany[relationName];
                var relatedStore = relation.getRelatedStore();
                var relatedQueryResult = relatedStore.find(relation.getRelatedQuery(self._obj));
                return when(relatedQueryResult, function(relatedQueryResult) {
                    self._obj[relationName] = relatedQueryResult;
                    return whenIter(relatedQueryResult, function(relatedObj) {
                        return self._handleRelatedObj(relatedStore, relatedObj);
                    });
                });
            });
        },
        _handleRelatedObj: function(relatedStore, relatedObj) {
            return relatedStore.compose(relatedObj, this._state);

        },
        _handleManyToMany: function() {
            var self = this;
            return whenIter(keys(this._store.relations.manyToMany), function(relationName) {
                var m2mRelation = self._store.relations.manyToMany[relationName];
                var relatedStore = m2mRelation.getRelatedStore();
                var relatedQueryResult = self._obj[relationName] = relatedStore.find(m2mRelation.getRelatedQuery(self._obj));
                return when(relatedQueryResult, function(relatedQueryResult) {
                    self._obj[relationName] = relatedQueryResult;
                    return whenIter(relatedQueryResult, function(relatedObj) {
                        return self._handleRelatedObj(relatedStore, relatedObj);
                    });
                });
            });
        }
    };


    function Decompose(store, obj) {
        this._store = store;
        this._obj = obj;
    }
    Decompose.prototype = {
        constructor: Decompose,
        compute: function() {
            var self = this;
            return when(self._handleForeignKey(), function() {
                return when(self._store.getLocalStore().add(self._obj), function(obj) {
                    self._obj = obj;
                    return when(self._handleOneToMany(), function() {
                        return when(self._handleManyToMany(), function() {
                            return self._obj;
                        });
                    });
                });
            });
        },
        _handleForeignKey: function() {
            var self = this;
            return whenIter(keys(this._store.relations.foreignKey), function(relationName) {
                var relation = self._store.relations.foreignKey[relationName];
                var relatedStore = relation.getRelatedStore();
                var relatedObj = self._obj[relationName];
                if (relatedObj && typeof relatedObj === "object") {
                    self._setForeignKeyToRelatedObj(relatedObj, relation.getRelatedRelation(), self._obj);
                    return when(self._handleRelatedObj(relatedStore, relatedObj), function(relatedObj) {
                        self._obj[relationName] = relatedObj;
                    });
                }
            });
        },
        _handleOneToMany: function() {
            var self = this;
            return whenIter(keys(this._store.relations.oneToMany), function(relationName) {
                if (self._store.relationIsUsedByM2m(relationName)) {
                    return;
                }
                var relation = self._store.relations.oneToMany[relationName];
                var relatedStore = relation.getRelatedStore();
                var relatedObjectList = self._obj[relationName] || [];
                return whenIter(relatedObjectList, function(relatedObj, i) {
                    self._setForeignKeyToRelatedObj(self._obj, relation, relatedObj);
                    return when(self._handleRelatedObj(relatedStore, relatedObj), function(relatedObj) {
                        relatedObjectList[i] = relatedObj;
                    });
                });
            });
        },
        _setForeignKeyToRelatedObj: function(obj, relation, relatedObj) {
            var value = relation.getValue(obj);
            var relatedField = relation.getRelatedField();
            for (var i = 0; i < relatedField.length; i++) {
                if (typeof relatedObj[relatedField[i]] === "undefined") {
                    relatedObj[relatedField[i]] = value[i];
                } else if (relatedObj[relatedField[i]] !== value[i]) {
                    throw Error("Uncorrect value of Foreigh Key!");
                }
            }
        },
        _handleRelatedObj: function(relatedStore, relatedObj) {
            try {
                relatedObj = relatedStore.decompose(relatedObj);
            } catch (e) {
                if (e instanceof ObjectAlreadyLoaded) {
                    // Make object to be single instance;
                    return relatedStore.get(relatedStore.getObjectAccessor().getPk(relatedObj));
                } else {
                    throw e;
                }
            }
            return relatedObj;
        },
        _handleManyToMany: function() {
            var self = this;
            return whenIter(keys(this._store.relations.manyToMany), function(relationName) {
                var m2mRelation = self._store.relations.manyToMany[relationName];
                var relatedStore = m2mRelation.getRelatedStore();
                var relatedObjectList = self._obj[relationName] || [];
                return whenIter(relatedObjectList, function(relatedObj, i) {
                    return when(self._handleRelatedObj(relatedStore, relatedObj), function(relatedObj) {
                        relatedObjectList[i] = relatedObj;
                        return self._addManyToManyRelation(m2mRelation, relatedObj);
                    });
                });
            });
        },
        _addManyToManyRelation: function(m2mRelation, relatedObj) {
            var relation = this._store.relations.oneToMany[m2mRelation.relation];
            var m2mStore = relation.getRelatedStore();
            var relatedStore = m2mRelation.getRelatedStore();
            var relatedRelation = relatedStore.relations.oneToMany[m2mRelation.relatedRelation];
            var value = relation.getValue(this._obj);
            var relatedValue = relatedRelation.getValue(relatedObj);

            var m2mObject = {};
            var toRelatedField = relatedRelation.getRelatedField();
            for (var i = 0; i < toRelatedField.length; i++) {
                m2mObject[toRelatedField[i]] = relatedValue[i];
            }
            var fromRelatedField = relation.getRelatedField();
            for (var i = 0; i < fromRelatedField.length; i++) {
                m2mObject[fromRelatedField[i]] = value[i];
            }
            var query = clone(relation.getRelatedQuery(this._obj),
                              relatedRelation.getRelatedQuery(relatedObj));
            if (!m2mStore.findList(query).length) {  // Prevent duplicates for bidirectional m2m.
                return m2mStore.getLocalStore().add(m2mObject);
            }
        }
    };


    function State() {
        this._visited = {};
        this._stack = [];
    };
    State.prototype = {
        constructor: State,
        visit: function(store, obj) {
            this._visited[this.getObjectUniqId(store, obj)] = obj;
        },
        isVisited: function(store, obj) {
            return this.getObjectUniqId(store, obj) in this._visited;
        },
        getObjectUniqId: function(store, obj) {
            return [store.getName(), store.getObjectAccessor().getPk(obj)];
        },
        push: function(attr, newValue) {
            var oldValue = this[attr];
            this._stack.push([attr, oldValue]);
            if (typeof newValue === "undefined") {
                newValue = clone(oldValue);
            }
            this[attr] = newValue;
            return oldValue;
        },
        pop: function() {
            var data = this._stack.pop();
            this[data[0]] = data[1];
        }
    };


    function Result(subject, reproducer, filter, objectList, relatedSubjects) {
        this._subject = subject;
        this._reproducer = reproducer;
        this._filter = filter;
        this._initObjectList = Array.prototype.slice.call(objectList);
        this._localReproducers = [];
        this._relatedSubjects = relatedSubjects || [];
        this._disposable = new CompositeDisposable();
        this._setState(objectList);
        observe(this, 'observed', DummyResultObservable);
    }

    Result.wrapProcedure = function(name) {
        return function() {
            var self = this,
                selfArguments = arguments;
            this._localReproducers.push(function(list) {
                Array.prototype[name].apply(list, selfArguments);
                return list;
            });
            var returnValue = Array.prototype[name].apply(this, arguments);
            this.observed().notify(name, arguments, returnValue);
            return returnValue;
        };
    };


    Result.wrapMethod = function(name) {
        return function() {
            var self = this,
                selfArguments = arguments;
            var child = new SubResult(
                this,
                function() {
                    return Array.prototype[name].apply(self, selfArguments);
                },
                (name === 'filter' ? arguments[0] : function(obj) { return true; }),
                Array.prototype[name].apply(this, arguments)
            );
            return child;
        };
    };


    Result.observedMethods = ['filter', 'slice'];
    Result.observedProcedures = ['sort', 'push', 'shift', 'unshift'];


    Result.prototype = clone({
        constructor: Result,
        observe: function(enable) {
            if (enable === false) {
                this._disposable.dispose();
                this._disposable = new CompositeDisposable();

            } else if (!this.observed().isObservable()) {
                for (var i = 0; i < this._relatedSubjects.length; i++) {
                    if (!this._relatedSubjects[i].observed().isObservable()) {
                        this._relatedSubjects[i].observe(enable);
                    }
                };
                observe(this, 'observed', ResultObservable);
                var self = this;

                this._disposable = this._disposable.add(
                    this._subject.observed().attach(['add'], function(aspect, obj, index) {
                        if (self.indexOf(obj) !== -1) { return; }
                        if (self._filter(obj)) {
                            var objectList = self._initObjectList;
                            if (typeof index === "undefined") { index = objectList.length; }
                            objectList.splice(index, 0, obj);
                            objectList = Array.prototype.slice.call(objectList);
                            for (var i = 0; i < self._localReproducers.length; i++) {
                                objectList = self._localReproducers[i](objectList);
                            }
                            self._setState(objectList);
                            self.observed().notify('add', obj, objectList.indexOf(obj));
                        }
                    })
                );

                this._disposable = this._disposable.add(
                    this._subject.observed().attach(['update'], function(aspect, obj, old) {
                        var index = self.indexOf(obj);
                        if (index !== -1) {
                            if (self._filter(obj)) {
                                self.observed().notify('update', obj, old);
                            } else {
                                self._initObjectList.splice(self._initObjectList.indexOf(obj), 1);
                                Array.prototype.splice.call(self, index, 1);
                                self.observed().notify('delete', obj, index);
                            }
                        } else {
                            if (self._filter(obj)) {
                                var objectList = self._initObjectList;
                                objectList.splice(objectList.length, 0, obj);
                                objectList = Array.prototype.slice.call(objectList);
                                for (var i = 0; i < self._localReproducers.length; i++) {
                                    objectList = self._localReproducers[i](objectList);
                                }
                                self._setState(objectList);
                                self.observed().notify('add', obj, index);
                            }
                        }
                    })
                );

                this._disposable = this._disposable.add(
                    this._subject.observed().attach(['delete'], function(aspect, obj, index) {
                        var index = self.indexOf(obj);
                        if (index !== -1) {
                            self._initObjectList.splice(self._initObjectList.indexOf(obj), 1);
                            Array.prototype.splice.call(self, index, 1);
                            self.observed().notify('delete', obj, index);
                        }
                    })
                );

                this.broadObserver = function() {
                    var newObjectList = Array.prototype.slice.call(self._reproducer());
                    for (var i = 0; i < self._localReproducers.length; i++) {
                        newObjectList = self._localReproducers[i](newObjectList);
                    }
                    var deleted = Array.prototype.filter.call(self, function(i) { return newObjectList.indexOf(i) === -1; });
                    var added = Array.prototype.filter.call(newObjectList, function(i) { return self.indexOf(i) === -1; });
                    self._setState(newObjectList);
                    for (var i = 0; i < deleted.length; i++) {
                        self.observed().notify('delete', deleted[i], newObjectList.indexOf(deleted[i]));
                    };
                    for (var i = 0; i < added.length; i++) {
                        self.observed().notify('add', added[i], newObjectList.indexOf(added[i]));
                    };

                };

                /* this._disposable = this._disposable.add(
                    this._subject.observed().attach(['add', 'update', 'delete'], this.broadObserver)
                );
                this._disposable = this._disposable.add(
                    this._subject.observed().attach('update', function(aspect, obj, old) {
                    if (self.indexOf(obj) !== -1) {
                        self.observed().notify('update', obj, old);
                    }
                })); */

                for (var i = 0; i < self._relatedSubjects.length; i++) {
                    this._disposable = this._disposable.add(
                        self._relatedSubjects[i].observed().attach(
                            ['add', 'update', 'delete'], self.broadObserver
                        )
                    );
                };
            }
            return this;
        },
        addRelatedSubject: function(relatedSubject) {
            this._relatedSubjects.push(relatedSubject);
            if (this.observed().isObservable()) {
                this._disposable = this._disposable.add(
                    relatedSubject.observed().attach(['add', 'update', 'delete'], this.broadObserver)
                );
            }
            return this;
        },
        getRelatedSubjects: function() {
            return this._relatedSubjects.slice();
        },
        reduce: function(callback, initValue) {
            var accumValue;
            var objectList = this.slice();
            if (typeof initValue !== "undefined") {
                accumValue = initValue;
            } else {
                accumValue = objectList.unshift();
            }
            for (var i = 0; i < objectList.length; i++) {
                accumValue = callback(accumValue, objectList[i]);
            }
            return accumValue;
        },
        forEach: function(callback, thisArg) {  // Do not change signature of parent class
            Array.prototype.forEach.apply(this, arguments);
            this._disposable = this._disposable.add(
                this.observed().attach('add', function(aspect, obj) {
                    callback(obj);
                })
            );
        },
        forEachByAttr: function(attr, defaultValue, observer) {
            var attrs = toArray(attr);
            this._disposable = this._disposable.add(
                this.observed().attachByAttr(attrs, defaultValue, observer)
            );
            for (var i = 0; i < this.length; i++) {
                // Don't use Result.prototype.forEach() insted, it'll add observer on load
                var obj = this[i];
                var objObservable = new Observable(obj);
                objObservable.attach(attrs, observer);
                for (var j = 0; j < attrs.length; j++) {
                    var attr = attrs[j];
                    objObservable.notify(attr, defaultValue, obj[attr]);
                }
            }
            return this;
        },
        _setState: function(list) {
            Array.prototype.splice.call(this, 0, Number.MAX_VALUE);
            for (var i = 0; i < list.length; i++) {
                Array.prototype.push.call(this, list[i]);
            }
        },
        toArray: function() {
            return Array.prototype.slice.call(this);
        },
        toJSON: function() {
            return JSON.stringify(this.toArray());
        }
    }, Object.create(Array.prototype));
    for (var i = 0; i < Result.observedMethods.length; i++) {
        Result.prototype[Result.observedMethods[i]] = Result.wrapMethod(Result.observedMethods[i]);
    }
    for (var i = 0; i < Result.observedProcedures.length; i++) {
        Result.prototype[Result.observedProcedures[i]] = Result.wrapProcedure(Result.observedProcedures[i]);
    }


    function SubResult(subject, reproducer, filter, objectList, relatedSubjects) {
        Result.apply(this, arguments);
        if (subject.observed().isObservable()) {
            this.observe();
        }
    }
    SubResult.prototype = clone({
        constructor: SubResult,
        observe: function(enable) {
            if (enable === false) {
                Result.prototype.observe.call(this, enable);
            } else if (!this.observed().isObservable()) {
                this._subject.observe(enable);
                Result.prototype.observe.call(this, enable);
                var self = this;
                for (var i = 0; i < Result.observedProcedures.length; i++) {
                    this._disposable = this._disposable.add(
                        this._subject.observed().attach(Result.observedProcedures[i], function(aspect, obj) {
                            var newObjectList = self._reproducer();
                            self._setState(newObjectList);
                            self.observed().notify(aspect, obj);
                        })
                    );
                }
            }
            return this.observed();
        }
    }, Object.create(Result.prototype));


    function AbstractLeafStore(pkOrObjectAccessor, modelOrMapper) {
        AbstractStore.call(this);
        if (!modelOrMapper) {
            this._mapper = new Mapper();
        } else if (modelOrMapper instanceof Mapper) {
            this._mapper = modelOrMapper;
        } else {
            this._mapper = new Mapper({model: modelOrMapper});
        }
        pkOrObjectAccessor = pkOrObjectAccessor || 'id';
        this._objectAccessor = pkOrObjectAccessor instanceof ObjectAccessor ? pkOrObjectAccessor : new ObjectAccessor(pkOrObjectAccessor);
        this._objectStateMapping = {};
    }
    AbstractLeafStore.prototype = clone({
        constructor: AbstractLeafStore,
        _queryEngine: undefined,
        setNextPk: function(obj) {},
        getQueryEngine: function() {
            return this._queryEngine;
        },
        restoreInstance: function(record) {
            var obj = this._mapper.isLoaded(record) ? record : this._mapper.load(record);
            this._setInitObjectState(obj);
            return obj;
        },
        getInitObjectState: function(obj) {
            var oid = this._getObjectId(obj);
            return this._objectStateMapping[oid];
        },
        _setInitObjectState: function(obj) {
            this._objectStateMapping[this._getObjectId(obj)] = this.getObjectAccessor().getObjectState(obj);
        },
        _delInitObjectState: function(obj) {
            delete this._objectStateMapping[this._getObjectId(obj)];
        },
        _getObjectId: function(obj) {
            // The idea from PostgreSQL
            if (!('__oid' in obj)) {
                obj.__oid = this._getNextObjectId();
            }
            return obj.__oid;
        },
        _getNextObjectId: function() {
            AbstractLeafStore._oidCounter || (AbstractLeafStore._oidCounter = 0);
            return ++AbstractLeafStore._oidCounter;
        },
        getObjectAccessor: function() {
            return this._objectAccessor;
        },
        syncDependencies: function(obj, old) {
        },
        _prepareQuery: function(queryEngine, query) {
            return new PrepareQuery(queryEngine, query).compute();
        },
        _makeResult: function(reproducer, filter, objectList, subjects) {
            return new Result(this, reproducer, filter, objectList, subjects);
        },
        get: function(pkOrQuery) {
            if ((typeof pkOrQuery !== "object") || (pkOrQuery instanceof Array)) {
                return this._get(pkOrQuery);
            }
            return this.findList(pkOrQuery)[0];
        },
        _get: function(pk) {
            throw Error("Not Implemented Error");
        },
        find: function(query, options) {
            var self = this;
            typeof query === "undefined" && (query = {});
            return when(this._prepareQuery(this._queryEngine, query), function(query) {
                return when(self._find(query, options), function(objectList) {
                    return self._makeResult(
                        function() {
                            return self.find(query);
                        },
                        function(obj) {
                            return simpleQueryEngine.execute(query, self.getObjectAccessor(), obj);
                        },
                        objectList,
                        query['$subjects']
                    );
                });
            });
        },
        findList: function(query, options) {
            var self = this;
            typeof query === "undefined" && (query = {});
            return when(this._prepareQuery(this._queryEngine, query), function(query) {
                return self._find(query, options);
            });
        },
        _find: function(query, options) {
            return Promise.resolve([]);
        },
        add: function(obj, state) {
            this.setNextPk(obj);
            this._setInitObjectState(obj);
            return Promise.resolve(obj);
        },
        update: function(obj, state) {
            var old = this.getInitObjectState(obj);
            this._setInitObjectState(obj);
            return Promise.resolve(obj);
        },
        delete: function(obj, state) {
            this._delInitObjectState(obj);
            return Promise.resolve(obj);
        },
        decompose: function(record) {
            record = this.restoreInstance(record);
            return this.add(record);
        },
        clean: function() {
            clean(this._objectStateMapping);
        }
    }, Object.create(AbstractStore.prototype));


    function MemoryStore(pkOrObjectAccessor, indexes, modelOrMapper) {
        AbstractLeafStore.call(this, pkOrObjectAccessor, modelOrMapper);
        this.objectList = [];
        this.pkIndex = {};
        this.indexes = {};
        indexes || (indexes = []);
        var pkFields = toArray(this.getObjectAccessor().pk);
        for (var i = 0; i < pkFields.length; i++) {
            if (!(pkFields[i] in indexes)) { indexes[pkFields[i]] = {}; }
        }
        for (var i = 0; i < indexes.length; i++) {
            this.indexes[indexes[i]] = {};
        }
    }
    MemoryStore.prototype = clone({
        constructor: MemoryStore,
        _queryEngine: simpleQueryEngine,
        add: function(obj, state) {
            obj = this.restoreInstance(obj);
            if (!this.getObjectAccessor().pkExists(obj)) {
                this.setNextPk(obj);
                if (!this.getObjectAccessor().pkExists(obj)) {
                    throw new PkRequired();
                }
            }
            var pkValue = this.getObjectAccessor().getPk(obj);
            if (pkValue in this.pkIndex) {
                if (this.pkIndex[pkValue] !== obj) {
                    throw new ObjectAlreadyLoaded();
                } else {
                    return this.pkIndex[pkValue];
                }
            }
            this.objectList.push(obj);
            this._indexObj(obj);
            this._setInitObjectState(obj);
            return obj;
        },
        update: function(obj, state) {
            var old = this.getInitObjectState(obj);
            this._reindexObj(old, obj);
            this._setInitObjectState(obj);
            return obj;
        },
        delete: function(obj, state) {
            delete this.pkIndex[this.getObjectAccessor().getPk(obj)];
            this.objectList.splice(this.objectList.indexOf(obj), 1);
            for (var field in this.indexes) {
                var value = obj[field];
                arrayRemove(this.indexes[field][value], obj);
            }
            this._delInitObjectState(obj);
            return obj;
        },
        _get: function(pk) {
            return this.pkIndex[pk];
        },
        _find: function(query, options) {
            var self = this;
            var initObjectList = self._getInitObjectList(query);
            return initObjectList.filter(function(obj) {
                return !query['$query'] || self._queryEngine.execute(query, self.getObjectAccessor(), obj);
            });
        },
        _getInitObjectList: function(query) {
            return new GetInitObjectList(this._queryEngine, query, this).compute();
        },
        clean: function() {
            clean(this.objectList);
            this._resetIndexes();
            AbstractLeafStore.prototype.clean.call(this);
        },
        _resetIndexes: function() {
            clean(this.pkIndex);
            for (var key in this.indexes) {
                clean(this.indexes[key]);
            }
        },
        _reloadIndexes: function() {
            this._resetIndexes();
            for (var i in this.objectList) {
                this._indexObj(this.objectList[i]);
            }
        },
        _indexObj: function(obj) {
            this.pkIndex[this.getObjectAccessor().getPk(obj)] = obj;
            for (var field in this.indexes) {
                var value = obj[field];
                if (!(value in this.indexes[field])) {
                    this.indexes[field][value] = [];
                };
                assert(this.indexes[field][value].indexOf(obj) === -1);
                this.indexes[field][value].push(obj);
            }
        },
        _reindexObj: function(old, obj) {
            var self = this;
            if (this.getObjectAccessor().getPk(old) !== this.getObjectAccessor().getPk(obj)) {
                delete this.pkIndex[this.getObjectAccessor().getPk(old)];
                this.pkIndex[this.getObjectAccessor().getPk(obj)] = obj;
            }
            for (var field in this.indexes) {
                var oldValue = old[field],
                    value = obj[field],
                    index = this.indexes[field];
                if (toString(oldValue) !== toString(value)) {
                    if (!(value in index)) {
                        index[value] = [];
                    };
                    assert(index[value].indexOf(obj) === -1);
                    arrayRemove(index[oldValue], obj);
                    index[value].push(obj);
                    index[value].sort(function(a, b) {
                        return self.objectList.indexOf(a) - self.objectList.indexOf(b);
                    });
                }
            }
        }
    }, Object.create(AbstractLeafStore.prototype));


    function RestStore(options) {
        options = options || {};
        AbstractLeafStore.call(this, options.objectAccessor || options.pk, options.mapper || options.model);
        this._url = options.url;
        this._jQuery = options.jQuery || window.jQuery;
        this._requestOptions = options.requestOptions || {};
    }
    RestStore.prototype = clone({
        constructor: RestStore,
        _queryEngine: djangoFilterQueryEngine,
        _get: function(pk) {
            var self = this;
            return new Promise(function(resolve, reject) {
                self._jQuery.ajax(clone(self._requestOptions, {
                    url: self._getUrl(pk),
                    type: 'GET',
                    success: function(obj) {
                        resolve(obj);
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        reject();
                    }
                }));
            }).then(function(obj) {
                return self.restoreInstance(obj);
            });

        },
        _find: function(query, options) {
            var self = this;
            typeof query === "undefined" && (query = {});
            return new Promise(function(resolve, reject) {
                self._jQuery.ajax(clone(self._requestOptions, {
                    url: self._getUrl(),
                    type: 'GET',
                    data: query,
                    success: function(objectList) {
                        resolve(objectList);
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        reject();
                    }
                }));
            }).then(function(objectList) {
                for (var i = 0; i < objectList.length; i++) {
                    objectList[i] = self.restoreInstance(objectList[i]);
                }
                return objectList;
            });
        },
        add: function(obj, state) {
            var self = this;
            return new Promise(function(resolve, reject) {
                self._jQuery.ajax(clone(self._requestOptions, {
                    url: self._getUrl(),
                    type: 'POST',
                    dataType: 'json',
                    contentType: 'application/json',
                    data: self._serialize(self._mapper.unload(obj)),
                    success: function(response) {
                        resolve(response);
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        reject();
                    }
                }));
            }).then(function(response) {
                clone(self._mapper.load(response), obj, self.getObjectAccessor().setter);
                self._setInitObjectState(obj);
                return obj;
            });
        },
        update: function(obj, state) {
            var self = this;
            return new Promise(function(resolve, reject) {
                self._jQuery.ajax(clone(self._requestOptions, {
                    url: self._getUrl(self.getObjectAccessor().getPk(obj)),
                    type: 'PUT',
                    dataType: 'json',
                    contentType: 'application/json',
                    data: self._serialize(self._mapper.unload(obj)),
                    success: function(response) {
                        resolve(response);
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        reject();
                    }
                }));
            }).then(function(response) {
                clone(self._mapper.load(response), obj, self.getObjectAccessor().setter);
                self._setInitObjectState(obj);
                return obj;
            });
        },
        delete: function(obj, state) {
            var self = this;
            return new Promise(function(resolve, reject) {
                self._jQuery.ajax(clone(self._requestOptions, {
                    url: self._getUrl(self.getObjectAccessor().getPk(obj)),
                    type: 'DELETE',
                    success: function(response) {
                        resolve(obj);
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        reject();
                    }
                }));
            }).then(function(obj) {
                this._delInitObjectState(obj);
                return obj;
            });
        },
        _getUrl: function(pk) {
            if (typeof pk === "undefined") {
                return this._url;
            }
            pk = toArray(pk);
            return this._url + '/' + pk.join('/');
        },
        _serialize: function(obj) {
            return JSON.stringify(obj);
        }
    }, Object.create(AbstractLeafStore.prototype));


    function DummyStore(pk) {
        AbstractLeafStore.call(this, pk);
    }
    DummyStore.prototype = clone({
        constructor: DummyStore
    }, Object.create(AbstractLeafStore.prototype));


    function AutoIncrementStore(pk) {
        DummyStore.call(this, pk);
        this._counter = 0;
    }
    AutoIncrementStore.prototype = clone({
        constructor: AutoIncrementStore,
        setNextPk: function(obj) {
            this.getObjectAccessor().setPk(obj, ++this._counter);
        }
    }, Object.create(DummyStore.prototype));


    function DefaultModel(attrs) { clone(attrs, this); }


    function Mapper(options) {
        options = options || {};
        this._model = options.model || DefaultModel;
        this._mapping = options.mapping || {};
        this._reverseMapping = this.makeReverseMapping(this._mapping);
    }
    Mapper.prototype = {
        constructor: Mapper,
        makeReverseMapping: function(mapping) {
            var reverseMapping = {};
            for (var key in mapping) {
                if (mapping.hasOwnProperty(key)) {
                    reverseMapping[mapping[key]] = key;
                }
            }
            return reverseMapping;
        },
        load: function(record) {
            var data = {};
            for (var key in record) {
                if (record.hasOwnProperty(key)) {
                    data[this._reverseMapping[key] || key] = record[key];
                }
            }
            return new this._model(data);
        },
        isLoaded: function(recordOrObj) {
            return recordOrObj instanceof this._model;
        },
        unload: function(obj) {
            var record = {};
            for (var key in obj) {
                if (obj.hasOwnProperty(key)) {
                    record[this._mapping[key] || key] = obj[key];
                }
            }
            return record;
        }
    };


    function Registry(parent) {
        observe(this, 'observed');
        this._stores = {};
        this._local_stores = {};
        this._parents = [];
        this._children = [];
        this.transaction = new TransactionManager(this);
        if (parent) {
            Array.prototype.push.apply(this._parents, parent._parent);
            this._parents.push(parent);
            parent._children.push(this);
        }
    }
    Registry.prototype = {
        constructor: Registry,
        register: function(name, store) {
            this._local_stores[name] = store;
            this._updateCache();
            store.register(name, this);
            this.observed().notify('register', store);
        },
        _updateCache: function() {
            for (var i = 0; i < this._parents.length; i++) {
                var parent = this._parents[i];
                clone(parent._local_stores, this._stores);
            }
            clone(this._local_stores, this._stores);
            for (var i = 0; i < this._children.length; i++) {
                var child = this._children[i];
                child._updateCache();
            }
        },
        has: function(name) {
            return name in this._stores;
        },
        get: function(name) {
            /* if (this._parents.length) {
                return this._stores[name].bind(this);
            } */
            return this._stores[name];
        },
        getStores: function() {
            return clone(this._stores, {});
        },
        keys: function() {
            var r = [];
            for (var name in this._stores) {
                if (!this.isStore(name)) { continue };
                r.push(name);
            }
            return r;
        },
        ready: function() {
            this.observed().notify('ready');
        },
        begin: function() {
            this.transaction.begin();
            this.observed().notify('begin');
        },
        commit: function() {
            var self = this;
            return this.transaction.commit().then(function() {
                self.observed().notify('commit');
            });
        },
        rollback: function() {
            var self = this;
            return this.transaction.rollback().then(function() {
                self.observed().notify('rollback');
            });
        },
        destroy: function() {
            for (var storeName in this._stores) {
                var store = this._stores[storeName];
                this.observed().notify('destroy', store);
                store.destroy();
            }
        },
        clean: function() {
            for (var storeName in this._stores) {
                var store = this._stores[storeName];
                this.observed().notify('clean', store);
                store.clean();
            }
        },
        isStore: function(attr) {
            return this._stores.hasOwnProperty(attr) && (this._stores[attr] instanceof IStore);
        },
        makeChild: function() {
            return new this.constructor(this);
        }
    };


    function TransactionManager(registry) {
        this._transaction = new NoneTransaction(registry);
    }
    TransactionManager.prototype = {
        constructor: TransactionManager,
        begin: function() {
            this._transaction = this._transaction.begin();
        },
        commit: function() {
            var self = this;
            return this._transaction.commit().then(function(transaction) {
                self._transaction = transaction;
            });
        },
        rollback: function() {
            var self = this;
            return this._transaction.rollback().then(function(transaction) {
                self._transaction = transaction;
            });
        },
        add: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            return this._transaction.add(store, obj, onCommit, onRollback, onPending, onAutocommit);
        },
        update: function(store, obj, old, onCommit, onRollback, onPending, onAutocommit) {
            return this._transaction.update(store, obj, old, onCommit, onRollback, onPending, onAutocommit);
        },
        delete: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            return this._transaction.delete(store, obj, onCommit, onRollback, onPending, onAutocommit);
        }
    };


    function AbstractTransaction(registry) {
        this._registry = registry;
    }
    AbstractTransaction.prototype = {
        constructor: AbstractTransaction,
        begin: function() {
            throw Error("Not Implemented Error!");
        },
        commit: function() {
            throw Error("Not Implemented Error!");
        },
        rollback: function() {
            throw Error("Not Implemented Error!");
        },
        add: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            throw Error("Not Implemented Error!");
        },
        update: function(store, obj, old, onCommit, onRollback, onPending, onAutocommit) {
            throw Error("Not Implemented Error!");
        },
        delete: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            throw Error("Not Implemented Error!");
        }
    };


    /*
     * Implementation of pattern Unit Of Work
     * http://martinfowler.com/eaaCatalog/unitOfWork.html
     */
    function TwoPhaseTransaction(registry, parent) {
        AbstractTransaction.call(this, registry);
        this._parent = parent;
        this._dirtyObjectList = [];
    }
    TwoPhaseTransaction.prototype = clone({
        constructor: TwoPhaseTransaction,
        begin: function() {
            return new TwoPhaseTransaction(this);
        },
        commit: function() {
            var self = this;
            this._topologicalSort();
            return new Iterator(
                this._dirtyObjectList.splice(0, Number.MAX_VALUE)
            ).onEach(function(dirty, resolve, reject) {
                dirty.commit().then(resolve, reject);
            }).iterate().then(function() {
                return self._parent;
            });
        },
        _topologicalSort: function() {
            this._dirtyObjectList.sort(function(left, right) {
                return left.compare(right);
            });
        },
        rollback: function() {
            var self = this;
            return when(whenIter(this._dirtyObjectList.splice(0, Number.MAX_VALUE), function(dirty) {
                return dirty.rollback();
            }), function() {
                return self._parent;
            });
        },
        add: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            var dirty = new AddDirty(store, obj, onCommit, onRollback, onPending, onAutocommit);
            this._dirtyObjectList.push(dirty);
            return dirty.pending();
        },
        update: function(store, obj, old, onCommit, onRollback, onPending, onAutocommit) {
            if (this._findDirty(obj) === -1) {
                var dirty = new UpdateDirty(store, obj, old, onCommit, onRollback, onPending, onAutocommit);
                this._dirtyObjectList.push(dirty);
                return dirty.pending();
            } else {
                return Promise.resolve(obj);
            }
        },
        delete: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            var index = this._findDirty(obj);
            if (index !== -1 && this._dirtyObjectList[index].cancelable()) {
                this._dirtyObjectList.splice(index, 1);
                return Promise.resolve(obj);
            } else {
                var dirty = new DeleteDirty(store, obj, onCommit, onRollback, onPending, onAutocommit);
                this._dirtyObjectList.push(dirty);
                return dirty.pending();
            }
        },
        _findDirty: function(obj) {
            for (var i = 0; i < this._dirtyObjectList.length; i++) {
                if (this._dirtyObjectList[i].hasObj(obj)) {
                    return i;
                }
            }
            return -1;
        }
    }, Object.create(AbstractTransaction.prototype));


    function AbstractDirty(store, obj, onCommit, onRollback, onPending, onAutocommit) {
        this.store = store;
        this.obj = obj;
        onCommit && (this.commit = onCommit);
        onRollback && (this.rollback = onRollback);
        this.pending = (onPending || function() { return when(obj); });
        this.autocommit = (onAutocommit || this.commit);
    }
    AbstractDirty.prototype = {
        constructor: AbstractDirty,
        hasObj: function(obj) {
            return this.obj === obj;
        },
        cancelable: function() {
            return false;
        },
        compare: function(other) {
            var weight = this.getWeight() - other.getWeight();
            if (weight !== 0) {
                return weight;
            }
            return this._doCompare(other);
        },
        getWeight: function() {
            throw Error("Not Implemented Error!");
        },
        commit: function() {
            throw Error("Not Implemented Error!");
        },
        pendind: function() {
            throw Error("Not Implemented Error!");
        },
        autocommit: function() {
            throw Error("Not Implemented Error!");
        },
        rollback: function() {
            throw Error("Not Implemented Error!");
        },
        _doCompare: function(other) {
            throw Error("Not Implemented Error!");
        },
        _compareByDependencies: function(other) {
            if (this.store === other.store) {
                return 0;
            }
            var dependencies = this.store.getDependencies();
            if (dependencies.indexOf(other.store) !== -1) {
                return 1;
            }
            var otherDependencies = this.store.getDependencies();
            if (otherDependencies.indexOf(this.store) !== -1) {
                return -1;
            }
            return 0;
        }
    };


    function AddDirty(store, obj, onCommit, onRollback, onPending, onAutocommit) {
        AbstractDirty.call(this, store, obj, onCommit, onRollback, onPending, onAutocommit);
    }
    AddDirty.prototype = clone({
        constructor: AddDirty,
        cancelable: function() {
            return true;
        },
        getWeight: function() {
            return 0;
        },
        _doCompare: function(other) {
            return this._compareByDependencies(other);
        }
    }, Object.create(AbstractDirty.prototype));


    function UpdateDirty(store, obj, old, onCommit, onRollback, onPending, onAutocommit) {
        AbstractDirty.call(this, store, obj, onCommit, onRollback, onPending, onAutocommit);
        this.old = old;
    }
    UpdateDirty.prototype = clone({
        constructor: UpdateDirty,
        getWeight: function() {
            return 1;
        },
        _doCompare: function(other) {
            return 0;
        }
    }, Object.create(AbstractDirty.prototype));


    function DeleteDirty(store, obj, onCommit, onRollback, onPending, onAutocommit) {
        AbstractDirty.call(this, store, obj, onCommit, onRollback, onPending, onAutocommit);
    }
    DeleteDirty.prototype = clone({
        constructor: DeleteDirty,
        getWeight: function() {
            return 2;
        },
        _doCompare: function(other) {
            return -1 * this._compareByDependencies(other);
        }
    }, Object.create(AbstractDirty.prototype));


    function NoneTransaction(registry) {
        AbstractTransaction.call(this, registry);
    }
    NoneTransaction.prototype = clone({
        constructor: NoneTransaction,
        begin: function() {
            return new TwoPhaseTransaction(this._registry, this);
        },
        commit: function() {
            return Promise.resolve(this);
        },
        rollback: function() {
            return Promise.resolve(this);
        },
        add: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            return new AddDirty(store, obj, onCommit, onRollback, onPending, onAutocommit).autocommit();
        },
        update: function(store, obj, old, onCommit, onRollback, onPending, onAutocommit) {
            return new UpdateDirty(store, obj, old, onCommit, onRollback, onPending, onAutocommit).autocommit();
        },
        delete: function(store, obj, onCommit, onRollback, onPending, onAutocommit) {
            return new DeleteDirty(store, obj, onCommit, onRollback, onPending, onAutocommit).autocommit();
        }
    }, Object.create(AbstractTransaction.prototype));


    /*
     * It's also possible use Mixin into object (for example by argument or by other factory),
     * if there is no conflict inside the single namespace.
     * That's why we use accessor instead of reference.
     * To prevent circular references.
     */
    function observe(obj, accessorName, constructor) {
        var observable = new (constructor || Observable)(obj);
        obj[accessorName || 'observed'] = function() { return observable; };
        return obj;
    }


    function IObservable() {}
    IObservable.prototype = {
        constructor: IObservable,
        set: function(name, newValue) {
            throw Error("Not Implemented Error!");
        },
        get: function(name) {
            throw Error("Not Implemented Error!");
        },
        attach: function(/* aspect, observer | observer */) {
            throw Error("Not Implemented Error!");
        },
        detach: function(/* aspect, observer | observer */) {
            throw Error("Not Implemented Error!");
        },
        notify: function(aspect/*, ...*/) {
            throw Error("Not Implemented Error!");
        },
        isObservable: function() {
            throw Error("Not Implemented Error!");
        }
    };


    function Observable(subject) {
        this.getSubject = function() { return subject; };
    };
    Observable.prototype = clone({
        constructor: Observable,
        set: function(name, newValue) {
            var oldValue = this.getSubject()[name];
            if (oldValue === newValue) { return; }
            this.getSubject()[name] = newValue;
            this.notify(name, oldValue, newValue);
        },
        get: function(name) {
            return this.getSubject()[name];
        },
        del: function(name) {
            var oldValue = this.getSubject()[name];
            delete this.getSubject()[name];
            this.notify(name, oldValue);  // arguments.length === 2; We can also pass undefined as 3-d attr, because access to nonexistent attr always returns undefined.
        },
        _getObserver: function(args) {
            return args.length === 1 ? args[0] : args[1];
        },
        _getAspect: function(args) {
            return args.length === 1 ? undefined : args[0];
        },
        attach: function(/* aspect, observer | observer */) {
            var observer = this._getObserver(arguments),
                aspects = toArray(this._getAspect(arguments));
            if (!this._observers) {
                this._observers = {};
            }
            for (var i = 0; i < aspects.length; i++) {
                var aspect = aspects[i];
                if (!this._observers[aspect]) {
                    this._observers[aspect] = [];
                }
                this._observers[aspect].push(observer);
            }
            return new Disposable(this, aspects, observer);
        },
        detach: function(/* aspect, observer | observer */) {
            var observer = this._getObserver(arguments), aspects = toArray(this._getAspect(arguments));
            var observers = this._observers && this._observers[aspect];
            if (!observers) {
                return this;
            }
            for (var i = 0; i < aspects.length; i++) {
                var aspect = aspects[i];
                arrayRemove(observers, observer);
            }
            this._observers[aspect] = observers;
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
            var ooArguments = [this.getSubject()].concat(arguments);
            for (var i = 0; i < observers.length; i++) {
                var observer = observers[i];
                if (typeof observer === "function") {
                    observer.apply(this.getSubject(), arguments);
                } else {
                    observer.update.apply(observer, ooArguments);
                }
            }
            return this;
        },
        isObservable: function() {
            return true;
        }
    }, Object.create(IObservable.prototype));


    function StoreObservable(store) {
        return Observable.call(this, store);
    }
    StoreObservable.prototype = clone({
        constructor: StoreObservable,
        /*
         * @param {Function} observer function(attr, oldValue, newValue)
         */
        attachByAttr: function(attr, defaultValue, observer) {
            var attrs = toArray(attr);
            var disposables = [];
            disposables.push(
                this.attach('add', function(aspect, obj) {
                    var objObservable = new Observable(obj);
                    objObservable.attach(attrs, observer);
                    for (var i = 0; i < attrs.length; i++) {
                        var attr = attrs[i];
                        objObservable.notify(attr, defaultValue, obj[attr]);
                    }
                })
            );
            disposables.push(
                this.attach('update', function(aspect, obj, old) {
                    var objObservable = new Observable(obj);
                    objObservable.attach(attrs, observer);
                    for (var i = 0; i < attrs.length; i++) {
                        var attr = attrs[i];
                        if (old[attr] !== obj[attr]) {
                            objObservable.notify(attr, old[attr], obj[attr]);
                        }
                    }
                })
            );
            disposables.push(
                this.attach('delete', function(aspect, obj) {
                    var objObservable = new Observable(obj);
                    objObservable.attach(attrs, observer);
                    for (var i = 0; i < attrs.length; i++) {
                        var attr = attrs[i];
                        objObservable.notify(attr, obj[attr], defaultValue);
                    }
                })
            );
            return new CompositeDisposable(disposables);
        }
    }, Object.create(Observable.prototype));


    function ResultObservable(subject) {
        return Observable.call(this, subject);
    }
    ResultObservable.prototype = clone({
        constructor: ResultObservable,
        attachByAttr: StoreObservable.prototype.attachByAttr
    }, Object.create(Observable.prototype));


    function DummyObservable(subject) {
        this.getSubject = function() { return subject; };
    };
    DummyObservable.prototype = clone({
        constructor: DummyObservable,
        set: function(name, newValue) {
            var oldValue = this.getSubject()[name];
            if (oldValue === newValue) { return; }
            this.getSubject()[name] = newValue;
        },
        get: function(name) {
            return this.getSubject()[name];
        },
        attach: function(/* aspect, observer | observer */) {
            return new Disposable(this, undefined, undefined);
        },
        detach: function(/* aspect, observer | observer */) {
            return this;
        },
        notify: function(aspect/*, ...*/) {
            return this;
        },
        isObservable: function() {
            return false;
        }
    }, Object.create(IObservable.prototype));


    function DummyResultObservable(subject) {
        return DummyObservable.call(this, subject);
    }
    DummyResultObservable.prototype = clone({
        constructor: DummyResultObservable,
        attachByAttr: function(attrs, defaultValue, observer) {
            return new Disposable(this, attrs, observer);
        }
    }, Object.create(DummyObservable.prototype));


    function IDisposable() {}
    IDisposable.prototype = {
        constructor: IDisposable,
        dispose: function() {
            throw Error("Not Implemented Error!");
        },
        add: function(other) {
            throw Error("Not Implemented Error!");
        }
    };

    function Disposable(observed, aspect, observer) {
        this._observed = observed;
        this._aspect = aspect;
        this._observer = observer;
    }
    Disposable.prototype = clone({
        constructor: Disposable,
        dispose: function() {
            this._observed.detach(this._aspect, this._observer);
        },
        add: function(other) {
            return new CompositeDisposable([this, other]);
        }
    }, Object.create(IDisposable.prototype));


    function CompositeDisposable(delegates) {
        this._delegates = delegates || [];
    }
    CompositeDisposable.prototype = clone({
        constructor: CompositeDisposable,
        dispose: function() {
            for (var i = 0; i < this._delegates.length; i++) {
                this._delegates[i]();
            }
        },
        add: function(other) {
            this._delegates.push(other);
            return this;
        }
    }, Object.create(IDisposable.prototype));


    function Iterator(collection) {
        this._collection = collection;
        this._next = 0;
        this._onEach = function(item, success, error) {};
    }
    Iterator.prototype = {
        constructor: Iterator,
        next: function() {
            return this._collection[this._next++];
        },
        isDone: function() {
            return this._next === this._collection.length;
        },
        onEach: function(callback) {
            this._onEach = callback;
            return this;
        },
        iterate: function() {
            var self = this;
            return new Promise(function(resolve, reject) {
                var success = function() {
                    if (self.isDone()) {
                        resolve();
                        return;
                    }
                    self._onEach(self.next(), success, reject);
                };
                success();
            });
        }
    };


    /*
     * Only o2m
     */
    function cascade(relatedObj, obj, old, relation, state) {
        return relation.getRelatedStore().delete(relatedObj, state);
    }


    /*
     * Only o2m
     */
    function remoteCascade(relatedObj, obj, old, relation, state) {
        return relation.getRelatedStore().delete(relatedObj, state, true);
    }


    /*
     * Only o2m
     */
    function setNull(relatedObj, obj, old, relation, state) {
        if (!(typeof relation.relatedField === "string")) { throw Error("Unable set NULL to composite relation!"); }
        relatedObj[relation.relatedField] = null;  // It's not actual for composite relations.
        return relation.getRelatedStore().update(relatedObj, state);
    }


    /*
     * Only Fk, m2m
     */
    function compose(relatedObj, obj, old, relation, state) {
        if (!relatedObj[relation.relatedName]) {
            relatedObj[relation.relatedName] = [];
        }
        relatedObj[relation.relatedName].push(obj);
        return Promise.resolve(relatedObj);
    }


    /*
     * Only o2m, m2m
     */
    function decompose(relatedObj, obj, old, relation, state) {
        if (relatedObj[relation.relatedName]) {
            arrayRemove(relatedObj[relation.relatedName], obj);
        }
        return Promise.resolve(relatedObj);
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


    function keys(obj) {
        var r = [];
        for (var i in obj) {
            if (!obj.hasOwnProperty(i)) { continue };
            r.push(i);
        }
        return r;
    }


    function clean(obj) {
        if (obj instanceof Array) {
            Array.prototype.splice.call(obj, 0, Number.MAX_VALUE);
        } else {
            for (var i in obj) {
                if (obj.hasOwnProperty(i)) {
                    delete obj[i];
                }
            }
        }
        return obj;
    }


    function toArray(value) {
        if (!(value instanceof Array)) {
            value = [value];
        }
        return value;
    }


    function isPlainObject(obj) {
        return obj && typeof obj === "object" && obj.constructor === Object;
    }


    function isModelInstance(obj) {
        return obj && typeof obj === "object" && '__oid' in obj;  // or getStore in obj
    }


    /*
     * Based on https://github.com/dojo/dojo/blob/master/when.js
     */
    function when(valueOrPromise, callback, errback) {
		var receivedPromise = valueOrPromise && typeof valueOrPromise.then === "function";
		if (!receivedPromise) {
			if(arguments.length > 1) {
				return callback ? callback(valueOrPromise) : valueOrPromise;
			} else {
				return Promise.resolve(valueOrPromise);
			}
		}
		if (callback || errback) {
			return valueOrPromise.then(callback, errback);
		}
		return valueOrPromise;
	};


    function whenIter(collection, callback, errback) {
        var next = function(i) {
            return when(callback(collection[i], i), function(item) {
                if (++i < collection.length) {
                    return next(i);
                } else {
                    return collection;
                }
            }, errback);
        };
        return collection.length && next(0);
    }


    function __super__(descendant, instance) {
        return instance['__super_' + getId(descendant) + '__']();
    }


    function withAspect(aspect, delegate) {
        var selfArguments = arguments;
        function Aspect() {}
        Aspect.prototype = delegate;
        Aspect.prototype.constructor = Aspect;
        var wrapped = new Aspect();
        clone(aspect, wrapped);
        wrapped['__super_' + getId(aspect) + '__'] = function() {
            return delegate;
        };
        if (wrapped.hasOwnProperty('__id')) { delete wrapped.__id; }
        wrapped.init = function() {
            if (aspect.init) {
                aspect.init.apply(this, Array.prototype.slice.call(selfArguments, 2));
            }
            if (delegate.init) {
                delegate.init.call(this);
            }
            return this;
        };
        return wrapped;
    }


    function withMixins() {
        var currentPrototype = arguments[arguments.length - 1];

        for (var i = arguments.length - 1; i >= 0; i--) {
            var mixinPrototype = arguments[i];
            currentPrototype = withMixin(mixinPrototype, currentPrototype);
        }
        return currentPrototype;
    }


    function withMixin(mixinPrototype, parentPrototype) {
        var newPrototype = Object.create(parentPrototype);
        clone(mixinPrototype, newPrototype);
        newPrototype.constructor = function() {
            mixinPrototype.init.applay(this, arguments);
        };
        newPrototype['__super_' + getId(mixinPrototype) + '__'] = function() {
            return parentPrototype;
        };
        if (newPrototype.hasOwnProperty('__id')) { delete newPrototype.__id; }
        return newPrototype;
    }


    function getId(obj) {
        getId._counter || (getId._counter = 0);
        if (!obj.__id) {
            obj.__id = ++getId._counter;
        }
        return obj.__id;
    }


    function arrayRemove(array, value, cast) {
        for(var i = array.length - 1; i >= 0; i--) {
            if(array[i] === value || cast && cast(array[i]) === cast(value)) {
                array.splice(i, 1);
            }
        }
        return array;
    }


    function arrayEqual(arr1, arr2) {
        if(arr1.length !== arr2.length) { return false; }
        for(var i = arr1.length; i--;) {
            if(arr1[i] !== arr2[i]) { return false; }
        }
        return true;
    }


    function arrayUniqueFilter(value, index, self) {
        return self.indexOf(value) === index;
    }


    function toString(el) { return el && el.toString ? el.toString() : el + ''; }


    function assert(condition, failMessage) {
        if (!condition) throw new Error(failMessage || "Assertion failed.");
    }


    return {
        Store: Store,
        AbstractQueryEngine: AbstractQueryEngine,
        SimpleQueryEngine: SimpleQueryEngine,
        simpleQueryEngine: simpleQueryEngine,
        DjangoFilterQueryEngine: DjangoFilterQueryEngine,
        djangoFilterQueryEngine: djangoFilterQueryEngine,
        PkRequired: PkRequired,
        ObjectAlreadyLoaded: ObjectAlreadyLoaded,
        Registry: Registry,
        AbstractLeafStore: AbstractLeafStore,
        MemoryStore: MemoryStore,
        DummyStore: DummyStore,
        AutoIncrementStore: AutoIncrementStore,
        RestStore: RestStore,
        CircularReferencesStoreAspect: CircularReferencesStoreAspect,
        ObservableStoreAspect: ObservableStoreAspect,
        PreObservableStoreAspect: PreObservableStoreAspect,
        RelationalStoreAspect: RelationalStoreAspect,
        CheckReferentialIntegrityStoreAspect: CheckReferentialIntegrityStoreAspect,
        __super__: __super__,
        withAspect: withAspect,
        withMixins: withMixins,
        withMixin: withMixin,
        DefaultModel: DefaultModel,
        Mapper: Mapper,
        Observable: Observable,
        observe: observe,
        cascade: cascade,
        remoteCascade: remoteCascade,
        setNull: setNull,
        clone: clone,
        deepClone: deepClone,
        arrayRemove: arrayRemove,
        arrayEqual: arrayEqual,
        keys: keys,
        when: when,
        whenIter: whenIter
    };
});
