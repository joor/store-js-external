define(['../store', './utils'], function(store, utils) {

    'use strict';

    var assert = utils.assert,
        expectPks = utils.expectPks;


    function testSimpleRelations() {
        var registry = new store.Registry();

        var postStore = new store.Store('id', ['slug', 'author'], {
            foreignKey: {
                author: {
                    field: 'author',
                    relatedStore: 'author',
                    relatedField: 'id',
                    relatedName: 'posts',
                    onDelete: store.cascade
                }
            }
        }, new store.DummyBackend());
        registry.register('post', postStore);

        var authorStore = new store.Store('id', ['firstName', 'lastName'], {}, new store.DummyBackend());
        registry.register('author', authorStore);

        registry.ready();

        var authors = [
            {id: 1, firstName: 'Fn1', lastName: 'Ln1'},
            {id: 2, firstName: 'Fn1', lastName: 'Ln2'},
            {id: 3, firstName: 'Fn3', lastName: 'Ln1'}
        ];
        authorStore.loadCollection(authors);

        var posts = [
            {id: 1, slug: 'sl1', title: 'tl1', author: 1},
            {id: 2, slug: 'sl1', title: 'tl2', author: 1},  // slug can be unique per date
            {id: 3, slug: 'sl3', title: 'tl1', author: 2},
            {id: 4, slug: 'sl4', title: 'tl4', author: 3}
        ];
        postStore.loadCollection(posts);

        registry.init();

        var o, r, oid;

        r = registry.post.find({slug: 'sl1'});
        assert(expectPks(r, [1, 2]));

        r = registry.post.find({'author.firstName': 'Fn1'});
        assert(expectPks(r, [1, 2, 3]));

        r = registry.post.find({author: {'$fk': {firstName: 'Fn1'}}});
        assert(expectPks(r, [1, 2, 3]));

        r = registry.author.find({'posts.slug': {'$in': ['sl1', 'sl3']}});
        assert(expectPks(r, [1, 2]));

        r = registry.author.find({posts: {'$o2m': {slug: {'$in': ['sl1', 'sl3']}}}});
        assert(expectPks(r, [1, 2]));

        // Add
        o = {id: 5, slug: 'sl5', title: 'tl5', author: 3};
        oid = registry.post.getObjectId(o);
        registry.post.add(o);
        assert(oid in registry.post.objectMapping);
        assert(5 in registry.post.pkIndex);
        assert(registry.post.indexes['slug']['sl5'].indexOf(oid) !== -1);

        // Update
        o = registry.post.get(5);
        o.slug = 'sl5.2';
        registry.post.update(o);
        assert(oid in registry.post.objectMapping);
        assert(5 in registry.post.pkIndex);
        assert(registry.post.indexes['slug']['sl5.2'].indexOf(oid) !== -1);
        assert(registry.post.indexes['slug']['sl5'].indexOf(oid) === -1);

        // Delete
        o = registry.author.get(1);
        oid = registry.post.getObjectId(registry.post.find({author: 1})[0]);
        assert(registry.post.indexes['slug']['sl1'].indexOf(oid) !== -1);
        assert(1 in registry.post.pkIndex);
        registry.author.delete(o);
        assert(registry.post.indexes['slug']['sl1'].indexOf(oid) === -1);
        assert(!(1 in registry.post.pkIndex));
        r = registry.author.find();
        assert(expectPks(r, [2, 3]));
        r = registry.post.find();
        assert(expectPks(r, [3, 4, 5]));

        registry.destroy();
    }
    return testSimpleRelations;
});