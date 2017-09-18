define(['../store', './utils'], function(store, utils) {

    'use strict';

    var assert = utils.assert,
        expectPks = utils.expectPks;


    function testCompositeRelations() {
        var registry = new store.Registry();

        // Use reverse order of store creation.
        var authorStore = new store.Store(['id', 'lang'], ['firstName', 'lastName'], {}, new store.DummyBackend());
        registry.register('author', authorStore);

        var postStore = new store.Store(['id', 'lang'], ['lang', 'slug', 'author'], {
            foreignKey: {
                author: {
                    field: ['author', 'lang'],
                    relatedStore: 'author',
                    relatedField: ['id', 'lang'],
                    relatedName: 'posts',
                    onDelete: store.cascade
                }
            }
        }, new store.DummyBackend());
        registry.register('post', postStore);

        registry.ready();

        var authors = [
            {id: 1, lang: 'en', firstName: 'Fn1', lastName: 'Ln1'},
            {id: 1, lang: 'ru', firstName: 'Fn1-ru', lastName: 'Ln1-ru'},
            {id: 2, lang: 'en', firstName: 'Fn1', lastName: 'Ln2'},
            {id: 3, lang: 'en', firstName: 'Fn3', lastName: 'Ln1'}
        ];
        authorStore.loadCollection(authors);

        var posts = [
            {id: 1, lang: 'en', slug: 'sl1', title: 'tl1', author: 1},
            {id: 1, lang: 'ru', slug: 'sl1-ru', title: 'tl1-ru', author: 1},
            {id: 2, lang: 'en', slug: 'sl1', title: 'tl2', author: 1},  // slug can be unique per date
            {id: 3, lang: 'en', slug: 'sl3', title: 'tl1', author: 2},
            {id: 4, lang: 'en', slug: 'sl4', title: 'tl4', author: 3}
        ];
        postStore.loadCollection(posts);

        registry.init();

        var o, r, oid;
        var compositePkAccessor = function(o) { return [o.id, o.lang]; };

        r = postStore.find({slug: 'sl1'});
        assert(expectPks(r, [[1, 'en'], [2, 'en']], compositePkAccessor));

        r = postStore.find({'author.firstName': 'Fn1'});
        assert(expectPks(r, [[1, 'en'], [2, 'en'], [3, 'en']], compositePkAccessor));

        r = postStore.find({author: {'$fk': {firstName: 'Fn1'}}});
        assert(expectPks(r, [[1, 'en'], [2, 'en'], [3, 'en']], compositePkAccessor));

        r = authorStore.find({'posts.slug': {'$in': ['sl1', 'sl3']}});
        assert(expectPks(r, [[1, 'en'], [2, 'en']], compositePkAccessor));

        r = authorStore.find({posts: {'$o2m': {slug: {'$in': ['sl1', 'sl3']}}}});
        assert(expectPks(r, [[1, 'en'], [2, 'en']], compositePkAccessor));

        // Add
        o = {id: 5, lang: 'en', slug: 'sl5', title: 'tl5', author: 3};
        oid = postStore.getObjectId(o);
        postStore.add(o);
        assert(oid in postStore.objectMapping);
        assert([5, 'en'] in postStore.pkIndex);
        assert(postStore.indexes['slug']['sl5'].indexOf(oid) !== -1);

        // Update
        o = postStore.get([5, 'en']);
        oid = postStore.getObjectId(o);
        o.slug = 'sl5.2';
        postStore.update(o);
        assert(oid in postStore.objectMapping);
        assert([5, 'en'] in postStore.pkIndex);
        assert(postStore.indexes['slug']['sl5.2'].indexOf(oid) !== -1);
        assert(postStore.indexes['slug']['sl5'].indexOf(oid) === -1);

        // Delete
        o = authorStore.get([1, 'en']);
        oid = postStore.getObjectId(postStore.find({author: 1, lang: 'en'})[0]);
        assert(postStore.indexes['slug']['sl1'].indexOf(oid) !== -1);
        assert([1, 'en'] in postStore.pkIndex);
        authorStore.delete(o);
        assert(postStore.indexes['slug']['sl1'].indexOf(oid) === -1);
        assert(!([1, 'en'] in postStore.pkIndex));
        r = authorStore.find();
        assert(expectPks(r, [[1, 'ru'], [2, 'en'], [3, 'en']], compositePkAccessor));
        r = postStore.find();
        assert(expectPks(r, [[1, 'ru'], [3, 'en'], [4, 'en'], [5, 'en']], compositePkAccessor));

        registry.destroy();
    }
    return testCompositeRelations;
});