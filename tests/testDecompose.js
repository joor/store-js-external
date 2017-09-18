define(['../store', './utils'], function(store, utils) {

    'use strict';

    var assert = utils.assert,
        expectPks = utils.expectPks;


    function testDecompose() {
        var registry = new store.Registry();

        var authorStore = new store.Store(['id', 'lang'], ['firstName', 'lastName'], {}, new store.DummyBackend());
        registry.register('author', authorStore);

        var tagStore = new store.Store(['id', 'lang'], ['slug'], {}, new store.DummyBackend());
        registry.register('tag', tagStore);

        var tagPostStore = new store.Store('id', [], {
            foreignKey: {
                post: {
                    field: ['postId', 'postLang'],
                    relatedStore: 'post',
                    relatedField: ['id', 'lang'],
                    relatedName: 'tagPostSet',
                    onDelete: store.cascade
                },
                tag: {
                    field: ['tagId', 'tagLang'],
                    relatedStore: 'tag',
                    relatedField: ['id', 'lang'],
                    relatedName: 'tagPostSet',
                    onDelete: store.cascade
                }
            }
        }, new store.AutoIncrementBackend('id'));
        registry.register('tagPost', tagPostStore);

        var postStore = new store.Store(['id', 'lang'], ['lang', 'slug', 'author'], {
            foreignKey: {
                author: {
                    field: ['author', 'lang'],
                    relatedStore: 'author',
                    relatedField: ['id', 'lang'],
                    relatedName: 'posts',
                    onDelete: store.cascade
                }
            },
            manyToMany: {
                tags: {
                    relation: 'tagPostSet',
                    relatedStore: 'tag',
                    relatedRelation: 'tagPostSet'
                }
            }
        }, new store.DummyBackend());
        registry.register('post', postStore);

        registry.ready();

        var author = {
            id: 1,
            lang: 'en',
            firstName: 'Fn1',
            lastName: 'Ln1',
            posts: [
                {
                    id: 2,
                    lang: 'en',
                    slug: 'sl1',
                    title: 'tl1',
                    tags: [
                        {id: 5, lang: 'en', name: 'T1'},
                        {id: 6, lang: 'en', name: 'T1'}
                    ]
                },
                {
                    id: 3,
                    lang: 'en',
                    slug: 'sl1',
                    title: 'tl2',
                    tags: [
                        {id: 5, lang: 'en', name: 'T1'},
                        {id: 7, lang: 'en', name: 'T3'}
                    ]
                }
            ]
        };
        authorStore.decompose(author);

        registry.init();

        var compositePkAccessor = function(o) { return [o.id, o.lang]; };
        var r;
        r = authorStore.find();
        assert(expectPks(r, [[1, 'en']], compositePkAccessor));
        r = postStore.find();
        assert(expectPks(r, [[2, 'en'], [3, 'en']], compositePkAccessor));
        for (var i in r) {
            assert(r[i].author === 1);
        }
        r = tagStore.find();
        assert(expectPks(r, [[5, 'en'], [6, 'en'], [7, 'en']], compositePkAccessor));
        r = tagPostStore.find({postId: 2, postLang: 'en', tagId: 5, tagLang: 'en'});
        assert(r.length === 1);
        r = tagPostStore.find({postId: 2, postLang: 'en', tagId: 6, tagLang: 'en'});
        assert(r.length === 1);
        r = tagPostStore.find({postId: 3, postLang: 'en', tagId: 5, tagLang: 'en'});
        assert(r.length === 1);
        r = tagPostStore.find({postId: 3, postLang: 'en', tagId: 7, tagLang: 'en'});
        assert(r.length === 1);

        assert(author.posts[0].id === 2);
        assert(author.posts[0].author === 1);
        assert(author.posts[1].id === 3);
        assert(author.posts[1].author === 1);
        assert(author.posts.length === 2);

        assert(author.posts[0].tags[0].id === 5);
        assert(author.posts[0].tags[1].id === 6);
        assert(author.posts[0].tags.length === 2);

        assert(author.posts[1].tags[0].id === 5);
        assert(author.posts[1].tags[1].id === 7);
        assert(author.posts[1].tags.length === 2);

        registry.destroy();
    }
    return testDecompose;
});