'use strict';

var jsonMerger = require('json-merger');
const uConfig = require('../configs/config.json');
const eConfig = require('../configs/default.json');
const sConfig = require('../configs/stripe.json');
var finalConfig = jsonMerger.mergeObjects([eConfig, uConfig, sConfig]);

module.exports = finalConfig;
