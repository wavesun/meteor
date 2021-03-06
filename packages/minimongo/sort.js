// Give a sort spec, which can be in any of these forms:
//   {"key1": 1, "key2": -1}
//   [["key1", "asc"], ["key2", "desc"]]
//   ["key1", ["key2", "desc"]]
//
// (.. with the first form being dependent on the key enumeration
// behavior of your javascript VM, which usually does what you mean in
// this case if the key names don't look like integers ..)
//
// return a function that takes two objects, and returns -1 if the
// first object comes first in order, 1 if the second object comes
// first, or 0 if neither object comes before the other.

Sorter = function (spec) {
  var self = this;
  self._sortFunction = null;

  var sortSpecParts = [];

  if (spec instanceof Array) {
    for (var i = 0; i < spec.length; i++) {
      if (typeof spec[i] === "string") {
        sortSpecParts.push({
          lookup: makeLookupFunction(spec[i]),
          ascending: true
        });
      } else {
        sortSpecParts.push({
          lookup: makeLookupFunction(spec[i][0]),
          ascending: spec[i][1] !== "desc"
        });
      }
    }
  } else if (typeof spec === "object") {
    for (var key in spec) {
      sortSpecParts.push({
        lookup: makeLookupFunction(key),
        ascending: spec[key] >= 0
      });
    }
  } else {
    throw Error("Bad sort specification: ", JSON.stringify(spec));
  }

  // If there are no sorting rules specified, leave _sortFunction as null.  This
  // will allow us to have a special case where we sort on distances if query
  // involved the $near operator.
  if (sortSpecParts.length === 0)
    return;

  // reduceValue takes in all the possible values for the sort key along various
  // branches, and returns the min or max value (according to the bool
  // findMin). Each value can itself be an array, and we look at its values
  // too. (ie, we do a single level of flattening on branchValues, then find the
  // min/max.)
  //
  // XXX This is actually wrong! In fact, the whole attempt to compile sort
  // functions independently of selectors is wrong. In MongoDB, if you have
  // documents {_id: 'x', a: [1, 10]} and {_id: 'y', a: [5, 15]},
  // then C.find({}, {sort: {a: 1}}) puts x before y (1 comes before 5).
  // But C.find({a: {$gt: 3}}, {sort: {a: 1}}) puts y before x (1 does not match
  // the selector, and 5 comes before 10).
  var reduceValue = function (branchValues, findMin) {
    // Expand any leaf arrays that we find, and ignore those arrays themselves.
    branchValues = expandArraysInBranches(branchValues, true);
    var reduced = undefined;
    var first = true;
    // Iterate over all the values found in all the branches, and if a value is
    // an array itself, iterate over the values in the array separately.
    _.each(branchValues, function (branchValue) {
      if (first) {
        reduced = branchValue.value;
        first = false;
      } else {
        // Compare the value we found to the value we found so far, saving it
        // if it's less (for an ascending sort) or more (for a descending
        // sort).
        var cmp = LocalCollection._f._cmp(reduced, branchValue.value);
        if ((findMin && cmp > 0) || (!findMin && cmp < 0))
          reduced = branchValue.value;
      }
    });
    return reduced;
  };

  self._sortFunction = function (a, b) {
    for (var i = 0; i < sortSpecParts.length; ++i) {
      var specPart = sortSpecParts[i];
      var aValue = reduceValue(specPart.lookup(a), specPart.ascending);
      var bValue = reduceValue(specPart.lookup(b), specPart.ascending);
      var compare = LocalCollection._f._cmp(aValue, bValue);
      if (compare !== 0)
        return specPart.ascending ? compare : -compare;
    };
    return 0;
  };
};

Sorter.prototype.getComparator = function (options) {
  var self = this;
  // If there was a sort specification, use it.
  // XXX do we not use distance as a secondary sort key?
  if (self._sortFunction)
    return self._sortFunction;

  // If there was no sort specification and we have no distances, everything is
  // equal.
  if (!options || !options.distances) {
    return function (a, b) {
      return 0;
    };
  }

  return function (a, b) {
    return options.distances.get(a._id) - options.distances.get(b._id);
  };
};

MinimongoTest.Sorter = Sorter;
