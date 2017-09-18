define(['../store', './utils'], function(store, utils) {

    'use strict';

    var assert = utils.assert,
        expectPks = utils.expectPks;


    function testQuery() {
        var registry = new store.Registry();

        var postStore = new store.Store('id', ['slug', 'author'], {}, new store.DummyBackend());
        registry.register('post', postStore);

        registry.ready();

        var posts = [
            {id: 1, slug: 'sl1', title: 'tl1', author: 1},
            {id: 2, slug: 'sl1', title: 'tl2', author: 1},  // slug can be unique per date
            {id: 3, slug: 'sl3', title: 'tl1', author: 2},
            {id: 4, slug: 'sl4', title: 'tl4', author: 3}
        ];
        postStore.loadCollection(posts);

        registry.init();

        var r;

        r = registry.post.find({slug: 'sl1'});
        assert(expectPks(r, [1, 2]));

        r = registry.post.find({slug: 'sl1', author: 1});
        assert(expectPks(r, [1, 2]));

        r = registry.post.find({'$and': [{slug: 'sl1'}, {author: 1}]});
        assert(expectPks(r, [1, 2]));

        r = registry.post.find({'$or': [{slug: 'sl1'}, {author: 2}]});
        assert(expectPks(r, [1, 2, 3]));

        r = registry.post.find({'$or': [{slug: 'sl1'}, {title: 'tl1'}]}); // No index
        assert(expectPks(r, [1, 2, 3]));

        r = registry.post.find({slug: {'$in': ['sl1', 'sl3']}});
        assert(expectPks(r, [1, 2, 3]));

        registry.destroy();
    }
    return testQuery;
});