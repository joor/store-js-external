define(['../store', './utils'], function(store, utils) {

    'use strict';

    var assert = utils.assert;


    function testObservable() {
        // Example of fast real-time aggregation
        var registry = new store.Registry();
        registry.getObservable().attach('register', function(aspect, newStore) {
            newStore.getObservable().attach('load', function(aspect, obj) { store.observable(obj); });
        });

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
        registry.getObservable().attach('ready', function() {
            var link = function(post, author) {
                author.getObservable().set('views_total', author.views_total + post.views_count);
                post.getObservable().attach('views_count', function(name, oldValue, newValue) {
                    author.getObservable().set('views_total', author.views_total - oldValue + newValue);
                });
            };
            registry.author.getObservable().attach('load', function(aspect, author) {
                author.views_total = 0;
                registry.post.find({'author': author.id}).map(function(post) {
                    link(post, author);
                });
            });
            registry.post.getObservable().attach('load', function(aspect, post) {
                registry.author.find({id: post.author}).map(function(author) {
                    link(post, author);
                });
            });
        });

        registry.ready();

        var authors = [
            {id: 1, firstName: 'Fn1', lastName: 'Ln1'},
            {id: 2, firstName: 'Fn1', lastName: 'Ln2'},
            {id: 3, firstName: 'Fn3', lastName: 'Ln1'}
        ];
        authorStore.loadCollection(authors);

        var posts = [
            {id: 1, slug: 'sl1', title: 'tl1', author: 1, views_count: 5},
            {id: 2, slug: 'sl1', title: 'tl2', author: 1, views_count: 6},  // slug can be unique per date
            {id: 3, slug: 'sl3', title: 'tl1', author: 2, views_count: 7},
            {id: 4, slug: 'sl4', title: 'tl4', author: 3, views_count: 8}
        ];
        postStore.loadCollection(posts);

        registry.init();

        var author = registry.author.get(1);
        assert(author.views_total === 11);
        var post = registry.post.find({author: author.id})[0];
        post.getObservable().set('views_count', post.views_count + 1);
        assert(author.views_total === 12);
    }
    return testObservable;
});