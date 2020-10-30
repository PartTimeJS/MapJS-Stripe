'use strict';

const path = require('path');
const compression = require('compression');
const express = require('express');
const moment = require('moment');
//const cookieSession = require('cookie-session');
const session = require('express-session');
const app = express();
const mustacheExpress = require('mustache-express');
const i18n = require('i18n');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const DiscordClient = require('./services/discord.js');
const StripeClient = require('./services/stripe.js');
const config = require('./services/config.js');
const defaultData = require('./data/default.js');
const apiRoutes = require('./routes/api.js');
const discordRoutes = require('./routes/discord.js');
const stripeRoutes = require('./routes/stripe.js');
const uiRoutes = require('./routes/ui.js');
const { sessionStore, isValidSession, clearOtherSessions } = require('./services/session-store.js');

// TODO: Check sessions table and parse json

const RateLimitTime = config.ratelimit.time * 60 * 1000;
const MaxRequestsPerHour = config.ratelimit.requests * (RateLimitTime / 1000);

const rateLimitOptions = {
    windowMs: RateLimitTime, // Time window in milliseconds
    max: MaxRequestsPerHour, // Start blocking after x requests
    headers: true,
    message: {
        status: 429, // optional, of course
        limiter: true,
        type: 'error',
        message: `Too many requests from this IP, please try again in ${config.ratelimit.time} minutes.`
    },
    /* eslint-disable no-unused-vars */
    onLimitReached: (req, res, options) => {
    /* eslint-enable no-unused-vars */
        //console.error('Rate limit reached! Redirect to landing page.');
        //res.status(options.message.status).send(options.message.message);
        // TODO: Fix redirect
        res.redirect('/429');
    }
};
const requestRateLimiter = rateLimit(rateLimitOptions);

// Basic security protection middleware
app.use(helmet());

// View engine
app.set('view engine', 'mustache');
app.set('views', path.resolve(__dirname, 'views'));
app.engine('mustache', mustacheExpress());

// Compression middleware
app.use(compression());

// Static paths
app.use(express.static(path.resolve(__dirname, '../static')));

// Body parser middlewares
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: false, limit: '500mb' }));

// Initialize localzation handler
i18n.configure({
    locales:['en', 'es', 'de'],
    directory: path.resolve(__dirname, '../static/locales')
});
app.use(i18n.init);

// Register helper as a locals function wrroutered as mustache expects
app.use((req, res, next) => {
    // Mustache helper
    res.locals.__ = () => {
        /* eslint-disable no-unused-vars */
        return (text, render) => {
        /* eslint-enable no-unused-vars */
            return i18n.__.routerly(req, arguments);
        };
    };
    next();
});

// Set locale
i18n.setLocale(config.locale);

// Sessions middleware
/*
app.use(cookieSession({
    name: 'session',
    keys: [config.sessionSecret],
    maxAge: 518400000,
    store: sessionStore
}));
*/
app.use(session({
    key: 'session',
    secret: config.sessionSecret,
    store: sessionStore,
    resave: true,
    saveUninitialized: false,
    cookie: {maxAge: 604800000}
}));

app.use('/api/discord', discordRoutes);

// Discord error middleware
/* eslint-disable no-unused-vars */
app.use((err, req, res, next) => {
    switch (err.message) {
        case 'NoCodeProvided':
            return res.status(400).send({
                status: 'ERROR',
                error: err.message,
            });
        default:
            return res.status(500).send({
                status: 'ERROR',
                error: err.message,
            });
    }
});
/* eslint-enable no-unused-vars */

app.use('/api/stripe', stripeRoutes);

const paths = ['/api/stripe/', '/subscribe', '/account', '/api/discord/', '/login'];

// Login middleware
app.use(async (req, res, next) => {
    const unix = moment().unix();
    req.session.ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    req.session.map_url = 'https://' + req.get('host');
    switch(true){
        case req.path.includes('/api/stripe/'):
        case req.path.includes('/api/discord/'):
        case req.path === '/subscribe':
        case req.path === '/login':
        case req.path === '/account':
            return next();
    }
    if (req.session.user_id && req.session.logged_in) {
        if(config.denylist.includes(req.session.user_id)){
            return res.render('blocked', defaultData);
        }
        const user = new DiscordClient(req.session);
        const customer = new StripeClient(req.session);
        if (!(await isValidSession(req.session.user_id))) {
            console.debug(`[MapJS] [${getTime()}] [index.js] Detected multiple sessions for ${user.userName} (${user.userId}). Clearing old ones...`);
            customer.insertAccessLog('Multiple Sessions Detected. Cleared Older Sessions.');
            user.sendChannelEmbed(req.session.access_log_channel, 'FFA500', 'Cleared Excess Sessions.', '');
            await clearOtherSessions(req.session.user_id, req.sessionID);
        }
        if(!req.session.perms || !req.session.updated || req.session.updated < (unix - 3600)){
            req.session.updated = unix;
            user.sendChannelEmbed(req.session.access_log_channel, '00FF00', 'Authenticated Successfully via Session.', '');
            customer.insertAccessLog('Authenticated Successfully via Session.');
            req.session.perms = await user.getPerms();
            if(!req.session.perms){
                customer.insertAccessLog('Invalid Permissions Returned. User Session Destroyed.');
                req.session.destroy();
                res.redirect('/login');
                return;
            }
        }
        const perms = req.session.perms;
        if (!perms.map) {
            if(!req.session.unauthorized_attempts){
                req.session.unauthorized_attempts = 1;
            } else if(req.session.unauthorized_attempts > 10){
                res.redirect('/subscribe');
            } else {
                req.session.unauthorized_attempts++;
            }
            req.session.save();
            console.error(`[MapJS] [${getTime()}] [index.js] Non-Donor Login Attempt, ${req.session.user_name} (${req.session.user_id})`);
            customer.insertAccessLog('Non-Donor Login Attempt.');
            await user.sendChannelEmbed(req.session.access_log_channel, 'FFA500', 'Non-Donor Login Attempt.', '');
            res.redirect('/subscribe');
            return;
        }
        req.session.save();
        defaultData.hide_pokemon = !perms.pokemon;
        defaultData.hide_raids = !perms.raids;
        defaultData.hide_gyms = !perms.gyms;
        defaultData.hide_pokestops = !perms.pokestops;
        defaultData.hide_quests = !perms.quests;
        defaultData.hide_lures = !perms.lures;
        defaultData.hide_invasions = !perms.invasions;
        defaultData.hide_spawnpoints = !perms.spawnpoints;
        defaultData.hide_iv = !perms.iv;
        defaultData.hide_cells = !perms.s2cells;
        defaultData.hide_submission_cells = !perms.submissionCells;
        defaultData.hide_nests = !perms.nests;
        defaultData.hide_portals = !perms.portals;
        defaultData.hide_scan_areas = !perms.scanAreas;
        defaultData.hide_weather = !perms.weather;
        defaultData.hide_devices = !perms.devices;
        return next();
    }
    res.redirect('/login');
});

// UI routes
app.use('/', uiRoutes);

app.use('/api', requestRateLimiter);

// API routes
app.use('/api', apiRoutes);

// Start listener
app.listen(config.port, config.interface, () => console.log(`[MapJS] [index.js] Listening on port ${config.port}...`));

function getTime (type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do  h:mmA');
        case 'unix':
            return moment().unix();
        case 'ms':
            return moment().valueOf();
        default:
            return moment().format('hh:mmA');
    }
}