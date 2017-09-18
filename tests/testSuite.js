define([
    './testQuery',
    './testSimpleRelations',
    './testCompositeRelations',
    './testManyToMany',
    './testCompose',
    './testDecompose',
    './testObservable',
    './testStoreObservable',
    './testUtils'
], function(
    testQuery,
    testSimpleRelations,
    testCompositeRelations,
    testManyToMany,
    testCompose,
    testDecompose,
    testObservable,
    testStoreObservable,
    testUtils
) {

    'use strict';


    function testSuite() {
        testQuery();
        testSimpleRelations();
        testCompositeRelations();
        testManyToMany();
        testCompose();
        testDecompose();
        testObservable();
        testStoreObservable();
        testUtils();
        console.debug('Test OK');
    }
    return testSuite;
});