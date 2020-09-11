'use strict';

const express = require('express');
const axios = require('axios');
const router = express.Router();

const DiscordClient = require('../services/discord.js');
//const utils = require('../services/utils.js');

const config = require('../config.json');
const redirect = encodeURIComponent(config.discord.redirectUri);

const catchAsyncErrors = fn => ((req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
        routePromise.catch(err => next(err));
    }
});

router.get('/subscribe', (req, res) => {
    
});

router.get('/stripe', (req, res) => {
    
});

module.exports = router;
