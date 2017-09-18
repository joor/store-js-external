define(function() {

    'use strict';


    function expectPks(ObjectList, expectedPks, pkAccessor) {
        if (!pkAccessor) {
            pkAccessor = function(o) { return o.id; };
        }
        var Pks = ObjectList.map(pkAccessor).sort();
        expectedPks = expectedPks.sort();
        return JSON.stringify(Pks) === JSON.stringify(expectedPks);
    }


    function assert(condition, failMessage) {
        if (!condition) throw new Error(failMessage || "Assertion failed.");
    }

    return {
        expectPks: expectPks,
        assert: assert
    };
});