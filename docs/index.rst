.. Store.js documentation master file, created by
   sphinx-quickstart on Fri Jan 13 21:42:04 2017.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

Welcome to Store.js's documentation!
====================================

.. toctree::
   :maxdepth: 2
   :caption: Contents:


.. contents:: Contents


Store
=====

The :class:`Store` class is a super lightweight implementation of Repository_ pattern.

The main goal of Repository_ pattern is to hide the data source.

The :class:`Store` class has a simple interface, so, this abstract layer allows you easy to change the policy of data access.
For example, you can use as data source:

- `html <https://dojotoolkit.org/reference-guide/1.10/dojox/data/HtmlStore.html>`__
- `CORS <https://en.wikipedia.org/wiki/Cross-origin_resource_sharing>`_ REST
- JSON-RPC
- `Indexed Database API <https://www.w3.org/TR/IndexedDB/>`_
- `Angular resource <https://en.wikipedia.org/wiki/Cross-origin_resource_sharing>`_
- etc.

The required attribute of the Repository pattern is the pattern `Query Object`_.
Without `Query Object`_ it's impossible to hide the data source.

This class was developed rapidly, in limited time, so there is used the simplest query syntax similar to `MongoDB Query`_.


Store public API
----------------


.. class:: Store([pk[, indexes[, relations[, backend]]]])

   :param pk: the name of Primary Key (or list of names of composite Primary Key)
   :type pk: string or Array[string]
   :param Array[string] indexes: the array of field names to be indexed for fast finding. \
      Note, all field used by relations or primary key will be indexed automatically.
   :param Object relations: the dictionary describes the schema relations.
   :param AbstractBackend backend: implements the Gateway_ pattern

   Format of ``relations`` argument::

      {
          foreignKey: {
              firstForeignKeyName: {
                  [field: fieldNameOfCurrentStore,] // (string | Array[string]),
                      // optional for Fk, in this case the relation name will be used as field name
                  relatedStore: nameOfRelatedStore, // (string)
                  relatedField: fieldNameOfRelatedStore, // (string | Array[string])
                  [onAdd: callableOnObjectAdd,] // (function) compose
                  [onDelete: callableOnObjectDelete,] // (function) cascade|setNull
                  [onUpdate: callableOnObjectUpdate,] // (function)
              },
              secondForeignKeyName: ...,
              ...
          },
          [oneToMany: {
              firstOneToManyName: {
                  field: fieldNameOfCurrentStore, // (string | Array[string]),
                  relatedStore: nameOfRelatedStore, // (string)
                  relatedField: fieldNameOfRelatedStore, // (string | Array[string])
                  [relatedName: nameOfReverseRelationOfRelatedStore,]
                  [onAdd: callableOnObjectAdd,] // (function)
                  [onDelete: callableOnObjectDelete,] // (function) cascade|setNull|decompose
                  [onUpdate: callableOnObjectUpdate,] // (function)
              },
              secondOneToManyName: ...,
              ...
          },]
          manyToMany: {
              fistManyToManyName: {
                  relation: relationNameOfCurrentStore, // (string)
                      // the name of foreignKey relation to middle M2M store.
                  relatedStore: nameOfRelatedStore, // (string)
                  relatedRelation: relationNameOfRelatedStore, // (string)
                      // the name of oneToMany relation from related store to middle M2M store.
                  [onAdd: callableOnObjectAdd,] // (function) compose
                  [onDelete: callableOnObjectDelete,] // (function) cascade|setNull|decompose
                  [onUpdate: callableOnObjectUpdate,] // (function)
              },
              secondManyToManyName: ...,
              ...
          }
      }

   If oneToMany is not defined, it will be built automatically from foreignKey of related store.
   In case the foreignKey don't has relatedName key, a new relatedName will be generated from the store name and "Set" suffix.

   The public method of Store:

   .. function:: Store.prototype.loadCollection(objectList)

      Loads a collection of model instances into the Store instance.

      :param Array[Object] objectList: the collection of Model instances

   .. function:: Store.prototype.load(obj)

      Loads a single Model instance into the Store instance.

      :param Object obj: the object to be loaded

   .. function:: Store.prototype.get(pkOrWhere)

      Retrieves a Model instance by primary key or by Query Object.

      :param pkOrWhere: the primary key of required Model instance or Query Object.
      :type pkOrWhere: number or string or Array or Object

   .. function:: Store.prototype.add(obj, callback)

      Adds a Model instance into the Store instance and it's backend.

      :param Object obj: the Model instance to be added.
      :param function callback: the callback to be called when the Model instance will be added.

   .. function:: Store.prototype.update(obj, callback)

      Updates a Model instance in the Store instance and it's backend.

      :param Object obj: the Model instance to be updated.
      :param function callback: the callback to be called when the Model instance will be updated.

   .. function:: Store.prototype.delete(obj, callback)

      Deletes a Model instance from the Store instance and it's backend.

      :param Object obj: the Model instance to be deleted.
      :param function callback: the callback to be called when the Model instance will be deleted.

   .. function:: Store.prototype.find(where)

      Returns a :class:`Result` instance with collection of Model instances meeting the selection criteria.

      :param Object where: the Query Object.

   .. function:: Store.prototype.compose(obj)

      Builds a nested hierarchical composition of related objects with the ``obj`` top object.

      :param Object obj: the Model instance to be the top of built nested hierarchical composition

   .. function:: Store.prototype.decompose(obj)

      Populates related stores from the nested hierarchical composition of related objects.

      :param Object obj: the nested hierarchical composition of related objects with the ``obj`` top object

   .. function:: Store.prototype.getObservable()

      Returns the :class:`StoreObservable` interface of the store.


   The service public methods (usually you don't call these methods):

   .. function:: Store.prototype.register(name, registry)

   .. function:: Store.prototype.init()

   .. function:: Store.prototype.unload(obj)

   .. function:: Store.prototype.destroy()

   .. function:: Store.prototype.clean()


Store events
------------

============  =============================================
Event         When notified
============  =============================================
"load"        on object is loaded to store

"init"        on store is loaded and initialized, triggered by :func:`Store.prototype.init`
              Usually at this moment all loaded objects can attach observers one another.

"add"         on object is added to store, triggered by :func:`Store.prototype.add`

"update"      on object is updated in store, triggered by :func:`Store.prototype.update`

"delete"      immediately before object is deleted from store, triggered by :func:`Store.prototype.delete`

"unload"      immediately before object is unloaded from store, triggered by :func:`Store.prototype.unload`

"destroy"     immediately before store is destroyed, triggered by :func:`Store.prototype.destroy`
              Usually used to kill
              `reference cycles <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_Management>`__.
============  =============================================


Store observers
---------------


Store functional-style observer signature:

.. function:: storeObserver(aspect, obj)

   ``this`` variable inside observer is setted to the notifier :class:`Store` instance.

   :param string aspect: the event name
   :param Object obj: the Model instance.


Store OOP-style Observer interface:

.. class:: IStoreObserver()

   .. function:: update(subject, aspect, obj)

      :param Store subject: the notifier
      :param string aspect: the event name
      :param Object obj: the Model instance.


Registry
========


Registry public API
-------------------


.. class:: Registry()

   The Registry class is a Mediator_ between :class:`stores <Store>` and has goal to lower the Coupling_.
   The public methods of Registry:

   .. function:: register(name, store)

      Links the :class:`Store` instance and the :class:`Registry` instance.

      :param string name: the name of :class:`Store` instance to be registered. \
         This name will be used in relations to the store from related stores.
      :param Store store: the instance of :class:`Store`


   .. function:: Registry.prototype.ready()

      Notifies the attached observers that all stores are registered.
      Usualy used to attach observers of registered :class:`stores <Store>` one another.

   .. function:: Registry.prototype.init()

      Notifies the attached observers when the data is loaded to all stores.
      The method calls the :func:`Store.prototype.init` method for each registered :class:`store <Store>`.

   .. function:: Registry.prototype.destroy()

      Notifies the attached observers when the data will be destroyed.
      The method calls :func:`Store.prototype.destroy` method for each registered store.

   .. function:: Registry.prototype.clean()

      Cleans all registered :class:`stores <Store>`.

   .. function:: Registry.prototype.getObservable()

      Returns the :class:`Observable` interface of the registry.


Registry events
---------------

============  =============================================
Event         When notified
============  =============================================
"register"    on store registered

"ready"       on all stores are registered

"init"        on all registered stores has loaded the data

"destroy"     on all data will be destroyed
============  =============================================


Registry observers
------------------


Registry functional-style observer signature:

.. function:: registryObserver(aspect, store)

   ``this`` variable inside observer is setted to the notifier :class:`Registry` instance.

   :param string aspect: the event name
   :param Store store: the :class:`Store` instance. This argument is omitted for "ready" event.


Registry OOP-style Observer interface:

.. class:: IRegistryObserver()

   .. function:: update(subject, aspect, store)

      :param Registry subject: the notifier
      :param string aspect: the event name
      :param Store store: the :class:`Store` instance. This argument is omitted for "ready" event.


Observable Interface
====================

.. class:: Observable(obj)

   Creates an observable interface for object.

   :param Object obj: the object to be observable

   .. function:: Observable.prototype.set(name, newValue)

      Sets the new value of attribute of the object by the name of the attribute.

      :param string name: the name of the object attribute to be updated
      :param newValue: the new value of the object attribute

   .. function:: Observable.prototype.get(name)

      Returns the current value of the object attribute by name.

      :param string name: the name of the object attribute

   .. function:: Observable.prototype.attach([aspect, ]observer)

      Attaches the observer to the specified aspect(s)
      If aspect is omitted, the observer will be attached to the global aspect which is notified on every aspect.

      :param aspect: the aspect name(s).
      :type aspect: string or Array[string]
      :param observer: the observer
      :type observer: function or Object

   .. function:: Observable.prototype.detach([aspect, ]observer)

      Detaches the observer to the specified aspect(s).
      If aspect is omitted, the observer will be detached from the global aspect which is notified on every aspect.

      :param aspect: the aspect name(s).
      :type aspect: string or Array[string]
      :param observer: the observer
      :type observer: function or Object

   .. function:: Observable.prototype.notify(aspect[[, argument], ...])

      Notifies observers attached to specified and global aspects.
      All arguments of this function are passed to each observer.

      :param string aspect: the aspect name.


StoreObservable Interface
=========================

.. class:: StoreObservable(store)

   Creates an observable interface for :class:`Store` instance.
   Inherited from the :class:`Observable` class.

   :param Store store: the :class:`Store` instance to be observable.

   .. js:attribute:: StoreObservable.prototype

      An :class:`Observable` instance.

   .. function:: StoreObservable.prototype.attachBidirectional(aspect, relationName, callback)

      Attaches observer to related objects.


Query Object
============


Comparison operators
--------------------


$eq
^^^

Specifies equality condition. The `$eq`_ operator matches objects where the value of a field equals the specified value.

::

   {<field>: {$eq: <value>}}

The `$eq`_ expression is equivalent to ``{field: <value>}``


$in
^^^

The `$in`_ operator selects the objects where the value of a field equals any value in the specified array.

::

   {field: {$in: [<value1>, <value2>, ... <valueN> ]}}


$callable
^^^^^^^^^

Function arguments: value, field, obj.

::

   {field: {$callable: <function>}}

The short form::

  {field: <function>}


Logical operators
-----------------


$and
^^^^

`$and`_ performs a logical AND operation on an array of two or more expressions (e.g. ``<expression1>``, ``<expression2>``, etc.) and selects the objects that satisfy all the expressions in the array.

::

   {$and: [{<expression1>}, {<expression2>}, ... , {<expressionN>}]}

In short form you can simple list expressions in single object. These two expressions are equivalent:

::

   {$and: [{firstName: 'Donald'}, {lastName: 'Duck'}]}

::

   {firstName: 'Donald', lastName: 'Duck'}



$or
^^^

The `$or`_ operator performs a logical OR operation on an array of two or more ``<expressions>`` and selects the objects that satisfy at least one of the ``<expressions>``.

::

   {$or: [{<expression1>}, {<expression2>}, ... , {<expressionN>}]}


Relation operators
------------------

All relation operators can be nested, for example, this expression is valid::

  tagStore.find({'posts.author.country.code': 'USA'})


$fk
^^^

Delegates expression to related store by foreign key.
The relation should be described in :attr:`store.relations.foreignKey`.

::

   {relation: {$fk: {<expression>}}}

In short form you can use dot in field (left part). These two expressions are equivalent:

::

   {author: {$fk: {firstName: 'Donald'}}

::

   {'author.firstName': 'Donald'}


$o2m
^^^^

Delegates expression to related store by one to many relation.
The relation should be described in :attr:`store.relations.oneToMany`.

::

   {relation: {$o2m: {<expression>}}}

In short form you can use dot in field (left part). These two expressions are equivalent:

::

   {posts: {$o2m: {title: 'Donald Duck'}}

::

   {'posts.title': 'Donald Duck'}


$m2m
^^^^

Delegates expression to related store by many to many relation.
The relation should be described in :attr:`store.relations.manyToMany`.

::

   {relation: {$m2m: {<expression>}}}

To short form you can use dot in field (left part). These two expressions are equivalent:

::

   {authors: {$m2m: {firstName: 'Donald'}}

::

   {'authors.firstName': 'Donald'}


Exaples
=======


Query
-----


.. literalinclude:: ../tests/testQuery.js
   :language: javascript
   :linenos:


Simple relations
----------------


.. literalinclude:: ../tests/testSimpleRelations.js
   :language: javascript
   :linenos:


Composite relations
-------------------


.. literalinclude:: ../tests/testCompositeRelations.js
   :language: javascript
   :linenos:


Many to many relations
----------------------


.. literalinclude:: ../tests/testManyToMany.js
   :language: javascript
   :linenos:


Compose
-------


.. literalinclude:: ../tests/testCompose.js
   :language: javascript
   :linenos:


Decompose
---------


.. literalinclude:: ../tests/testDecompose.js
   :language: javascript
   :linenos:


Observable object
-----------------

Example of fast real-time aggregation:

.. literalinclude:: ../tests/testObservable.js
   :language: javascript
   :linenos:


StoreObservable
---------------

Example of fast real-time aggregation using :

.. literalinclude:: ../tests/testStoreObservable.js
   :language: javascript
   :linenos:


.. _Coupling: http://wiki.c2.com/?CouplingAndCohesion
.. _Cohesion: http://wiki.c2.com/?CouplingAndCohesion
.. _Gateway: https://martinfowler.com/eaaCatalog/gateway.html
.. _Mediator: https://en.wikipedia.org/wiki/Mediator_pattern
.. _MongoDB Query: https://docs.mongodb.com/manual/reference/operator/query/
.. _Repository: http://martinfowler.com/eaaCatalog/repository.html
.. _Query Object: http://martinfowler.com/eaaCatalog/queryObject.html


Indices and tables
==================

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
