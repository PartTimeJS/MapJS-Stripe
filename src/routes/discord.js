'use strict';

const express = require('express');
const axios = require('axios');
const router = express.Router();
const moment = require('moment');

const DiscordClient = require('../services/discord.js');
const StripeClient = require('../services/stripe.js');
//const utils = require('../services/utils.js');

const defaultData = require('../data/default.js');
const config = require('../services/config.js');
const discords = require('../configs/discords.json').discords;

const catchAsyncErrors = fn => ((req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
        routePromise.catch(err => next(err));
    }
});


router.get('/login', (req, res) => {
    let discord;
    if(discords.length > 1){
        for(let d = 0, dlen = discords.length; d < dlen; d++){
            if(('https://' + req.get('host')) === discords[d].domain){
                discord = discords[d]; break;
            }
        }
    } else { 
        discord = discords[0];
    }
    req.session.guild_id = discord.id;
    req.session.plan_id = discord.plan_id;
    req.session.amt = discord.plan_cost;
    req.session.donor_role = discord.role;
    req.session.access_log_channel = discord.access_log_channel;
    req.session.stripe_log_channel = discord.stripe_log_channel;
    req.session.map_name = discord.name;
    req.session.map_url = discord.domain;
    req.session.save();
    const redirect = encodeURIComponent('https://' + req.get('host') + '/api/discord/callback');
    const scope = 'guilds%20identify%20email';
    res.redirect(`https://discordapp.com/api/oauth2/authorize?client_id=${config.discord.clientId}&scope=${scope}&response_type=code&redirect_uri=${redirect}`);
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
        const user = new DiscordClient({ access_token: response.data.access_token });
        const data = await user.getUser();
        req.session.access_token = response.data.access_token;
        req.session.refresh_token = response.data.refresh_token;
        req.session.logged_in = true;
        req.session.user_id = data.id;
        req.session.email = data.email;
        req.session.user_name = data.username;
        if(config.denylist.includes(req.session.user_id)){
            return res.render('blocked', defaultData);
        }
        user.setClientInfo(req.session);
        const customer = new StripeClient(req.session);
        const perms = await user.getPerms();
        req.session.perms = perms;
        const isMember = await user.guildMemberCheck();
        if(!isMember){
            await user.sendDmEmbed(req.session.user_id, '00FF00', `Welcome to ${req.session.map_name}!`, config.join_welcome_content.replace('%map_url%', req.session.map_url));
        } 
        const valid = perms.map !== false;
        req.session.valid = valid;
        req.session.save();
        if(valid) {
            console.log(`[MapJS] [${getTime()}] [services/discord.js] ${user.userName} (${user.userId}) - Authenticated Successfully via Oauth.`);
            customer.insertAccessLog('Authenticated Successfully using Discord Oauth.');
            if(req.session.access_log_channel){
                await user.sendChannelEmbed(req.session.access_log_channel, '00FF00', 'Authenticated Successfully via Oauth.', '');
            }
            return res.redirect('/');
        } else {
            console.warn(`[MapJS] [${getTime()}] [services/discord.js] ${user.userName} (${user.userId}) - Unauthorized Access Attempt via Oauth.`);
            customer.insertAccessLog('Unauthorized Access Attempt using Discord Oauth.');
            if(req.session.access_log_channel){
                await user.sendChannelEmbed(req.session.access_log_channel, 'Unauthorized Access Attempt via Oauth.', '');
            }
            return res.redirect('/subscribe');
        }
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
