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

if (config.discord.enabled) {
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
}

app.use('/api/stripe', stripeRoutes);

// Login middleware
app.use(async (req, res, next) => {
    req.session.ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    req.session.map_url = 'https://' + req.get('host');
    if (config.discord.enabled && (req.path.includes('/api/stripe/') || req.path === '/subscribe')) {
        return next();
    }
    if (config.discord.enabled && (req.path.includes('/api/discord/') || req.path === '/login')) {
        return next();
    }
    if (req.session.user_id && req.session.logged_in) {
        const user = new DiscordClient(req.session);
        const customer = new StripeClient(req.session);
        defaultData.logged_in = true;
        defaultData.username = req.session.user_name;
        if (!req.session.valid) {
            console.error(`[MapJS] [${getTime()}] [index.js] Invalid User Authenticated, ${user.userName} (${user.userId})`);
            customer.insertAccessLog('Invalid User Authentication via Cookie Session.');
            res.redirect('/subscribe');
            return;
        }
        if (!(await isValidSession(req.session.user_id))) {
            console.debug(`[MapJS] [${getTime()}] [index.js] Detected multiple sessions for ${user.userName} (${user.userId}). Clearing old ones...`);
            customer.insertAccessLog('Multiple Sessions Detected and Cleared Older Sessions.');
            if(req.session.access_log_channel){
                await user.sendChannelEmbed(req.session.access_log_channel, 'FFA500', 'Cleared Excess Sessions.', '');
            }
            await clearOtherSessions(req.session.user_id, req.sessionID);
        }
        const unix = moment().unix();
        if(!req.session.perms || !req.session.updated || req.session.updated < (unix - 600)){
            req.session.updated = unix;
            customer.insertAccessLog('Authenticated Successfully via Cookie Session.');
            if(req.session.access_log_channel){
                await user.sendChannelEmbed(req.session.access_log_channel, '00FF00', 'Authenticated Successfully.', '');
            }
            req.session.perms = await user.getPerms();
        }
        const perms = req.session.perms;
        defaultData.hide_map = !perms.map;
        if (defaultData.hide_map) {
            // No view map permissions, go to login screen
            console.error('[index.js] Invalid view map permissions for user', req.session.user_id);
            customer.insertAccessLog('Invalid Permissions Found via Cookie Session.');
            res.redirect('/subscribe');
            return;
        }
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

function getTime(type) {
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
