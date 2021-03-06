'use strict';

exports.__esModule = true;
exports.default = createPersistoid;

var _constants = require('./constants');

// import { throttle as _throttle } from 'lodash-es/function/throttle'
var _ = require('lodash');

var THROTTLE_WAIT_DURATION = 1000;

// @TODO remove once flow < 0.63 support is no longer required.

function createPersistoid(config) {
  // defaults
  var blacklist = config.blacklist || null;
  var whitelist = config.whitelist || null;
  var transforms = config.transforms || [];
  var throttle = config.throttle || 0;
  var storageKey = '' + (config.keyPrefix !== undefined ? config.keyPrefix : _constants.KEY_PREFIX) + config.key;
  var storage = config.storage;
  var serialize = config.serialize === false ? function (x) {
    return x;
  } : defaultSerialize;

  // initialize stateful values
  var lastState = {};
  var stagedState = {};
  var keysToProcess = [];
  var timeIterator = null;
  var writePromise = null;

  var _update = function _update(state) {
    console.log('%credux-persist/createPersistoid/_update', 'color: #7ce3cd');
    // add any changed keys to the queue
    Object.keys(state).forEach(function (key) {
      if (!passWhitelistBlacklist(key)) return; // is keyspace ignored? noop
      if (lastState[key] === state[key]) return; // value unchanged? noop
      if (keysToProcess.indexOf(key) !== -1) return; // is key already queued? noop
      keysToProcess.push(key); // add key to queue
    });

    //if any key is missing in the new state which was present in the lastState,
    //add it for processing too
    Object.keys(lastState).forEach(function (key) {
      if (state[key] === undefined) {
        keysToProcess.push(key);
      }
    });

    // start the time iterator if not running (read: throttle)
    if (timeIterator === null) {
      timeIterator = setInterval(processNextKey, throttle);
    }

    lastState = state;
  };
  var update = _.throttle(_update, THROTTLE_WAIT_DURATION, {
    leading: false,
    trailing: true
  });

  function processNextKey() {
    if (keysToProcess.length === 0) {
      if (timeIterator) clearInterval(timeIterator);
      timeIterator = null;
      console.log('%credux-persist/createPersistoid/processNextKey - no more keys', 'color: #5cc3ad');
      return;
    }

    var key = keysToProcess.shift();
    console.log('%credux-persist/createPersistoid/processNextKey start - ' + key, 'color: #5cc3ad');
    var endState = transforms.reduce(function (subState, transformer) {
      return transformer.in(subState, key, lastState);
    }, lastState[key]);
    console.log('%credux-persist/createPersistoid/processNextKey transforms.reduced', 'color: #aaaaaa');
    if (endState !== undefined) {
      try {
        stagedState[key] = serialize(endState);
        console.log('%credux-persist/createPersistoid/processNextKey serialized', 'color: #aaaaaa');
      } catch (err) {
        console.error('redux-persist/createPersistoid: error serializing state', err);
      }
    } else {
      //if the endState is undefined, no need to persist the existing serialized content
      delete stagedState[key];
    }

    if (keysToProcess.length === 0) {
      writeStagedState();
    }
    console.log('%credux-persist/createPersistoid/processNextKey end - ' + key, 'color: #5cc3ad');
  }

  function writeStagedState() {
    // cleanup any removed keys just before write.
    Object.keys(stagedState).forEach(function (key) {
      if (lastState[key] === undefined) {
        delete stagedState[key];
      }
    });
    console.log('%credux-persist/createPersistoid/processNextKey keys deleted', 'color: #aaaaaa');

    writePromise = storage.setItem(storageKey, serialize(stagedState)).catch(onWriteFail);
  }

  function passWhitelistBlacklist(key) {
    if (whitelist && whitelist.indexOf(key) === -1 && key !== '_persist') return false;
    if (blacklist && blacklist.indexOf(key) !== -1) return false;
    return true;
  }

  function onWriteFail(err) {
    // @TODO add fail handlers (typically storage full)
    if (err && process.env.NODE_ENV !== 'production') {
      console.error('Error storing data', err);
    }
  }

  var flush = function flush() {
    while (keysToProcess.length !== 0) {
      processNextKey();
    }
    return writePromise || Promise.resolve();
  };

  // return `persistoid`
  return {
    update: update,
    flush: flush
  };
}

// @NOTE in the future this may be exposed via config
function defaultSerialize(data) {
  return JSON.stringify(data);
}