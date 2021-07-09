'use strict';

const express = require('express');
const axios = require('axios');
const router = express.Router();
const moment = require('moment');
const DiscordClient = require('../services/discord.js');
const StripeClient = require('../services/stripe.js');
//const utils = require('../services/utils.js');
const config = require('../services/config.js');
const discords = require('../configs/discords.json').discords;

const catchAsyncErrors = fn => ((req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
        routePromise.catch(err => next(err));
    }
});


router.get('/login', (req, res) => {
    let discord = false;
    if (discords.length > 1) {
        for (let d = 0, dlen = discords.length; d < dlen; d++) {
            if (('https://' + req.get('host')) === discords[d].domain) {
                discord = discords[d]; break;
            }
        }
    } else {
        discord = discords[0];
    }
    if (discord) {
        req.session.guild_id = discord.id;
        req.session.plan_id = discord.plan_id;
        req.session.amt = discord.plan_cost;
        req.session.donor_role = discord.role;
        req.session.access_log_channel = discord.access_log_channel;
        req.session.stripe_log_channel = discord.stripe_log_channel;
        req.session.guild_name = discord.name;
        req.session.map_url = discord.domain;
        req.session.save();
        const redirect = encodeURIComponent('https://' + req.get('host') + '/api/discord/callback');
        const scope = 'guilds%20identify%20email%20guilds.join';
        res.redirect(`https://discordapp.com/api/oauth2/authorize?client_id=${config.discord.clientId}&scope=${scope}&response_type=code&redirect_uri=${redirect}`);
    } else {
        console.error(`[MapJS] [${getTime()}] [services/discord.js] No discord found for ${'https://' + req.get('host')}.`, req.session);
    }
});

router.get('/callback', catchAsyncErrors(async (req, res) => {
    if (!req.query.code) {
        throw new Error('NoCodeProvided');
    }
    const redirect = encodeURIComponent('https://' + req.get('host') + '/api/discord/callback');
    const data = `client_id=${config.discord.clientId}&client_secret=${config.discord.clientSecret}&grant_type=authorization_code&code=${req.query.code}&redirect_uri=${redirect}&scope=guilds%20identify%20email`;
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    
    axios.post('https://discord.com/api/oauth2/token', data, {
        headers: headers
    }).then(async (response) => {
        const unix = moment().unix();
        req.session.updated = unix;
        req.session.user_agent = req.headers['user-agent'];
        const user = new DiscordClient({ access_token: response.data.access_token });
        const data = await user.getUser();
        req.session.access_token = response.data.access_token;
        req.session.refresh_token = response.data.refresh_token;
        req.session.logged_in = true;
        req.session.user_id = data.id;
        req.session.email = data.email;
        req.session.user_name = data.username;
        req.session.avatar = data.avatar;
        user.setClientInfo(req.session);
        await user.guildMemberCheck();
        const customer = new StripeClient(req.session);
        customer.insertDbRecord();
        req.session.perms = await user.getPerms();
        const perms = req.session.perms;
        const valid = perms.map !== false;
        const url = `http://ip-api.com/json/${req.session.ip_address}?fields=66846719&lang=${config.locale || 'en'}`;
        const geoResponse = await axios.get(url);
        req.session.geo = geoResponse.data;
        req.session.client_info = req.headers['user-agent'];
        req.session.provider = `${req.session.geo['isp']}, ${req.session.geo['as']}`;
        req.session.mobile = `${req.session.geo['mobile']}`;
        req.session.save();
        const embed = {
            color: 0xFF0000,
            title: 'User Failed Authentication',
            author: {
                name: `${req.session.user_name} (${req.session.user_id})`,
                icon_url: `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`,
            },
            fields: [
                { 
                    name: 'Client Info',  
                    value: req.session.client_info
                },
                { 
                    name: 'Ip Address',
                    value: `${req.session.ip_address}` 
                },
                {
                    name: 'Geo Lookup',
                    value: `${req.session.geo['city']}, ${req.session.geo['regionName']}, ${req.session.geo['zip']}` 
                },
                {
                    name: 'Network Provider',
                    value: `${req.session.geo['isp']}, ${req.session.geo['as']}`
                },
                {
                    name: 'Mobile',
                    value: `${req.session.geo['mobile']}`,
                    inline: true
                },
                {
                    name: 'Proxy',
                    value: `${req.session.geo['proxy']}`,
                    inline: true
                },
                {
                    name: 'Hosting',
                    value: `${req.session.geo['hosting']}`,
                    inline: true
                },
            ],
            footer: {
                text: `${getTime('full')} | ${req.sessionID}`
            }
        };
        let redirect;
        if (valid) {
            embed.title = 'Authenticated Successfully via Oauth';
            embed.color = 0x00FF00;
            redirect = '/';
            console.log(`[MapJS] [${getTime()}] [services/discord.js] ${user.userName} (${user.userId}) - Authenticated Successfully via Oauth.`);
            customer.insertAccessLog('Authenticated Successfully using Discord Oauth.');
        } else if (config.denylist.includes(req.session.user_id)) {
            embed.title = 'Blocked Login Attempt';
            embed.color = 0xFF0000;
            redirect = '/blocked';
            console.warn(`[MapJS] [${getTime()}] [services/discord.js] ${user.userName} (${user.userId}) - Blocked Login Attempt.`);
            customer.insertAccessLog('Blocked Login Attempt.');
        } else if (config.suspendedlist.includes(req.session.user_id)) {
            embed.title = 'Suspended Login Attempt';
            embed.color = 0xFF0000;
            redirect = '/blocked';
            console.warn(`[MapJS] [${getTime()}] [services/discord.js] ${user.userName} (${user.userId}) - Suspended Login Attempt.`);
            customer.insertAccessLog('Suspended Login Attempt.');
        } else {
            console.warn(`[MapJS] [${getTime()}] [services/discord.js] ${user.userName} (${user.userId}) - Authentication Attempt via Oauth.`);
            redirect = '/subscribe';
            customer.insertAccessLog('Authentication Attempt usign Discord Oauth.');
        }
        await user.sendMessage(req.session.access_log_channel, {embed: embed}).catch(console.error);
        return res.redirect(redirect);
    }).catch(error => {
        console.error(error);
        //throw new Error('UnableToFetchToken');
    });
}));

function getTime (type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do h:mmA');
        case 'unix':
            return moment().unix();
        case 'ms':
            return moment().valueOf();
        default:
            return moment().format('hh:mmA');
    }
}

module.exports = router;
